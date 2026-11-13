// Rutas internas (solo con la clave del cron):
//   POST /app/prueba-mail  {"to":"vos@mail.com"}   -> manda un mail de muestra
//   POST /app/reenviar     {"codigos":["GELICA6K..."]} -> manda el aviso inicial que quedó pendiente
import { db } from "../_shared/tiendanube.ts";
import { cargarConfig, crearCuponPrueba } from "../_shared/cupones.ts";
import { avisoInicial, enviarMail } from "../_shared/avisos.ts";

async function autorizado(req: Request) {
  const { data } = await db().from("secretos_internos").select("valor").eq("nombre", "cron").single();
  return !!data?.valor && req.headers.get("x-cron-secret") === data.valor;
}

export async function pruebaMail(req: Request): Promise<Response> {
  if (!(await autorizado(req))) return new Response("no", { status: 401 });
  const { to, tipo = "inicial", nombre = "Dani", monto = 10000, comprados = [] } = await req.json();
  const { data: t } = await db().from("tiendas").select("store_id").limit(1).single();
  const { cfg } = await cargarConfig(Number(t!.store_id));
  const dias = tipo === "inicial" ? cfg.dias_validez : Number(String(tipo).split("_")[1] ?? 7);
  try {
    const c = await crearCuponPrueba(Number(t!.store_id), { email: to, nombre, monto, dias, comprados });
    await enviarMail(c, cfg, tipo);
    return new Response("enviado");
  } catch (e) {
    console.error("prueba-mail", e);
    return new Response(`error: ${e}`, { status: 500 });
  }
}

export async function reenviar(req: Request): Promise<Response> {
  if (!(await autorizado(req))) return new Response("no", { status: 401 });
  const { codigos } = await req.json();
  const { data: cupones } = await db().from("cupones").select("*").in("codigo", codigos).eq("estado", "activo");
  const out: string[] = [];
  for (const c of cupones ?? []) {
    const { cfg } = await cargarConfig(Number(c.store_id));
    await avisoInicial(c, cfg);
    out.push(c.codigo);
  }
  return new Response(`ok: ${out.join(", ")}`);
}
