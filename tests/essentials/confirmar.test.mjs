// Pruebas de essentials-confirmar: confirmación contra n1co, idempotencia y no exposición de otros pedidos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RAIZ } from './helpers/cargar-funcion.mjs';
import { crearEntorno, pedidoValido, envioValido, TOTAL_PEDIDO_CENTS, CLAVE_N1CO, sinAleatorios } from './helpers/entorno.mjs';

async function conEntorno(fn, opts) {
  const e = await crearEntorno(opts);
  try { await fn(e); } finally { await e.cerrar(); }
}

// Crea un pedido por la vía normal (essentials-pago) y devuelve lo que recibe el navegador.
async function crearPedido(e, extra = {}) {
  const r = await e.pago(pedidoValido(extra));
  assert.equal(r.status, 200, r.texto);
  return { ...r.body, email: (extra.email ?? 'Jane.Buyer@Example.com') };
}

const CLAVES_PAGADO = ['entorno', 'estado', 'items', 'moneda', 'monto', 'ok', 'orderCode', 'pagado', 'pagado_en', 'pedido', 'referencia', 'total_cents'];

test('confirmar OK: consulta a n1co, marca el pedido pagado y devuelve el resumen (sin datos personales)', () => conEntorno(async (e) => {
  const p = await crearPedido(e);
  e.n1co.pagar(p.orderCode);

  const r = await e.confirmar({ order_code: p.orderCode, token: p.token });
  assert.equal(r.status, 200, r.texto);
  const b = r.body;
  assert.deepEqual(Object.keys(b).sort(), CLAVES_PAGADO, 'solo estos campos');
  assert.equal(b.ok, true);
  assert.equal(b.pagado, true);
  assert.equal(b.estado, 'pagado');
  assert.equal(b.pedido, p.pedido);
  assert.equal(b.referencia, p.referencia);
  assert.equal(b.orderCode, p.orderCode);
  assert.equal(b.total_cents, TOTAL_PEDIDO_CENTS);
  assert.equal(b.monto, 372.03);
  assert.equal(b.moneda, 'USD');
  assert.equal(b.entorno, 'sandbox');
  assert.ok(!Number.isNaN(Date.parse(b.pagado_en)));
  assert.deepEqual(b.items.map((i) => [i.sku, i.variante, i.qty, i.precio_unit_cents]), [
    ['leather-briefcase-17-inch', 'black', 1, 21703], ['leather-card-holder', 'navy', 2, 7750],
  ]);
  for (const prohibido of ['jane', 'buyer', 'pennsylvania', 'example.com', '20500', '555', 'washington']) {
    assert.ok(!sinAleatorios(r.texto).includes(prohibido), `la respuesta no debe contener ${prohibido}`);
  }
  assert.ok(!r.texto.includes(p.token), 'la respuesta no devuelve el token de consulta');

  // Consulta a n1co: mismo endpoint y autenticación que n1co-confirmar
  const consulta = e.salidas.find((s) => s.metodo === 'GET');
  assert.equal(consulta.url, `https://api-pay-sandbox.n1co.shop/api/paymentlink/order/${p.orderCode}`);
  const peticion = e.n1co.peticiones.find((x) => x.metodo === 'GET');
  assert.equal(peticion.auth, `Bearer ${CLAVE_N1CO}`);
  assert.equal(peticion.accept, 'application/json');

  // Base
  const f = e.supa.porId(p.pedido);
  assert.equal(f.estado, 'pagado');
  assert.equal(f.n1co_estado, 'PAID');
  assert.equal(f.monto_n1co, 372.03);
  assert.equal(f.pagado_en, b.pagado_en);
}));

test('confirmar dos veces: misma respuesta exacta, n1co se consulta una sola vez y pagado_en no cambia', () => conEntorno(async (e) => {
  const p = await crearPedido(e);
  e.n1co.pagar(p.orderCode);

  const a = await e.confirmar({ order_code: p.orderCode, token: p.token });
  const b = await e.confirmar({ order_code: p.orderCode, token: p.token });
  const c = await e.confirmar({ order_code: p.orderCode, email: p.email });     // con otra prueba válida
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(c.status, 200);
  assert.equal(b.texto, a.texto, 'la segunda llamada devuelve exactamente lo mismo');
  assert.equal(c.texto, a.texto);
  assert.equal(a.body.pagado, true);
  assert.equal(e.n1co.consultas(p.orderCode), 1, 'las repeticiones se sirven desde la fila, sin volver a n1co');
  assert.equal(e.supa.filas.length, 1);
  assert.equal(e.supa.porId(p.pedido).pagado_en, a.body.pagado_en);
  const parches = e.supa.peticiones.filter((x) => x.metodo === 'PATCH' && x.cuerpo?.estado === 'pagado');
  assert.equal(parches.length, 1, 'una sola transición a pagado');
}));

test('confirmar en paralelo (varias pestañas): una sola transición y todas las respuestas idénticas', () => conEntorno(async (e) => {
  const p = await crearPedido(e);
  e.n1co.pagar(p.orderCode);
  e.n1co.opciones.retardoMs = 30;                                   // todas llegan a la vez a la fase de escritura
  const rs = await Promise.all(Array.from({ length: 6 }, () => e.confirmar({ order_code: p.orderCode, token: p.token })));
  assert.ok(rs.every((r) => r.status === 200), rs.map((r) => `${r.status}`).join(','));
  assert.ok(rs.every((r) => r.texto === rs[0].texto), 'respuestas idénticas');
  assert.equal(rs[0].body.pagado, true);
  assert.equal(e.supa.filas.length, 1);
  assert.equal(e.supa.porId(p.pedido).pagado_en, rs[0].body.pagado_en, 'pagado_en lo fijó solo la primera');
}));

test('aún no pagado: pagado=false con el estado; después de pagar en n1co, confirma', () => conEntorno(async (e) => {
  const p = await crearPedido(e);
  const antes = await e.confirmar({ order_code: p.orderCode, token: p.token });
  assert.equal(antes.status, 200);
  assert.deepEqual(antes.body, { ok: true, pagado: false, estado: 'pendiente', pedido: p.pedido, referencia: p.referencia, estado_pasarela: 'PENDING' });
  assert.equal(e.supa.porId(p.pedido).estado, 'pendiente');
  assert.equal(e.supa.porId(p.pedido).pagado_en, null);

  e.n1co.pagar(p.orderCode);
  const despues = await e.confirmar({ order_code: p.orderCode, token: p.token });
  assert.equal(despues.body.pagado, true);
}));

test('estados no pagados de n1co: cancelado/vencido se registran, y un pago posterior sigue pudiendo confirmarse', () => conEntorno(async (e) => {
  const p = await crearPedido(e);
  for (const [n1co, local] of [['CANCELLED', 'cancelado'], ['EXPIRED', 'fallido'], ['PROCESSING', 'pendiente']]) {
    e.n1co.fijarEstado(p.orderCode, n1co);
    const r = await e.confirmar({ order_code: p.orderCode, token: p.token });
    assert.equal(r.body.pagado, false, n1co);
    assert.equal(r.body.estado, local, n1co);
    assert.equal(r.body.estado_pasarela, n1co);
    assert.equal(e.supa.porId(p.pedido).estado, local);
    assert.equal(e.supa.porId(p.pedido).n1co_estado, n1co);
  }
  e.n1co.pagar(p.orderCode, { status: 'FINALIZED' });
  const ok = await e.confirmar({ order_code: p.orderCode, token: p.token });
  assert.equal(ok.body.pagado, true, 'FINALIZED también cuenta como pagado (igual que n1co-confirmar)');
  assert.equal(e.supa.porId(p.pedido).n1co_estado, 'FINALIZED');
}));

test('formas de identificar y probar: order_code, orderCode, referencia, pedido; token o email (sin distinguir mayúsculas)', () => conEntorno(async (e) => {
  const p = await crearPedido(e);
  e.n1co.pagar(p.orderCode);
  const intentos = [
    { order_code: p.orderCode, token: p.token },
    { orderCode: p.orderCode, token: p.token },
    { order_code: p.referencia, token: p.token },                     // la referencia propia viaja en la URL de retorno
    { pedido: p.pedido, token: p.token },
    { order_code: p.orderCode, email: 'jane.buyer@example.com' },
    { order_code: p.orderCode, email: '  JANE.BUYER@EXAMPLE.COM ' },
    { order_code: p.referencia, email: p.email },
    { pedido: p.pedido, email: p.email },
    { order_code: p.orderCode, token: p.token.toUpperCase() },
  ];
  for (const cuerpo of intentos) {
    const r = await e.confirmar(cuerpo);
    assert.equal(r.status, 200, JSON.stringify(cuerpo));
    assert.equal(r.body.pagado, true, JSON.stringify(cuerpo));
  }
  assert.equal(e.n1co.consultas(p.orderCode), 1);
}));

test('no expone datos de otros pedidos: sin la prueba correcta siempre 404 idéntico, y n1co no se consulta', () => conEntorno(async (e) => {
  const A = await crearPedido(e, { email: 'ana@example.com' });
  const B = await crearPedido(e, { email: 'beto@example.com', envio: envioValido({ nombre: 'Beto Beltran', linea1: '9 Secret Lane' }) });
  e.n1co.pagar(A.orderCode);
  e.n1co.pagar(B.orderCode);

  const noEncontrado = [
    { order_code: A.orderCode, token: B.token },                      // token de otro pedido
    { order_code: A.orderCode, email: B.email },                      // email de otro comprador
    { order_code: A.orderCode, token: '0'.repeat(32) },               // token con buen formato pero falso
    { order_code: A.orderCode, email: 'nadie@example.com' },
    { order_code: 'NO-EXISTE-123', token: A.token },                  // código inexistente
    { pedido: B.pedido, token: A.token },
    { pedido: '3f2b8c1e-5d4a-4b7e-9a10-ffffffffffff', token: A.token },
    { order_code: A.orderCode, pedido: B.pedido, token: A.token },     // identificadores que no coinciden
    { order_code: A.orderCode, token: B.token, email: B.email },
  ];
  const textos = new Set();
  for (const cuerpo of noEncontrado) {
    const r = await e.confirmar(cuerpo);
    assert.equal(r.status, 404, JSON.stringify(cuerpo));
    assert.equal(r.body.codigo, 'pedido_no_encontrado');
    assert.equal(r.body.pagado, false);
    textos.add(r.texto);
    for (const dato of ['ana', 'beto', 'secret', 'beltran', A.pedido, B.pedido, A.token, B.token]) {
      assert.ok(!r.texto.toLowerCase().includes(dato.toLowerCase()), `el 404 no debe filtrar ${dato}`);
    }
  }
  assert.equal(textos.size, 1, 'el 404 es el mismo para "no existe" y "no es tuyo"');
  assert.equal(e.n1co.consultas(A.orderCode) + e.n1co.consultas(B.orderCode), 0, 'sin prueba válida no se consulta a n1co');
  assert.equal(e.supa.porId(A.pedido).estado, 'pendiente', 'ni se modifica nada');

  // Con la prueba correcta cada uno ve SOLO lo suyo
  const ra = await e.confirmar({ order_code: A.orderCode, token: A.token });
  const rb = await e.confirmar({ order_code: B.orderCode, email: B.email });
  assert.equal(ra.body.pedido, A.pedido);
  assert.equal(rb.body.pedido, B.pedido);
  assert.ok(!ra.texto.includes(B.pedido) && !rb.texto.includes(A.pedido));
}));

test('entradas inválidas: 400 con pagado=false (sin identificador, sin prueba, formatos, intento de inyección en el filtro)', () => conEntorno(async (e) => {
  const p = await crearPedido(e);
  const lecturasAntes = e.supa.peticiones.filter((x) => x.metodo === 'GET').length;
  const casos = [
    [{ token: p.token }, 'identificador_requerido'],
    [{}, 'identificador_requerido'],
    [{ order_code: p.orderCode }, 'prueba_requerida'],
    [{ order_code: p.orderCode, token: '', email: '' }, 'prueba_requerida'],
    [{ order_code: p.orderCode, token: 'zzzz' }, 'token_invalido'],
    [{ order_code: p.orderCode, token: p.token + '0' }, 'token_invalido'],
    [{ order_code: p.orderCode, email: 'no-es-email' }, 'email_invalido'],
    [{ order_code: 'x,id.neq.0', token: p.token }, 'order_code_invalido'],
    [{ order_code: 'a)', token: p.token }, 'order_code_invalido'],
    [{ order_code: 'a b', token: p.token }, 'order_code_invalido'],
    [{ order_code: 'x'.repeat(65), token: p.token }, 'order_code_invalido'],
    [{ pedido: 'no-uuid', token: p.token }, 'pedido_invalido'],
    [{ pedido: '1 or 1=1', token: p.token }, 'pedido_invalido'],
  ];
  for (const [cuerpo, codigo] of casos) {
    const r = await e.confirmar(cuerpo);
    assert.equal(r.status, 400, JSON.stringify(cuerpo));
    assert.equal(r.body.codigo, codigo, JSON.stringify(cuerpo));
    assert.equal(r.body.pagado, false);
    assert.equal(r.body.ok, false);
  }
  assert.equal(e.n1co.consultas(p.orderCode), 0);
  assert.equal(e.supa.peticiones.filter((x) => x.metodo === 'GET').length, lecturasAntes,
    'las entradas inválidas ni siquiera llegan a la base');
}));

test('n1co dice pagado pero el monto, la moneda o el pedido no cuadran: no se marca pagado (estado revision)', () => conEntorno(async (e) => {
  const casos = [
    ['monto menor', { total: 100 }],
    ['moneda distinta', { currency: 'MXN' }],
    ['monto 0', { total: 0 }],
  ];
  for (const [nombre, cambio] of casos) {
    const p = await crearPedido(e);
    e.n1co.pagar(p.orderCode, cambio);
    const r = await e.confirmar({ order_code: p.orderCode, token: p.token });
    assert.equal(r.status, 200, nombre);
    assert.equal(r.body.pagado, false, nombre);
    assert.equal(r.body.estado, 'revision', nombre);
    assert.equal(e.supa.porId(p.pedido).estado, 'revision', nombre);
    assert.equal(e.supa.porId(p.pedido).pagado_en, null, nombre);
  }
  // metadata de otro pedido
  const q = await crearPedido(e);
  e.n1co.pagar(q.orderCode);
  e.n1co.ordenes.get(q.orderCode).metadata = [{ name: 'pedido', value: '3f2b8c1e-5d4a-4b7e-9a10-aaaaaaaaaaaa' }];
  const rq = await e.confirmar({ order_code: q.orderCode, token: q.token });
  assert.equal(rq.body.estado, 'revision');

  // Corregido el cobro, el pedido en revisión sí puede confirmarse
  const r1 = await crearPedido(e);
  e.n1co.pagar(r1.orderCode, { total: 100 });
  assert.equal((await e.confirmar({ order_code: r1.orderCode, token: r1.token })).body.estado, 'revision');
  e.n1co.pagar(r1.orderCode, { total: 372.03 });
  const ok = await e.confirmar({ order_code: r1.orderCode, token: r1.token });
  assert.equal(ok.body.pagado, true);
}));

test('n1co cobró de más (por ejemplo comisiones): se acepta y se guarda el monto real en monto_n1co', () => conEntorno(async (e) => {
  const p = await crearPedido(e);
  e.n1co.pagar(p.orderCode, { total: 380 });
  const r = await e.confirmar({ order_code: p.orderCode, token: p.token });
  assert.equal(r.body.pagado, true);
  assert.equal(r.body.total_cents, TOTAL_PEDIDO_CENTS, 'el total del pedido sigue siendo el calculado por el servidor');
  assert.equal(e.supa.porId(p.pedido).monto_n1co, 380);
}));

test('n1co no responde o responde error: 502 pasarela_no_disponible y el pedido sigue sin pagar; el reintento funciona', () => conEntorno(async (e) => {
  const p = await crearPedido(e);
  e.n1co.pagar(p.orderCode);
  for (const status of [500, 503, 404]) {
    e.n1co.opciones.falloConsulta = { status };
    const r = await e.confirmar({ order_code: p.orderCode, token: p.token });
    assert.equal(r.status, 502, `n1co ${status}`);
    assert.equal(r.body.codigo, 'pasarela_no_disponible');
    assert.equal(r.body.pagado, false);
  }
  assert.equal(e.supa.porId(p.pedido).estado, 'pendiente');
  e.n1co.opciones.falloConsulta = null;
  const ok = await e.confirmar({ order_code: p.orderCode, token: p.token });
  assert.equal(ok.body.pagado, true);
}));

test('la base rechaza la transición a pagado: 500 pago_no_registrado, y un reintento posterior la registra', () => conEntorno(async (e) => {
  const p = await crearPedido(e);
  e.n1co.pagar(p.orderCode);
  e.supa.opciones.falloPatch = 500;
  const r = await e.confirmar({ order_code: p.orderCode, token: p.token });
  assert.equal(r.status, 500);
  assert.equal(r.body.codigo, 'pago_no_registrado');
  assert.equal(r.body.pagado, false);
  e.supa.opciones.falloPatch = null;
  const ok = await e.confirmar({ order_code: p.orderCode, token: p.token });
  assert.equal(ok.body.pagado, true);
}));

test('pedido sin enlace de pago (fallido en la pasarela): pagado=false sin consultar a n1co', () => conEntorno(async (e) => {
  e.n1co.opciones.falloCrear = { status: 500, cuerpo: {} };
  const cuerpo = pedidoValido();
  const fallido = await e.pago(cuerpo);
  assert.equal(fallido.status, 502);
  const fila = e.supa.filas[0];
  const r = await e.confirmar({ pedido: fila.id, email: 'jane.buyer@example.com' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, pagado: false, estado: 'fallido_pasarela', pedido: fila.id, referencia: fila.referencia });
  assert.equal(e.n1co.peticiones.filter((x) => x.metodo === 'GET').length, 0);
}));

test('un pedido pagado no se puede reconfirmar ni alterar sus cobros (restricción de la base), pero sí anotar el envío', () => conEntorno(async (e) => {
  const p = await crearPedido(e);
  e.n1co.pagar(p.orderCode);
  await e.confirmar({ order_code: p.orderCode, token: p.token });
  const id = p.pedido;
  const intenta = (cambio) => assert.throws(() => e.supa.parchear((f) => f.id === id, cambio), (err) => err.code === '23514', JSON.stringify(cambio));
  intenta({ estado: 'pagado', pagado_en: new Date(Date.now() + 3600000).toISOString() });
  intenta({ estado: 'pendiente', pagado_en: null });
  intenta({ total: 1, subtotal: 1 });
  intenta({ order_code: 'OTRO' });
  e.supa.parchear((f) => f.id === id, { cumplimiento: 'enviado', seguimiento: 'TRACK-1' });
  assert.equal(e.supa.porId(id).seguimiento, 'TRACK-1');
}));

// ───────────────────────── configuración, forma de la petición, CORS ─────────────────────────

test('sin variables de entorno: 500 servicio_no_configurado', async () => {
  for (const faltante of ['N1CO_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    await conEntorno(async (e) => {
      const r = await e.confirmar({ order_code: 'ABC', token: '0'.repeat(32) });
      assert.equal(r.status, 500, faltante);
      assert.equal(r.body.codigo, 'servicio_no_configurado');
    }, { env: { [faltante]: undefined } });
  }
});

test('CORS idéntico al de n1co-confirmar; método no POST: 405; JSON inválido: 400; cuerpo grande: 413', () => conEntorno(async (e) => {
  const ref = readFileSync(resolve(RAIZ, 'referencia/n1co-confirmar/index.ts'), 'utf8');
  const esperadas = new Function(`return ${ref.match(/const corsHeaders = (\{[\s\S]*?\});/)[1]}`)();
  const op = await e.confirmar(null, { metodo: 'OPTIONS' });
  assert.equal(op.status, 200);
  const malo = await e.confirmar({ order_code: 'x' });
  for (const r of [op, malo]) {
    for (const [k, v] of Object.entries(esperadas)) assert.equal(r.headers.get(k), v, k);
  }
  assert.equal((await e.confirmar(null, { metodo: 'GET' })).status, 405);
  for (const cuerpo of ['no json', '[]', 'null']) assert.equal((await e.confirmar(cuerpo)).status, 400, cuerpo);
  assert.equal((await e.confirmar({ order_code: 'x', relleno: 'y'.repeat(3000) })).status, 413);
}));

test('los logs de confirmar no contienen datos personales ni el token', () => conEntorno(async (e) => {
  const p = await crearPedido(e);
  e.n1co.pagar(p.orderCode);
  const logs = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  try {
    await e.confirmar({ order_code: p.orderCode, token: p.token });
    e.n1co.opciones.falloConsulta = { status: 500 };
    await e.confirmar({ order_code: p.referencia, email: p.email });
  } finally { console.log = orig.log; console.error = orig.error; }
  const texto = logs.join('\n').toLowerCase();
  assert.ok(texto.includes('essentials-confirmar ok'));
  for (const pii of ['jane', 'buyer', 'example.com', p.token, 'pennsylvania']) assert.ok(!texto.includes(pii.toLowerCase()), pii);
}));
