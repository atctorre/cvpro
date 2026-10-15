// ═══════════════════════════════════════════════════════════════
//  Professional Essentials by CVPro · Edge Function: essentials-pago
//
//  Dos acciones sobre POST:
//    "cotizar"  items -> precios y total calculados AQUÍ (servidor). No toca la base.
//    "pagar"    items + email + envío + aceptación de política
//               -> guarda el pedido en essentials_pedidos y crea el enlace de pago en n1co.
//
//  El navegador solo envía items [{sku, variante, qty}]; NUNCA precios. Cualquier campo de
//  precio que llegue se ignora. El catálogo mínimo (CATALOGO) está embebido más abajo y se
//  regenera con herramientas/sync-catalogo.mjs desde tarea-4/catalogo.json.
//
//  Integración n1co: la misma que n1co-pago (mismo endpoint, mismo Bearer, mismas variables
//  de entorno N1CO_ENTORNO y N1CO_SECRET_KEY). No hay secretos nuevos.
//  Privacidad: nunca se loguea nombre, email ni dirección, y a n1co no se le envían.
// ═══════════════════════════════════════════════════════════════

// ── CORS: idéntico al de n1co-pago ──
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Variables de entorno: las mismas que n1co-pago / n1co-confirmar ──
const N1CO_ENTORNO = (Deno.env.get('N1CO_ENTORNO') ?? 'sandbox').toLowerCase();
const N1CO_SECRET_KEY = Deno.env.get('N1CO_SECRET_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const API_BASE = N1CO_ENTORNO === 'live'
  ? 'https://api-pay.n1co.shop/api'
  : 'https://api-pay-sandbox.n1co.shop/api';

const SITIO = 'https://getcvpro.com';
const RETORNO_OK = '/essentials/thanks.html';                    // + ?ref=<referencia>
const RETORNO_CANCELADO = '/essentials/checkout.html?pago=cancelado';

// Versión del texto de política/términos que acepta el comprador (se guarda con el pedido).
// Cambiarla cuando cambie terms.html.
const POLITICA_VERSION = 'essentials-terms-v1';

// ── Límites ──
const MAX_BODY_BYTES = 8 * 1024;
const MAX_LINEAS = 5;      // líneas distintas por pedido (una por sku)
const MAX_QTY = 5;         // unidades por línea
const LINK_MINUTOS = 60;   // vigencia del enlace n1co (expirationMinutes, igual que n1co-pago)
const N1CO_TIMEOUT_MS = 20000;
const CLAIM_MINUTOS = 2;   // un pedido 'creado' sin enlace se considera abandonado pasado este tiempo

// Rate-limit con la RPC existente checar_limite_ia_v2 (como guardar-cv), clave propia 'ess:<ip>'.
const ESS_LIM_HORA = 10;
const ESS_LIM_DIA = 30;
const ESS_LIM_IP_HORA = 400;

type Variante = { etiqueta: string; precio_cents: number };
type Producto = { nombre: string; corto: string; variantes: Record<string, Variante> };

// ── CATÁLOGO: fuente de verdad de precios en el servidor ──
// <CATALOGO:BEGIN> generado por herramientas/sync-catalogo.mjs desde tarea-4/catalogo.json; no editar a mano
const CATALOGO: Record<string, Producto> = {
  'leather-briefcase-17-inch': {
    nombre: '17-Inch Leather Laptop Bag and Briefcase',
    corto: '17-Inch Leather Briefcase',
    variantes: {
      'coffee': { etiqueta: 'Coffee', precio_cents: 21703 },
      'black': { etiqueta: 'Black', precio_cents: 21703 },
      'brown': { etiqueta: 'Brown', precio_cents: 21703 },
    },
  },
  'leather-briefcase-15-inch': {
    nombre: '15-Inch Leather Briefcase',
    corto: '15-Inch Leather Briefcase',
    variantes: {
      'dark-coffee': { etiqueta: 'Dark Coffee', precio_cents: 20497 },
      'brown': { etiqueta: 'Brown', precio_cents: 20497 },
    },
  },
  'leather-card-holder': {
    nombre: 'Leather Card Holder with RFID Blocking Feature',
    corto: 'Leather Card Holder',
    variantes: {
      'green': { etiqueta: 'Green', precio_cents: 7750 },
      'black-1': { etiqueta: 'Black (option 1)', precio_cents: 7750 },
      'grey': { etiqueta: 'Grey', precio_cents: 7750 },
      'navy': { etiqueta: 'Navy', precio_cents: 7750 },
      'black-2': { etiqueta: 'Black (option 2)', precio_cents: 7750 },
      'orange': { etiqueta: 'Orange', precio_cents: 7750 },
    },
  },
  'leather-travel-duffel': {
    nombre: 'Leather Travel Duffel Bag, Sizes L and XL',
    corto: 'Leather Travel Duffel, L and XL',
    variantes: {
      'black-l': { etiqueta: 'Black, Size L', precio_cents: 19519 },
      'brown-l': { etiqueta: 'Brown, Size L', precio_cents: 19519 },
      'black-xl': { etiqueta: 'Black, Size XL', precio_cents: 21453 },
      'brown-xl': { etiqueta: 'Brown, Size XL', precio_cents: 21453 },
    },
  },
  'leather-vintage-duffel': {
    nombre: 'Vintage Leather Duffel Bag',
    corto: 'Vintage Leather Duffel',
    variantes: {
      'black': { etiqueta: 'Black', precio_cents: 21360 },
      'light-brown': { etiqueta: 'Light Brown', precio_cents: 23242 },
    },
  },
};
const ENTREGA_DIAS = { min: 15, max: 25 };
// <CATALOGO:END>

const ESTADOS_US = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]);

const SKU_RE = /^[a-z0-9-]{3,40}$/;
const VARIANTE_RE = /^[a-z0-9-]{1,30}$/;
const EMAIL_RE = /^[\w.+-]+@[\w.-]+\.\w{2,}$/;   // el mismo de guardar-cv y chat-cv.html
const ZIP_RE = /^\d{5}(-\d{4})?$/;
const TEL_RE = /^[0-9+()\-\s.]{7,20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALFABETO_REF = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // el mismo alfabeto de los códigos de CV

type Obj = Record<string, unknown>;
type Fallo = { ok: false; status: number; codigo: string; error: string; campo?: string };
type Resultado<T> = { ok: true; v: T } | Fallo;
type Linea = { sku: string; variante: string; qty: number };
type LineaCotizada = {
  sku: string; variante: string; variante_etiqueta: string; nombre: string; nombre_corto: string;
  qty: number; precio_unit_cents: number; subtotal_cents: number;
};
type Cotizacion = {
  items: LineaCotizada[]; subtotal_cents: number; envio_cents: number; impuesto_cents: number; total_cents: number;
};
type Envio = {
  nombre: string; linea1: string; linea2: string; ciudad: string; estado: string; zip: string; pais: string; telefono: string;
};
type Pedido = {
  id: string; estado: string; referencia: string; order_code: string | null; payment_link_url: string | null;
  link_creado_at: string | null; actualizado_at: string; solicitud_hash: string | null; token_consulta: string;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function fallo(status: number, codigo: string, error: string, campo?: string): Fallo {
  return campo ? { ok: false, status, codigo, error, campo } : { ok: false, status, codigo, error };
}

function respFallo(f: Fallo, extra: Obj = {}): Response {
  const body: Obj = { ok: false, error: f.error, codigo: f.codigo, ...extra };
  if (f.campo) body.campo = f.campo;
  return json(body, f.status);
}

function esObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function tiene(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function aDolares(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

// ═══════════════ Validación y saneamiento ═══════════════

// Recorta, quita caracteres de control, colapsa espacios. Devuelve null si no es texto.
function limpiar(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  return v.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
}

function validarItems(raw: unknown): Resultado<Linea[]> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_LINEAS) {
    return fallo(400, 'items_invalidos', `Your cart must have between 1 and ${MAX_LINEAS} items.`, 'items');
  }
  const vistos = new Set<string>();
  const lineas: Linea[] = [];
  for (let i = 0; i < raw.length; i++) {
    const it: unknown = raw[i];
    const campo = `items[${i}]`;
    if (!esObj(it)) return fallo(400, 'items_invalidos', 'One of the items in your cart is not valid.', campo);

    const sku = typeof it.sku === 'string' ? it.sku.trim() : '';
    if (!SKU_RE.test(sku)) return fallo(400, 'sku_invalido', 'One of the items in your cart is not valid.', `${campo}.sku`);
    if (!tiene(CATALOGO, sku)) {
      return fallo(404, 'sku_no_disponible', 'One of the items in your cart is no longer available. Remove it and try again.', `${campo}.sku`);
    }
    if (vistos.has(sku)) return fallo(400, 'items_duplicados', 'Each item can appear only once in an order.', `${campo}.sku`);
    vistos.add(sku);

    const variante = typeof it.variante === 'string' ? it.variante.trim() : '';
    if (!VARIANTE_RE.test(variante) || !tiene(CATALOGO[sku].variantes, variante)) {
      return fallo(400, 'variante_invalida', 'The option you selected is not available for this item.', `${campo}.variante`);
    }

    const qty = it.qty;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return fallo(400, 'qty_invalida', `Quantity must be a whole number from 1 to ${MAX_QTY}.`, `${campo}.qty`);
    }
    lineas.push({ sku, variante, qty });
  }
  return { ok: true, v: lineas };
}

function validarEmail(raw: unknown): Resultado<string> {
  const e = limpiar(raw);
  if (e === null || e.length > 254 || !EMAIL_RE.test(e) || /[<>]/.test(e)) {
    return fallo(400, 'email_invalido', 'Enter a valid email address.', 'email');
  }
  return { ok: true, v: e.toLowerCase() };
}

// Dirección de EE.UU. normalizada: espacios colapsados, estado en mayúsculas, ZIP de 5 o 5+4.
function validarEnvio(raw: unknown): Resultado<Envio> {
  if (!esObj(raw)) return fallo(400, 'envio_invalido', 'Enter your shipping address.', 'envio');

  function texto(campo: string, valor: unknown, min: number, max: number, msg: string, opcional = false): Resultado<string> {
    if (opcional && (valor === undefined || valor === null)) return { ok: true, v: '' };
    const s = limpiar(valor);
    if (s === null || /[<>]/.test(s) || s.length > max || s.length < (opcional && s.length === 0 ? 0 : min)) {
      return fallo(400, 'direccion_invalida', msg, `envio.${campo}`);
    }
    return { ok: true, v: s };
  }

  const nombre = texto('nombre', raw.nombre, 2, 80, 'Enter the full name for delivery (2 to 80 characters).');
  if (!nombre.ok) return nombre;
  const linea1 = texto('linea1', raw.linea1, 3, 100, 'Enter your street address (3 to 100 characters).');
  if (!linea1.ok) return linea1;
  const linea2 = texto('linea2', raw.linea2, 1, 100, 'Apartment or suite can have up to 100 characters.', true);
  if (!linea2.ok) return linea2;
  const ciudad = texto('ciudad', raw.ciudad, 2, 60, 'Enter your city (2 to 60 characters).');
  if (!ciudad.ok) return ciudad;

  const estado = (limpiar(raw.estado) ?? '').toUpperCase();
  if (!ESTADOS_US.has(estado)) {
    return fallo(400, 'estado_invalido', 'Select a valid U.S. state.', 'envio.estado');
  }

  const zip = limpiar(raw.zip) ?? '';
  if (!ZIP_RE.test(zip)) {
    return fallo(400, 'zip_invalido', 'Enter a valid ZIP code (12345 or 12345-6789).', 'envio.zip');
  }

  const pais = (limpiar(raw.pais) ?? '').toUpperCase();
  if (pais !== 'US') {
    return fallo(400, 'pais_no_soportado', 'We currently ship only to addresses in the United States.', 'envio.pais');
  }

  let telefono = '';
  if (raw.telefono !== undefined && raw.telefono !== null) {
    const t = limpiar(raw.telefono);
    if (t === null || (t.length > 0 && !TEL_RE.test(t))) {
      return fallo(400, 'telefono_invalido', 'Enter a valid phone number or leave it blank.', 'envio.telefono');
    }
    telefono = t;
  }

  return { ok: true, v: { nombre: nombre.v, linea1: linea1.v, linea2: linea2.v, ciudad: ciudad.v, estado, zip, pais: 'US', telefono } };
}

// ═══════════════ Cálculo de precios (solo servidor, en centavos enteros) ═══════════════

function calcular(lineas: Linea[]): Cotizacion {
  const items: LineaCotizada[] = lineas.map((l) => {
    const p = CATALOGO[l.sku];
    const v = p.variantes[l.variante];
    return {
      sku: l.sku,
      variante: l.variante,
      variante_etiqueta: v.etiqueta,
      nombre: p.nombre,
      nombre_corto: p.corto,
      qty: l.qty,
      precio_unit_cents: v.precio_cents,
      subtotal_cents: v.precio_cents * l.qty,
    };
  });
  const subtotal = items.reduce((s, i) => s + i.subtotal_cents, 0);
  // Envío incluido en el precio mostrado; sin cálculo de impuestos en v1 (decisión del negocio).
  return { items, subtotal_cents: subtotal, envio_cents: 0, impuesto_cents: 0, total_cents: subtotal };
}

// ═══════════════ Utilidades ═══════════════

async function leerCuerpo(req: Request): Promise<string | null> {
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (declarado > MAX_BODY_BYTES) return null;
  const reader = req.body?.getReader();
  if (!reader) return '';
  const trozos: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      try { await reader.cancel(); } catch (_e) { /* ignorar */ }
      return null;
    }
    trozos.push(value);
  }
  const todo = new Uint8Array(total);
  let pos = 0;
  for (const t of trozos) { todo.set(t, pos); pos += t.byteLength; }
  return new TextDecoder().decode(todo);
}

function aleatorio(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

function generarReferencia(): string {
  let s = 'ESS-';
  for (const b of aleatorio(10)) s += ALFABETO_REF[b % ALFABETO_REF.length];
  return s;
}

// Token de consulta: 32 caracteres hex (128 bits). Solo se entrega al navegador que creó el pedido.
function generarToken(): string {
  return Array.from(aleatorio(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(texto: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

function minutosDesde(iso: string | null): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / 60000;
}

function ipDe(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || req.headers.get('cf-connecting-ip')
    || 'desconocida';
}

// ═══════════════ Acceso a la base (PostgREST con service role, como guardar-cv) ═══════════════

function sb(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });
}

// Columnas que se leen: nunca la dirección ni el nombre.
const COLUMNAS_PEDIDO = 'id,estado,referencia,order_code,payment_link_url,link_creado_at,actualizado_at,solicitud_hash,token_consulta';

async function verificarLimite(ip: string): Promise<{ ok: boolean; retryAfter?: number }> {
  try {
    const r = await sb('rpc/checar_limite_ia_v2', {
      method: 'POST',
      body: JSON.stringify({
        p_clave: `ess:${ip}`,
        p_ip: ip,
        p_lim_hora: ESS_LIM_HORA,
        p_lim_dia: ESS_LIM_DIA,
        p_lim_ip_hora: ESS_LIM_IP_HORA,
      }),
    });
    if (!r.ok) {
      // RPC ausente, firma distinta o error de la base: se permite. Un fallo del límite no debe bloquear las ventas
      // (guardar-cv solo degrada ante una excepción de red; aquí también ante una respuesta HTTP de error).
      console.error('essentials-pago: checar_limite_ia_v2 respondió', r.status);
      return { ok: true };
    }
    const data = await r.json();
    if (data && data.ok === true) return { ok: true };
    return { ok: false, retryAfter: (data && Number(data.retry_after)) || 3600 };
  } catch (_e) {
    // Degradar a "permitido" si el RPC falla (mismo criterio que guardar-cv): no tumbar la venta por el límite.
    return { ok: true };
  }
}

async function buscarPorIdem(idem: string): Promise<Pedido | null> {
  const r = await sb(`essentials_pedidos?select=${COLUMNAS_PEDIDO}&idem=eq.${encodeURIComponent(idem)}&limit=1`);
  if (!r.ok) throw new Error(`lectura por idem falló (${r.status})`);
  const filas = await r.json();
  return Array.isArray(filas) && filas.length > 0 ? filas[0] as Pedido : null;
}

// ═══════════════ n1co (misma integración que n1co-pago) ═══════════════

async function crearEnlaceN1co(p: { id: string; referencia: string; cot: Cotizacion }):
  Promise<{ paymentLinkUrl: string; orderCode: string; orderId: string } | null> {
  // n1co-pago usa `CVPRO-<codigo>-<base36 del reloj>`: una referencia distinta por intento.
  const orderReference = `${p.referencia}-${Date.now().toString(36).toUpperCase()}`;
  const descripcion = p.cot.items
    .map((i) => `${i.qty} x ${i.nombre_corto} (${i.variante_etiqueta})`)
    .join('; ')
    .slice(0, 240);

  const payload = {
    orderReference,
    orderName: `Professional Essentials order ${p.referencia}`,
    orderDescription: descripcion,
    amount: aDolares(p.cot.total_cents),
    successUrl: `${SITIO}${RETORNO_OK}?ref=${p.referencia}`,
    cancelUrl: `${SITIO}${RETORNO_CANCELADO}`,
    metadata: [
      { name: 'tienda', value: 'essentials' },
      { name: 'pedido', value: p.id },
      { name: 'referencia', value: p.referencia },
    ],
    expirationMinutes: LINK_MINUTOS,
  };

  const r = await fetch(`${API_BASE}/paymentlink/checkout`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${N1CO_SECRET_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(N1CO_TIMEOUT_MS),
  });

  const data = await r.json().catch(() => null);
  const orderCode = data?.orderCode === undefined || data?.orderCode === null ? '' : String(data.orderCode);

  if (!r.ok || typeof data?.paymentLinkUrl !== 'string' || !data.paymentLinkUrl.startsWith('https://')
    || !/^[A-Za-z0-9_-]{1,64}$/.test(orderCode)) {
    console.error('essentials-pago: n1co rechazó la creación', r.status, JSON.stringify(data));
    return null;
  }
  return { paymentLinkUrl: data.paymentLinkUrl, orderCode, orderId: data.orderId === undefined ? '' : String(data.orderId) };
}

function enProceso(): Response {
  return respFallo(
    fallo(409, 'pedido_en_proceso', 'Your order is being created. Wait a moment and try again.'),
    { retry_after_seconds: 3 },
  );
}

// Qué hacer con un pedido que ya existe para la misma clave idem. Devuelve una respuesta, o null si hay
// que crear un enlace de pago nuevo para ese pedido (el anterior venció, falló o se canceló).
function decidirReuso(p: Pedido, hash: string, totalCents: number): Response | null {
  if (p.solicitud_hash !== hash) {
    return respFallo(fallo(409, 'idem_reutilizado', 'Your cart changed. Refresh the page and try again.'));
  }
  if (p.estado === 'pagado') {
    return respFallo(fallo(409, 'pedido_ya_pagado', 'This order has already been paid.'));
  }
  if (p.estado === 'revision') {
    return respFallo(fallo(409, 'pedido_en_revision', 'This order is under review. Please email hola@getcvpro.com.'));
  }
  if (p.estado === 'pendiente' && p.payment_link_url && p.order_code && minutosDesde(p.link_creado_at) < LINK_MINUTOS) {
    // Doble clic o reintento: se devuelve el mismo enlace, todavía vigente.
    return respuestaPago(p, p.order_code, p.payment_link_url, totalCents);
  }
  if (p.estado === 'creado' && minutosDesde(p.actualizado_at) < CLAIM_MINUTOS) {
    return enProceso();   // otra solicitud está creando ahora mismo el enlace de este pedido
  }
  return null;
}

// Reclama un pedido existente para crearle un enlace nuevo. UPDATE condicional (optimista): solo prospera si
// nadie lo tocó desde que se leyó (estado y actualizado_at iguales). Si dos solicitudes compiten, gana una.
async function reclamar(p: Pedido): Promise<Pedido | null> {
  const r = await sb(
    `essentials_pedidos?id=eq.${p.id}&estado=eq.${p.estado}&actualizado_at=eq.${encodeURIComponent(p.actualizado_at)}&select=${COLUMNAS_PEDIDO}`,
    { method: 'PATCH', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify({ estado: 'creado' }) },
  );
  if (!r.ok) throw new Error(`reclamar el pedido falló (${r.status})`);
  const filas = await r.json().catch(() => null);
  return Array.isArray(filas) && filas.length === 1 ? filas[0] as Pedido : null;
}

function respuestaPago(p: Pedido, orderCode: string, url: string, totalCents: number): Response {
  return json({
    ok: true,
    pedido: p.id,
    referencia: p.referencia,
    orderCode,
    token: p.token_consulta,
    paymentLinkUrl: url,
    total_cents: totalCents,
    monto: aDolares(totalCents),
    moneda: 'USD',
  });
}

// ═══════════════ Acciones ═══════════════

function accionCotizar(body: Obj): Response {
  const items = validarItems(body.items);
  if (!items.ok) return respFallo(items);
  const cot = calcular(items.v);
  return json({
    ok: true,
    moneda: 'USD',
    items: cot.items.map((i) => ({
      sku: i.sku,
      variante: i.variante,
      variante_etiqueta: i.variante_etiqueta,
      nombre: i.nombre,
      qty: i.qty,
      precio_unit_cents: i.precio_unit_cents,
      subtotal_cents: i.subtotal_cents,
      entrega_min_dias: ENTREGA_DIAS.min,
      entrega_max_dias: ENTREGA_DIAS.max,
    })),
    subtotal_cents: cot.subtotal_cents,
    envio_cents: cot.envio_cents,
    impuesto_cents: cot.impuesto_cents,
    total_cents: cot.total_cents,
    monto: aDolares(cot.total_cents),
  });
}

async function accionPagar(req: Request, body: Obj): Promise<Response> {
  // 1. Validar todo antes de tocar la base o n1co
  const items = validarItems(body.items);
  if (!items.ok) return respFallo(items);
  const email = validarEmail(body.email);
  if (!email.ok) return respFallo(email);
  const envio = validarEnvio(body.envio);
  if (!envio.ok) return respFallo(envio);
  if (body.acepta_terminos !== true) {
    return respFallo(fallo(400, 'politica_no_aceptada',
      'You must accept the shipping and returns terms to continue.', 'acepta_terminos'));
  }
  let idem: string | null = null;
  if (body.idem !== undefined && body.idem !== null) {
    if (typeof body.idem !== 'string' || !UUID_RE.test(body.idem)) {
      return respFallo(fallo(400, 'idem_invalido', 'Invalid request key.', 'idem'));
    }
    idem = body.idem.toLowerCase();
  }

  if (!N1CO_SECRET_KEY || !SUPABASE_URL || !SERVICE_KEY) {
    console.error('essentials-pago: faltan variables de entorno');
    return respFallo(fallo(500, 'servicio_no_configurado', 'Checkout is not available right now. Please try again later.'));
  }

  // 2. Rate-limit por IP
  const limite = await verificarLimite(ipDe(req));
  if (!limite.ok) {
    return respFallo(
      fallo(429, 'demasiadas_solicitudes', 'Too many attempts. Please try again later.'),
      { retry_after_seconds: limite.retryAfter ?? 3600 },
    );
  }

  // 3. Precios y total, en el servidor
  const cot = calcular(items.v);
  const hash = await sha256Hex(JSON.stringify([
    items.v.map((l) => [l.sku, l.variante, l.qty]).sort(),
    email.v,
    envio.v,
    cot.total_cents,
  ]));

  // 4. Idempotencia y posesión del pedido: solo UNA solicitud crea el enlace de pago de un pedido.
  //    · Sin clave idem: cada llamada crea un pedido nuevo.
  //    · Con idem: si el pedido ya existe se reutiliza su enlace vigente; si hay que crear otro enlace
  //      (vencido, fallido, cancelado) la solicitud lo reclama con un UPDATE condicional; si dos llegan
  //      a la vez, una gana y la otra recibe 409 pedido_en_proceso (no se crean dos enlaces).
  let pedido: Pedido | null = null;
  const existente = idem ? await buscarPorIdem(idem) : null;
  if (existente) {
    const previa = decidirReuso(existente, hash, cot.total_cents);
    if (previa) return previa;
    pedido = await reclamar(existente);
    if (!pedido) return enProceso();
  } else {
    const ahora = new Date().toISOString();
    const ua = (limpiar(req.headers.get('user-agent') ?? '') ?? '').slice(0, 300);
    for (let intento = 0; intento < 3 && !pedido; intento++) {
      const fila = {
        estado: 'creado',
        referencia: generarReferencia(),
        entorno: N1CO_ENTORNO === 'live' ? 'live' : 'sandbox',
        items: cot.items,
        subtotal: aDolares(cot.subtotal_cents),
        costo_envio: aDolares(cot.envio_cents),
        impuesto: aDolares(cot.impuesto_cents),
        total: aDolares(cot.total_cents),
        moneda: 'USD',
        nombre: envio.v.nombre,
        email: email.v,
        telefono: envio.v.telefono || null,
        envio_line1: envio.v.linea1,
        envio_line2: envio.v.linea2 || null,
        envio_city: envio.v.ciudad,
        envio_state: envio.v.estado,
        envio_zip: envio.v.zip,
        envio_pais: 'US',
        acepto_politica_at: ahora,
        politica_version: POLITICA_VERSION,
        user_agent: ua || null,
        idem,
        solicitud_hash: hash,
        token_consulta: generarToken(),
      };
      const ins = await sb(`essentials_pedidos?select=${COLUMNAS_PEDIDO}`, {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(fila),
      });
      if (ins.ok) {
        const filas = await ins.json().catch(() => null);
        pedido = Array.isArray(filas) && filas.length > 0 ? filas[0] as Pedido : null;
        if (!pedido) throw new Error('insert sin fila de retorno');
      } else if (ins.status === 409) {
        // Misma clave idem en paralelo: otra solicitud acaba de crear el pedido. Se devuelve su enlace si
        // ya está listo, y si no, "en proceso". Si no hay idem, fue una colisión (improbable) de la referencia.
        if (idem) {
          const previo = await buscarPorIdem(idem);
          if (previo) return decidirReuso(previo, hash, cot.total_cents) ?? enProceso();
        }
      } else {
        console.error('essentials-pago: no se pudo guardar el pedido', ins.status);
        return respFallo(fallo(500, 'error_interno', 'We could not create your order. Please try again.'));
      }
    }
    if (!pedido) {
      console.error('essentials-pago: no se pudo crear el pedido tras reintentos');
      return respFallo(fallo(500, 'error_interno', 'We could not create your order. Please try again.'));
    }
  }

  // 5. Crear el enlace de pago en n1co (solo quien tiene la posesión del pedido, estado 'creado')
  let enlace: { paymentLinkUrl: string; orderCode: string; orderId: string } | null = null;
  try {
    enlace = await crearEnlaceN1co({ id: pedido.id, referencia: pedido.referencia, cot });
  } catch (err) {
    console.error('essentials-pago: n1co no respondió', err instanceof Error ? err.message : String(err));
  }
  if (!enlace) {
    await sb(`essentials_pedidos?id=eq.${pedido.id}&estado=eq.creado`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ estado: 'fallido_pasarela' }),
    }).catch(() => null);
    return respFallo(fallo(502, 'pasarela_no_disponible', 'We could not start the payment. Please try again in a moment.'));
  }

  // 6. Ligar el orderCode de n1co al pedido
  const upd = await sb(`essentials_pedidos?id=eq.${pedido.id}&estado=eq.creado&select=${COLUMNAS_PEDIDO}`, {
    method: 'PATCH',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify({
      estado: 'pendiente',
      order_code: enlace.orderCode,
      n1co_order_id: enlace.orderId || null,
      payment_link_url: enlace.paymentLinkUrl,
      link_creado_at: new Date().toISOString(),
    }),
  });
  const filasUpd = upd.ok ? await upd.json().catch(() => null) : null;
  if (!Array.isArray(filasUpd) || filasUpd.length !== 1) {
    // El enlace existe en n1co pero no quedó ligado al pedido. La referencia y el id del pedido viajan en la
    // metadata de n1co para conciliar a mano si alguien pagara.
    console.error(`essentials-pago: no se pudo ligar orderCode=${enlace.orderCode} al pedido ${pedido.id} (${upd.status})`);
    return respFallo(fallo(500, 'error_interno', 'We could not create your order. Please try again.'));
  }
  pedido = filasUpd[0] as Pedido;

  console.log(`essentials-pago OK · pedido=${pedido.id} · orderCode=${enlace.orderCode} · total=${aDolares(cot.total_cents)} · ${N1CO_ENTORNO === 'live' ? 'live' : 'sandbox'}`);
  return respuestaPago(pedido, enlace.orderCode, enlace.paymentLinkUrl, cot.total_cents);
}

// ═══════════════ Entrada ═══════════════

async function manejar(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return respFallo(fallo(405, 'metodo_no_permitido', 'Method not allowed.'));
  }

  try {
    const texto = await leerCuerpo(req);
    if (texto === null) {
      return respFallo(fallo(413, 'cuerpo_demasiado_grande', 'The request is too large.'));
    }
    let body: unknown;
    try { body = JSON.parse(texto); } catch (_e) { body = null; }
    if (!esObj(body)) {
      return respFallo(fallo(400, 'cuerpo_invalido', 'The request could not be read.'));
    }

    if (body.accion === 'cotizar') return accionCotizar(body);
    if (body.accion === 'pagar') return await accionPagar(req, body);
    return respFallo(fallo(400, 'accion_invalida', "accion must be 'cotizar' or 'pagar'.", 'accion'));
  } catch (err) {
    console.error('essentials-pago error:', err instanceof Error ? err.message : String(err));
    return respFallo(fallo(500, 'error_interno', 'Something went wrong. Please try again.'));
  }
}

Deno.serve(manejar);
