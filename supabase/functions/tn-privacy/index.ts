// Webhooks de privacidad obligatorios para apps de Tiendanube
// (store/redact, customers/redact, customers/data_request)
import { db, firmaValida } from "../_shared/tiendanube.ts";

Deno.serve(async (req) => {
  const raw = await req.text();
  if (!(await firmaValida(raw, req.headers.get("x-linkedstore-hmac-sha256")))) {
    return new Response("firma inválida", { status: 401 });
  }
  const ev = JSON.parse(raw);
  const s = db();
  const storeId = Number(ev.store_id);

  if (ev.event === "store/redact") {
    await s.from("tiendas").delete().eq("store_id", storeId); // cascade borra todo
  } else if (ev.event === "customers/redact") {
    const email = ev.customer?.email;
    const orders: number[] = ev.orders_to_redact ?? [];
    let q = s.from("cupones").update({ cliente_nombre: null, cliente_email: null, cliente_telefono: null })
      .eq("store_id", storeId);
    if (orders.length) q = q.in("order_id", orders);
    else if (email) q = q.eq("cliente_email", email);
    else return new Response("ok");
    await q;
  }
  // customers/data_request: los datos que guardamos (nombre, email, teléfono, cupón) ya están
  // en Tiendanube; no hace falta mandar nada extra.
  return new Response("ok");
});
