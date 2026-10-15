// Comprueba que essentials-pago / essentials-confirmar reutilizan la integración n1co REAL (copias en referencia/):
// mismo endpoint, misma autenticación, mismas variables de entorno, sin secretos nuevos ni hardcodeados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RAIZ, RUTA_REFERENCIA, RUTA_FUNCIONES, cargarFuncion } from './helpers/cargar-funcion.mjs';
import { crearEntorno, pedidoValido, CLAVE_N1CO, CLAVE_SERVICIO } from './helpers/entorno.mjs';

const leer = (base, slug) => readFileSync(resolve(base, slug, 'index.ts'), 'utf8');
const ref = { pago: leer(RUTA_REFERENCIA, 'n1co-pago'), confirmar: leer(RUTA_REFERENCIA, 'n1co-confirmar') };
const nuevo = { pago: leer(RUTA_FUNCIONES, 'essentials-pago'), confirmar: leer(RUTA_FUNCIONES, 'essentials-confirmar') };

const variablesDeEntorno = (fuente) => new Set([...fuente.matchAll(/Deno\.env\.get\('([A-Z0-9_]+)'\)/g)].map((m) => m[1]));
const linea = (fuente, empieza) => fuente.split('\n').find((l) => l.startsWith(empieza));
const normalizar = (s) => s.replace(/\s+/g, ' ').trim();
function declaracion(fuente, nombre) {
  const m = fuente.match(new RegExp(`const ${nombre}\\s*= [\\s\\S]*?;\\n`));
  assert.ok(m, `no se encontró const ${nombre}`);
  return normalizar(m[0]);
}

test('variables de entorno: solo las que ya usan n1co-pago y n1co-confirmar (ninguna nueva)', () => {
  const usadasPorReferencia = new Set([...variablesDeEntorno(ref.pago), ...variablesDeEntorno(ref.confirmar)]);
  assert.deepEqual([...usadasPorReferencia].sort(), ['N1CO_ENTORNO', 'N1CO_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']);
  assert.deepEqual([...variablesDeEntorno(nuevo.pago)].sort(), ['N1CO_ENTORNO', 'N1CO_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']);
  assert.deepEqual([...variablesDeEntorno(nuevo.confirmar)].sort(), ['N1CO_ENTORNO', 'N1CO_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']);
});

test('las declaraciones de entorno, endpoint y autenticación son idénticas a las de las funciones reales', () => {
  for (const nombre of ['N1CO_ENTORNO', 'N1CO_SECRET_KEY', 'API_BASE']) {
    assert.equal(declaracion(nuevo.pago, nombre), declaracion(ref.pago, nombre), `essentials-pago ${nombre}`);
    assert.equal(declaracion(nuevo.confirmar, nombre), declaracion(ref.confirmar, nombre), `essentials-confirmar ${nombre}`);
  }
  for (const nombre of ['SUPABASE_URL', 'SERVICE_KEY']) {
    assert.equal(declaracion(nuevo.confirmar, nombre), declaracion(ref.confirmar, nombre), nombre);
    assert.equal(declaracion(nuevo.pago, nombre), declaracion(ref.confirmar, nombre), nombre);
  }
  assert.ok(nuevo.pago.includes("'Authorization': `Bearer ${N1CO_SECRET_KEY}`"));
  assert.ok(nuevo.confirmar.includes("'Authorization': `Bearer ${N1CO_SECRET_KEY}`"));
  assert.ok(ref.pago.includes("'Authorization': `Bearer ${N1CO_SECRET_KEY}`"));
  assert.ok(nuevo.pago.includes('${API_BASE}/paymentlink/checkout') && ref.pago.includes('${API_BASE}/paymentlink/checkout'));
  assert.ok(nuevo.confirmar.includes('${API_BASE}/paymentlink/order/') && ref.confirmar.includes('${API_BASE}/paymentlink/order/'));
  // El CORS es el mismo literal
  const cors = (f) => normalizar(f.match(/const corsHeaders = \{[\s\S]*?\};/)[0]);
  assert.equal(cors(nuevo.pago), cors(ref.pago));
  assert.equal(cors(nuevo.confirmar), cors(ref.confirmar));
});

test('las únicas URLs de n1co escritas en el código son las dos de n1co-pago', () => {
  const urls = (f) => new Set([...f.matchAll(/https:\/\/[a-z0-9.-]*n1co[a-z0-9.-]*[^'"`\s]*/g)].map((m) => m[0]));
  const esperadas = ['https://api-pay-sandbox.n1co.shop/api', 'https://api-pay.n1co.shop/api'];
  assert.deepEqual([...urls(ref.pago)].sort(), esperadas);
  assert.deepEqual([...urls(nuevo.pago)].sort(), esperadas);
  assert.deepEqual([...urls(nuevo.confirmar)].sort(), esperadas);
});

test('no hay secretos escritos en el código: ni JWT, ni claves, ni Bearer literal', () => {
  for (const [nombre, fuente] of Object.entries(nuevo)) {
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(fuente), `${nombre}: no debe haber un JWT literal`);
    assert.ok(!/\b(sk|pk|rk)[_-](live|test)?[_-]?[A-Za-z0-9]{16,}/.test(fuente), `${nombre}: no debe haber claves secretas de pasarela (prefijos sk, pk, rk)`);
    assert.ok(!/Bearer\s+[A-Za-z0-9._-]{16,}/.test(fuente), `${nombre}: Bearer solo con variable`);
    assert.ok(!/(SECRET|SERVICE|API)_?KEY\s*=\s*['"`][^'"`]+['"`]/.test(fuente), `${nombre}: claves solo desde Deno.env`);
    assert.ok(!/^\s*import\s/m.test(fuente) && !/\brequire\(/.test(fuente), `${nombre}: debe ser un solo index.ts sin imports`);
    assert.ok(!/\beval\(|new Function\(/.test(fuente), `${nombre}: sin eval`);
  }
});

test('payload y cabeceras hacia n1co: mismas claves y mismas cabeceras que n1co-pago (comparado ejecutando ambas)', async () => {
  const e = await crearEntorno({ conReferencia: false });
  try {
    // 1. n1co-pago REAL (referencia/) contra la misma simulación n1co
    const hReal = await cargarFuncion('n1co-pago', e.env, { base: RUTA_REFERENCIA });
    const real = await hReal(new Request('https://x.test/n1co-pago', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'basico', codigo_cv: 'ABCD2345' }),
    }));
    assert.equal(real.status, 200);
    // 2. essentials-pago
    const nuevoR = await e.pago(pedidoValido());
    assert.equal(nuevoR.status, 200, nuevoR.texto);

    const [pReal, pNuevo] = e.n1co.creaciones();
    assert.deepEqual(Object.keys(pNuevo.cuerpo).sort(), Object.keys(pReal.cuerpo).sort(), 'mismo conjunto de campos hacia n1co');
    assert.equal(pNuevo.auth, pReal.auth);
    assert.equal(pNuevo.auth, `Bearer ${CLAVE_N1CO}`);
    assert.equal(pNuevo.accept, pReal.accept);
    assert.equal(pNuevo.contentType, pReal.contentType);
    assert.equal(pNuevo.ruta, pReal.ruta);
    assert.equal(pNuevo.cuerpo.expirationMinutes, pReal.cuerpo.expirationMinutes);
    assert.equal(typeof pNuevo.cuerpo.amount, typeof pReal.cuerpo.amount);
    assert.equal(new URL(pNuevo.cuerpo.successUrl).origin, new URL(pReal.cuerpo.successUrl).origin);
    assert.equal(new URL(pNuevo.cuerpo.cancelUrl).origin, new URL(pReal.cuerpo.cancelUrl).origin);
    assert.deepEqual(Object.keys(pNuevo.cuerpo.metadata[0]), Object.keys(pReal.cuerpo.metadata[0]), 'metadata como [{name, value}]');
    assert.equal(e.salidas.length, 2);
    assert.equal(e.salidas[0].url, e.salidas[1].url, 'la misma URL de n1co');
    // 3. Los dos usan la misma clave; la clave del service role solo va a la base
    assert.ok(e.n1co.peticiones.every((x) => x.auth === `Bearer ${CLAVE_N1CO}`));
    assert.ok(e.n1co.peticiones.every((x) => !JSON.stringify(x).includes(CLAVE_SERVICIO)));
  } finally { await e.cerrar(); }
});

test('la consulta de estado es la de n1co-confirmar (comparado ejecutando ambas)', async () => {
  const e = await crearEntorno({ conReferencia: true });
  try {
    const p = await e.pago(pedidoValido());
    e.n1co.pagar(p.body.orderCode);
    await e.confirmar({ order_code: p.body.orderCode, token: p.body.token });
    // n1co-confirmar real, sobre una orden de CV (metadata codigo_cv) en la misma simulación
    const cv = await fetch('https://api-pay-sandbox.n1co.shop/api/paymentlink/checkout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CLAVE_N1CO}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        orderReference: 'CVPRO-X', orderName: 'CVPro Básico', orderDescription: 'x', amount: 4.99, successUrl: 'https://getcvpro.com/gracias.html',
        cancelUrl: 'https://getcvpro.com/chat-cv.html', metadata: [{ name: 'codigo_cv', value: 'ABCD2345' }, { name: 'plan', value: 'basico' }], expirationMinutes: 60,
      }),
    }).then((r) => r.json());
    e.n1co.pagar(cv.orderCode);
    e.salidas.length = 0;
    await e.n1coConfirmarReal({ orderCode: cv.orderCode });          // fallará al escribir en pagos (la simulación no la tiene); solo interesa la consulta
    const consultaReal = e.n1co.peticiones.filter((x) => x.metodo === 'GET').pop();
    const consultaNueva = e.n1co.peticiones.filter((x) => x.metodo === 'GET')[0];
    assert.equal(consultaNueva.auth, consultaReal.auth);
    assert.equal(consultaNueva.accept, consultaReal.accept);
    assert.match(consultaReal.ruta, /^\/api\/paymentlink\/order\//);
    assert.match(consultaNueva.ruta, /^\/api\/paymentlink\/order\//);
  } finally { await e.cerrar(); }
});

test('la n1co-confirmar REAL rechaza una orden de /essentials/ (sin codigo_cv) y no escribe en pagos', async () => {
  const e = await crearEntorno({ conReferencia: true });
  try {
    const p = await e.pago(pedidoValido());
    e.n1co.pagar(p.body.orderCode);
    const r = await e.n1coConfirmarReal({ orderCode: p.body.orderCode });
    assert.equal(r.status, 502);
    assert.equal(r.body.pagado, false);
    assert.equal(r.body.error, 'Orden sin código asociado');
    assert.ok(!e.supa.peticiones.some((x) => x.ruta.includes('/rest/v1/pagos')), 'no debe tocar la tabla pagos');
  } finally { await e.cerrar(); }
});
