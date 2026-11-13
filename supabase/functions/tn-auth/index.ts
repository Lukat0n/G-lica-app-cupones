// Redirect URL de la app: Tiendanube llega acá con ?code=... cuando instalás la app.
import { db, env, TN } from "../_shared/tiendanube.ts";

const html = (titulo: string, texto: string, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><body style="font-family:Arial;max-width:520px;margin:60px auto;line-height:1.5">
     <h2>${titulo}</h2><p>${texto}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

Deno.serve(async (req) => {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return html("Falta el código", "Instalá la app desde Tiendanube.", 400);

  const r = await fetch("https://www.tiendanube.com/apps/authorize/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env("TN_CLIENT_ID"),
      client_secret: env("TN_CLIENT_SECRET"),
      grant_type: "authorization_code",
      code,
    }),
  });
  const tok = await r.json();
  if (!r.ok || !tok.access_token) {
    return html("No se pudo instalar", `Tiendanube respondió: ${JSON.stringify(tok)}`, 400);
  }
  const storeId = Number(tok.user_id ?? tok.store_id);

  const s = db();
  const { error } = await s.from("tiendas").upsert({
    store_id: storeId, access_token: tok.access_token, scope: tok.scope,
    instalada_en: new Date().toISOString(), desinstalada_en: null,
  });
  if (error) return html("Error guardando la tienda", error.message, 500);
  await s.rpc("cargar_config_por_defecto", { p_store: storeId });

  // Webhooks (borra los viejos de esta app y crea los nuevos)
  const tn = new TN(storeId, tok.access_token);
  const base = `${env("SUPABASE_URL")}/functions/v1/app/webhook`;
  const existentes: any[] = await tn.req("GET", "/webhooks").catch(() => []);
  for (const w of existentes) await tn.req("DELETE", `/webhooks/${w.id}`).catch(() => {});
  const fallidos: string[] = [];
  for (const event of ["order/paid", "order/cancelled", "app/uninstalled"]) {
    await tn.req("POST", "/webhooks", { event, url: base }).catch((e) => fallidos.push(`${event}: ${e}`));
  }
  if (fallidos.length) return html("⚠️ App instalada, pero fallaron webhooks", fallidos.join("<br>"), 500);

  return html("✅ App instalada", `Tienda ${storeId} conectada. Ya se generan cupones con cada orden pagada.`);
});
