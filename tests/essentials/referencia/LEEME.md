# Referencia: integración n1co que reutiliza /essentials/

`n1co-pago/index.ts` y `n1co-confirmar/index.ts` son copias literales del código desplegado en el proyecto Supabase del sitio (leídas el 2026-10-14; solo se añadió el salto de línea final). No forman parte del despliegue de /essentials/: las pruebas las usan para comprobar que `essentials-pago` y `essentials-confirmar` hablan con n1co igual que ellas (mismo endpoint, mismas cabeceras, mismos campos, mismas variables de entorno) y que `n1co-confirmar` rechaza una orden de la tienda sin escribir en `public.pagos`.

| Archivo | Slug | Versión desplegada | verify_jwt | ezbr_sha256 (bundle) |
|---|---|---|---|---|
| `n1co-pago/index.ts` | n1co-pago | 5 | true | `2cb4e4b9ee15165a9c831b0c17e7ac2249b7d57ff27c4dc6f6b202bf4573cedf` |
| `n1co-confirmar/index.ts` | n1co-confirmar | 3 | true | `5667d84cbc6379603afe9c1a363cf3f65fbaa3f646661cceab140308a827e32e` |

Si alguna de las dos cambia en producción, actualiza la copia (y estos datos) y vuelve a ejecutar `npm run test:essentials`.

## Lo que se extrae de ellas

| Elemento | Valor real |
|---|---|
| Variables de entorno n1co | `N1CO_ENTORNO` (`live` o, por defecto, `sandbox`), `N1CO_SECRET_KEY` |
| Variables de Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (las inyecta Supabase) |
| Base de la API | `live`: `https://api-pay.n1co.shop/api` · otro valor: `https://api-pay-sandbox.n1co.shop/api` |
| Crear enlace | `POST {API_BASE}/paymentlink/checkout` con `Authorization: Bearer ${N1CO_SECRET_KEY}`, `Content-Type` y `Accept: application/json` |
| Cuerpo del enlace | `orderReference`, `orderName`, `orderDescription`, `amount` (dólares, número), `successUrl`, `cancelUrl`, `metadata: [{name, value}]`, `expirationMinutes: 60` |
| Respuesta | `paymentLinkUrl`, `orderCode`, `orderId` |
| Consultar orden | `GET {API_BASE}/paymentlink/order/{orderCode}` con `Authorization: Bearer` y `Accept: application/json` |
| Campos leídos de la orden | `orderStatus` (`PAID` o `FINALIZED` = pagado), `total`, `metadata[]`, `store.currencyCode`, `payment.buyer.{email,name}` |
| CORS | `Access-Control-Allow-Origin: *`; `Allow-Headers: authorization, x-client-info, apikey, content-type`; `Allow-Methods: POST, OPTIONS` |

## Observaciones

- `public.pagos` (planes de CV) tiene `CHECK (monto >= 4.99 AND monto <= 100)`: los pedidos de la tienda superan 100 USD y no pueden guardarse allí. Por eso existe la tabla `essentials_pedidos`.
- `n1co-confirmar` solo registra órdenes cuya metadata incluya `codigo_cv`; una orden de /essentials/ (sin ese campo) devuelve 502 "Orden sin código asociado" y no escribe en `pagos`.
- `n1co-pago` no valida que `orderCode` exista en la respuesta de n1co; `essentials-pago` sí lo exige porque lo necesita para confirmar.
