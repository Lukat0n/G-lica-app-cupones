// Endpoint público que consulta el cartel de la página "pago confirmado".
// GET /app/cupon-orden?store=123&url=<url de la página>&cart=<id del carrito>
// La orden se identifica por la URL de la página de éxito, que contiene el id y/o el token
// secreto de la orden. Solo se muestra el código si el token de la orden aparece en la URL
// (o sea: solo quien compró puede verlo).
import { db, TN } from "../_shared/tiendanube.ts";
import { cargarConfig, crearCuponParaOrden, previsualizar } from "../_shared/cupones.ts";
import { pesos } from "../_shared/logic.ts";
import { variables } from "../_shared/avisos.ts";
import { plantilla, textosEfectivos } from "../_shared/textos.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const VENTANA_MS = 7 * 86_400_000; // la página de seguimiento se puede reabrir varios días después

function piezas(url: string): string[] {
  try {
    const u = new URL(url);
    return [...u.pathname.split("/"), ...[...u.searchParams.values()]].map((x) => x.trim()).filter(Boolean);
  } catch {
    return url.split(/[/?&=#]/).filter(Boolean);
  }
}

/** Encuentra la orden de esta página. Devuelve null si no hay coincidencia segura. */
async function resolverOrden(tn: TN, url: string, cartId: string) {
  const p = piezas(url);
  const coincide = (o: any) =>
    o && ((o.token && p.includes(String(o.token))) ||
      (cartId && (String(o.cart_id ?? "") === cartId || String(o.checkout_id ?? "") === cartId)));

  // 1) números de la URL que podrían ser el id de la orden
  for (const n of p.filter((x) => /^\d{6,}$/.test(x))) {
    const o = await tn.orden(Number(n)).catch(() => null);
    if (coincide(o)) return o;
  }
  // 2) órdenes de las últimas 6 horas
  const desde = new Date(Date.now() - 6 * 3600_000).toISOString();
  const recientes: any[] = await tn.req("GET",
    `/orders?created_at_min=${encodeURIComponent(desde)}&per_page=100`).catch(() => []);
  return recientes.find(coincide) ?? null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const u = new URL(req.url);
  const storeId = Number(u.searchParams.get("store"));
  const url = u.searchParams.get("url") ?? "";
  const cartId = u.searchParams.get("cart") ?? "";
  if (!storeId || (!url && !cartId)) return json({ estado: "error" }, 400);

  try {
    const tn = await TN.para(storeId);
    const order = await resolverOrden(tn, url, cartId);
    if (!order) {
      console.log("cupon-orden: sin coincidencia", JSON.stringify({ url, cartId }));
      return json({ estado: "no_encontrada" });
    }
    if (Date.now() - Date.parse(order.created_at) > VENTANA_MS) return json({ estado: "no_disponible" });

    const s = db();
    const ya = await s.from("cupones").select("*").eq("store_id", storeId).eq("order_id", order.id).maybeSingle();
    let cupon = ya.data && ya.data.estado !== "creando" ? ya.data : null;
    if (!cupon && order.payment_status === "paid") cupon = await crearCuponParaOrden(storeId, order.id);

    if (!cupon) {
      const p = await previsualizar(storeId, order);
      if (!p || order.payment_status === "paid") return json({ estado: "sin_cupon" });
      return json({
        estado: "pago_pendiente",
        monto: p.escala.monto_cupon,
        monto_texto: pesos(p.escala.monto_cupon),
        dias_validez: p.cfg.dias_validez,
      });
    }
    if (cupon.estado === "anulado") return json({ estado: "sin_cupon" });
    const { cfg } = await cargarConfig(storeId);
    const v = variables(cupon, cfg);
    const T = textosEfectivos(cfg.textos).checkout;
    const r = (x: string) => plantilla(x, v);
    return json({
      estado: "listo",
      usado: cupon.estado === "usado",
      slot: cfg.slot_checkout || "after_order_number",
      codigo: cupon.codigo,
      monto_texto: v.monto,
      link: v.link,
      etiqueta: r(T.etiqueta),
      titulo: r(T.titulo),
      bajada: r(T.bajada),
      boton: r(T.boton),
      codigo_linea: r(T.codigo_linea),
    });
  } catch (e) {
    console.error("cupon-orden", storeId, url, e);
    return json({ estado: "error" }, 500);
  }
}
