-- =====================================================================
-- Gelica · Cupones de recompra
-- Todo lo "editable" (días de validez, escalas, recordatorios) vive en
-- las tablas `configuracion` y `escalas`. Se editan desde el Table Editor
-- de Supabase como si fuera una planilla.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Tiendas que instalaron la app (en la práctica: solo Gelica)
create table if not exists tiendas (
  store_id        bigint primary key,
  access_token    text not null,
  scope           text,
  instalada_en    timestamptz not null default now(),
  desinstalada_en timestamptz
);

-- Configuración general (una fila por tienda)
create table if not exists configuracion (
  store_id              bigint primary key references tiendas(store_id) on delete cascade,
  activa                boolean not null default true,
  -- Duración del cupón en días. Cambiala acá cuando quieras (afecta a cupones NUEVOS).
  dias_validez          int     not null default 20 check (dias_validez between 1 and 365),
  -- Sobre qué monto se calcula la escala:
  --   'total_sin_envio' = lo que pagó el cliente, sin contar el envío (recomendado)
  --   'total'           = lo que pagó, incluido el envío
  --   'subtotal'        = precio de lista de los productos, antes de descuentos
  base_monto            text    not null default 'total_sin_envio'
                        check (base_monto in ('total_sin_envio','total','subtotal')),
  -- ¿El cupón se puede sumar a otras promos (ej. 3x2)?
  combina_con_promos    boolean not null default false,
  -- Recordatorios: días antes del vencimiento y canal ('email' | 'whatsapp')
  recordatorios         jsonb   not null default
    '[{"dias_antes":7,"canal":"email"},{"dias_antes":3,"canal":"email"},{"dias_antes":2,"canal":"whatsapp"}]',
  aviso_inicial_email   boolean not null default true,
  aviso_inicial_whatsapp boolean not null default true,
  -- Origen de órdenes que NO generan cupón ('meli' = Mercado Libre)
  origenes_excluidos    text[]  not null default '{meli}',
  nombre_tienda         text    not null default 'GELICA',
  url_tienda            text    not null default 'https://www.gelica.com.ar',
  prefijo_codigo        text    not null default 'GELICA' check (prefijo_codigo ~ '^[A-Z0-9]{0,10}$'),
  actualizada_en        timestamptz not null default now()
);

-- Escalas: si  monto > desde  y  monto <= hasta  (hasta NULL = sin tope)  => cupón de $monto_cupon
create table if not exists escalas (
  id            bigserial primary key,
  store_id      bigint not null references tiendas(store_id) on delete cascade,
  desde         numeric(12,2) not null default 0,
  hasta         numeric(12,2),
  monto_cupon   numeric(12,2) not null check (monto_cupon > 0),
  -- Compra mínima para poder USAR el cupón (NULL = sin mínimo)
  compra_minima numeric(12,2),
  check (hasta is null or hasta > desde)
);
create index if not exists escalas_store_idx on escalas(store_id, desde);

-- Cupones generados (uno por orden pagada)
create table if not exists cupones (
  id                 uuid primary key default gen_random_uuid(),
  store_id           bigint not null references tiendas(store_id) on delete cascade,
  order_id           bigint not null,
  order_number       bigint,
  order_creada_en    timestamptz,
  monto_base         numeric(12,2) not null,
  monto_cupon        numeric(12,2) not null,
  compra_minima      numeric(12,2),
  codigo             text unique,
  tn_coupon_id       bigint,
  vence_el           date,
  estado             text not null default 'creando'
                     check (estado in ('creando','activo','usado','vencido','anulado')),
  usado_en           timestamptz,
  usado_en_order_id  bigint,
  cliente_nombre     text,
  cliente_email      text,
  cliente_telefono   text,
  creado_en          timestamptz not null default now(),
  unique (store_id, order_id)
);
create index if not exists cupones_estado_idx on cupones(estado, vence_el);

-- Registro de avisos enviados (evita duplicados)
create table if not exists avisos (
  id          bigserial primary key,
  cupon_id    uuid not null references cupones(id) on delete cascade,
  tipo        text not null,          -- 'inicial' | 'recordatorio_7' | ...
  canal       text not null,          -- 'email' | 'whatsapp'
  estado      text not null default 'enviado', -- 'enviado' | 'error'
  detalle     text,
  enviado_en  timestamptz not null default now(),
  unique (cupon_id, tipo, canal)
);

-- Nadie entra a estas tablas desde el navegador: solo las Edge Functions (service role)
alter table tiendas       enable row level security;
alter table configuracion enable row level security;
alter table escalas       enable row level security;
alter table cupones       enable row level security;
alter table avisos        enable row level security;

-- Escalas por defecto al instalar
create or replace function cargar_config_por_defecto(p_store bigint) returns void
language plpgsql as $$
begin
  insert into configuracion(store_id) values (p_store) on conflict do nothing;
  if not exists (select 1 from escalas where store_id = p_store) then
    insert into escalas(store_id, desde, hasta, monto_cupon) values
      (p_store,      0,  70000,  6000),
      (p_store,  70000, 190000, 10000),
      (p_store, 190000, 250000, 20000),
      (p_store, 250000, 400000, 30000),
      (p_store, 400000,   null, 42000);
  end if;
end $$;

-- Vista rápida para ver cómo viene la campaña
create or replace view resumen_cupones as
select
  store_id,
  count(*) filter (where estado <> 'anulado')                       as emitidos,
  count(*) filter (where estado = 'activo')                         as activos,
  count(*) filter (where estado = 'usado')                          as usados,
  count(*) filter (where estado = 'vencido')                        as vencidos,
  round(100.0 * count(*) filter (where estado = 'usado')
        / nullif(count(*) filter (where estado in ('usado','vencido')),0), 1) as tasa_uso_pct,
  sum(monto_cupon) filter (where estado = 'usado')                  as pesos_canjeados
from cupones group by store_id;
