// API del panel de configuración (lo usa el panel publicado en Vercel).
// Todas las rutas piden el header x-panel-key con la clave del panel.
//   GET  /app/panel-datos           -> configuración, escalas, textos, estadísticas
//   POST /app/panel-guardar         -> guarda configuración + escalas + textos
//   POST /app/panel-preview         -> devuelve el HTML del mail y los textos del checkout con un borrador (sin guardar)
//   POST /app/panel-prueba          -> manda un mail de prueba con la configuración guardada
import { db, TN } from "../_shared/tiendanube.ts";
import { cargarConfig, type Config, crearCuponPrueba } from "../_shared/cupones.ts";
import { type Cupon, enviarMail, htmlMail, linkSaldo, type Reco, textos, type Tipo, variables } from "../_shared/avisos.ts";
import { catalogo, elegirRecomendacion } from "../_shared/recomendar.ts";
import { calcularVencimiento, hoyAR, pesos, sumarDias } from "../_shared/logic.ts";
import { plantilla, TEXTOS_DEFAULT, textosEfectivos } from "../_shared/textos.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-panel-key",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const CAMPOS_EDITABLES = [
  "activa", "dias_validez", "vencimiento_modo", "vencimiento_fecha", "base_monto", "combina_con_promos",
  "recordatorios", "aviso_inicial_email", "aviso_inicial_whatsapp", "slot_checkout", "url_tienda", "textos",
  "recomendaciones",
] as const;

async function tiendaId(): Promise<number> {
  const { data } = await db().from("tiendas").select("store_id").is("desinstalada_en", null).limit(1).single();
  if (!data) throw new Error("No hay tienda instalada");
  return Number(data.store_id);
}

async function autorizado(req: Request) {
  const clave = req.headers.get("x-panel-key") ?? "";
  if (clave.length < 6) return false;
  const { data } = await db().from("secretos_internos").select("valor").eq("nombre", "panel").single();
  return !!data?.valor && data.valor === clave;
}

function cuponEjemplo(cfg: Config, monto = 10000, nombre = "Dani", diasRestantes?: number): Cupon {
  const vence = diasRestantes !== undefined
    ? sumarDias(hoyAR(), diasRestantes)
    : calcularVencimiento(hoyAR(), cfg.vencimiento_modo, cfg.dias_validez, cfg.vencimiento_fecha);
  return {
    id: "ejemplo", codigo: `${nombre.toUpperCase()}${monto}K7P`, monto_cupon: monto, compra_minima: null,
    vence_el: vence, cliente_nombre: nombre, cliente_email: null, cliente_telefono: null, order_number: 31007,
  };
}

function validar(cfg: any, escalas: any[]): string | null {
  if (cfg.dias_validez !== undefined && !(cfg.dias_validez >= 1 && cfg.dias_validez <= 365)) return "Los días tienen que estar entre 1 y 365";
  if (cfg.vencimiento_modo === "fecha" && !cfg.vencimiento_fecha) return "Elegí la fecha de vencimiento";
  if (!Array.isArray(escalas) || !escalas.length) return "Tiene que haber al menos una escala";
  const ord = [...escalas].sort((a, b) => Number(a.desde) - Number(b.desde));
  for (let i = 0; i < ord.length; i++) {
    const e = ord[i];
    if (!(Number(e.monto_cupon) > 0)) return "Cada escala necesita un monto de saldo mayor a 0";
    if (e.hasta !== null && e.hasta !== "" && Number(e.hasta) <= Number(e.desde)) return `La escala desde ${e.desde} tiene "hasta" menor o igual a "desde"`;
    if (i > 0 && Number(ord[i - 1].hasta) !== Number(e.desde)) return `Hay un hueco o superposición entre escalas cerca de $${e.desde}`;
  }
  for (const r of cfg.recordatorios ?? []) {
    if (!(r.dias_antes >= 0 && r.dias_antes <= 60) || !["email", "whatsapp"].includes(r.canal)) return "Recordatorio inválido";
  }
  if (cfg.recomendaciones !== undefined && (typeof cfg.recomendaciones !== "object" || Array.isArray(cfg.recomendaciones))) return "Recomendaciones inválidas";
  return null;
}

export async function panel(req: Request, ruta: string): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (!(await autorizado(req))) return json({ error: "Clave incorrecta" }, 401);
  const s = db();
  const storeId = await tiendaId();

  try {
    if (ruta === "panel-datos") {
      const { cfg, escalas } = await cargarConfig(storeId);
      const [{ data: resumen }, { data: ultimos }] = await Promise.all([
        s.from("resumen_cupones").select("*").eq("store_id", storeId).maybeSingle(),
        s.from("cupones").select("order_number,monto_base,monto_cupon,codigo,vence_el,estado,cliente_nombre,creado_en")
          .eq("store_id", storeId).not("estado", "in", "(creando,prueba)").order("creado_en", { ascending: false }).limit(50),
      ]);
      const { data: escalasFull } = await s.from("escalas").select("desde,hasta,monto_cupon,compra_minima")
        .eq("store_id", storeId).order("desde");
      return json({
        cfg, escalas: escalasFull ?? escalas, textos_default: TEXTOS_DEFAULT,
        textos: textosEfectivos(cfg.textos), resumen: resumen ?? {}, ultimos: ultimos ?? [],
      });
    }

    if (ruta === "panel-guardar") {
      const body = await req.json();
      const cambios: Record<string, unknown> = {};
      for (const k of CAMPOS_EDITABLES) if (k in (body.cfg ?? {})) cambios[k] = body.cfg[k];
      const err = validar(cambios, body.escalas);
      if (err) return json({ error: err }, 400);
      cambios.actualizada_en = new Date().toISOString();
      const up = await s.from("configuracion").update(cambios).eq("store_id", storeId);
      if (up.error) return json({ error: up.error.message }, 400);
      await s.from("escalas").delete().eq("store_id", storeId);
      const ins = await s.from("escalas").insert(body.escalas.map((e: any) => ({
        store_id: storeId,
        desde: Number(e.desde),
        hasta: e.hasta === null || e.hasta === "" ? null : Number(e.hasta),
        monto_cupon: Number(e.monto_cupon),
        compra_minima: e.compra_minima === null || e.compra_minima === "" ? null : Number(e.compra_minima),
      })));
      if (ins.error) return json({ error: ins.error.message }, 400);
      return json({ ok: true });
    }

    if (ruta === "panel-preview") {
      const body = await req.json();
      const { cfg: guardada } = await cargarConfig(storeId);
      const cfg = { ...guardada, ...(body.cfg ?? {}) } as Config;
      const tipo = (body.tipo ?? "inicial") as Tipo;
      const dias = tipo === "inicial" ? undefined : Number(String(tipo).split("_")[1]);
      const c = cuponEjemplo(cfg, Number(body.monto ?? 10000), body.nombre ?? "Dani", dias);
      // recomendación de ejemplo: como si hubiera comprado body.comprado (id de producto)
      let reco: Reco = null;
      const tn = await TN.para(storeId);
      const rc = (cfg.recomendaciones ?? {}) as any;
      const cat = await catalogo(tn, rc).catch(() => []);
      const comprado = String(body.comprado ?? rc.prioridad?.[0] ?? "");
      const p = elegirRecomendacion(cat, new Set([comprado]), rc, [comprado]);
      if (p) {
        reco = {
          producto: p, precio_con_saldo: Math.max(0, p.precio - c.monto_cupon),
          link: linkSaldo(cfg.url_tienda.replace(/\/$/, ""), c.codigo, p),
        };
      }
      const t = textos(c, cfg, tipo, reco);
      const v = variables(c, cfg);
      const T = textosEfectivos(cfg.textos);
      const r = (x: string) => plantilla(x, v);
      // el WhatsApp de recordatorio se muestra como si faltaran 2 días
      const v2 = variables(cuponEjemplo(cfg, Number(body.monto ?? 10000), body.nombre ?? "Dani", 2), cfg);
      return json({
        asunto: t.asunto,
        html: htmlMail(c, cfg, tipo, reco),
        recomendado: reco ? reco.producto.nombre : null,
        whatsapp: t.whatsapp,
        whatsapp_recordatorio: plantilla(T.whatsapp_recordatorio, v2),
        checkout: {
          etiqueta: r(T.checkout.etiqueta), titulo: r(T.checkout.titulo), bajada: r(T.checkout.bajada),
          boton: r(T.checkout.boton), codigo_linea: r(T.checkout.codigo_linea),
        },
        vence_el: c.vence_el,
      });
    }

    if (ruta === "panel-productos") {
      const { cfg } = await cargarConfig(storeId);
      const tn = await TN.para(storeId);
      const cat = await catalogo(tn, (cfg.recomendaciones ?? {}) as any);
      return json({
        productos: cat.map((p) => ({ ...p, precio_txt: pesos(p.precio) })),
        recomendaciones: cfg.recomendaciones ?? {},
      });
    }

    if (ruta === "panel-prueba") {
      const body = await req.json();
      const { cfg } = await cargarConfig(storeId);
      const tipo = (body.tipo ?? "inicial") as Tipo;
      const dias = tipo === "inicial" ? undefined : Number(String(tipo).split("_")[1]);
      const rc = (cfg.recomendaciones ?? {}) as any;
      const comprado = String(body.comprado ?? rc.prioridad?.[0] ?? "");
      const c = await crearCuponPrueba(storeId, {
        email: body.to, nombre: body.nombre ?? "Dani", monto: Number(body.monto ?? 10000),
        dias: dias ?? cfg.dias_validez, comprados: comprado ? [comprado] : [],
      });
      await enviarMail(c, cfg, tipo);
      return json({ ok: true });
    }
  } catch (e) {
    console.error("panel", ruta, e);
    return json({ error: String(e) }, 500);
  }
  return json({ error: "ruta" }, 404);
}
