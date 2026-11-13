// Núcleo: crear el cupón de una orden, marcarlo usado, anularlo
import { db, TN } from "./tiendanube.ts";
import {
  type BaseMonto, calcularVencimiento, codigosUsados, type Escala, escalaPara, generarCodigo, hoyAR, montoBase,
  telefonoAR,
} from "./logic.ts";
import { avisoInicial } from "./avisos.ts";
import { idsDeOrden } from "./recomendar.ts";

export type Config = {
  store_id: number;
  activa: boolean;
  dias_validez: number;
  base_monto: BaseMonto;
  combina_con_promos: boolean;
  recordatorios: { dias_antes: number; canal: "email" | "whatsapp" }[];
  aviso_inicial_email: boolean;
  aviso_inicial_whatsapp: boolean;
  origenes_excluidos: string[];
  nombre_tienda: string;
  url_tienda: string;
  prefijo_codigo: string;
  vencimiento_modo: "dias" | "fecha";
  vencimiento_fecha: string | null;
  slot_checkout: string;
  textos: Record<string, unknown>;
  recomendaciones: Record<string, unknown>;
};

export async function cargarConfig(storeId: number): Promise<{ cfg: Config; escalas: Escala[] }> {
  const s = db();
  const [{ data: cfg, error: e1 }, { data: escalas, error: e2 }] = await Promise.all([
    s.from("configuracion").select("*").eq("store_id", storeId).single(),
    s.from("escalas").select("desde,hasta,monto_cupon,compra_minima").eq("store_id", storeId),
  ]);
  if (e1 || !cfg) throw new Error(`Sin configuración para tienda ${storeId}`);
  if (e2) throw e2;
  return { cfg: cfg as Config, escalas: (escalas ?? []) as Escala[] };
}

export function datosCliente(order: any) {
  const nombre = order.contact_name || order.customer?.name || order.billing_name || "";
  const email = order.contact_email || order.customer?.email || null;
  const telRaw = order.contact_phone || order.customer?.phone || order.shipping_address?.phone ||
    order.billing_phone || null;
  return {
    cliente_nombre: String(nombre).trim().split(/\s+/)[0] || null, // solo el nombre de pila
    cliente_email: email,
    cliente_telefono: telefonoAR(telRaw) ?? (telRaw ? String(telRaw) : null),
  };
}

/** Qué cupón le corresponde a esta orden (sin crear nada). */
export async function previsualizar(storeId: number, order: any) {
  const { cfg, escalas } = await cargarConfig(storeId);
  if (!cfg.activa) return null;
  if (cfg.origenes_excluidos.includes(order.storefront)) return null;
  const base = montoBase(order, cfg.base_monto);
  const escala = escalaPara(base, escalas);
  if (!escala) return null;
  return { cfg, base, escala };
}

/**
 * Crea (una sola vez) el cupón de una orden pagada. Idempotente: si llega el webhook
 * dos veces, o el webhook y la página de "pago confirmado" a la vez, se crea uno solo.
 */
export async function crearCuponParaOrden(storeId: number, orderId: number) {
  const s = db();
  const existente = await s.from("cupones").select("*").eq("store_id", storeId).eq("order_id", orderId)
    .maybeSingle();
  if (existente.data && existente.data.estado !== "creando") return existente.data;

  const tn = await TN.para(storeId);
  const order = await tn.orden(orderId);
  if (order.payment_status !== "paid") return null;
  if (order.status === "cancelled") return null;

  const p = await previsualizar(storeId, order);
  if (!p) return null;
  const { cfg, base, escala } = p;

  // 1) Reservamos la fila (unique store_id+order_id): si otro proceso ganó, devolvemos lo suyo
  const reserva = await s.from("cupones").insert({
    store_id: storeId,
    order_id: orderId,
    order_number: order.number,
    order_creada_en: order.created_at,
    monto_base: base,
    monto_cupon: escala.monto_cupon,
    compra_minima: escala.compra_minima,
    productos_comprados: idsDeOrden(order).map(Number),
    ...datosCliente(order),
  }).select("id").single();

  if (reserva.error) {
    if (reserva.error.code !== "23505") throw reserva.error; // 23505 = ya existe
    // Otro proceso lo está creando: esperamos un toque y devolvemos lo que haya
    for (let i = 0; i < 6; i++) {
      await new Promise((ok) => setTimeout(ok, 500));
      const r = await s.from("cupones").select("*").eq("store_id", storeId).eq("order_id", orderId).single();
      if (r.data && r.data.estado !== "creando") return r.data;
    }
    // Quedó colgado (ej. un intento anterior falló a mitad): lo retomamos
    const r = await s.from("cupones").select("id,creado_en").eq("store_id", storeId).eq("order_id", orderId)
      .single();
    if (!r.data || Date.now() - Date.parse(r.data.creado_en) < 60_000) return null;
    return await emitir(storeId, r.data.id, tn, cfg, escala, datosCliente(order).cliente_nombre);
  }
  return await emitir(storeId, reserva.data.id, tn, cfg, escala, datosCliente(order).cliente_nombre);
}

async function emitir(
  storeId: number, filaId: string, tn: TN, cfg: Config, escala: Escala, nombre: string | null,
) {
  const s = db();
  const venceEl = calcularVencimiento(hoyAR(), cfg.vencimiento_modo, cfg.dias_validez, cfg.vencimiento_fecha);
  let creado: any = null;
  let codigo = "";
  for (let intento = 0; intento < 4 && !creado; intento++) {
    codigo = generarCodigo(nombre, escala.monto_cupon, cfg.prefijo_codigo || "GELICA");
    try {
      creado = await tn.crearCupon({
        code: codigo,
        type: "absolute",
        value: escala.monto_cupon.toFixed(2),
        valid: true,
        max_uses: 1,
        start_date: hoyAR(),
        end_date: venceEl,
        ...(escala.compra_minima ? { min_price: escala.compra_minima } : {}),
        combines_with_other_discounts: cfg.combina_con_promos,
        includes_shipping: false,
        first_consumer_purchase: false,
      });
    } catch (e) {
      // Código repetido (rarísimo): probamos con otro
      if (!String(e).includes("422") || intento === 3) {
        await s.from("cupones").delete().eq("id", filaId).eq("estado", "creando"); // libera para reintentar
        throw e;
      }
    }
  }
  const { data, error } = await s.from("cupones").update({
    codigo,
    tn_coupon_id: creado.id,
    vence_el: venceEl,
    estado: "activo",
  }).eq("id", filaId).select("*").single();
  if (error) throw error;

  await avisoInicial(data, cfg).catch((e) => console.error("aviso inicial", e));
  return data;
}

/** Si la orden usó un cupón nuestro, lo marcamos como usado (corta los recordatorios). */
export async function registrarUso(storeId: number, order: any) {
  const codigos = codigosUsados(order);
  if (!codigos.length) return;
  await db().from("cupones")
    .update({ estado: "usado", usado_en: new Date().toISOString(), usado_en_order_id: order.id })
    .eq("store_id", storeId).in("codigo", codigos).eq("estado", "activo");
}

/** Orden cancelada => su cupón (si no se usó) se desactiva. Evita "compro, me llevo el cupón, cancelo". */
export async function anularPorCancelacion(storeId: number, orderId: number) {
  const s = db();
  const { data } = await s.from("cupones").select("*").eq("store_id", storeId).eq("order_id", orderId)
    .eq("estado", "activo").maybeSingle();
  if (!data?.tn_coupon_id) return;
  const tn = await TN.para(storeId);
  await tn.editarCupon(data.tn_coupon_id, {
    code: data.codigo, type: "absolute", value: Number(data.monto_cupon).toFixed(2), valid: false,
  });
  await s.from("cupones").update({ estado: "anulado" }).eq("id", data.id);
}
