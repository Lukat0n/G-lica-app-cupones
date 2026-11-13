// Firma de los links "comprar con mi saldo" (para que nadie arme pedidos con datos de otro)
import { db } from "./tiendanube.ts";

let secreto: string | null = null;
async function clave(): Promise<string> {
  if (secreto) return secreto;
  const { data } = await db().from("secretos_internos").select("valor").eq("nombre", "links").single();
  if (!data?.valor) throw new Error("falta secreto de links");
  secreto = data.valor;
  return secreto!;
}

export async function firmar(texto: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(await clave()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(texto));
  return [...new Uint8Array(sig)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function firmaOk(texto: string, firma: string): Promise<boolean> {
  const esperada = await firmar(texto);
  if (esperada.length !== firma.length) return false;
  let d = 0;
  for (let i = 0; i < firma.length; i++) d |= esperada.charCodeAt(i) ^ firma.charCodeAt(i);
  return d === 0;
}
