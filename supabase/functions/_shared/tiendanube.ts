// Cliente mínimo de la API de Tiendanube
import { createClient } from "npm:@supabase/supabase-js@2";

// Valores por defecto (no son secretos). Se pueden pisar con secrets de Supabase.
const DEFAULTS: Record<string, string> = {
  TN_CLIENT_ID: "51956",
  EMAIL_FROM: "GELICA <hola@gelica.com.ar>",
  EMAIL_REPLY_TO: "hola@gelica.com.ar",
  GMAIL_USER: "hola@gelica.com.ar",
  CONTACT_EMAIL: "hola@gelica.com.ar",
};

export const env = (k: string, opcional = false): string => {
  const v = Deno.env.get(k) || DEFAULTS[k];
  if (!v && !opcional) throw new Error(`Falta la variable de entorno ${k}`);
  return v ?? "";
};

export const db = () =>
  createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

const API = "https://api.tiendanube.com/v1";

export class TN {
  constructor(private storeId: number, private token: string) {}

  static async para(storeId: number): Promise<TN> {
    const { data, error } = await db()
      .from("tiendas").select("access_token").eq("store_id", storeId).is("desinstalada_en", null).single();
    if (error || !data) throw new Error(`Tienda ${storeId} no instalada`);
    return new TN(storeId, data.access_token);
  }

  async req<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    for (let intento = 0; intento < 3; intento++) {
      const r = await fetch(`${API}/${this.storeId}${path}`, {
        method,
        headers: {
          "Authentication": `bearer ${this.token}`,
          "Content-Type": "application/json",
          "User-Agent": `Gelica Cupones (${env("CONTACT_EMAIL", true) || "app"})`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status === 429) { // rate limit: esperar y reintentar
        await new Promise((ok) => setTimeout(ok, 1000 * (intento + 1)));
        continue;
      }
      const txt = await r.text();
      if (!r.ok) throw new Error(`Tiendanube ${method} ${path} -> ${r.status}: ${txt}`);
      return (txt ? JSON.parse(txt) : null) as T;
    }
    throw new Error(`Tiendanube ${method} ${path}: demasiados reintentos`);
  }

  orden(id: number) { return this.req("GET", `/orders/${id}`); }
  cupon(id: number) { return this.req("GET", `/coupons/${id}`); }
  crearCupon(c: Record<string, unknown>) { return this.req("POST", "/coupons", c); }
  editarCupon(id: number, c: Record<string, unknown>) { return this.req("PUT", `/coupons/${id}`, c); }
}

/** Verifica la firma HMAC que manda Tiendanube en cada webhook. */
export async function firmaValida(rawBody: string, firma: string | null): Promise<boolean> {
  if (!firma) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env("TN_CLIENT_SECRET")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // comparación en tiempo constante
  const a = hex, b = firma.trim().toLowerCase();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
