# Pruebas de /essentials/ (backend y migración)

Cubren `supabase/functions/essentials-pago`, `supabase/functions/essentials-confirmar` y `supabase/migrations/*_essentials_pedidos.sql`. No necesitan instalar nada ni tocar Supabase o n1co reales: un servidor n1co simulado y un PostgREST simulado en memoria (con los mismos NOT NULL, CHECK, UNIQUE y trigger que la migración) escuchan en 127.0.0.1, y las dos URLs de n1co escritas en el código se redirigen a ellos. Cualquier otra salida a red se bloquea.

```
npm run test:essentials      # 68 pruebas; sin los recursos opcionales de abajo, 65 pasan y 3 se omiten
npm run test:todo            # npm test (motor y cliente) + las de essentials
```

Requisitos: **Node 22.13 o superior** (las funciones son TypeScript de Deno y se cargan con `module.stripTypeScriptTypes`). El workflow `tests.yml` usa `node-version: 22`, que lo cumple. Con Node 20 a 22.12 hay que tener instalado el paquete `typescript`; `npm test` (motor y cliente) sigue funcionando con Node 20 porque no incluye estas pruebas. No usar `node --test tests/essentials/` (el argumento de directorio no funciona en Node 22); usar el script.

## Cobertura

cotizar OK; pagar OK; confirmar OK; confirmar dos veces y en paralelo; sku inexistente; variante inválida; qty 0 y 6; dirección sin ZIP válido; política no aceptada; idempotencia y concurrencia; importes que no cuadran; n1co caído; CORS; secretos; no exposición de otros pedidos; ausencia de datos personales en n1co, logs y respuestas; la migración (columnas, RLS sin políticas, privilegios, índices, trigger anti-doble-confirmación).

## Recursos opcionales (las 3 pruebas que se omiten)

| Variable | Qué activa |
|---|---|
| `ESSENTIALS_CATALOGO_JSON=/ruta/catalogo.json` | 2 pruebas que comparan el catálogo embebido en `essentials-pago` con el catálogo interno de la tienda. Ese archivo lleva datos del proveedor y no está en el repositorio. Con la misma variable funciona `herramientas/sync-catalogo.mjs` (regenera o verifica el bloque `<CATALOGO:BEGIN>...<CATALOGO:END>`). |
| `ESSENTIALS_TEST_PG="host=/ruta/socket port=5432 user=postgres dbname=postgres"` | Ejecuta `sql/verificar-migracion.sql` en un PostgreSQL REAL (usa `psql`). Solo una base DESECHABLE, nunca la de producción: corre dentro de una transacción que termina en `ROLLBACK`. Verificado con PostgreSQL 16.15 (37 comprobaciones, y la migración aplicada dos veces sin error). |

## Carpetas

| Ruta | Qué es |
|---|---|
| `*.test.mjs` | Las pruebas (`node:test`). |
| `helpers/` | Carga de las funciones .ts, n1co simulado, Supabase simulado y datos de prueba. |
| `sql/verificar-migracion.sql` | Verificación de la migración en PostgreSQL real. |
| `referencia/` | Copias del código desplegado de `n1co-pago` y `n1co-confirmar` y `LEEME.md`. |
| `herramientas/sync-catalogo.mjs` | Sincroniza el catálogo embebido con `catalogo.json`. |

## Qué cambia respecto a la versión original

Las pruebas son las mismas que se aprobaron junto con las funciones, con estas adaptaciones al repositorio:

- Rutas: las funciones y la migración se leen de `supabase/`, y el frontend de `essentials/catalog.js` (antes, el `catalog.js` de la maqueta).
- `essentials/catalog.js` se ejecuta en un contexto aislado (`node:vm`) porque `package.json` declara `"type": "module"` y es un script de navegador.
- La prueba de `maxQty` ya no es un aviso: falla si `catalog.js` ofrece más de 5 unidades por línea (el límite del servidor).
- La prueba de la migración filtra `*_essentials_pedidos.sql`, para no romperse cuando el repositorio tenga otras migraciones.
- La prueba "sin datos internos del proveedor" busca palabras y números largos en vez de los identificadores concretos de los listados.
- El catálogo interno es opcional (`ESSENTIALS_CATALOGO_JSON`).
