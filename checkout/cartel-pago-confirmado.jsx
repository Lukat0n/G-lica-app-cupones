// GELICA · Saldo para la próxima compra, en la página de pedido confirmado.
// Pegar TAL CUAL en: Configuración > Opciones del checkout > Códigos personalizados > Scripts
// Los textos y la ubicación se editan desde la configuración de la app: no hace falta volver a pegar esto.

const API = "https://mbipihpxrjkfnpvtomca.supabase.co/functions/v1/app/cupon-orden";

const CELESTE = "#3BB3DB";
const GRIS = "#5B7C8D";
const HIELO = "#EAF7FC";
const TINTA = "#1D2730";

const LEXEND = "Lexend, 'Zalando Sans', Arial, Helvetica, sans-serif";
const ZALANDO = "'Zalando Sans', Arial, Helvetica, sans-serif";

function Cartel(c) {
  // Versión compacta: poco espacio vertical, pensada para el celu.
  const t = { margin: "0", padding: "0" };
  return (
    <Box direction="col" width="100%" padding="12px 14px" gap="4px" borderRadius="14px" background={HIELO}
      style={{ border: `2px solid ${CELESTE}`, marginTop: "6px", marginBottom: "6px", maxWidth: "560px" }}>
      <Text color={CELESTE} style={{ ...t, fontFamily: LEXEND, fontSize: "10px", fontWeight: "700", letterSpacing: "1.3px" }}>
        {c.etiqueta}
      </Text>
      <Text color={TINTA} style={{ ...t, fontFamily: LEXEND, fontSize: "18px", fontWeight: "700", lineHeight: "1.2" }}>
        {c.titulo}
      </Text>
      <Text color={GRIS} style={{ ...t, fontFamily: ZALANDO, fontSize: "13px", lineHeight: "1.35" }}>{c.bajada}</Text>
      <Link href={c.link} style={{
        display: "block", width: "100%", textAlign: "center", textDecoration: "none", marginTop: "6px",
        background: CELESTE, color: "#FFFFFF", borderRadius: "999px", padding: "9px 14px",
        fontFamily: LEXEND, fontSize: "14px", fontWeight: "600", border: "none",
      }}>
        {c.boton}
      </Link>
      <Box direction="row" padding="5px 8px" borderRadius="10px" background="#FFFFFF" alignItems="center"
        justifyContent="center" style={{ marginTop: "2px" }}>
        <Text showCopyButton color={TINTA} style={{ ...t, fontFamily: ZALANDO, fontSize: "11px", textAlign: "center" }}>
          {c.codigo_linea}
        </Text>
      </Box>
    </Box>
  );
}

let listo = false;
let buscando = false;

async function cargar(intento) {
  if (listo || buscando) return;
  const st = nube.getState();
  const step = st && st.location && st.location.page && st.location.page.data && st.location.page.data.step;
  if (step !== "success") return;
  buscando = true;
  try {
    const q = new URLSearchParams({
      store: String(st.store.id),
      url: st.location.url || "",
      cart: (st.cart && st.cart.id) || "",
    });
    const r = await fetch(`${API}?${q}`);
    const c = await r.json();
    if (c.estado === "listo" && !c.usado) {
      listo = true;
      nube.render(c.slot || "after_order_number", Cartel(c));
    } else if (c.estado === "pago_pendiente") {
      // Pago pendiente (ej. transferencia): no se muestra nada para no confundir con el monto a pagar.
      if (intento < 8) setTimeout(() => cargar(intento + 1), 15000);
    } else if ((c.estado === "error" || c.estado === "no_encontrada") && intento < 3) {
      setTimeout(() => cargar(intento + 1), 4000);
    }
  } catch (e) {
    if (intento < 3) setTimeout(() => cargar(intento + 1), 4000);
  } finally {
    buscando = false;
  }
}

nube.on("checkout:ready", () => cargar(0));
nube.on("order:update", () => cargar(0));
cargar(0);
