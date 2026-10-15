// ═══════════════════════════════════════════════════════════════
//  Professional Essentials by CVPro · Edge Function: essentials-confirmar
//
//  Verifica el estado de un pedido de /essentials/ CONTRA N1CO (no contra el navegador),
//  como hace n1co-confirmar, y marca el pedido como pagado UNA SOLA VEZ en essentials_pedidos.
//
//  · Idempotente: la transición a "pagado" es un UPDATE condicional (estado <> 'pagado') y,
//    además, un trigger de la base impide modificar un pedido ya pagado. Las llamadas
//    repetidas devuelven exactamente la misma respuesta, construida desde la fila guardada.
//  · No expone datos de otros pedidos: exige un identificador (order_code o pedido) MÁS una
//    prueba de posesión (email del comprador o token entregado por essentials-pago). Si no
//    coinciden responde 404 sin distinguir "no existe" de "no es tuyo". Nunca devuelve
//    email, nombre ni dirección.
//  · Mismas variables de entorno y misma consulta a n1co que n1co-confirmar.
// ═══════════════════════════════════════════════════════════════

// ── CORS: idéntico al de n1co-confirmar ──
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Variables de entorno: las mismas que n1co-confirmar ──
const N1CO_ENTORNO = (Deno.env.get('N1CO_ENTORNO') ?? 'sandbox').toLowerCase();
const N1CO_SECRET_KEY = Deno.env.get('N1CO_SECRET_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const API_BASE = N1CO_ENTORNO === 'live'
  ? 'https://api-pay.n1co.shop/api'
  : 'https://api-pay-sandbox.n1co.shop/api';

const MAX_BODY_BYTES = 2 * 1024;
const N1CO_TIMEOUT_MS = 20000;

const CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;                 // mismo patrón que n1co-confirmar
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[0-9a-f]{32}$/;
const EMAIL_RE = /^[\w.+-]+@[\w.-]+\.\w{2,}$/;

// Estados desde los que un pedido todavía puede pasar a "pagado". 'pagado' es terminal; 'revision' solo lo
// resuelve el dueño a mano.
const ESTADOS_ABIERTOS = 'creado,pendiente,fallido,cancelado,fallido_pasarela';

// Columnas que se leen: NUNCA la dirección ni el nombre.
const COLUMNAS = 'id,estado,referencia,order_code,email,token_consulta,items,total,moneda,entorno,pagado_en';

type Obj = Record<string, unknown>;
type Fallo = { status: number; codigo: string; error: string };
type Pedido = {
  id: string; estado: string; referencia: string; order_code: string | null; email: string; token_consulta: string;
  items: Obj[]; total: number | string; moneda: string; entorno: string; pagado_en: string | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Todos los errores llevan pagado:false, como n1co-confirmar (la lógica de reintento del cliente lo lee).
function respFallo(f: Fallo): Response {
  return json({ ok: false, pagado: false, error: f.error, codigo: f.codigo }, f.status);
}

function esObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function aDolares(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

// Comparación en tiempo constante (no se corta en el primer carácter distinto).
function iguales(a: string, b: string): boolean {
  let d = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

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

function metaValor(metadata: unknown, nombre: string): string {
  if (!Array.isArray(metadata)) return '';
  const m = metadata.find((x) => esObj(x) && x.name === nombre);
  return esObj(m) && m.value ? String(m.value) : '';
}

// Estado propio a partir del estado de n1co cuando NO está pagado. Solo se conoce con certeza
// PAID/FINALIZED (los usa n1co-confirmar); el resto es una clasificación prudente: lo desconocido
// se queda en "pendiente". El estado crudo de n1co se guarda aparte (n1co_estado).
function estadoLocal(n1co: string): string {
  if (/CANCEL/.test(n1co)) return 'cancelado';
  if (/EXPIR|FAIL|REJECT|DECLIN|DENIED/.test(n1co)) return 'fallido';
  return 'pendiente';
}

function itemsPublicos(items: unknown): Obj[] {
  if (!Array.isArray(items)) return [];
  return items.filter(esObj).map((i) => ({
    sku: i.sku,
    variante: i.variante,
    variante_etiqueta: i.variante_etiqueta,
    nombre: i.nombre,
    qty: i.qty,
    precio_unit_cents: i.precio_unit_cents,
    subtotal_cents: i.subtotal_cents,
  }));
}

// Respuesta del pedido PAGADO, construida SOLO desde la fila guardada: por eso las llamadas
// repetidas devuelven exactamente lo mismo (pagado_en incluido).
function respuestaPagado(p: Pedido): Response {
  const totalCents = Math.round(Number(p.total) * 100);
  return json({
    ok: true,
    pagado: true,
    estado: 'pagado',
    pedido: p.id,
    referencia: p.referencia,
    orderCode: p.order_code,
    items: itemsPublicos(p.items),
    total_cents: totalCents,
    monto: aDolares(totalCents),
    moneda: p.moneda,
    entorno: p.entorno,
    pagado_en: p.pagado_en,
  });
}

function respuestaNoPagado(p: { id: string; estado: string; referencia: string }, estadoPasarela?: string): Response {
  const body: Obj = { ok: true, pagado: false, estado: p.estado, pedido: p.id, referencia: p.referencia };
  if (estadoPasarela) body.estado_pasarela = estadoPasarela;
  return json(body);
}

async function leerPedido(filtro: string): Promise<Pedido | null> {
  const r = await sb(`essentials_pedidos?select=${COLUMNAS}&${filtro}&limit=1`);
  if (!r.ok) throw new Error(`lectura del pedido falló (${r.status})`);
  const filas = await r.json();
  return Array.isArray(filas) && filas.length > 0 ? filas[0] as Pedido : null;
}

// ═══════════════ Entrada ═══════════════

async function manejar(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return respFallo({ status: 405, codigo: 'metodo_no_permitido', error: 'Method not allowed.' });
  }

  if (!N1CO_SECRET_KEY || !SUPABASE_URL || !SERVICE_KEY) {
    console.error('essentials-confirmar: faltan variables de entorno');
    return respFallo({ status: 500, codigo: 'servicio_no_configurado', error: 'Service not configured.' });
  }

  try {
    const texto = await leerCuerpo(req);
    if (texto === null) {
      return respFallo({ status: 413, codigo: 'cuerpo_demasiado_grande', error: 'The request is too large.' });
    }
    let body: unknown;
    try { body = JSON.parse(texto); } catch (_e) { body = null; }
    if (!esObj(body)) {
      return respFallo({ status: 400, codigo: 'cuerpo_invalido', error: 'The request could not be read.' });
    }

    // 1. Identificador del pedido: order_code (n1co o referencia propia) o pedido (uuid)
    const codigoRaw = body.order_code ?? body.orderCode;
    const codigo = typeof codigoRaw === 'string' ? codigoRaw.trim() : '';
    const pedidoRaw = typeof body.pedido === 'string' ? body.pedido.trim().toLowerCase() : '';
    let filtro: string;
    if (codigo) {
      if (!CODE_RE.test(codigo)) {
        return respFallo({ status: 400, codigo: 'order_code_invalido', error: 'Invalid order code.' });
      }
      filtro = `or=(order_code.eq.${codigo},referencia.eq.${codigo})`;   // valores sin comas ni paréntesis (CODE_RE)
    } else if (pedidoRaw) {
      if (!UUID_RE.test(pedidoRaw)) {
        return respFallo({ status: 400, codigo: 'pedido_invalido', error: 'Invalid order id.' });
      }
      filtro = `id=eq.${pedidoRaw}`;
    } else {
      return respFallo({ status: 400, codigo: 'identificador_requerido', error: 'Provide order_code or pedido.' });
    }

    // 2. Prueba de posesión: email del comprador o token de essentials-pago
    const token = typeof body.token === 'string' ? body.token.trim().toLowerCase() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!token && !email) {
      return respFallo({ status: 400, codigo: 'prueba_requerida', error: 'Provide email or token.' });
    }
    if (token && !TOKEN_RE.test(token)) {
      return respFallo({ status: 400, codigo: 'token_invalido', error: 'Invalid token.' });
    }
    if (email && (email.length > 254 || !EMAIL_RE.test(email))) {
      return respFallo({ status: 400, codigo: 'email_invalido', error: 'Invalid email.' });
    }

    // 3. Buscar el pedido y comprobar la prueba. "No existe" y "no es tuyo" dan la misma respuesta.
    const p = await leerPedido(filtro);
    const autorizado = !!p
      && (!pedidoRaw || p.id === pedidoRaw)
      && ((token !== '' && iguales(token, p.token_consulta)) || (email !== '' && iguales(email, p.email)));
    if (!p || !autorizado) {
      return respFallo({ status: 404, codigo: 'pedido_no_encontrado', error: 'We could not find that order.' });
    }

    // 4. Ya pagado: respuesta desde la fila, sin volver a preguntar a n1co (idempotencia)
    if (p.estado === 'pagado') return respuestaPagado(p);

    // 5. Sin enlace de pago todavía (creado o fallido en la pasarela): nada que consultar
    if (!p.order_code || !CODE_RE.test(p.order_code)) return respuestaNoPagado(p);

    // 6. Preguntarle a n1co el estado REAL de la orden (misma consulta que n1co-confirmar)
    const r = await fetch(`${API_BASE}/paymentlink/order/${p.order_code}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${N1CO_SECRET_KEY}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(N1CO_TIMEOUT_MS),
    });
    if (!r.ok) {
      console.error('essentials-confirmar: n1co respondió', r.status, 'orderCode=' + p.order_code);
      return respFallo({ status: 502, codigo: 'pasarela_no_disponible', error: 'We could not verify the payment right now.' });
    }
    const orden: unknown = await r.json().catch(() => null);
    const o: Obj = esObj(orden) ? orden : {};
    const estadoN1co = String(o.orderStatus ?? '').toUpperCase();
    const ahora = new Date().toISOString();

    if (estadoN1co !== 'PAID' && estadoN1co !== 'FINALIZED') {
      const nuevo = estadoLocal(estadoN1co);
      console.log(`essentials-confirmar: orden ${p.order_code} en estado ${estadoN1co}`);
      await sb(`essentials_pedidos?id=eq.${p.id}&estado=in.(${ESTADOS_ABIERTOS})`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ estado: nuevo, n1co_estado: estadoN1co || null, ultima_consulta: ahora }),
      }).catch(() => null);   // no bloquear la respuesta por un fallo de bitácora
      return respuestaNoPagado({ id: p.id, estado: nuevo, referencia: p.referencia }, estadoN1co || undefined);
    }

    // 7. n1co dice PAGADO: comprobar contra lo que el SERVIDOR calculó (nunca contra el navegador)
    const totalCents = Math.round(Number(p.total) * 100);
    const totalN1co = Number(o.total ?? 0);
    const centsN1co = Math.round(totalN1co * 100);
    const moneda = String((esObj(o.store) ? o.store.currencyCode : undefined) ?? 'USD').toUpperCase();
    const metaPedido = metaValor(o.metadata, 'pedido');
    const anomalias: string[] = [];
    if (!(centsN1co > 0)) anomalias.push('monto_invalido');
    else if (centsN1co < totalCents) anomalias.push('monto_menor');
    if (moneda !== 'USD') anomalias.push('moneda_distinta');
    if (metaPedido && metaPedido !== p.id) anomalias.push('pedido_distinto');

    if (anomalias.length > 0) {
      // Se cobró algo que no cuadra con el pedido: no se marca pagado; el dueño lo revisa a mano.
      console.error(`essentials-confirmar: orden ${p.order_code} PAGADA pero no cuadra (${anomalias.join(',')}) · pedido=${p.id}`);
      await sb(`essentials_pedidos?id=eq.${p.id}&estado=in.(${ESTADOS_ABIERTOS})`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ estado: 'revision', n1co_estado: estadoN1co, ultima_consulta: ahora }),
      }).catch(() => null);
      return respuestaNoPagado({ id: p.id, estado: 'revision', referencia: p.referencia }, estadoN1co);
    }

    // 8. Transición atómica a "pagado": solo la primera llamada concurrente la realiza
    const upd = await sb(`essentials_pedidos?id=eq.${p.id}&estado=neq.pagado&select=${COLUMNAS}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        estado: 'pagado',
        pagado_en: ahora,
        n1co_estado: estadoN1co,
        monto_n1co: totalN1co,
        ultima_consulta: ahora,
      }),
    });
    if (!upd.ok) {
      console.error('essentials-confirmar: la base rechazó la transición a pagado', upd.status, 'pedido=' + p.id);
      return respFallo({ status: 500, codigo: 'pago_no_registrado', error: 'Payment received but not recorded. Please email hola@getcvpro.com.' });
    }
    const filas = await upd.json().catch(() => null);
    let final: Pedido | null = Array.isArray(filas) && filas.length > 0 ? filas[0] as Pedido : null;
    if (!final) {
      // Otra llamada (concurrente) ya lo marcó: se lee la fila y se devuelve lo mismo que ella.
      final = await leerPedido(`id=eq.${p.id}`);
    }
    if (!final) {
      return respFallo({ status: 500, codigo: 'pago_no_registrado', error: 'Payment received but not recorded. Please email hola@getcvpro.com.' });
    }
    if (final.estado !== 'pagado') return respuestaNoPagado(final);

    console.log(`essentials-confirmar OK · pedido=${final.id} · orderCode=${final.order_code} · total=${aDolares(Math.round(Number(final.total) * 100))} · ${final.entorno}`);
    return respuestaPagado(final);

  } catch (err) {
    console.error('essentials-confirmar error:', err instanceof Error ? err.message : String(err));
    return respFallo({ status: 500, codigo: 'error_interno', error: 'Something went wrong while checking the payment.' });
  }
}

Deno.serve(manejar);
