// Mail (cuenta de Google de hola@gelica.com.ar) + WhatsApp (webhook del bot de tu amigo)
import { db, env } from "./tiendanube.ts";
import { diasEntre, fechaCorta, fechaLarga, hoyAR, pesos } from "./logic.ts";
import type { Config } from "./cupones.ts";
import { type BloqueMail, plantilla, textosEfectivos } from "./textos.ts";

export type Cupon = {
  id: string; codigo: string; monto_cupon: number; compra_minima: number | null; vence_el: string;
  cliente_nombre: string | null; cliente_email: string | null; cliente_telefono: string | null;
  order_number: number | null;
};

export type Tipo = "inicial" | `recordatorio_${number}`;

const LOGO_BLANCO = "https://d1a9qnv764bsoo.cloudfront.net/stores/005/002/067/rte/logo-gelica-blanco.png";

/** Variables para las plantillas de texto. */
export function variables(c: Cupon, cfg: Config, hoy = hoyAR()): Record<string, string> {
  const quedan = diasEntre(hoy, c.vence_el);
  const base = cfg.url_tienda.replace(/\/$/, "");
  const nombre = c.cliente_nombre ?? "";
  return {
    nombre,
    nombre_coma: nombre ? `${nombre}, ` : "",
    monto: pesos(Number(c.monto_cupon)),
    vence: fechaLarga(c.vence_el),
    vence_corto: fechaCorta(c.vence_el),
    dias: String(quedan),
    dias_txt: quedan === 1 ? "1 día" : `${quedan} días`,
    codigo: c.codigo,
    link: `${base}/discount/${c.codigo}`,
    web: base.replace(/^https?:\/\//, ""),
  };
}

export function textos(c: Cupon, cfg: Config, tipo: Tipo) {
  const v = variables(c, cfg);
  const T = textosEfectivos((cfg as any).textos);
  const quedan = Number(v.dias);
  const urgente = tipo !== "inicial" && quedan <= 3;
  const bloque: BloqueMail = tipo === "inicial" ? T.mail_inicial : urgente ? T.mail_recordatorio_urgente : T.mail_recordatorio;
  const r = (s: string) => plantilla(s, v);
  const msjAmigo = `Te paso ${v.monto} para gastar en GELICA. Entrá acá y se descuentan solos: ${v.link} (vale hasta el ${v.vence_corto})`;
  return {
    v, urgente,
    asunto: r(bloque.asunto),
    etiqueta: r(bloque.etiqueta),
    titulo: r(bloque.titulo),
    bajada: r(bloque.bajada),
    caja_label: r(bloque.caja_label),
    caja_vence: r(bloque.caja_vence),
    boton: r(bloque.boton),
    nota: r(bloque.nota),
    beneficios: bloque.beneficios.map(r).filter(Boolean),
    codigo_linea: r(bloque.codigo_linea),
    tip: r(T.tip_uso),
    linkCompartir: `https://wa.me/?text=${encodeURIComponent(msjAmigo)}`,
    whatsapp: r(tipo === "inicial" ? T.whatsapp_inicial : T.whatsapp_recordatorio),
  };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Paleta GELICA
const CELESTE = "#3BB3DB", GRIS = "#5B7C8D", NEUTRO = "#F5F7F9", HIELO = "#EAF7FC", TINTA = "#1D2730";
const LEXEND = "'Lexend',Arial,Helvetica,sans-serif";
const ZALANDO = "'Zalando Sans',Arial,Helvetica,sans-serif";

export function htmlMail(c: Cupon, cfg: Config, tipo: Tipo): string {
  const t = textos(c, cfg, tipo);
  const acento = t.urgente ? GRIS : CELESTE; // celeste = buena noticia; gris = lo que se está por perder
  const beneficios = t.beneficios.map((b) => `
        <tr><td style="padding:3px 0;font-size:15px;color:${TINTA}"><span style="color:${CELESTE};font-weight:700;margin-right:8px">&#10003;</span>${esc(b)}</td></tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@600;700;800&family=Zalando+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<title>${esc(t.asunto)}</title></head>
<body style="margin:0;padding:0;background:${NEUTRO};font-family:${ZALANDO};color:${TINTA}">
<span style="display:none;max-height:0;overflow:hidden">${esc(t.bajada)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NEUTRO};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden">

  <tr><td align="center" style="background:${CELESTE};padding:28px 24px 22px">
    <img src="${LOGO_BLANCO}" alt="GELICA" width="190" style="display:block;color:#FFFFFF;font-family:Arial,sans-serif;font-size:28px;font-weight:bold;width:190px;max-width:60%;height:auto;border:0">
    <div style="font-family:${ZALANDO};color:#FFFFFF;font-size:14px;margin-top:8px">Alivio cuando más lo necesitás</div>
  </td></tr>

  <tr><td style="padding:32px 40px 4px">
    <span style="display:inline-block;background:${HIELO};color:${acento};font-family:${LEXEND};font-weight:700;font-size:12px;letter-spacing:1.5px;padding:7px 14px;border-radius:999px">${esc(t.etiqueta)}</span>
    <h1 style="font-family:${LEXEND};font-weight:700;font-size:30px;line-height:1.2;color:${TINTA};margin:18px 0 10px">${esc(t.titulo)}</h1>
    <p style="font-size:17px;line-height:1.55;color:${GRIS};margin:0">${esc(t.bajada)}</p>
  </td></tr>

  <tr><td style="padding:24px 40px 8px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${HIELO};border:2px solid ${acento};border-radius:16px">
      <tr><td align="center" style="padding:24px 16px">
        <div style="font-family:${LEXEND};font-weight:700;font-size:13px;letter-spacing:2px;color:${GRIS}">${esc(t.caja_label)}</div>
        <div style="font-family:${LEXEND};font-weight:800;font-size:46px;line-height:1.1;color:${TINTA};margin:6px 0">${esc(t.v.monto)}</div>
        <div style="font-size:16px;color:${acento};font-weight:600">${esc(t.caja_vence)}</div>
      </td></tr>
    </table>
  </td></tr>

  <tr><td align="center" style="padding:22px 40px 6px">
    <a href="${esc(t.v.link)}" style="display:inline-block;background:${CELESTE};color:#FFFFFF;text-decoration:none;font-family:${LEXEND};font-weight:600;font-size:17px;padding:16px 38px;border-radius:999px">${esc(t.boton)}</a>
  </td></tr>
  <tr><td align="center" style="padding:12px 48px 4px;font-size:14px;line-height:1.5;color:${GRIS}">${esc(t.nota)}</td></tr>

  ${beneficios ? `<tr><td style="padding:16px 40px 4px"><table role="presentation" cellpadding="0" cellspacing="0" align="center">${beneficios}
  </table></td></tr>` : ""}

  <tr><td align="center" style="padding:16px 40px 6px;font-size:13px;color:${GRIS}">${esc(t.codigo_linea)}</td></tr>
  <tr><td align="center" style="padding:4px 40px 24px">
    <a href="${esc(t.linkCompartir)}" style="color:${GRIS};font-size:13px;text-decoration:underline">¿No los vas a usar? Pasáselos a alguien por WhatsApp</a>
  </td></tr>

  ${t.tip ? `<tr><td style="padding:0 40px 28px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NEUTRO};border-radius:12px">
      <tr><td style="padding:18px 20px">
        <div style="font-family:${LEXEND};font-weight:700;font-size:12px;letter-spacing:1.5px;color:${CELESTE};margin-bottom:6px">TIP DE USO</div>
        <div style="font-size:14px;line-height:1.5;color:${TINTA}">${esc(t.tip)}</div>
      </td></tr>
    </table>
  </td></tr>` : ""}

  <tr><td align="center" style="border-top:1px solid #E6EBEF;padding:20px 24px 26px;font-size:13px;line-height:1.7;color:${GRIS}">
    <a href="mailto:hola@gelica.com.ar" style="color:${GRIS};text-decoration:none">hola@gelica.com.ar</a> · <a href="${esc(cfg.url_tienda)}" style="color:${GRIS};text-decoration:none">${esc(t.v.web)}</a> · <a href="https://www.instagram.com/gelica.ar" style="color:${GRIS};text-decoration:none">@gelica.ar</a>${c.order_number ? `<br>Por tu pedido #${c.order_number}` : ""}
  </td></tr>

</table></td></tr></table></body></html>`;
}

// ---------- Envío ----------

export async function enviarMail(c: Cupon, cfg: Config, tipo: Tipo) {
  if (!c.cliente_email) throw new Error("sin email");
  const t = textos(c, cfg, tipo);
  const html = htmlMail(c, cfg, tipo);
  if (env("RESEND_API_KEY", true)) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env("EMAIL_FROM"), to: [c.cliente_email], reply_to: env("EMAIL_REPLY_TO", true) || undefined,
        subject: t.asunto, html,
      }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
    return;
  }
  const { default: nodemailer } = await import("npm:nodemailer@6.9.16");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: env("GMAIL_USER"), pass: env("GMAIL_APP_PASSWORD").replace(/\s/g, "") },
  });
  await transporter.sendMail({
    from: env("EMAIL_FROM"),
    to: c.cliente_email,
    subject: t.asunto,
    html,
    text: `${t.titulo}\n\n${t.bajada}\n\n${t.caja_label}: ${t.v.monto}\n${t.caja_vence}\n\n${t.boton}: ${t.v.link}\n\n${t.codigo_linea}`,
  });
}

/**
 * Le avisa al bot de WhatsApp. Tu amigo recibe este JSON en su endpoint y manda el mensaje.
 * `mensaje` ya viene armado; si su bot usa plantillas aprobadas de Meta, puede usar los campos sueltos.
 */
async function enviarWhatsapp(c: Cupon, cfg: Config, tipo: Tipo) {
  const url = env("WHATSAPP_WEBHOOK_URL", true);
  if (!url) throw new Error("WHATSAPP_WEBHOOK_URL no configurada");
  if (!c.cliente_telefono) throw new Error("sin teléfono");
  const t = textos(c, cfg, tipo);
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env("WHATSAPP_WEBHOOK_SECRET", true)}`,
    },
    body: JSON.stringify({
      evento: tipo === "inicial" ? "cupon_creado" : "cupon_por_vencer",
      tipo,
      telefono: c.cliente_telefono, // 549XXXXXXXXXX (o el número tal cual lo cargó el cliente si no se pudo normalizar)
      nombre: c.cliente_nombre,
      codigo: c.codigo,
      monto: c.monto_cupon,
      monto_texto: t.v.monto,
      vence_el: c.vence_el,
      vence_texto: t.v.vence,
      dias_restantes: Number(t.v.dias),
      link: t.v.link,
      mensaje: t.whatsapp,
      id_unico: `${c.id}:${tipo}`, // para que el bot descarte duplicados
    }),
  });
  if (!r.ok) throw new Error(`Bot WhatsApp ${r.status}: ${await r.text()}`);
}

/** Envía un aviso una sola vez por (cupón, tipo, canal). */
export async function avisar(c: Cupon, cfg: Config, tipo: Tipo, canal: "email" | "whatsapp") {
  // Canal todavía no configurado: no registramos nada
  if (canal === "email" && !env("RESEND_API_KEY", true) && !env("GMAIL_APP_PASSWORD", true)) return;
  if (canal === "whatsapp" && !env("WHATSAPP_WEBHOOK_URL", true)) return;
  const s = db();
  // reservamos el registro primero: si ya existe, ya se mandó (o se está mandando)
  const ins = await s.from("avisos").insert({ cupon_id: c.id, tipo, canal }).select("id").single();
  if (ins.error) return; // duplicado
  try {
    if (canal === "email") await enviarMail(c, cfg, tipo);
    else await enviarWhatsapp(c, cfg, tipo);
  } catch (e) {
    await s.from("avisos").update({ estado: "error", detalle: String(e).slice(0, 500) }).eq("id", ins.data.id);
    console.error(`aviso ${tipo}/${canal} cupón ${c.codigo}:`, e);
  }
}

export async function avisoInicial(c: Cupon, cfg: Config) {
  const tareas: Promise<void>[] = [];
  if (cfg.aviso_inicial_email) tareas.push(avisar(c, cfg, "inicial", "email"));
  if (cfg.aviso_inicial_whatsapp) tareas.push(avisar(c, cfg, "inicial", "whatsapp"));
  await Promise.all(tareas);
}
