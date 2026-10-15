# Professional Essentials by CVPro: la sección /essentials/

Tienda en inglés, dentro de getcvpro.com, para vender artículos de cuero a compradores de EE.UU. por dropshipping, con pago por n1co. Es una sección aparte del creador de CV: no comparte páginas con él y solo se enlaza desde el pie de `en/index.html`.

**Estado: integrada en la rama `essentials`; nada está desplegado.** Hacer merge publica las páginas (GitHub Pages), pero el checkout no funciona hasta aplicar la migración y desplegar las dos funciones en Supabase. Antes del merge hay pendientes que bloquean la publicación (sección 5).

## 1. Qué se añadió

| Ruta | Qué es |
|---|---|
| `essentials/index.html`, `essentials/leather-*.html` (5) | Landing de la colección y 5 fichas de producto. |
| `essentials/guides/*.html` (2) | Guías de compra: cómo elegir un maletín para portátil y regalos para un hombre que trabaja en oficina. |
| `essentials/checkout.html`, `thanks.html` | Dirección de EE.UU., resumen con el total del servidor, aceptación de la política y retorno de n1co. Llevan `noindex`. |
| `essentials/terms.html`, `shipping-returns.html` | Términos de venta y la política «all sales final» con dos excepciones. |
| `essentials/catalog.js`, `essentials.js`, `checkout.js`, `*.css`, `img/` | Catálogo para mostrar precios, carrito, checkout, estilos e imágenes (WebP 480/800/1200 px e imágenes OG). |
| `sitemap.xml`, `llms.txt`, `en/index.html` | Solo se añaden las 10 URLs públicas, una sección en `llms.txt` y el enlace «Essentials» en el pie. |
| `supabase/functions/essentials-pago` | Funciones `cotizar` y `pagar`. |
| `supabase/functions/essentials-confirmar` | Confirmación del pago. |
| `supabase/migrations/20261014220000_essentials_pedidos.sql` | Tabla `public.essentials_pedidos`. |
| `tests/essentials/` | 68 pruebas del backend y de la migración (ver `tests/essentials/README.md`). |

Las páginas de `essentials/` se generan con herramientas que no viven en este repositorio (el texto sale de un archivo de contenido y un catálogo interno). Se pueden editar a mano, pero la próxima regeneración las sobrescribiría: si se cambia un texto o un precio, hay que cambiarlo también en la fuente.

## 2. Arquitectura

```
ficha de producto ──▶ carrito (localStorage, claves essentials_*) ──▶ checkout.html
                                                                        │ POST cotizar / pagar (Authorization: Bearer <anon key>)
                                                                        ▼
                                                              essentials-pago (Edge Function)
                                                               · precios en el servidor (sku + variante + qty)
                                                               · guarda el pedido en essentials_pedidos
                                                               · crea el enlace de pago en n1co
                                                                        │ paymentLinkUrl
                                                                        ▼
                                                                 página de pago de n1co
                                                                        │ successUrl = /essentials/thanks.html?ref=ESS-XXXXXXXXXX
                                                                        ▼
thanks.html ──▶ essentials-confirmar ──▶ consulta a n1co ──▶ marca el pedido «pagado» (una sola vez)
```

- **El servidor decide el precio.** El navegador solo manda `sku`, `variante` y `qty`; cualquier precio que llegue se ignora. El catálogo (5 productos, 17 variantes) está embebido en `essentials-pago`; `essentials/catalog.js` solo sirve para mostrar precios y una prueba comprueba que ambos coinciden.
- **Reglas del pedido:** de 1 a 5 líneas, cantidad de 1 a 5 por línea, un solo `sku` por línea, dirección de EE.UU. validada (ZIP, estado de 2 letras, país `US`), USD, envío incluido en el precio, sin impuesto, aceptación expresa de la política.
- **Idempotencia.** El navegador manda un `idem` (UUID) por intento de compra: un doble clic o un reintento devuelve el mismo pedido y el mismo enlace.
- **Confirmación única.** `essentials-confirmar` pide `token` (lo devuelve `pagar`) o el email del comprador, consulta a n1co y marca el pedido pagado con un UPDATE condicional. La tabla lo refuerza con restricciones y un trigger: un pedido pagado no puede cambiar de importe, de estado ni de `order_code`. Si n1co dice PAID pero el monto es menor, la moneda no es USD o el pedido no coincide, el pedido pasa a `revision` y no se marca pagado.
- **Privacidad.** A n1co solo se le envía referencia, monto, descripción de los artículos y 3 metadatos (`tienda`, `pedido`, `referencia`). Nombre, email y dirección se guardan en `essentials_pedidos` (RLS activado y sin ninguna política: solo la leen las funciones con la service role) y no se escriben en logs ni en respuestas.
- **Tabla propia.** No se usa `public.pagos`: su `CHECK (monto <= 100)` rechaza los pedidos de la tienda, y no debe llevar direcciones. La `n1co-confirmar` actual rechaza las órdenes de la tienda (no tienen `codigo_cv`) y no escribe en `pagos`: una prueba lo demuestra.
- **Estados del pedido:** `creado`, `pendiente`, `pagado`, `fallido`, `cancelado`, `fallido_pasarela`, `revision`. `cumplimiento` y `seguimiento` son para anotar a mano el pedido al proveedor y el envío.
- **Después del pago nada se automatiza:** ni el pedido al proveedor ni un correo al comprador. El dueño ve los pedidos en el panel de Supabase (tabla `essentials_pedidos`) y compra al proveedor con la dirección guardada.

Contrato completo (campos, códigos de error, ejemplos): comentarios de cabecera de cada `index.ts`. Todas las llamadas son `POST` JSON a `https://<proyecto>.supabase.co/functions/v1/<función>`, con `verify_jwt` activo (como `n1co-pago`). `essentials-confirmar` acepta como identificador `order_code` (también `orderCode`), la `referencia` `ESS-...` o el `pedido` (uuid), y como prueba de posesión `token` o `email`.

## 3. Variables de entorno: las mismas, ninguna nueva

| Variable | Uso |
|---|---|
| `N1CO_ENTORNO` | `live` usa `https://api-pay.n1co.shop/api`; cualquier otro valor usa `https://api-pay-sandbox.n1co.shop/api`. |
| `N1CO_SECRET_KEY` | `Authorization: Bearer ...` hacia n1co. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Las inyecta Supabase; acceso REST a la base con la service role. |

Son las mismas que ya usan `n1co-pago` y `n1co-confirmar`: no hay que crear secretos. No hay claves escritas en el código (una prueba lo verifica); la única clave del frontend es la anon key publicable que ya usa `index.html`.

> **Aviso: `N1CO_ENTORNO` es compartido con los pagos de CV.** Los secretos de Edge Functions son del proyecto entero. La tienda y el cobro de los CV usan el mismo entorno de n1co: no se puede tener la tienda en sandbox y los CV en live a la vez. Si hoy está en `live`, la tienda cobra de verdad desde que se despliegan las funciones; si se cambia a `sandbox` para probar, los pagos de CV también dejan de cobrar de verdad mientras dure la prueba.

## 4. Despliegue

Lo hace el dueño; no se despliega nada al hacer merge. Orden obligatorio: **migración → funciones → pruebas → merge del PR**. Las funciones fallan con 500 si la tabla no existe, y el merge publica páginas que llaman a las funciones.

1. **Antes de empezar.** `npm run test:todo` en la rama `essentials` (necesita Node 22.13 o superior). Opcional: verificar la migración en una base PostgreSQL desechable (`tests/essentials/README.md`).
2. **Migración.** Aplicar `supabase/migrations/20261014220000_essentials_pedidos.sql` en el SQL Editor de Supabase (o con la CLI, si el proyecto está enlazado). Es aditiva e idempotente: crea la tabla, 4 índices, la función `essentials_pedidos_guard()` y su trigger; no toca `public.pagos` ni nada existente. Comprobar que la tabla existe, que RLS está activo y que no tiene políticas.
3. **Secretos.** Confirmar que existen `N1CO_ENTORNO` y `N1CO_SECRET_KEY` (ya los usa `n1co-pago`). Decidir el entorno con el aviso de la sección 3 a la vista.
4. **Funciones.** Desplegar `essentials-pago` y `essentials-confirmar` con `verify_jwt` activo (el valor por defecto; no usar `--no-verify-jwt`):
   `supabase functions deploy essentials-pago essentials-confirmar --project-ref <ref del proyecto>`
5. **Prueba de humo sin riesgo.** `cotizar` no toca la base ni n1co:
   ```
   curl -s -X POST "https://<proyecto>.supabase.co/functions/v1/essentials-pago" \
     -H "Authorization: Bearer $ANON_KEY" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
     -d '{"accion":"cotizar","items":[{"sku":"leather-card-holder","variante":"navy","qty":1}]}'
   ```
   (`ANON_KEY` es la anon key publicable de `index.html`). Debe responder `ok: true` y `total_cents: 7750`.
6. **Pago de prueba de extremo a extremo** (pendiente 3; necesita un «go» explícito). Entorno: (a) `N1CO_ENTORNO=sandbox` un rato, que afecta también a los pagos de CV mientras dure, o (b) una compra real de la pieza más barata (77,50 USD) con reembolso posterior desde n1co. Antes del merge se puede probar todo menos el retorno a `thanks.html`, porque la `successUrl` apunta a `https://getcvpro.com/essentials/thanks.html`, que aún no existe: servir la rama en local (`python3 -m http.server` en la raíz del repo), hacer un pedido desde `/essentials/checkout.html`, pagarlo en n1co y confirmarlo con `curl` a `essentials-confirmar` (`{"order_code":"<referencia ESS-...>","email":"<email del pedido>"}`). Debe responder `pagado: true`, y la fila de `essentials_pedidos` debe quedar `pagado`.
7. **Merge del PR** solo cuando estén resueltos los pendientes que bloquean (sección 5). GitHub Pages publica `/essentials/` en uno o dos minutos. Como el merge también añade los enlaces (sitemap, `llms.txt`, pie de `en/index.html`), la tienda queda visible desde ese momento.
8. **Después del merge.** Repetir una compra con el reembolso por el sitio publicado para ver el retorno completo a `thanks.html`; abrir `/essentials/` y una ficha; comprobar `https://getcvpro.com/sitemap.xml` y enviarlo en Search Console. Revisar los puntos «a confirmar» de la sección 6. `robots.txt` no bloquea `checkout.html` ni `thanks.html` (necesario para que los buscadores vean su `noindex`); no hay que cambiarlo.

### Rollback

Se deshace en orden inverso y cada paso es independiente:

1. **Sitio:** revertir el merge (`git revert -m 1 <merge>` o el botón «Revert» del PR). Las páginas dejan de publicarse; los pagos de CV no se ven afectados.
2. **Funciones:** `supabase functions delete essentials-pago` y `supabase functions delete essentials-confirmar`. Son nuevas y nada más depende de ellas; `n1co-pago` y `n1co-confirmar` no se tocan.
3. **Tabla:** lo normal es dejarla (es inofensiva: RLS sin políticas). Borrarla solo si no hay pedidos, o después de exportarlos: guarda direcciones y emails de compradores reales.
   ```sql
   drop table if exists public.essentials_pedidos;
   drop function if exists public.essentials_pedidos_guard();
   ```
4. **Entorno:** si se puso `N1CO_ENTORNO=sandbox` para probar, devolverlo a su valor anterior (afecta a los pagos de CV).

## 5. Pendientes

**Bloquean el merge** (la tienda no debe publicarse sin ellos):

1. **Datos del vendedor.** Los tokens `{{SELLER_LEGAL_NAME}}` y `{{SELLER_STREET_ADDRESS}}` siguen visibles a propósito en `essentials/terms.html` (sección del vendedor y cláusula 8) y `essentials/shipping-returns.html` (cláusula 8). Se reemplazan con la razón social y la dirección física reales (`grep -rn "{{SELLER_" essentials` debe quedar vacío). Según la investigación de la misión, sin ellos el sitio incumpliría la sección 17538(d) del Código de Negocios y Profesiones de California para compradores de ese estado (a confirmar con el abogado).
2. **Ley aplicable y revisión legal.** `terms.html` dice «Governing law and dispute resolution: to be completed by legal counsel before this page is published». Hay que completarlo, quitar esa frase y pasar `terms.html` y `shipping-returns.html` por un abogado. Los hechos sobre n1co y sobre los requisitos de EE.UU. (norma de la FTC para pedidos por correo o internet, impuestos sobre ventas, aduanas) vienen de la investigación de la misión y no se verificaron con fuentes primarias.
3. **Pago real de prueba.** Toda la validación usó el backend simulado. Falta el extremo a extremo con n1co real y la base real (paso 6 del despliegue).
4. **Reembolsos con n1co.** Confirmar con n1co cómo y en cuánto tiempo reembolsa (la política promete 7 días hábiles) y si permite reembolsos parciales por artículo.

**Necesarios, pero no bloquean la publicación:**

5. **Correo de confirmación.** La política dice que la fecha del pedido es la del correo de confirmación, pero el backend no lo envía (`thanks.html` muestra «Payment confirmed on <fecha UTC>»). Hay que enviarlo o cambiar la frase de la política.
6. **Fotos de estudio.** Las imágenes se derivan de las fotos de los anuncios del proveedor. Faltan fotos de estudio (o propias) para el maletín de 17", el Travel Duffel y el maletín de 15" (esta última, de baja calidad), y el permiso por escrito del titular de las fotos para las demás. Las fichas muestran una nota discreta según el estado de cada foto (final, provisional o limitada). Mensaje para el vendedor, más abajo.
7. **Reseñas, certificados y especificaciones.** Todo lo que afirman las fichas está marcado como dicho por el vendedor. No hay reseñas ni valoraciones y no se debe añadir ninguna sin evidencia.
8. **Compromisos operativos de la política.** Atender `hola@getcvpro.com` en 2 días hábiles; validar los plazos (estimado de 15 a 25 días, reclamación de «no entregado» desde el día 30); decidir el texto de aranceles de la cláusula 1.
9. **Menores de la auditoría del backend:** añadir una prueba de regresión de «precios del cliente ignorados» para la acción `pagar` (hoy solo existe para `cotizar`); un pedido en `revision` podría pasar a `pagado` por el UPDATE final de `essentials-confirmar` si una llamada posterior lo confirma, aunque el comentario del código dice que solo lo resuelve el dueño a mano.
10. **Imagen OG de la colección.** `essentials/img/og-essentials.png` pesa 431 KB (es una imagen para redes, no se carga en la página): conviene optimizarla.
11. **Mediciones en producción.** Lighthouse se midió en local; repetirlo ya publicado.

## 6. A confirmar con n1co al desplegar

No se puede comprobar sin llamar a n1co; las pruebas solo cubren lo que `n1co-pago` y `n1co-confirmar` ya dan por hecho.

1. Si n1co añade el código de orden a la `successUrl` al volver al sitio (por eso se agrega `?ref=<referencia>`).
2. El formato real de `orderCode` (el patrón aceptado es `^[A-Za-z0-9_-]{1,64}$`, el mismo de `n1co-confirmar`).
3. Los valores de `orderStatus` distintos de PAID/FINALIZED (solo esos marcan pagado; `CANCEL*` pasa a `cancelado`; `EXPIR*`, `FAIL*`, `REJECT*`, `DECLIN*` y `DENIED` a `fallido`; el resto, `pendiente`).
4. Que `expirationMinutes: 60` signifique vigencia del enlace en minutos, como en `n1co-pago`.
5. Los límites de n1co: longitud de `orderName`/`orderDescription` y monto máximo por transacción. Los pedidos van de 77,50 a 4.732,25 USD (5 líneas de 5 unidades); los planes de CV no pasan de 100 USD, así que ese rango nunca se probó con n1co.
6. Si el `total` que devuelve n1co incluye comisiones (se acepta un total mayor y se guarda en `monto_n1co`; uno menor lleva a `revision`).
7. Que la RPC `checar_limite_ia_v2` acepte la clave `ess:<ip>` (si falla, la función deja pasar la compra y lo registra).

## 7. Mantenimiento

- **Cambiar un precio:** el precio que se cobra sale del bloque `<CATALOGO:BEGIN>...<CATALOGO:END>` de `essentials-pago/index.ts` (se regenera con `tests/essentials/herramientas/sync-catalogo.mjs` desde el catálogo interno) y hay que redesplegar la función. El precio que se muestra sale de `essentials/catalog.js`, de los JSON-LD y del texto de las páginas. La prueba `tests/essentials/catalogo.test.mjs` falla si servidor y `catalog.js` difieren.
- **Si `n1co-pago` o `n1co-confirmar` cambian**, actualizar las copias de `tests/essentials/referencia/`: las pruebas comparan contra ellas.
- **Tests:** `npm run test:essentials` (job `essentials` de `tests.yml`); `npm test` sigue siendo el de motor y cliente y funciona con Node 20.

## 8. Mensaje al vendedor de AliExpress (fotos sin marca de agua y permiso)

Sirve para los cinco artículos. Se sustituye `[LISTING TITLE]` por el título del anuncio de cada uno.

> Hello! I am setting up an online store for customers in the United States and would like to sell your item: [LISTING TITLE]. Could you please send high-resolution photos of this product (at least 2000 px on the long side) with no watermark or text, ideally on a plain white background, showing the front, back, side and inside, in each colour you offer? I would also like your written permission to use these photos on my reseller website. If you cannot send new files, please send the original-resolution images used in your listing. Thank you very much!
