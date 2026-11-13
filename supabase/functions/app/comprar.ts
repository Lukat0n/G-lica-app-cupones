// GET /app/comprar?c=CODIGO&p=PRODUCTO&s=FIRMA
// Arma un pedido borrador con el producto, el saldo descontado y los datos de la última compra,
// y redirige al checkout de Tiendanube (el cliente elige envío y pago).
// Si algo no se puede (talles, saldo vencido, error), cae a la página del producto con el saldo cargado.
import { db, TN } from "../_shared/tiendanube.ts";
import { cargarConfig } from "../_shared/cupones.ts";
import { catalogo } from "../_shared/recomendar.ts";
import { firmaOk } from "../_shared/firma.ts";
import { hoyAR } from "../_shared/logic.ts";

const ir = (url: string) => new Response(null, { status: 302, headers: { Location: url } });

async function ultimaOrden(tn: TN, email: string | null) {
  if (!email) return null;
  const mail = email.trim().toLowerCase();
  const ordenes: any[] = await tn.req("GET", `/orders?q=${encodeURIComponent(mail)}&per_page=20`).catch(() => []);
  return ordenes
    .filter((o) => String(o.contact_email ?? "").toLowerCase() === mail && o.status !== "cancelled")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null;
}

function separarNombre(completo: string): [string, string] {
  const partes = String(completo ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return [partes[0] ?? "Cliente", "-"];
  return [partes.slice(0, -1).join(" "), partes[partes.length - 1]];
}

export default async function handler(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const codigo = u.searchParams.get("c") ?? "";
  const productoId = u.searchParams.get("p") ?? "";
  const firma = u.searchParams.get("s") ?? "";
  const s = db();

  const { data: cupon } = await s.from("cupones").select("*").eq("codigo", codigo).maybeSingle();
  const storeId = Number(cupon?.store_id ?? 0);
  let base = "https://www.gelica.com.ar";
  try {
    if (!cupon || !(await firmaOk(`${codigo}:${productoId}`, firma))) return ir(base);
    const { cfg } = await cargarConfig(storeId);
    base = cfg.url_tienda.replace(/\/$/, "");
    const tn = await TN.para(storeId);
    const cat = await catalogo(tn, (cfg.recomendaciones ?? {}) as any);
    const prod = cat.find((p) => p.id === productoId);
    const paginaProducto = prod
      ? `${base}/discount/${codigo}?redirect_to=${encodeURIComponent(`/productos/${prod.handle}/`)}`
      : `${base}/discount/${codigo}`;

    // saldo ya usado, vencido o anulado -> a la tienda (sin descuento mágico)
    if (!["activo", "prueba"].includes(cupon.estado) || cupon.vence_el < hoyAR()) return ir(prod ? `${base}/productos/${prod.handle}/` : base);
    if (!prod?.variant_id || !prod.disponible) return ir(paginaProducto);

    // ¿ya armamos uno hace poco? se reusa (si toca el botón dos veces no duplica pedidos)
    const { data: previo } = await s.from("borradores").select("checkout_url,creado_en")
      .eq("cupon_id", cupon.id).eq("producto_id", Number(productoId)).eq("estado", "pendiente")
      .order("creado_en", { ascending: false }).limit(1).maybeSingle();
    if (previo?.checkout_url) return ir(previo.checkout_url);

    // datos de su última compra (la que generó el saldo)
    const orden: any = Number(cupon.order_id) > 0
      ? await tn.orden(Number(cupon.order_id)).catch(() => null)
      : await ultimaOrden(tn, cupon.cliente_email);
    const [nombre, apellido] = separarNombre(orden?.contact_name ?? orden?.customer?.name ?? cupon.cliente_nombre ?? "");
    const dir = orden?.shipping_address;
    const tieneDireccion = dir && dir.address && dir.zipcode && orden?.shipping_pickup_type !== "pickup";

    const body: Record<string, unknown> = {
      contact_name: nombre,
      contact_lastname: apellido,
      contact_email: cupon.cliente_email ?? orden?.contact_email,
      ...(orden?.contact_phone || cupon.cliente_telefono ? { contact_phone: orden?.contact_phone ?? `+${cupon.cliente_telefono}` } : {}),
      payment_status: "unpaid",
      products: [{ variant_id: prod.variant_id, quantity: 1 }],
      discount: Math.min(Number(cupon.monto_cupon), prod.precio),
      discount_type: "absolute",
      note: `Saldo GELICA ${codigo}`,
      ...(tieneDireccion ? {
        shipping: [{
          shipping_address: {
            address: dir.address, number: dir.number ?? "", floor: dir.floor ?? "",
            locality: dir.locality ?? "", city: dir.city ?? "", province: dir.province ?? "", zipcode: dir.zipcode,
          },
        }],
      } : {}),
    };
    const draft: any = await tn.req("POST", "/draft_orders", body);
    if (!draft?.checkout_url) return ir(paginaProducto);
    await s.from("borradores").insert({
      cupon_id: cupon.id, draft_id: draft.id, producto_id: Number(productoId), checkout_url: draft.checkout_url,
    });
    return ir(draft.checkout_url);
  } catch (e) {
    console.error("comprar", codigo, productoId, e);
    return ir(`${base}/discount/${codigo}`);
  }
}

/** Borra (en Tiendanube) los pedidos borrador pendientes de un cupón. Best effort. */
export async function borrarBorradores(storeId: number, cuponId: string) {
  const s = db();
  const { data } = await s.from("borradores").select("id,draft_id").eq("cupon_id", cuponId).eq("estado", "pendiente");
  if (!data?.length) return;
  const tn = await TN.para(storeId);
  for (const b of data) {
    await tn.req("DELETE", `/draft_orders/${b.draft_id}`).catch(() => {});
    await s.from("borradores").update({ estado: "borrado" }).eq("id", b.id);
  }
}
