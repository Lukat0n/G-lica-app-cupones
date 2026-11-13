// deno test -A tests/logic.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularVencimiento, codigosUsados, diasEntre, nombreParaCodigo, escalaPara, fechaLarga, generarCodigo, hoyAR, montoBase, pesos,
  recordatoriosPendientes, sumarDias, telefonoAR,
} from "../supabase/functions/_shared/logic.ts";

const ESCALAS = [
  { desde: 0, hasta: 70000, monto_cupon: 6000, compra_minima: null },
  { desde: 70000, hasta: 190000, monto_cupon: 10000, compra_minima: null },
  { desde: 190000, hasta: 250000, monto_cupon: 20000, compra_minima: null },
  { desde: 250000, hasta: 400000, monto_cupon: 30000, compra_minima: null },
  { desde: 400000, hasta: null, monto_cupon: 42000, compra_minima: null },
];

test("escalas: bordes", () => {
  const c = (m: number) => escalaPara(m, ESCALAS)?.monto_cupon;
  assert.equal(c(1), 6000);
  assert.equal(c(70000), 6000);      // "70 mil o menos"
  assert.equal(c(70000.01), 10000);
  assert.equal(c(88146), 10000);     // la orden #31003 de la captura
  assert.equal(c(190000), 10000);
  assert.equal(c(190001), 20000);
  assert.equal(c(250000), 20000);
  assert.equal(c(250001), 30000);
  assert.equal(c(400000), 30000);
  assert.equal(c(400001), 42000);
  assert.equal(c(5_000_000), 42000);
  assert.equal(c(0), undefined);
});

test("monto base de la orden de la captura", () => {
  const order = { total: "88146.00", subtotal: "146910.00", shipping_cost_customer: "0.00" };
  assert.equal(montoBase(order, "total_sin_envio"), 88146);
  assert.equal(montoBase(order, "subtotal"), 146910);
  assert.equal(montoBase({ total: "100000", shipping_cost_customer: "8000" }, "total_sin_envio"), 92000);
});

test("recordatorios 7/3/2 en cupón de 20 días", () => {
  const R = [
    { dias_antes: 7, canal: "email" as const },
    { dias_antes: 3, canal: "email" as const },
    { dias_antes: 2, canal: "whatsapp" as const },
  ];
  const creado = "2026-11-12";
  const vence = sumarDias(creado, 20);
  assert.equal(vence, "2026-12-02");
  const enviados = new Set<string>();
  const log: string[] = [];
  for (let d = 0; d <= 21; d++) {
    const hoy = sumarDias(creado, d);
    for (const r of recordatoriosPendientes(vence, hoy, R, enviados)) {
      enviados.add(`recordatorio_${r.dias_antes}:${r.canal}`);
      log.push(`${hoy} ${r.dias_antes}d ${r.canal}`);
    }
  }
  assert.deepEqual(log, ["2026-11-25 7d email", "2026-11-29 3d email", "2026-11-30 2d whatsapp"]);
});

test("recordatorios: si el cron falla un día, recupera al siguiente; nunca uno viejo", () => {
  const R = [{ dias_antes: 7, canal: "email" as const }, { dias_antes: 3, canal: "email" as const }];
  assert.deepEqual(recordatoriosPendientes("2026-12-02", "2026-11-26", R, new Set()).map((r) => r.dias_antes), [7]);
  assert.deepEqual(recordatoriosPendientes("2026-12-02", "2026-11-29", R, new Set()).map((r) => r.dias_antes), [3]);
  // cupón de 5 días: el de 7 no se manda nunca
  assert.deepEqual(recordatoriosPendientes("2026-11-17", "2026-11-12", R, new Set()), []);
  assert.deepEqual(recordatoriosPendientes("2026-11-17", "2026-11-18", R, new Set()), []); // vencido
});

test("códigos personales: NOMBRE + MONTO + 3 al azar", () => {
  const set = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const c = generarCodigo("Dani", 10000);
    assert.match(c, /^DANI10000[A-Z2-9]{3}$/);
    set.add(c);
  }
  assert.ok(set.size > 1500);
  assert.match(generarCodigo("María José", 6000), /^MARIA6000[A-Z0-9]{3}$/);
  assert.match(generarCodigo(null, 42000), /^GELICA42000[A-Z0-9]{3}$/);
  assert.equal(nombreParaCodigo("  Ñandú"), "NANDU");
});

test("vencimiento: días o fecha fija (Navidad)", () => {
  assert.equal(calcularVencimiento("2026-11-12", "dias", 20, null), "2026-12-02");
  assert.equal(calcularVencimiento("2026-11-12", "fecha", 20, "2026-12-23"), "2026-12-23");
  // si la fecha fija ya pasó o falta muy poco, vuelve a "días"
  assert.equal(calcularVencimiento("2026-12-22", "fecha", 15, "2026-12-23"), "2027-01-06");
});

test("teléfonos argentinos", () => {
  assert.equal(telefonoAR("+54 9 11 2233-4455"), "5491122334455");
  assert.equal(telefonoAR("011 15 2233-4455"), "5491122334455");
  assert.equal(telefonoAR("1122334455"), "5491122334455");
  assert.equal(telefonoAR("0351 15 655-1234"), "5493516551234");
  assert.equal(telefonoAR("+5493516551234"), "5493516551234");
  assert.equal(telefonoAR("123"), null);
});

test("formato", () => {
  assert.equal(pesos(10000), "$10.000");
  assert.equal(pesos(42000), "$42.000");
  assert.equal(fechaLarga("2026-12-02"), "miércoles 2 de diciembre");
  assert.equal(diasEntre("2026-11-12", "2026-12-02"), 20);
  assert.match(hoyAR(), /^\d{4}-\d{2}-\d{2}$/);
  // 23:30 en Argentina del 12/11 = 02:30 UTC del 13/11 -> sigue siendo 12 en AR
  assert.equal(hoyAR(new Date("2026-11-13T02:30:00Z")), "2026-11-12");
});

test("detección de uso de cupón en la orden", () => {
  assert.deepEqual(codigosUsados({ coupon: [{ code: "gelica10kabcde" }] }), ["GELICA10KABCDE"]);
  assert.deepEqual(codigosUsados({ coupon: { code: "X1" } }), ["X1"]);
  assert.deepEqual(codigosUsados({ coupon: [] }), []);
  assert.deepEqual(codigosUsados({}), []);
});

import { plantilla, textosEfectivos } from "../supabase/functions/_shared/textos.ts";
test("plantillas de texto", () => {
  const T = textosEfectivos({ checkout: { titulo: "Regalo de Navidad: {monto}" } });
  assert.equal(T.checkout.titulo, "Regalo de Navidad: {monto}");
  assert.equal(T.checkout.boton, "Usar mis {monto}"); // lo no editado queda por defecto
  const v = { nombre: "Dani", nombre_coma: "Dani, ", monto: "$10.000" };
  assert.equal(plantilla("{nombre_coma}tenés {monto} en GELICA", v), "Dani, tenés $10.000 en GELICA");
  assert.equal(plantilla("{nombre_coma}tenés {monto} en GELICA", { ...v, nombre: "", nombre_coma: "" }), "Tenés $10.000 en GELICA");
  assert.equal(plantilla("Hola {nombre}, gracias", { nombre: "" }), "Hola, gracias");
});

import { aProducto, elegirRecomendacion, nombreCorto } from "../supabase/functions/_shared/recomendar.ts";
test("recomendaciones: nunca algo ya comprado, primero complementos", () => {
  const mk = (id: string, nombre: string, precio: string, stock: number | null = null) =>
    aProducto({ id, name: { es: nombre }, handle: { es: id }, published: true,
      variants: [{ price: precio, promotional_price: null, stock, stock_management: stock !== null }], images: [] });
  const cat = [
    mk("ROD", "Rodillera Frío-Calor Gelica | Alivio", "48970"),
    mk("TOB", "Tobillera Frío-Calor Gelica PRO | Alivio", "42970"),
    mk("LUM", "Lumbar GELICA Frío-Calor | Alivio", "49970"),
    mk("CER", "Cervical Frío-Calor Gelica | Alivio", "47900"),
    mk("MED", "Medias Frio-Calor", "45990", 0),
  ];
  const cfg = {
    complementos: { ROD: ["TOB", "LUM"], LUM: ["CER", "ROD"] },
    prioridad: ["ROD", "LUM", "CER", "TOB"], excluidos: ["MED"],
  };
  assert.equal(nombreCorto("Gorro Gélica 360 PRO | Alivio del Dolor de Cabeza"), "Gorro GELICA 360 PRO");
  // compró rodillera -> tobillera
  assert.equal(elegirRecomendacion(cat, new Set(["ROD"]), cfg, ["ROD"])?.id, "TOB");
  // compró rodillera hoy y tobillera antes -> lumbar
  assert.equal(elegirRecomendacion(cat, new Set(["ROD", "TOB"]), cfg, ["ROD"])?.id, "LUM");
  // compró lumbar y ya tiene cervical y rodillera -> cae a prioridad: tobillera
  assert.equal(elegirRecomendacion(cat, new Set(["LUM", "CER", "ROD"]), cfg, ["LUM"])?.id, "TOB");
  // ya compró todo lo disponible -> nada (las medias sin stock y excluidas nunca)
  assert.equal(elegirRecomendacion(cat, new Set(["ROD", "TOB", "LUM", "CER"]), cfg, ["ROD"]), null);
});
