// Textos por defecto de mails, checkout y WhatsApp.
// Todo se puede pisar desde configuracion.textos (JSON) — el panel de la app edita eso.
//
// Variables disponibles en cualquier texto:
//   {nombre}      Dani            (vacío si no lo sabemos)
//   {nombre_coma} "Dani, "        (para empezar asuntos: "{nombre_coma}tenés..." → "Dani, tenés...")
//   {monto}       $10.000
//   {vence}       miércoles 2 de diciembre
//   {vence_corto} 2 de diciembre
//   {dias}        3               (días que faltan)
//   {dias_txt}    "3 días" / "1 día"
//   {codigo}      DANI10000K7P
//   {link}        link que aplica el saldo solo (gelica.com.ar/discount/CODIGO)
//   {web}         www.gelica.com.ar

export type BloqueMail = {
  asunto: string;
  etiqueta: string;
  titulo: string;
  bajada: string;
  caja_label: string;
  caja_vence: string;
  boton: string;
  nota: string;
  beneficios: string[];
  codigo_linea: string;
};

export type Textos = {
  mail_inicial: BloqueMail;
  mail_recordatorio: BloqueMail;         // cuando faltan más de 3 días
  mail_recordatorio_urgente: BloqueMail; // cuando faltan 3 días o menos
  tip_uso: string;
  checkout: {
    etiqueta: string;
    titulo: string;
    bajada: string;
    boton: string;
    codigo_linea: string;
  };
  whatsapp_inicial: string;
  whatsapp_recordatorio: string;
};

const BENEFICIOS = ["Se suma a todas las promos y descuentos", "Se aplica solo al tocar el botón"];

export const TEXTOS_DEFAULT: Textos = {
  mail_inicial: {
    asunto: "{nombre_coma}tenés {monto} en GELICA",
    etiqueta: "TU SALDO EN GELICA",
    titulo: "Tenés {monto} a favor",
    bajada: "Hola {nombre}, gracias por tu compra. Te cargamos {monto} para la próxima. Son tuyos.",
    caja_label: "TU SALDO",
    caja_vence: "Vence el {vence}",
    boton: "Usar mis {monto}",
    nota: "Tocá el botón, elegí lo que quieras y se descuentan solos. Si no los usás antes del {vence_corto}, los perdés.",
    beneficios: BENEFICIOS,
    codigo_linea: "Código por si lo necesitás: {codigo} · Un solo uso",
  },
  mail_recordatorio: {
    asunto: "{nombre_coma}te quedan {dias_txt} para usar tus {monto}",
    etiqueta: "TE QUEDAN {dias} DÍAS",
    titulo: "Tus {monto} siguen ahí",
    bajada: "Vencen el {vence}. Si querés una segunda unidad para rotar (una puesta y otra en el freezer) o aliviar otra zona, es el momento.",
    caja_label: "TU SALDO",
    caja_vence: "Vence el {vence}",
    boton: "Usar mis {monto}",
    nota: "Tocá el botón, elegí lo que quieras y se descuentan solos.",
    beneficios: BENEFICIOS,
    codigo_linea: "Código por si lo necesitás: {codigo} · Un solo uso",
  },
  mail_recordatorio_urgente: {
    asunto: "{nombre_coma}en {dias_txt} perdés tus {monto}",
    etiqueta: "ÚLTIMOS {dias} DÍAS",
    titulo: "En {dias_txt} perdés tus {monto}",
    bajada: "Vencen el {vence} y no se pueden extender. Si no los vas a usar, regaláselos a alguien: sirven para cualquier persona.",
    caja_label: "TU SALDO",
    caja_vence: "Vence el {vence}",
    boton: "Usar mis {monto}",
    nota: "Tocá el botón, elegí lo que quieras y se descuentan solos.",
    beneficios: BENEFICIOS,
    codigo_linea: "Código por si lo necesitás: {codigo} · Un solo uso",
  },
  tip_uso: "Guardala en el freezer dentro de una bolsa protectora, así está siempre lista. Para calor: 45 segundos en el microondas.",
  checkout: {
    etiqueta: "TU SALDO EN GELICA",
    titulo: "Tenés {monto} a favor",
    bajada: "Te los cargamos para tu próxima compra. Vencen el {vence}: si no los usás, los perdés.",
    boton: "Usar mis {monto}",
    codigo_linea: "Código por si lo necesitás: {codigo} · Un solo uso",
  },
  whatsapp_inicial:
    "¡Hola {nombre}! Gracias por tu compra en GELICA. Te cargamos *{monto}* para la próxima. Son tuyos. " +
    "Vencen el {vence}. Tocá acá y se descuentan solos: {link}",
  whatsapp_recordatorio:
    "¡Hola {nombre}! En *{dias_txt}* vencen tus *{monto}* en GELICA. Si no los usás, los perdés. " +
    "Usalos acá: {link} (código {codigo})",
};

/** Mezcla los textos guardados en la configuración con los de por defecto. */
export function textosEfectivos(guardados: unknown): Textos {
  const g = (guardados && typeof guardados === "object" ? guardados : {}) as Record<string, any>;
  const out: any = structuredClone(TEXTOS_DEFAULT);
  for (const [k, v] of Object.entries(g)) {
    if (!(k in out)) continue;
    if (typeof out[k] === "string" && typeof v === "string") out[k] = v;
    else if (typeof out[k] === "object" && v && typeof v === "object") Object.assign(out[k], v);
  }
  return out as Textos;
}

/** Reemplaza {variables}; limpia dobles espacios/comas si una variable vino vacía y pone mayúscula inicial. */
export function plantilla(t: string, vars: Record<string, string>): string {
  let s = t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  s = s.replace(/Hola ,/g, "Hola,").replace(/¡Hola !/g, "¡Hola!").replace(/ {2,}/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
