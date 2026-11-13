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
  // Misma estética que la vista previa del panel y el mail.
  return (
    <Box direction="col" width="100%" padding="16px" gap="8px" borderRadius="16px" background={HIELO}
      style={{ border: `2px solid ${CELESTE}`, marginTop: "8px", marginBottom: "8px", maxWidth: "560px" }}>
      <Text color={CELESTE} style={{ fontFamily: LEXEND, fontSize: "11px", fontWeight: "700", letterSpacing: "1.4px" }}>
        {c.etiqueta}
      </Text>
      <Text color={TINTA} style={{ fontFamily: LEXEND, fontSize: "22px", fontWeight: "700", lineHeight: "1.2" }}>
        {c.titulo}
      </Text>
      <Text color={GRIS} style={{ fontFamily: ZALANDO, fontSize: "15px", lineHeight: "1.45" }}>{c.bajada}</Text>
      <Link href={c.link} style={{
        display: "block", width: "100%", textAlign: "center", textDecoration: "none",
        background: CELESTE, color: "#FFFFFF", borderRadius: "999px", padding: "13px 16px",
        fontFamily: LEXEND, fontSize: "16px", fontWeight: "600", border: "none",
      }}>
        {c.boton}
      </Link>
      <Box direction="row" padding="10px" borderRadius="12px" background="#FFFFFF" alignItems="center"
        justifyContent="center">
        <Text showCopyButton color={TINTA} style={{ fontFamily: ZALANDO, fontSize: "13px", textAlign: "center" }}>
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
