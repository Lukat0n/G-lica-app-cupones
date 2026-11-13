// Recibe los webhooks de Tiendanube. Responde 200 al instante (Tiendanube corta a los 3 s)
// y procesa en segundo plano.
import { db, firmaValida, TN } from "../_shared/tiendanube.ts";
import { anularPorCancelacion, crearCuponParaOrden, registrarUso } from "../_shared/cupones.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

async function procesar(ev: { store_id: number; event: string; id: number }) {
  const storeId = Number(ev.store_id);
  switch (ev.event) {
    case "order/paid": {
      const tn = await TN.para(storeId);
      const order = await tn.orden(ev.id);
      await registrarUso(storeId, order);       // ¿usó un cupón nuestro? => no más recordatorios
      await crearCuponParaOrden(storeId, ev.id); // cupón nuevo para esta compra
      break;
    }
    case "order/cancelled":
      await anularPorCancelacion(storeId, ev.id);
      break;
    case "app/uninstalled":
      await db().from("tiendas").update({ desinstalada_en: new Date().toISOString() }).eq("store_id", storeId);
      break;
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  if (!(await firmaValida(raw, req.headers.get("x-linkedstore-hmac-sha256")))) {
    return new Response("firma inválida", { status: 401 });
  }
  const ev = JSON.parse(raw);
  const tarea = procesar(ev).catch(async (e) => {
    console.error("webhook", ev, e);
  });
  EdgeRuntime.waitUntil(tarea);
  return new Response("ok");
}
