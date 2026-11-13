// Recomendación de producto para el bloque "¿En qué los uso?" de los mails.
// Regla de oro: nunca recomendar algo que el cliente ya compró (en esta orden o en cualquier otra).
import { TN } from "./tiendanube.ts";

export type Producto = {
  id: string;
  nombre: string;        // nombre corto para el mail
  nombre_largo: string;
  handle: string;
  imagen: string | null;
  precio: number;        // precio actual (promocional si hay)
  disponible: boolean;
  variant_id: number | null; // solo si tiene UNA variante (talle único) -> se puede armar el checkout directo
};

export type ConfigReco = {
  complementos?: Record<string, string[]>;
  prioridad?: string[];
  excluidos?: string[];
  nombres?: Record<string, string>;
};

/** "Rodillera Frío-Calor Gelica | Alivio del..." -> "Rodillera Frío-Calor GELICA" */
export function nombreCorto(nombre: string): string {
  return nombre.split("|")[0].replace(/g[eé]lica/gi, "GELICA").replace(/\s+/g, " ").trim();
}

export function aProducto(p: any, nombres: Record<string, string> = {}): Producto {
  const largo = typeof p.name === "object" ? (p.name.es ?? Object.values(p.name)[0]) : String(p.name ?? "");
  const handle = typeof p.handle === "object" ? (p.handle.es ?? Object.values(p.handle)[0]) : String(p.handle ?? "");
  const variantes: any[] = p.variants ?? [];
  const precios = variantes
    .map((v) => Number(v.promotional_price ?? NaN) || Number(v.price ?? NaN))
    .filter((n) => Number.isFinite(n) && n > 0);
  const disponible = p.published !== false &&
    variantes.some((v) => v.stock_management === false || v.stock === null || Number(v.stock) > 0);
  const img = (p.images ?? []).slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))[0];
  return {
    id: String(p.id),
    nombre: nombres[String(p.id)] || nombreCorto(largo),
    nombre_largo: largo,
    handle,
    imagen: img?.src ?? null,
    precio: precios.length ? Math.min(...precios) : 0,
    disponible,
    variant_id: variantes.length === 1 ? Number(variantes[0].id) : null,
  };
}

/** Elige UN producto: primero complementos de lo comprado, después la prioridad general. */
export function elegirRecomendacion(
  catalogo: Producto[], comprados: Set<string>, cfg: ConfigReco, compradosEnOrden: string[] = [],
): Producto | null {
  const porId = new Map(catalogo.map((p) => [p.id, p]));
  const excluidos = new Set(cfg.excluidos ?? []);
  const sirve = (id: string) => {
    const p = porId.get(id);
    return !!p && p.disponible && p.precio > 0 && !comprados.has(id) && !excluidos.has(id);
  };
  // complementos en el orden en que aparecen los productos de la orden
  for (const c of compradosEnOrden.length ? compradosEnOrden : [...comprados]) {
    for (const id of cfg.complementos?.[c] ?? []) if (sirve(id)) return porId.get(id)!;
  }
  for (const id of cfg.prioridad ?? []) if (sirve(id)) return porId.get(id)!;
  for (const p of catalogo) if (sirve(p.id)) return p;
  return null;
}

// ---------- Acceso a Tiendanube ----------

let cacheCatalogo: { t: number; data: any[] } | null = null;

export async function catalogo(tn: TN, cfg: ConfigReco): Promise<Producto[]> {
  if (!cacheCatalogo || Date.now() - cacheCatalogo.t > 10 * 60_000) {
    const todos: any[] = [];
    for (let page = 1; page <= 5; page++) {
      const r: any[] = await tn.req("GET",
        `/products?published=true&per_page=100&page=${page}&fields=id,name,handle,variants,images,published`)
        .catch(() => []);
      todos.push(...r);
      if (r.length < 100) break;
    }
    cacheCatalogo = { t: Date.now(), data: todos };
  }
  return cacheCatalogo.data.map((p) => aProducto(p, cfg.nombres ?? {}));
}

/** Todo lo que compró esta persona: esta orden + sus órdenes anteriores (buscadas por email). */
export async function productosComprados(tn: TN, email: string | null, base: string[] = []): Promise<Set<string>> {
  const set = new Set(base.map(String));
  if (!email) return set;
  const mail = email.trim().toLowerCase();
  for (let page = 1; page <= 3; page++) {
    const ordenes: any[] = await tn.req("GET",
      `/orders?q=${encodeURIComponent(mail)}&per_page=100&page=${page}&fields=id,contact_email,customer,status,products`)
      .catch(() => []);
    for (const o of ordenes) {
      const e = String(o.contact_email ?? o.customer?.email ?? "").trim().toLowerCase();
      if (e !== mail || o.status === "cancelled") continue;
      for (const it of o.products ?? []) if (it.product_id) set.add(String(it.product_id));
    }
    if (ordenes.length < 100) break;
  }
  return set;
}

export function idsDeOrden(order: any): string[] {
  return [...new Set<string>((order?.products ?? []).map((it: any) => String(it.product_id)).filter(Boolean))];
}
