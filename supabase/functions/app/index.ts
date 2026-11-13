// Una sola función con 3 rutas:
//   /functions/v1/app/webhook        <- webhooks de Tiendanube (order/paid, order/cancelled, app/uninstalled)
//   /functions/v1/app/cupon-orden    <- lo consulta el cartel de "pago confirmado"
//   /functions/v1/app/recordatorios  <- lo dispara el cron diario
import webhook from "./webhook.ts";
import cuponOrden from "./cupon-orden.ts";
import recordatorios from "./recordatorios.ts";
import { pruebaMail, reenviar } from "./admin.ts";
import { panel } from "./panel.ts";

Deno.serve((req) => {
  const ruta = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (ruta === "webhook") return webhook(req);
  if (ruta === "cupon-orden") return cuponOrden(req);
  if (ruta === "recordatorios") return recordatorios(req);
  if (ruta === "prueba-mail") return pruebaMail(req);
  if (ruta === "reenviar") return reenviar(req);
  if (ruta && ruta.startsWith("panel-")) return panel(req, ruta);
  return new Response("not found", { status: 404 });
});
