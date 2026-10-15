// El catálogo embebido en essentials-pago es la fuente de verdad de precios en el servidor.
// Estas pruebas lo comparan con catalogo.json y con lo que muestra el frontend (essentials/catalog.js).
// catalogo.json es el catálogo interno (lleva datos del proveedor) y NO está en este repositorio: esas dos comparaciones
// solo corren si defines ESSENTIALS_CATALOGO_JSON con su ruta; sin ella se omiten. La comparación con essentials/catalog.js siempre corre.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolve } from 'node:path';
import { RAIZ_REPO, leerFuente } from './helpers/cargar-funcion.mjs';
import { crearEntorno } from './helpers/entorno.mjs';
import { construirBloque, extraerBloque } from './herramientas/sync-catalogo.mjs';

const RUTA_CATALOGO = process.env.ESSENTIALS_CATALOGO_JSON ? resolve(process.env.ESSENTIALS_CATALOGO_JSON) : null;
const RUTA_CATALOG_JS = resolve(RAIZ_REPO, 'essentials/catalog.js');
const hayCatalogo = RUTA_CATALOGO !== null && existsSync(RUTA_CATALOGO);
const hayCatalogJs = existsSync(RUTA_CATALOG_JS);
const SIN_CATALOGO = 'define ESSENTIALS_CATALOGO_JSON con la ruta de catalogo.json (no está en el repositorio)';

// essentials/catalog.js es un script de navegador (UMD sin import/export) y package.json declara "type": "module":
// se ejecuta en un contexto aislado con un `module` falso, igual que lo haría un require de CommonJS.
function cargarCatalogoFrontend() {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(readFileSync(RUTA_CATALOG_JS, 'utf8'), sandbox, { filename: RUTA_CATALOG_JS });
  return sandbox.module.exports;
}

async function conEntorno(fn) {
  const e = await crearEntorno();
  try { await fn(e); } finally { await e.cerrar(); }
}

test('el bloque de catálogo de essentials-pago coincide con catalogo.json', { skip: !hayCatalogo && SIN_CATALOGO }, () => {
  const catalogo = JSON.parse(readFileSync(RUTA_CATALOGO, 'utf8'));
  const { bloque } = extraerBloque(leerFuente('essentials-pago'));
  assert.equal(bloque, construirBloque(catalogo),
    'ejecuta: node herramientas/sync-catalogo.mjs (regenera el bloque desde catalogo.json)');
});

test('cada variante de catalogo.json se cotiza al precio exacto del archivo; las variantes que no se ofrecen se rechazan', { skip: !hayCatalogo && SIN_CATALOGO }, () => conEntorno(async (e) => {
  const catalogo = JSON.parse(readFileSync(RUTA_CATALOGO, 'utf8'));
  let comprobadas = 0;
  for (const p of catalogo.productos) {
    for (const v of p.variantes) {
      const r = await e.pago({ accion: 'cotizar', items: [{ sku: p.sku, variante: v.id, qty: 1 }] });
      assert.equal(r.status, 200, `${p.sku}/${v.id}`);
      assert.equal(r.body.total_cents, Math.round(v.precio * 100), `${p.sku}/${v.id}`);
      assert.equal(r.body.items[0].nombre, p.nombre_comercial);
      assert.equal(r.body.items[0].variante_etiqueta, v.etiqueta_publica);
      comprobadas += 1;
    }
    for (const no of p.variantes_no_ofrecer) {
      const literal = no.nombre_proveedor_literal.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (p.variantes.some((v) => v.id === literal)) continue;     // el id público coincide con otro literal: no es "no ofrecida"
      const r = await e.pago({ accion: 'cotizar', items: [{ sku: p.sku, variante: literal, qty: 1 }] });
      assert.equal(r.status, 400, `${p.sku}/${literal} no se ofrece`);
      assert.equal(r.body.codigo, 'variante_invalida');
    }
  }
  assert.equal(comprobadas, 17, '5 productos, 17 variantes en total');
  assert.deepEqual(catalogo.productos.map((p) => p.sku), catalogo.meta.skus);
}));

test('los precios del servidor coinciden con los que muestra el frontend (essentials/catalog.js)', { skip: !hayCatalogJs && 'no está essentials/catalog.js' }, () => conEntorno(async (e) => {
  const { CATALOG } = cargarCatalogoFrontend();
  assert.equal(CATALOG.currency, 'USD');
  let n = 0;
  for (const [sku, prod] of Object.entries(CATALOG.products)) {
    for (const v of prod.variants) {
      const r = await e.pago({ accion: 'cotizar', items: [{ sku, variante: v.id, qty: 1 }] });
      assert.equal(r.status, 200, `${sku}/${v.id}: el frontend ofrece una variante que el servidor no acepta`);
      assert.equal(r.body.total_cents, CATALOG.tokens[v.key], `${sku}/${v.id}: precio del servidor distinto del que muestra el frontend`);
      assert.equal(r.body.items[0].nombre, prod.name);
      assert.equal(r.body.items[0].variante_etiqueta, v.label);
      n += 1;
    }
  }
  assert.equal(n, 17);
}));

// El servidor acepta 1 a 5 unidades por línea. Si catalog.js dejara elegir más, el comprador que pidiera 6 o más recibiría
// el error "Quantity must be a whole number from 1 to 5". Esta prueba falla si el frontend ofrece más de lo que el servidor acepta.
test('frontend: unidades máximas de catalog.js no superan el límite del servidor (1 a 5)', { skip: !hayCatalogJs && 'no está essentials/catalog.js' }, async () => {
  const { CATALOG } = cargarCatalogoFrontend();
  const e = await crearEntorno();
  try {
    const dentro = await e.pago({ accion: 'cotizar', items: [{ sku: 'leather-card-holder', variante: 'navy', qty: 5 }] });
    const fuera = await e.pago({ accion: 'cotizar', items: [{ sku: 'leather-card-holder', variante: 'navy', qty: 6 }] });
    assert.equal(dentro.status, 200);
    assert.equal(fuera.status, 400);
  } finally { await e.cerrar(); }
  assert.ok(Number.isInteger(CATALOG.maxQty) && CATALOG.maxQty >= 1 && CATALOG.maxQty <= 5,
    `catalog.js ofrece hasta ${CATALOG.maxQty} unidades y el servidor acepta 5`);
});

test('el código de la función no lleva datos internos del proveedor (catálogo mínimo)', () => {
  const fuente = leerFuente('essentials-pago').toLowerCase();
  for (const interno of ['aliexpress', 'proveedor', 'costo_envio_proveedor', 'nombre_proveedor']) {
    assert.ok(!fuente.includes(interno), `no debe aparecer "${interno}" en essentials-pago`);
  }
  // Los identificadores de los listados del proveedor son números largos (15 dígitos o más).
  assert.ok(!/\b\d{15,}\b/.test(fuente), 'no debe haber identificadores numéricos largos de listados del proveedor en essentials-pago');
});
