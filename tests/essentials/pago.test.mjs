// Pruebas de essentials-pago: cotizar y pagar. Node >= 22.13 (o `typescript` instalado; ver helpers/cargar-funcion.mjs),
// sin dependencias. Servidor n1co simulado y Supabase simulado en memoria.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RAIZ } from './helpers/cargar-funcion.mjs';
import {
  crearEntorno, pedidoValido, envioValido, nuevoUuid, TOTAL_PEDIDO_CENTS, CLAVE_N1CO, sinAleatorios,
} from './helpers/entorno.mjs';

async function conEntorno(fn, opts) {
  const e = await crearEntorno(opts);
  try { await fn(e); } finally { await e.cerrar(); }
}

function sinLlamadasExternas(e, msg = '') {
  assert.equal(e.supa.peticiones.length, 0, `no debía tocar Supabase ${msg}`);
  assert.equal(e.n1co.peticiones.length, 0, `no debía tocar n1co ${msg}`);
  assert.equal(e.salidas.length, 0);
}

const cotizar = (items, extra = {}) => ({ accion: 'cotizar', items, ...extra });
const ITEM = { sku: 'leather-card-holder', variante: 'navy', qty: 1 };

// ───────────────────────── cotizar ─────────────────────────

test('cotizar OK: precios y total se calculan en el servidor desde sku + variante', () => conEntorno(async (e) => {
  const r = await e.pago(cotizar([
    { sku: 'leather-briefcase-17-inch', variante: 'black', qty: 1 },
    { sku: 'leather-card-holder', variante: 'navy', qty: 2 },
  ], { lang: 'en' }));
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.moneda, 'USD');
  assert.deepEqual(r.body.items.map((i) => [i.sku, i.variante, i.qty, i.precio_unit_cents, i.subtotal_cents]), [
    ['leather-briefcase-17-inch', 'black', 1, 21703, 21703],
    ['leather-card-holder', 'navy', 2, 7750, 15500],
  ]);
  assert.equal(r.body.subtotal_cents, TOTAL_PEDIDO_CENTS);
  assert.equal(r.body.envio_cents, 0, 'envío incluido en el precio');
  assert.equal(r.body.impuesto_cents, 0);
  assert.equal(r.body.total_cents, 37203);
  assert.equal(r.body.monto, 372.03);
  assert.equal(r.body.items[0].entrega_min_dias, 15);
  assert.equal(r.body.items[0].entrega_max_dias, 25);
  sinLlamadasExternas(e, '(cotizar no usa base ni pasarela)');
}));

test('cotizar: el precio depende de la variante (talla XL, color Light Brown)', () => conEntorno(async (e) => {
  const casos = [
    ['leather-travel-duffel', 'black-l', 19519], ['leather-travel-duffel', 'brown-l', 19519],
    ['leather-travel-duffel', 'black-xl', 21453], ['leather-travel-duffel', 'brown-xl', 21453],
    ['leather-vintage-duffel', 'black', 21360], ['leather-vintage-duffel', 'light-brown', 23242],
  ];
  for (const [sku, variante, cents] of casos) {
    const r = await e.pago(cotizar([{ sku, variante, qty: 1 }]));
    assert.equal(r.status, 200, `${sku}/${variante}`);
    assert.equal(r.body.total_cents, cents, `${sku}/${variante}`);
  }
}));

test('cotizar: cualquier precio que mande el cliente se ignora', () => conEntorno(async (e) => {
  const r = await e.pago({
    accion: 'cotizar',
    items: [{ sku: 'leather-card-holder', variante: 'navy', qty: 2, precio: 1, price: 1, precio_unit_cents: 1, subtotal_cents: 1, amount: 1 }],
    total_cents: 1, monto: 0.01, amount: 1, total: 1, subtotal_cents: 1,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.total_cents, 15500);
  assert.equal(r.body.items[0].precio_unit_cents, 7750);
}));

test('cotizar funciona aunque falten los secretos (no usa n1co ni la base)', () =>
  conEntorno(async (e) => {
    const r = await e.pago(cotizar([ITEM]));
    assert.equal(r.status, 200);
    assert.equal(r.body.total_cents, 7750);
  }, { env: { N1CO_SECRET_KEY: undefined, SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined } }));

// ───────────────────────── pagar OK ─────────────────────────

test('pagar OK: guarda el pedido, crea el enlace n1co y devuelve pedido/orderCode/paymentLinkUrl', () => conEntorno(async (e) => {
  const logs = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  let r;
  const antes = Date.now();
  try {
    r = await e.pago(pedidoValido(), { headers: { 'user-agent': 'PruebaNavegador/1.0', 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } });
  } finally { console.log = orig.log; console.error = orig.error; }

  assert.equal(r.status, 200, r.texto);
  const b = r.body;
  assert.equal(b.ok, true);
  assert.match(b.pedido, /^[0-9a-f-]{36}$/);
  assert.match(b.referencia, /^ESS-[2-9A-HJ-NP-Z]{10}$/);
  assert.match(b.orderCode, /^N1TEST\d{4}X$/);
  assert.equal(b.paymentLinkUrl, `https://pay.n1co.test/checkout/${b.orderCode}`);
  assert.match(b.token, /^[0-9a-f]{32}$/);
  assert.equal(b.total_cents, TOTAL_PEDIDO_CENTS);
  assert.equal(b.monto, 372.03);
  assert.equal(b.moneda, 'USD');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');

  // ── Lo que recibió n1co: mismo endpoint, mismo Bearer, payload documentado ──
  assert.equal(e.salidas.length, 1);
  assert.equal(e.salidas[0].url, 'https://api-pay-sandbox.n1co.shop/api/paymentlink/checkout');
  assert.equal(e.salidas[0].metodo, 'POST');
  const [crea] = e.n1co.creaciones();
  assert.equal(crea.auth, `Bearer ${CLAVE_N1CO}`);
  assert.equal(crea.accept, 'application/json');
  const p = crea.cuerpo;
  assert.deepEqual(Object.keys(p).sort(), [
    'amount', 'cancelUrl', 'expirationMinutes', 'metadata', 'orderDescription', 'orderName', 'orderReference', 'successUrl',
  ]);
  assert.equal(p.amount, 372.03, 'el monto sale del servidor (dólares, número, como n1co-pago)');
  assert.equal(p.expirationMinutes, 60);
  assert.ok(p.orderReference.startsWith(`${b.referencia}-`));
  assert.equal(p.successUrl, `https://getcvpro.com/essentials/thanks.html?ref=${b.referencia}`);
  assert.equal(p.cancelUrl, 'https://getcvpro.com/essentials/checkout.html?pago=cancelado');
  assert.deepEqual(p.metadata, [
    { name: 'tienda', value: 'essentials' }, { name: 'pedido', value: b.pedido }, { name: 'referencia', value: b.referencia },
  ]);
  assert.match(p.orderDescription, /1 x 17-Inch Leather Briefcase \(Black\); 2 x Leather Card Holder \(Navy\)/);
  const enviado = sinAleatorios(JSON.stringify(p));
  for (const pii of ['jane', 'buyer', 'pennsylvania', 'example.com', '20500', '555', 'washington']) {
    assert.ok(!enviado.includes(pii), `n1co no debe recibir datos personales (${pii})`);
  }

  // ── Lo que quedó en la base ──
  assert.equal(e.supa.filas.length, 1);
  const f = e.supa.filas[0];
  assert.equal(f.id, b.pedido);
  assert.equal(f.estado, 'pendiente');
  assert.equal(f.order_code, b.orderCode);
  assert.equal(f.referencia, b.referencia);
  assert.equal(f.payment_link_url, b.paymentLinkUrl);
  assert.equal(f.token_consulta, b.token);
  assert.equal(f.entorno, 'sandbox');
  assert.equal(f.moneda, 'USD');
  assert.equal(f.subtotal, 372.03);
  assert.equal(f.costo_envio, 0);
  assert.equal(f.impuesto, 0);
  assert.equal(f.total, 372.03);
  assert.equal(f.nombre, 'Jane Q. Buyer');
  assert.equal(f.email, 'jane.buyer@example.com', 'el email se guarda en minúsculas');
  assert.equal(f.telefono, '(202) 555-0143');
  assert.deepEqual([f.envio_line1, f.envio_line2, f.envio_city, f.envio_state, f.envio_zip, f.envio_pais],
    ['1600 Pennsylvania Ave NW', 'Apt 4B', 'Washington', 'DC', '20500', 'US']);
  assert.equal(f.user_agent, 'PruebaNavegador/1.0');
  assert.equal(f.politica_version, 'essentials-terms-v1');
  const aceptado = Date.parse(f.acepto_politica_at);
  assert.ok(aceptado >= antes - 1000 && aceptado <= Date.now() + 1000, 'acepto_politica_at lo fija el servidor, ahora');
  assert.deepEqual(f.items, [
    { sku: 'leather-briefcase-17-inch', variante: 'black', variante_etiqueta: 'Black', nombre: '17-Inch Leather Laptop Bag and Briefcase',
      nombre_corto: '17-Inch Leather Briefcase', qty: 1, precio_unit_cents: 21703, subtotal_cents: 21703 },
    { sku: 'leather-card-holder', variante: 'navy', variante_etiqueta: 'Navy', nombre: 'Leather Card Holder with RFID Blocking Feature',
      nombre_corto: 'Leather Card Holder', qty: 2, precio_unit_cents: 7750, subtotal_cents: 15500 },
  ]);

  // Rate-limit con la RPC existente y clave propia
  const rpc = e.supa.peticiones.find((x) => x.ruta.endsWith('/rpc/checar_limite_ia_v2'));
  assert.equal(rpc.cuerpo.p_clave, 'ess:203.0.113.9');
  assert.equal(rpc.cuerpo.p_ip, '203.0.113.9');
  // Las peticiones a la base usan el service role (no la clave del navegador)
  assert.ok(e.supa.peticiones.every((x) => x.auth === 'Bearer service-role-de-prueba-no-es-real'));

  // Nada de datos personales en logs
  const registro = sinAleatorios(logs.join('\n'));
  for (const pii of ['jane', 'buyer', 'pennsylvania', 'example.com', '20500', '555']) {
    assert.ok(!registro.includes(pii), `los logs no deben contener datos personales (${pii})`);
  }
  assert.ok(logs.some((l) => l.includes('essentials-pago OK')));
}));

test('pagar normaliza la dirección (espacios, estado en mayúsculas, ZIP+4) y acepta dirección sin línea 2 ni teléfono', () => conEntorno(async (e) => {
  const r = await e.pago(pedidoValido({
    envio: { nombre: '  José   Núñez ', linea1: '  742   Evergreen   Terrace ', linea2: '', ciudad: ' Springfield ',
      estado: 'or', zip: '97477-1234', pais: 'us', telefono: '' },
  }));
  assert.equal(r.status, 200, r.texto);
  const f = e.supa.filas[0];
  assert.deepEqual([f.nombre, f.envio_line1, f.envio_line2, f.envio_city, f.envio_state, f.envio_zip, f.envio_pais, f.telefono],
    ['José Núñez', '742 Evergreen Terrace', null, 'Springfield', 'OR', '97477-1234', 'US', null]);
}));

test('pagar con N1CO_ENTORNO=live llama al endpoint live y marca el pedido live', () => conEntorno(async (e) => {
  const r = await e.pago(pedidoValido());
  assert.equal(r.status, 200, r.texto);
  assert.equal(e.salidas[0].url, 'https://api-pay.n1co.shop/api/paymentlink/checkout');
  assert.equal(e.supa.filas[0].entorno, 'live');
}, { env: { N1CO_ENTORNO: 'LIVE' } }));

// ───────────────────────── validación de items ─────────────────────────

test('sku inexistente: 404 sku_no_disponible, sin tocar base ni n1co', () => conEntorno(async (e) => {
  for (const sku of ['leather-wallet-xyz', 'constructor', 'hasownproperty']) {
    for (const cuerpo of [cotizar([{ sku, variante: 'black', qty: 1 }]), pedidoValido({ items: [{ sku, variante: 'black', qty: 1 }] })]) {
      const r = await e.pago(cuerpo);
      assert.equal(r.status, 404, `${sku} ${cuerpo.accion}`);
      assert.equal(r.body.codigo, 'sku_no_disponible');
      assert.equal(r.body.ok, false);
      assert.equal(r.body.campo, 'items[0].sku');
      assert.ok(r.body.error.length > 10);
    }
  }
  sinLlamadasExternas(e);
}));

test('sku mal formado: 400 sku_invalido', () => conEntorno(async (e) => {
  for (const sku of ['Leather Bag!', '../etc/passwd', 'ab', 'x'.repeat(41), '', null, 7, ['leather-card-holder']]) {
    const r = await e.pago(cotizar([{ sku, variante: 'navy', qty: 1 }]));
    assert.equal(r.status, 400, JSON.stringify(sku));
    assert.equal(r.body.codigo, 'sku_invalido');
  }
}));

test('variante inválida para ese sku: 400 variante_invalida', () => conEntorno(async (e) => {
  const malas = [
    ['leather-card-holder', 'black'],            // existe en otros skus pero no en este (aquí son black-1 / black-2)
    ['leather-briefcase-17-inch', 'navy'],       // variante de otro producto
    ['leather-vintage-duffel', 'black-xl'],      // variante del duffel de viaje
    ['leather-travel-duffel', 'black'],          // falta la talla
    ['leather-card-holder', 'constructor'],      // propiedad heredada del objeto
    ['leather-card-holder', 'tostring'],
    ['leather-card-holder', 'NAVY'],
    ['leather-card-holder', ''],
    ['leather-card-holder', undefined],
    ['leather-card-holder', null],
    ['leather-card-holder', 5],
  ];
  for (const [sku, variante] of malas) {
    for (const cuerpo of [cotizar([{ sku, variante, qty: 1 }]), pedidoValido({ items: [{ sku, variante, qty: 1 }] })]) {
      const r = await e.pago(cuerpo);
      assert.equal(r.status, 400, `${sku}/${String(variante)} ${cuerpo.accion}`);
      assert.equal(r.body.codigo, 'variante_invalida');
      assert.equal(r.body.campo, 'items[0].variante');
    }
  }
  sinLlamadasExternas(e);
}));

test('qty fuera de 1 a 5 o no entera: 400 qty_invalida (0 y 6 incluidos)', () => conEntorno(async (e) => {
  for (const qty of [0, 6, -1, 100, 1.5, 0.5, '2', '', null, undefined, true, [], {}, 1e21]) {
    for (const cuerpo of [cotizar([{ ...ITEM, qty }]), pedidoValido({ items: [{ ...ITEM, qty }] })]) {
      const r = await e.pago(cuerpo);
      assert.equal(r.status, 400, `qty=${JSON.stringify(qty)} ${cuerpo.accion}`);
      assert.equal(r.body.codigo, 'qty_invalida');
      assert.equal(r.body.campo, 'items[0].qty');
    }
  }
  sinLlamadasExternas(e);
  for (const qty of [1, 5]) {
    const r = await e.pago(cotizar([{ ...ITEM, qty }]));
    assert.equal(r.status, 200, `qty=${qty} es válida`);
    assert.equal(r.body.total_cents, 7750 * qty);
  }
}));

test('items: vacío, más de 5, no arreglo, elementos no objeto o sku repetido => 400', () => conEntorno(async (e) => {
  const cinco = ['leather-briefcase-17-inch', 'leather-briefcase-15-inch', 'leather-card-holder', 'leather-travel-duffel', 'leather-vintage-duffel'];
  const variante = { 'leather-briefcase-17-inch': 'black', 'leather-briefcase-15-inch': 'brown', 'leather-card-holder': 'navy',
    'leather-travel-duffel': 'black-l', 'leather-vintage-duffel': 'black' };
  const ok = await e.pago(cotizar(cinco.map((sku) => ({ sku, variante: variante[sku], qty: 5 }))));
  assert.equal(ok.status, 200, 'los 5 productos x 5 unidades es el máximo');
  assert.equal(ok.body.total_cents, 5 * (21703 + 20497 + 7750 + 19519 + 21360));

  const sextaLinea = [...cinco.map((sku) => ({ sku, variante: variante[sku], qty: 1 })), { ...ITEM }];
  const casos = [
    [[], 'items_invalidos'], [undefined, 'items_invalidos'], [null, 'items_invalidos'], ['x', 'items_invalidos'],
    [{ sku: ITEM.sku }, 'items_invalidos'], [sextaLinea, 'items_invalidos'],
    [[null], 'items_invalidos'], [['leather-card-holder'], 'items_invalidos'], [[[ITEM]], 'items_invalidos'],
    [[ITEM, { ...ITEM, variante: 'grey' }], 'items_duplicados'],
  ];
  for (const [items, codigo] of casos) {
    const r = await e.pago(cotizar(items));
    assert.equal(r.status, 400, JSON.stringify(items)?.slice(0, 60));
    assert.equal(r.body.codigo, codigo);
  }
}));

// ───────────────────────── validación de datos del comprador ─────────────────────────

test('dirección sin ZIP válido: 400 zip_invalido (campo envio.zip), sin crear pedido ni llamar a n1co', () => conEntorno(async (e) => {
  for (const zip of ['ABCDE', '1234', '123456', '12345-12', '12345-', '12 345', '9021O', '', '   ', null, undefined, 90210, '90210\n']) {
    const envio = envioValido();
    if (zip === undefined) delete envio.zip; else envio.zip = zip;
    const r = await e.pago(pedidoValido({ envio }));
    assert.equal(r.status, zip === '90210\n' ? 200 : 400, `zip=${JSON.stringify(zip)}`);
    if (zip !== '90210\n') {
      assert.equal(r.body.codigo, 'zip_invalido');
      assert.equal(r.body.campo, 'envio.zip');
    }
  }
  // '90210\n' se limpia (espacio en blanco al borde) y es válido; el resto no creó nada
  assert.equal(e.supa.filas.length, 1);
  assert.equal(e.supa.filas[0].envio_zip, '90210');
  assert.equal(e.n1co.creaciones().length, 1);
}));

test('ZIP válidos de 5 y de 9 dígitos se aceptan', () => conEntorno(async (e) => {
  for (const zip of ['90210', '00501', '90210-1234']) {
    const r = await e.pago(pedidoValido({ envio: envioValido({ zip }) }));
    assert.equal(r.status, 200, zip);
  }
}));

test('otros campos de dirección y email inválidos: 400 con el campo señalado', () => conEntorno(async (e) => {
  const casos = [
    [{ estado: 'ZZ' }, 'estado_invalido', 'envio.estado'], [{ estado: 'Texas' }, 'estado_invalido', 'envio.estado'],
    [{ estado: '' }, 'estado_invalido', 'envio.estado'], [{ estado: 'PR' }, 'estado_invalido', 'envio.estado'],
    [{ pais: 'MX' }, 'pais_no_soportado', 'envio.pais'], [{ pais: '' }, 'pais_no_soportado', 'envio.pais'],
    [{ pais: undefined }, 'pais_no_soportado', 'envio.pais'],
    [{ nombre: '<script>alert(1)</script>' }, 'direccion_invalida', 'envio.nombre'], [{ nombre: 'A' }, 'direccion_invalida', 'envio.nombre'],
    [{ nombre: 'N'.repeat(81) }, 'direccion_invalida', 'envio.nombre'], [{ nombre: 12 }, 'direccion_invalida', 'envio.nombre'],
    [{ linea1: 'ab' }, 'direccion_invalida', 'envio.linea1'], [{ linea1: '1 <b>Main</b> St' }, 'direccion_invalida', 'envio.linea1'],
    [{ linea1: undefined }, 'direccion_invalida', 'envio.linea1'], [{ linea1: 'x'.repeat(101) }, 'direccion_invalida', 'envio.linea1'],
    [{ linea2: 'y'.repeat(101) }, 'direccion_invalida', 'envio.linea2'], [{ linea2: '<i>' }, 'direccion_invalida', 'envio.linea2'],
    [{ ciudad: 'X' }, 'direccion_invalida', 'envio.ciudad'], [{ ciudad: '' }, 'direccion_invalida', 'envio.ciudad'],
    [{ ciudad: 'C'.repeat(61) }, 'direccion_invalida', 'envio.ciudad'],
    [{ telefono: 'abc' }, 'telefono_invalido', 'envio.telefono'], [{ telefono: '123' }, 'telefono_invalido', 'envio.telefono'],
  ];
  for (const [cambio, codigo, campo] of casos) {
    const envio = envioValido(); Object.assign(envio, cambio);
    for (const k of Object.keys(envio)) if (envio[k] === undefined) delete envio[k];
    const r = await e.pago(pedidoValido({ envio }));
    assert.equal(r.status, 400, JSON.stringify(cambio));
    assert.equal(r.body.codigo, codigo, JSON.stringify(cambio));
    assert.equal(r.body.campo, campo, JSON.stringify(cambio));
  }
  for (const email of ['', 'sin-arroba', 'a@b', '<x>@example.com', 'a b@example.com', 'x'.repeat(250) + '@example.com', null, 5]) {
    const r = await e.pago(pedidoValido({ email }));
    assert.equal(r.status, 400, JSON.stringify(email)?.slice(0, 40));
    assert.equal(r.body.codigo, 'email_invalido');
    assert.equal(r.body.campo, 'email');
  }
  const r = await e.pago(pedidoValido({ envio: 'Calle 1' }));
  assert.equal(r.status, 400);
  assert.equal(r.body.codigo, 'envio_invalido');
  sinLlamadasExternas(e);
}));

test('política no aceptada: 400 politica_no_aceptada, sin crear pedido ni llamar a n1co', () => conEntorno(async (e) => {
  for (const acepta of [false, undefined, null, 'true', 1, 'yes', 0, []]) {
    const cuerpo = pedidoValido({ acepta_terminos: acepta });
    if (acepta === undefined) delete cuerpo.acepta_terminos;
    const r = await e.pago(cuerpo);
    assert.equal(r.status, 400, JSON.stringify(acepta));
    assert.equal(r.body.codigo, 'politica_no_aceptada');
    assert.equal(r.body.campo, 'acepta_terminos');
    assert.equal(r.body.ok, false);
  }
  sinLlamadasExternas(e);
}));

// ───────────────────────── forma de la petición, CORS, errores ─────────────────────────

test('CORS: OPTIONS responde con las mismas cabeceras que n1co-pago; también en respuestas de error y de éxito', () => conEntorno(async (e) => {
  const ref = readFileSync(resolve(RAIZ, 'referencia/n1co-pago/index.ts'), 'utf8');
  const literal = ref.match(/const corsHeaders = (\{[\s\S]*?\});/)[1];
  const esperadas = new Function(`return ${literal}`)();
  assert.deepEqual(Object.keys(esperadas).length, 3);

  const op = await e.pago(null, { metodo: 'OPTIONS' });
  assert.equal(op.status, 200);
  for (const [k, v] of Object.entries(esperadas)) assert.equal(op.headers.get(k), v, `OPTIONS ${k}`);

  const malo = await e.pago(cotizar([]));
  const bueno = await e.pago(cotizar([ITEM]));
  for (const r of [malo, bueno]) {
    for (const [k, v] of Object.entries(esperadas)) assert.equal(r.headers.get(k), v, `POST ${k}`);
    assert.equal(r.headers.get('content-type'), 'application/json');
  }
}));

test('método distinto de POST: 405; cuerpo no JSON, demasiado grande o acción desconocida: 400/413', () => conEntorno(async (e) => {
  const get = await e.pago(null, { metodo: 'GET' });
  assert.equal(get.status, 405);
  assert.equal(get.body.codigo, 'metodo_no_permitido');

  for (const cuerpo of ['no es json', '[]', '"texto"', 'null', '']) {
    const r = await e.pago(cuerpo);
    assert.equal(r.status, 400, cuerpo);
    assert.equal(r.body.codigo, 'cuerpo_invalido');
  }
  const grande = await e.pago(cotizar([ITEM], { relleno: 'x'.repeat(9000) }));
  assert.equal(grande.status, 413);
  assert.equal(grande.body.codigo, 'cuerpo_demasiado_grande');
  const declarado = await e.pago(cotizar([ITEM]), { headers: { 'content-length': '100000' } });
  assert.equal(declarado.status, 413);

  for (const accion of ['comprar', '', undefined, 5]) {
    const r = await e.pago({ accion, items: [ITEM] });
    assert.equal(r.status, 400);
    assert.equal(r.body.codigo, 'accion_invalida');
  }
  sinLlamadasExternas(e);
}));

test('pagar sin variables de entorno de n1co/Supabase: 500 servicio_no_configurado', async () => {
  for (const faltante of ['N1CO_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    await conEntorno(async (e) => {
      const r = await e.pago(pedidoValido());
      assert.equal(r.status, 500, faltante);
      assert.equal(r.body.codigo, 'servicio_no_configurado');
      assert.equal(e.n1co.peticiones.length, 0);
    }, { env: { [faltante]: undefined } });
  }
});

// ───────────────────────── fallos de la pasarela, idempotencia, límite ─────────────────────────

test('n1co rechaza la creación: 502 pasarela_no_disponible y el pedido queda fallido_pasarela; el reintento reutiliza el pedido', () => conEntorno(async (e) => {
  const cuerpo = pedidoValido();
  e.n1co.opciones.falloCrear = { status: 500, cuerpo: { message: 'boom' } };
  const r1 = await e.pago(cuerpo);
  assert.equal(r1.status, 502);
  assert.equal(r1.body.codigo, 'pasarela_no_disponible');
  assert.equal(r1.body.paymentLinkUrl, undefined);
  assert.equal(e.supa.filas.length, 1);
  assert.equal(e.supa.filas[0].estado, 'fallido_pasarela');
  assert.equal(e.supa.filas[0].order_code, null);

  e.n1co.opciones.falloCrear = null;
  const r2 = await e.pago(cuerpo);                              // misma clave idem
  assert.equal(r2.status, 200, r2.texto);
  assert.equal(e.supa.filas.length, 1, 'el reintento no crea otro pedido');
  assert.equal(e.supa.filas[0].estado, 'pendiente');
  assert.equal(r2.body.pedido, e.supa.filas[0].id);
}));

test('n1co responde 200 sin orderCode o sin https: se trata como fallo (502)', async () => {
  await conEntorno(async (e) => {
    e.n1co.opciones.sinOrderCode = true;
    const r = await e.pago(pedidoValido());
    assert.equal(r.status, 502);
    assert.equal(e.supa.filas[0].estado, 'fallido_pasarela');
  });
});

test('n1co no disponible (conexión caída): 502 y el pedido queda fallido_pasarela', async () => {
  await conEntorno(async (e) => {
    await e.n1co.cerrar();
    const r = await e.pago(pedidoValido());
    assert.equal(r.status, 502);
    assert.equal(r.body.codigo, 'pasarela_no_disponible');
    assert.equal(e.supa.filas[0].estado, 'fallido_pasarela');
  });
});

test('idempotencia: la misma clave idem devuelve el mismo pedido y el mismo enlace, sin crear otro', () => conEntorno(async (e) => {
  const cuerpo = pedidoValido();
  const a = await e.pago(cuerpo);
  const b = await e.pago(cuerpo);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual(b.body, a.body, 'misma respuesta, incluido el token');
  assert.equal(e.supa.filas.length, 1);
  assert.equal(e.n1co.creaciones().length, 1, 'un solo enlace n1co');
}));

test('idempotencia: misma clave con otro carrito o dirección => 409 idem_reutilizado', () => conEntorno(async (e) => {
  const cuerpo = pedidoValido();
  assert.equal((await e.pago(cuerpo)).status, 200);
  const otro = await e.pago({ ...cuerpo, items: [{ ...ITEM, qty: 3 }] });
  assert.equal(otro.status, 409);
  assert.equal(otro.body.codigo, 'idem_reutilizado');
  const otraDir = await e.pago({ ...cuerpo, envio: envioValido({ zip: '10001' }) });
  assert.equal(otraDir.status, 409);
  assert.equal(e.supa.filas.length, 1);
  assert.equal(e.n1co.creaciones().length, 1);
}));

test('idem inválido: 400; sin idem cada llamada crea un pedido nuevo', () => conEntorno(async (e) => {
  const mal = await e.pago(pedidoValido({ idem: 'no-es-uuid' }));
  assert.equal(mal.status, 400);
  assert.equal(mal.body.codigo, 'idem_invalido');
  const c = pedidoValido(); delete c.idem;
  const a = await e.pago(c); const b = await e.pago(c);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.notEqual(a.body.pedido, b.body.pedido);
  assert.equal(e.supa.filas.length, 2);
}));

test('idempotencia: dentro de la vigencia se reutiliza el enlace; vencido, se crea uno nuevo para el mismo pedido', () => conEntorno(async (e) => {
  const cuerpo = pedidoValido();
  const a = await e.pago(cuerpo);
  const hace = (min) => new Date(Date.now() - min * 60000).toISOString();

  e.supa.parchear((f) => f.id === a.body.pedido, { link_creado_at: hace(59) });
  const b = await e.pago(cuerpo);
  assert.equal(b.body.orderCode, a.body.orderCode, 'a los 59 min el enlace sigue vigente');
  assert.equal(e.n1co.creaciones().length, 1);

  e.supa.parchear((f) => f.id === a.body.pedido, { link_creado_at: hace(61) });
  const c = await e.pago(cuerpo);
  assert.equal(c.status, 200, c.texto);
  assert.notEqual(c.body.orderCode, a.body.orderCode, 'a los 61 min se emite un enlace nuevo');
  assert.equal(c.body.pedido, a.body.pedido, 'para el mismo pedido');
  assert.equal(e.supa.filas.length, 1);
  assert.equal(e.supa.filas[0].order_code, c.body.orderCode);
  assert.equal(e.n1co.creaciones().length, 2);
}));

test('misma clave idem en paralelo (doble clic): un solo pedido y un solo enlace n1co', () => conEntorno(async (e) => {
  e.n1co.opciones.retardoMs = 40;                // ensancha la ventana de la carrera
  const cuerpo = pedidoValido();
  const rs = await Promise.all([e.pago(cuerpo), e.pago(cuerpo), e.pago(cuerpo), e.pago(cuerpo)]);
  const ok = rs.filter((r) => r.status === 200);
  const enProceso = rs.filter((r) => r.status === 409);
  assert.equal(ok.length + enProceso.length, 4, rs.map((r) => `${r.status} ${r.body?.codigo}`).join(', '));
  assert.ok(ok.length >= 1);
  assert.ok(enProceso.every((r) => r.body.codigo === 'pedido_en_proceso'));
  assert.ok(ok.every((r) => r.body.orderCode === ok[0].body.orderCode), 'todos los 200 llevan el mismo enlace');
  assert.equal(e.supa.filas.length, 1);
  assert.equal(e.n1co.creaciones().length, 1, 'nunca dos enlaces para un mismo pedido');
}));

test('pedido ya pagado o en revisión: pagar con la misma clave devuelve 409', () => conEntorno(async (e) => {
  const cuerpo = pedidoValido();
  const a = await e.pago(cuerpo);
  e.n1co.pagar(a.body.orderCode);
  assert.equal((await e.confirmar({ order_code: a.body.orderCode, token: a.body.token })).body.pagado, true);
  const otra = await e.pago(cuerpo);
  assert.equal(otra.status, 409);
  assert.equal(otra.body.codigo, 'pedido_ya_pagado');

  const c2 = pedidoValido();
  const b = await e.pago(c2);
  e.supa.parchear((f) => f.id === b.body.pedido, { estado: 'revision' });
  const rev = await e.pago(c2);
  assert.equal(rev.status, 409);
  assert.equal(rev.body.codigo, 'pedido_en_revision');
}));

test('límite de solicitudes: 429 con retry_after_seconds; si la RPC falla, se permite (como guardar-cv)', () => conEntorno(async (e) => {
  e.supa.opciones.limite = { ok: false, retry_after: 120 };
  const r = await e.pago(pedidoValido());
  assert.equal(r.status, 429);
  assert.equal(r.body.codigo, 'demasiadas_solicitudes');
  assert.equal(r.body.retry_after_seconds, 120);
  assert.equal(e.supa.filas.length, 0);
  assert.equal(e.n1co.peticiones.length, 0);

  e.supa.opciones.limite = null;
  e.supa.opciones.rpcFalla = true;
  const ok = await e.pago(pedidoValido());
  assert.equal(ok.status, 200, ok.texto);
}));

test('la base rechaza el insert: 500 error_interno sin llamar a n1co', () => conEntorno(async (e) => {
  e.supa.opciones.falloPost = 500;
  const r = await e.pago(pedidoValido());
  assert.equal(r.status, 500);
  assert.equal(r.body.codigo, 'error_interno');
  assert.equal(e.n1co.peticiones.length, 0);
}));

// Guarda contra una prueba intermitente: un UUID o una hora generados al azar pueden contener "555" o "20500" por casualidad
// (un UUID contiene "555" en ~0,45 % de los casos). Las pruebas de "sin datos personales" ignoran esos valores y siguen
// detectando el teléfono, el ZIP o el nombre cuando de verdad se filtran.
test('sinAleatorios ignora UUID, referencia, token y fechas, pero no deja pasar datos personales', () => {
  const azar = '{"pedido":"a5555555-2050-4055-8555-205000555555","referencia":"ESS-55555AB555","orderReference":"ESS-55555AB555-LK555X",'
    + '"token":"5555555555555555555555555555555a","fecha":"2026-10-14T05:55:55.555Z"}';
  const limpio = sinAleatorios(azar);
  assert.ok(!limpio.includes('555') && !limpio.includes('20500'), limpio);
  assert.ok(sinAleatorios(`${azar} tel (202) 555-0143 zip 20500 Jane`).includes('555-0143'));
  assert.ok(sinAleatorios(`${azar} zip 20500`).includes('20500'));
  assert.ok(sinAleatorios(`${azar} Jane`).includes('jane'));
});
