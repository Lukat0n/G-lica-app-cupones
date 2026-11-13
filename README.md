# Gelica · Cupones de recompra para Tiendanube

Cada compra pagada genera un **cupón único en pesos** para la próxima compra, que **vence** (20 días por defecto, editable).
El cliente se entera en 3 lugares: **la página de "pago confirmado"**, **mail** y **WhatsApp**. Después le llegan **recordatorios solo si no lo usó**.

| Monto de la compra (sin envío) | Cupón |
|---|---|
| hasta $70.000 | $6.000 |
| más de $70.000 hasta $190.000 | $10.000 |
| más de $190.000 hasta $250.000 | $20.000 |
| más de $250.000 hasta $400.000 | $30.000 |
| más de $400.000 | $42.000 |

| Cuándo | Canal |
|---|---|
| Al pagar | Cartel en "pago confirmado" + mail + WhatsApp |
| Faltan 7 días | Mail |
| Faltan 3 días | Mail (en rojo, "últimos días") |
| Faltan 2 días | WhatsApp |

---

## Cómo funciona

```
Cliente paga ──► Tiendanube manda webhook "order/paid" ──► tn-webhook
                                                             ├─ crea cupón único en Tiendanube (1 uso, con vencimiento)
                                                             ├─ mail (Resend) + WhatsApp (bot de tu amigo)
                                                             └─ si la orden USÓ un cupón nuestro → lo marca usado
Página "pago confirmado" ──► script Nube SDK ──► cupon-orden ──► muestra el código (o "te llega cuando se acredite")
Todos los días 10:00 ──► recordatorios ──► chequea en Tiendanube si se usó; si no, manda el aviso que toque
Orden cancelada ──► el cupón de esa orden se desactiva
```

Todo corre en **Supabase** (gratis para este volumen): base de datos + funciones + cron.

---

## Instalación (una sola vez, ~1 hora)

### 1. Supabase
1. Creá un proyecto en [supabase.com](https://supabase.com) (región São Paulo).
2. Instalá la CLI y vinculá: `npx supabase login` y `npx supabase link --project-ref TU-PROYECTO`
3. Subí la base: `npx supabase db push`

### 2. App en el Portal de Partners de Tiendanube
1. Entrá a [partners.tiendanube.com](https://partners.tiendanube.com) (si no tenés cuenta, creala; es gratis) → **Crear aplicación** (para uso propio).
2. **URL de redirección**: `https://TU-PROYECTO.supabase.co/functions/v1/tn-auth`
3. **Permisos**: Órdenes (lectura) y Cupones/Descuentos (escritura).
4. **Webhooks de privacidad** (los 3 obligatorios: store/redact, customers/redact, customers/data_request):
   `https://TU-PROYECTO.supabase.co/functions/v1/tn-privacy`
5. Anotá el **App ID** y el **Client Secret**.

### 3. Mail (Resend)
1. Cuenta en [resend.com](https://resend.com) → verificá tu dominio (te pide 3 registros DNS).
2. Creá una API key.

### 4. Secrets y deploy
```bash
npx supabase secrets set \
  TN_CLIENT_ID=xxxx \
  TN_CLIENT_SECRET=xxxx \
  RESEND_API_KEY=re_xxxx \
  EMAIL_FROM="Gelica <cupones@tudominio.com.ar>" \
  EMAIL_REPLY_TO="hola@tudominio.com.ar" \
  WHATSAPP_WEBHOOK_URL="https://el-bot-de-tu-amigo/..." \
  WHATSAPP_WEBHOOK_SECRET="una-clave-que-le-pasas-a-tu-amigo" \
  CRON_SECRET="otra-clave-larga-al-azar" \
  CONTACT_EMAIL="tu@mail.com"

npx supabase functions deploy
```

### 5. Instalar la app en tu tienda
Abrí `https://www.tiendanube.com/apps/TU_APP_ID/authorize` logueado en el admin de Gelica → Aceptar.
Tiene que aparecer "✅ App instalada". Eso crea la configuración, las escalas y los webhooks.

### 6. Cron diario
Abrí `supabase/cron.sql`, reemplazá `TU-PROYECTO` y `TU_CRON_SECRET`, y corrélo en el **SQL Editor** de Supabase.

### 7. Cartel en "pago confirmado"
1. Abrí `checkout/cartel-pago-confirmado.jsx` y completá `API` y `STORE_ID`.
2. Admin de Tiendanube → **Configuración → Opciones del checkout → Códigos personalizados → Desarrollo** → pegalo en **Scripts** → Guardar.
3. Hacé una compra de prueba en incógnito.
   Si el cartel aparece en un lugar que no te gusta, cambiá `SLOT` (las opciones están en el archivo).

### 8. Ajustá la configuración
En Supabase → **Table Editor → `configuracion`**: poné tu `url_tienda` real y revisá el resto.

---

## Qué podés editar (sin tocar código)

Supabase → Table Editor:

- **`configuracion`**
  - `dias_validez`: duración del cupón (20). Afecta a los cupones nuevos.
  - `recordatorios`: `[{"dias_antes":7,"canal":"email"},{"dias_antes":3,"canal":"email"},{"dias_antes":2,"canal":"whatsapp"}]`.
    Podés agregar, por ejemplo, `{"dias_antes":1,"canal":"email"}`.
  - `base_monto`: `total_sin_envio` (lo que pagó, sin envío), `total` o `subtotal` (precio de lista, antes de descuentos).
  - `combina_con_promos`: si el cupón se suma al 3x2 u otras promos (por defecto **no**).
  - `activa`: apaga todo sin desinstalar.
  - `aviso_inicial_email` / `aviso_inicial_whatsapp`.
- **`escalas`**: montos y cupones. `compra_minima` = mínimo para *usar* el cupón (vacío = sin mínimo).
- **`resumen_cupones`** (vista): emitidos, usados, vencidos, % de uso, pesos canjeados.
- **`cupones`** / **`avisos`**: detalle de cada cupón y cada aviso (incluye errores de envío).

---

## Para tu amigo (bot de WhatsApp)

La app hace un `POST` a `WHATSAPP_WEBHOOK_URL` con el header `Authorization: Bearer <WHATSAPP_WEBHOOK_SECRET>` y este JSON:

```json
{
  "evento": "cupon_creado",            // o "cupon_por_vencer"
  "tipo": "inicial",                   // o "recordatorio_2"
  "telefono": "5491122334455",
  "nombre": "Laura",
  "codigo": "GELICA10KQ7HXM",
  "monto": 10000,
  "monto_texto": "$10.000",
  "vence_el": "2026-12-02",
  "vence_texto": "miércoles 2 de diciembre",
  "dias_restantes": 20,
  "link_tienda": "https://www.gelica.com.ar",
  "mensaje": "¡Hola Laura! 🎁 Gracias por tu compra en Gelica. Te regalamos *$10.000* ...",
  "id_unico": "uuid:inicial"
}
```

- `mensaje` viene listo para mandar. Si el bot usa la API oficial de Meta (mensajes fuera de las 24 h), necesita una **plantilla aprobada**; los campos sueltos sirven para completarla.
- Tiene que responder `200`. Si responde error, queda registrado en la tabla `avisos`.
- `id_unico` sirve para no mandar dos veces lo mismo.
- Si el teléfono no se pudo pasar a formato `549...`, llega tal cual lo cargó el cliente.

---

## Detalles de seguridad y anti-abuso
- Cada cupón es de **1 uso**, con fecha de vencimiento, y el código no se puede adivinar.
- Si la orden se **cancela**, su cupón se desactiva.
- El endpoint del cartel solo responde órdenes de las **últimas 48 h** y no devuelve datos personales.
- Los webhooks se verifican con la firma HMAC de Tiendanube.
- Si un webhook se pierde, el proceso diario crea los cupones de las órdenes pagadas en los últimos 2 días que hayan quedado sin cupón.
- Las órdenes de **Mercado Libre** no generan cupón (editable en `origenes_excluidos`).

## Tests
`node --test tests/logic.test.ts`: escalas (con bordes), calendario de recordatorios, códigos, teléfonos y fechas.
La carpeta `preview/` tiene cómo se ven los mails.
