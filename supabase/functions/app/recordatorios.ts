// Corre una vez por día (pg_cron). Hace 3 cosas:
// 1) Red de seguridad: crea cupones de órdenes pagadas de los últimos 2 días que no lo tengan.
// 2) Marca vencidos los cupones cuya fecha pasó.
// 3) Manda recordatorios (7 días mail, 3 días mail, 2 días WhatsApp — editable) SOLO si no lo usaron.
import { db, TN } from "../_shared/tiendanube.ts";
import { cargarConfig, crearCuponParaOrden } from "../_shared/cupones.ts";
import { avisar } from "../_shared/avisos.ts";
import { borrarBorradores } from "./comprar.ts";
import { hoyAR, recordatoriosPendientes } from "../_shared/logic.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

async function correr() {
  const s = db();
  const hoy = hoyAR();
  const log: string[] = [];
  const { data: tiendas } = await s.from("tiendas").select("store_id").is("desinstalada_en", null);

  for (const { store_id } of tiendas ?? []) {
    const storeId = Number(store_id);
    const { cfg } = await cargarConfig(storeId);
    const tn = await TN.para(storeId);

    // 1) Red de seguridad por si un webhook se perdió
    if (cfg.activa) {
      const desde = new Date(Date.now() - 2 * 86_400_000).toISOString();
      for (let page = 1; page <= 10; page++) {
        const ordenes: any[] = await tn.req("GET",
          `/orders?payment_status=paid&created_at_min=${encodeURIComponent(desde)}&per_page=100&page=${page}&fields=id`)
          .catch(() => []);
        if (!ordenes.length) break;
        const ids = ordenes.map((o) => o.id);
        const { data: tienen } = await s.from("cupones").select("order_id").eq("store_id", storeId).in("order_id", ids);
        const con = new Set((tienen ?? []).map((r) => Number(r.order_id)));
        for (const id of ids) {
          if (!con.has(Number(id))) {
            await crearCuponParaOrden(storeId, id).catch((e) => log.push(`orden ${id}: ${e}`));
          }
        }
        if (ordenes.length < 100) break;
      }
    }

    // 2) Vencidos
    await s.from("cupones").update({ estado: "vencido" })
      .eq("store_id", storeId).eq("estado", "activo").lt("vence_el", hoy);

    // Saldos de prueba vencidos: se borran (con sus checkouts)
    const { data: pruebas } = await s.from("cupones").select("id").eq("store_id", storeId).eq("estado", "prueba").lt("vence_el", hoy);
    for (const p of pruebas ?? []) {
      await borrarBorradores(storeId, p.id).catch(() => {});
      await s.from("cupones").delete().eq("id", p.id);
    }

    // Limpieza: checkouts armados de saldos que ya se usaron, vencieron o se anularon
    const { data: viejos } = await s.from("borradores").select("cupon_id, cupones!inner(estado,store_id)")
      .eq("estado", "pendiente").eq("cupones.store_id", storeId);
    for (const b of viejos ?? []) {
      const c: any = (b as any).cupones;
      if (!["activo", "prueba"].includes(c?.estado)) {
        await borrarBorradores(storeId, b.cupon_id).catch(() => {});
      }
    }

    // 3) Recordatorios
    const { data: activos } = await s.from("cupones").select("*, avisos(tipo,canal)")
      .eq("store_id", storeId).eq("estado", "activo").gte("vence_el", hoy);

    for (const c of activos ?? []) {
      const enviados = new Set<string>((c.avisos ?? []).map((a: any) => `${a.tipo}:${a.canal}`));
      const toca = recordatoriosPendientes(c.vence_el, hoy, cfg.recordatorios, enviados);
      if (!toca.length) continue;

      // Antes de molestar, confirmamos con Tiendanube que no lo haya usado
      try {
        const tc = await tn.cupon(c.tn_coupon_id);
        if (Number(tc.used ?? 0) > 0) {
          await s.from("cupones").update({ estado: "usado", usado_en: new Date().toISOString() }).eq("id", c.id);
          continue;
        }
        if (tc.valid === false) continue;
      } catch (e) {
        log.push(`no pude verificar ${c.codigo}: ${e}`);
        continue; // ante la duda, no mandamos
      }

      for (const r of toca) {
        await avisar(c, cfg, `recordatorio_${r.dias_antes}`, r.canal);
        log.push(`${c.codigo}: recordatorio ${r.dias_antes}d por ${r.canal}`);
      }
    }
  }
  console.log(`recordatorios ${hoy}\n` + log.join("\n"));
}

export default async function handler(req: Request): Promise<Response> {
  // Solo lo puede disparar el cron (o vos con la clave)
  const { data } = await db().from("secretos_internos").select("valor").eq("nombre", "cron").single();
  if (!data?.valor || req.headers.get("x-cron-secret") !== data.valor) return new Response("no", { status: 401 });
  EdgeRuntime.waitUntil(correr().catch((e) => console.error("recordatorios", e)));
  return new Response("ok");
}
