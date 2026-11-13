// Lógica pura (sin red ni base de datos) — es lo que se testea en tests/logic.test.ts

export type Escala = {
  desde: number;
  hasta: number | null;
  monto_cupon: number;
  compra_minima: number | null;
};

export type BaseMonto = "total_sin_envio" | "total" | "subtotal";

export type Recordatorio = { dias_antes: number; canal: "email" | "whatsapp" };

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
};

/** Monto de la orden sobre el que se aplica la escala. */
export function montoBase(order: Record<string, unknown>, base: BaseMonto): number {
  const total = num(order.total);
  if (base === "total") return total;
  if (base === "subtotal") return num(order.subtotal);
  const envio = num(order.shipping_cost_customer);
  return Math.max(0, total - envio);
}

/** Escala que corresponde a un monto: desde < monto <= hasta (hasta null = sin tope). */
export function escalaPara(monto: number, escalas: Escala[]): Escala | null {
  if (!(monto > 0)) return null;
  const ordenadas = [...escalas].sort((a, b) => num(a.desde) - num(b.desde));
  for (const e of ordenadas) {
    const desde = num(e.desde);
    const hasta = e.hasta === null || e.hasta === undefined ? Infinity : num(e.hasta);
    if (monto > desde && monto <= hasta) {
      return {
        desde,
        hasta: hasta === Infinity ? null : hasta,
        monto_cupon: num(e.monto_cupon),
        compra_minima: e.compra_minima === null || e.compra_minima === undefined ? null : num(e.compra_minima),
      };
    }
  }
  return null;
}

/** Fecha de hoy en Argentina como YYYY-MM-DD. */
export function hoyAR(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function sumarDias(fechaISO: string, dias: number): string {
  const d = new Date(fechaISO + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function diasEntre(desdeISO: string, hastaISO: string): number {
  const a = Date.parse(desdeISO + "T12:00:00Z");
  const b = Date.parse(hastaISO + "T12:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

/**
 * Recordatorios que tocan hoy. El cupón vale hasta el final del día `venceEl`.
 * Si un día el cron no corrió, al día siguiente se recupera (ventana de 1 día),
 * pero nunca se manda un recordatorio "de 7 días" a quien le quedan 3.
 */
export function recordatoriosPendientes(
  venceEl: string,
  hoy: string,
  recordatorios: Recordatorio[],
  yaEnviados: Set<string>, // claves "recordatorio_7:email"
): Recordatorio[] {
  const quedan = diasEntre(hoy, venceEl);
  if (quedan < 0) return [];
  return recordatorios.filter((r) => {
    const clave = `recordatorio_${r.dias_antes}:${r.canal}`;
    if (yaEnviados.has(clave)) return false;
    return quedan <= r.dias_antes && quedan >= r.dias_antes - 1;
  });
}

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O/1/I para que no se confundan

/** Nombre de pila en mayúsculas, sin tildes ni símbolos, máx 10 letras. "María José" -> "MARIA" */
export function nombreParaCodigo(nombre: string | null | undefined): string {
  const limpio = String(nombre ?? "").trim().split(/\s+/)[0]
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
  return limpio.slice(0, 10);
}

/**
 * Código personal: NOMBRE + MONTO + 3 caracteres al azar. Ej: DANI10000K7P.
 * Los 3 del final evitan que alguien adivine el código de otro ("MARIA10000").
 * Solo letras y números (Tiendanube no acepta guiones).
 */
export function generarCodigo(
  nombre: string | null | undefined, monto: number, prefijoSinNombre = "GELICA", rnd: () => number = Math.random,
): string {
  let s = "";
  for (let i = 0; i < 3; i++) s += ALFABETO[Math.floor(rnd() * ALFABETO.length)];
  const base = nombreParaCodigo(nombre) || prefijoSinNombre;
  return `${base}${Math.round(monto)}${s}`.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Fecha de vencimiento de un cupón nuevo.
 *  - modo "dias":  hoy + dias
 *  - modo "fecha": la fecha fija (ej. 2026-12-23 para Navidad). Si ya pasó o falta menos de
 *                  `minimoDias`, cae al modo "dias" para no dar cupones que vencen enseguida.
 */
export function calcularVencimiento(
  hoy: string, modo: string, dias: number, fecha: string | null, minimoDias = 3,
): string {
  if (modo === "fecha" && fecha && diasEntre(hoy, fecha) >= minimoDias) return fecha;
  return sumarDias(hoy, dias);
}

export function pesos(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-AR").replace(/,/g, ".");
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** "2 de diciembre" */
export function fechaCorta(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

/** "martes 2 de diciembre" */
export function fechaLarga(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

/** Teléfono en formato internacional argentino (best effort). Devuelve solo dígitos, ej. 5491122334455 */
export function telefonoAR(raw: unknown): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) {
    d = d.slice(2);
    if (d.startsWith("9")) d = d.slice(1);
  }
  if (d.startsWith("0")) d = d.slice(1);
  // Saca el "15" de celulares escritos a la antigua (ej. 11 15 2233 4455)
  for (const largoArea of [2, 3, 4]) {
    if (d.length === 12 && d.slice(largoArea, largoArea + 2) === "15") {
      d = d.slice(0, largoArea) + d.slice(largoArea + 2);
      break;
    }
  }
  if (d.length !== 10) return null; // no lo pudimos normalizar con seguridad
  return "549" + d;
}

/** Códigos de cupón que usó una orden (Tiendanube manda `coupon` como array u objeto). */
export function codigosUsados(order: Record<string, unknown>): string[] {
  const c = order.coupon as unknown;
  const lista = Array.isArray(c) ? c : c ? [c] : [];
  return lista
    .map((x) => (x && typeof x === "object" ? (x as { code?: string }).code : null))
    .filter((x): x is string => !!x)
    .map((x) => x.toUpperCase());
}
