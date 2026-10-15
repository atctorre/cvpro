// Supabase SIMULADO en memoria (HTTP real en 127.0.0.1, subconjunto de PostgREST) para probar las Edge Functions.
//
// Implementa lo que usan essentials-pago y essentials-confirmar:
//   GET/POST/PATCH /rest/v1/essentials_pedidos   filtros eq, neq, in, is.null, lt, gt, or=(...), select, limit,
//                                                Prefer: return=representation | minimal
//   POST /rest/v1/rpc/checar_limite_ia_v2        rate-limit (configurable)
// y reproduce en JavaScript las restricciones de la migración 20261014220000_essentials_pedidos.sql
// (NOT NULL, CHECK, UNIQUE y el trigger essentials_pedidos_guard). La migración REAL se verifica aparte,
// contra PostgreSQL, en tests/sql/verificar-migracion.sql; tests/migracion.test.mjs comprueba además que las
// columnas de esta simulación sean exactamente las de la migración.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export const COLUMNAS = [
  'id', 'created_at', 'actualizado_at', 'estado', 'referencia', 'order_code', 'n1co_order_id', 'payment_link_url',
  'link_creado_at', 'n1co_estado', 'ultima_consulta', 'entorno', 'monto_n1co', 'pagado_en', 'items', 'subtotal',
  'costo_envio', 'impuesto', 'total', 'moneda', 'nombre', 'email', 'telefono', 'envio_line1', 'envio_line2',
  'envio_city', 'envio_state', 'envio_zip', 'envio_pais', 'acepto_politica_at', 'politica_version', 'user_agent',
  'idem', 'solicitud_hash', 'token_consulta', 'cumplimiento', 'seguimiento',
];
const TIMESTAMPS = new Set(['created_at', 'actualizado_at', 'link_creado_at', 'ultima_consulta', 'pagado_en', 'acepto_politica_at']);
const NUMERICAS = new Set(['subtotal', 'costo_envio', 'impuesto', 'total', 'monto_n1co']);
const NOT_NULL = ['estado', 'referencia', 'entorno', 'items', 'subtotal', 'costo_envio', 'impuesto', 'total', 'moneda',
  'nombre', 'email', 'envio_line1', 'envio_city', 'envio_state', 'envio_zip', 'envio_pais', 'acepto_politica_at',
  'politica_version', 'token_consulta', 'cumplimiento'];
const UNICAS = ['idem', 'referencia', 'order_code'];     // NULL no cuenta como repetido
const ESTADOS = ['creado', 'pendiente', 'pagado', 'fallido', 'cancelado', 'fallido_pasarela', 'revision'];
const CUMPLIMIENTO = ['pendiente', 'pedido_a_proveedor', 'enviado', 'entregado', 'reembolsado', 'cancelado'];
// Columnas que el trigger essentials_pedidos_guard congela cuando el pedido ya está pagado
const CONGELADAS = ['estado', 'pagado_en', 'order_code', 'referencia', 'items', 'subtotal', 'costo_envio', 'impuesto',
  'total', 'moneda', 'entorno', 'monto_n1co', 'acepto_politica_at'];

const cents = (x) => Math.round(Number(x) * 100);

export async function iniciarSupabaseSim({ serviceKey }) {
  const filas = [];
  const peticiones = [];
  const opciones = {
    limite: null,          // p. ej. { ok: false, retry_after: 120 }
    rpcFalla: false,       // el RPC responde 500
    falloPost: null,       // status HTTP forzado en POST
    falloPatch: null,      // status HTTP forzado en PATCH
    retardoMs: 0,
  };
  let ultimoMicros = 0;

  function ahoraPg() {
    let micros = Date.now() * 1000;
    if (micros <= ultimoMicros) micros = ultimoMicros + 1;     // estrictamente creciente, como un reloj de µs
    ultimoMicros = micros;
    const iso = new Date(Math.floor(micros / 1000)).toISOString();
    return `${iso.slice(0, -1)}${String(micros % 1000).padStart(3, '0')}+00:00`;
  }
  const normTs = (v) => {
    if (v === null || v === undefined) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw errorPg('22007', `fecha inválida: ${v}`);
    return `${d.toISOString().slice(0, -1)}000+00:00`;
  };

  function errorPg(code, message) { return Object.assign(new Error(message), { pg: true, code }); }

  function normalizar(fila) {
    for (const k of Object.keys(fila)) {
      if (!COLUMNAS.includes(k)) throw errorPg('PGRST204', `Could not find the '${k}' column of 'essentials_pedidos' in the schema cache`);
    }
    for (const k of TIMESTAMPS) if (k in fila && !['created_at', 'actualizado_at'].includes(k)) fila[k] = normTs(fila[k]);
    for (const k of NUMERICAS) if (fila[k] !== null && fila[k] !== undefined) fila[k] = Math.round(Number(fila[k]) * 100) / 100;
    return fila;
  }

  function validarFila(f, anterior) {
    for (const k of NOT_NULL) {
      if (f[k] === null || f[k] === undefined) throw errorPg('23502', `null value in column "${k}" violates not-null constraint`);
    }
    const chk = (cond, nombre) => { if (!cond) throw errorPg('23514', `new row violates check constraint "essentials_pedidos_${nombre}_chk"`); };
    chk(ESTADOS.includes(f.estado), 'estado');
    chk(['sandbox', 'live'].includes(f.entorno), 'entorno');
    chk(f.moneda === 'USD', 'moneda');
    chk(Array.isArray(f.items) && f.items.length >= 1 && f.items.length <= 5, 'items');
    chk(f.subtotal > 0 && f.costo_envio >= 0 && f.impuesto >= 0
      && cents(f.total) === cents(f.subtotal) + cents(f.costo_envio) + cents(f.impuesto), 'importes');
    chk(/^ESS-[2-9A-HJ-NP-Z]{10}$/.test(f.referencia), 'referencia');
    chk(f.order_code === null || /^[A-Za-z0-9_-]{1,64}$/.test(f.order_code), 'order_code');
    chk(/^[0-9a-f]{32}$/.test(f.token_consulta), 'token');
    chk(f.email.length <= 254 && f.email.indexOf('@') > 0, 'email');
    chk(/^[A-Z]{2}$/.test(f.envio_state), 'state');
    chk(/^\d{5}(-\d{4})?$/.test(f.envio_zip), 'zip');
    chk(f.envio_pais === 'US', 'pais');
    chk(CUMPLIMIENTO.includes(f.cumplimiento), 'cumplimiento');
    chk((f.estado === 'pagado') === (f.pagado_en !== null), 'pagado');
    chk(f.estado !== 'pagado' || f.order_code !== null, 'pagado_codigo');
    for (const k of UNICAS) {
      if (f[k] !== null && filas.some((o) => o !== anterior && o[k] === f[k])) {
        throw errorPg('23505', `duplicate key value violates unique constraint "essentials_pedidos_${k}_key"`);
      }
    }
    // Trigger essentials_pedidos_guard: un pedido pagado no se puede reconfirmar ni alterar sus datos de cobro
    if (anterior && anterior.estado === 'pagado') {
      for (const k of CONGELADAS) {
        if (JSON.stringify(f[k]) !== JSON.stringify(anterior[k])) {
          throw errorPg('23514', `essentials_pedidos: el pedido ${anterior.id} ya esta pagado; no se puede confirmar de nuevo ni modificar sus datos de cobro`);
        }
      }
    }
  }

  function insertar(datos) {
    const f = normalizar({ ...datos });
    const ahora = ahoraPg();
    const fila = {};
    for (const k of COLUMNAS) fila[k] = null;
    Object.assign(fila, {
      id: randomUUID(), created_at: ahora, actualizado_at: ahora, estado: 'creado', entorno: 'sandbox',
      costo_envio: 0, impuesto: 0, moneda: 'USD', envio_pais: 'US', cumplimiento: 'pendiente',
    }, f);
    validarFila(fila, null);
    fila.actualizado_at = ahoraPg();            // trigger BEFORE INSERT
    filas.push(fila);
    return fila;
  }

  function parchear(coincide, cambios) {
    const c = normalizar({ ...cambios });
    const tocadas = [];
    for (const anterior of filas.filter(coincide)) {
      const nueva = { ...anterior, ...c };
      validarFila(nueva, anterior);
      nueva.actualizado_at = ahoraPg();          // trigger: actualizado_at
      tocadas.push([anterior, nueva]);
    }
    for (const [anterior, nueva] of tocadas) filas[filas.indexOf(anterior)] = nueva;
    return tocadas.map(([, nueva]) => nueva);
  }

  // ── filtros PostgREST ──
  function condicion(col, expr) {
    if (!COLUMNAS.includes(col)) throw errorPg('42703', `column essentials_pedidos.${col} does not exist`);
    const punto = expr.indexOf('.');
    const op = expr.slice(0, punto);
    const val = expr.slice(punto + 1);
    const str = (v) => (v === null || v === undefined ? null : String(v));
    switch (op) {
      case 'eq': return (f) => str(f[col]) === val;
      case 'neq': return (f) => str(f[col]) !== val;
      case 'lt': return (f) => f[col] !== null && String(f[col]) < val;
      case 'gt': return (f) => f[col] !== null && String(f[col]) > val;
      case 'is': return (f) => (val === 'null' ? f[col] === null : f[col] !== null);
      case 'in': {
        const lista = val.replace(/^\(|\)$/g, '').split(',');
        return (f) => lista.includes(str(f[col]));
      }
      default: throw errorPg('PGRST100', `operador no soportado en la simulación: ${op}`);
    }
  }
  function construirFiltro(params) {
    const conds = [];
    for (const [k, v] of params) {
      if (['select', 'limit', 'order', 'offset'].includes(k)) continue;
      if (k === 'or') {
        const partes = v.replace(/^\(|\)$/g, '').split(',').map((p) => {
          const i = p.indexOf('.');
          return condicion(p.slice(0, i), p.slice(i + 1));
        });
        conds.push((f) => partes.some((c) => c(f)));
      } else {
        conds.push(condicion(k, v));
      }
    }
    return (f) => conds.every((c) => c(f));
  }
  function proyectar(fila, select) {
    if (!select || select === '*') return fila;
    const out = {};
    for (const c of select.split(',')) {
      if (!COLUMNAS.includes(c)) throw errorPg('42703', `column essentials_pedidos.${c} does not exist`);
      out[c] = fila[c];
    }
    return out;
  }

  const HTTP = { 23505: 409, 23514: 400, 23502: 400, PGRST204: 400, 42703: 400, PGRST100: 400, 22007: 400 };

  const servidor = createServer(async (req, res) => {
    const trozos = [];
    for await (const t of req) trozos.push(t);
    const texto = Buffer.concat(trozos).toString('utf8');
    const url = new URL(req.url, 'http://sim');
    let cuerpo = null;
    try { cuerpo = texto ? JSON.parse(texto) : null; } catch { cuerpo = null; }
    const prefer = req.headers['prefer'] || '';
    peticiones.push({
      metodo: req.method, ruta: url.pathname, consulta: url.search, cuerpo, prefer,
      apikey: req.headers['apikey'], auth: req.headers['authorization'],
    });

    const responder = (status, obj, extra = {}) => {
      const enviar = () => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...extra });
        res.end(obj === undefined ? '' : JSON.stringify(obj));
      };
      if (opciones.retardoMs > 0) setTimeout(enviar, opciones.retardoMs); else enviar();
    };

    if (req.headers['apikey'] !== serviceKey || req.headers['authorization'] !== `Bearer ${serviceKey}`) {
      return responder(401, { message: 'Invalid API key' });
    }

    try {
      if (url.pathname === '/rest/v1/rpc/checar_limite_ia_v2' && req.method === 'POST') {
        if (opciones.rpcFalla) return responder(500, { message: 'rpc roto' });
        return responder(200, opciones.limite ?? { ok: true });
      }
      if (url.pathname !== '/rest/v1/essentials_pedidos') return responder(404, { message: 'tabla desconocida' });

      const select = url.searchParams.get('select');
      const representacion = /return=representation/.test(prefer);

      if (req.method === 'GET') {
        const lim = Number(url.searchParams.get('limit') ?? Infinity);
        const filtro = construirFiltro(url.searchParams);
        const salida = filas.filter(filtro).slice(0, lim).map((f) => proyectar(f, select));
        return responder(200, salida);
      }
      if (req.method === 'POST') {
        if (opciones.falloPost) return responder(opciones.falloPost, { message: 'fallo forzado' });
        if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return responder(400, { message: 'cuerpo inválido' });
        const fila = insertar(cuerpo);
        return representacion ? responder(201, [proyectar(fila, select)]) : responder(201, undefined);
      }
      if (req.method === 'PATCH') {
        if (opciones.falloPatch) return responder(opciones.falloPatch, { message: 'fallo forzado' });
        if (!cuerpo || typeof cuerpo !== 'object') return responder(400, { message: 'cuerpo inválido' });
        const filtro = construirFiltro(url.searchParams);
        const tocadas = parchear(filtro, cuerpo);
        return representacion ? responder(200, tocadas.map((f) => proyectar(f, select))) : responder(204, undefined);
      }
      return responder(405, { message: 'método no soportado' });
    } catch (e) {
      if (e.pg) return responder(HTTP[e.code] ?? 400, { code: e.code, message: e.message, details: null, hint: null });
      return responder(500, { message: String(e?.message ?? e) });
    }
  });

  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const puerto = servidor.address().port;

  return {
    url: `http://127.0.0.1:${puerto}`,
    filas,
    peticiones,
    opciones,
    // Acceso directo (como lo haría el dueño desde el panel) pasando por las MISMAS restricciones y el trigger
    parchear: (coincide, cambios) => parchear(coincide, cambios),
    porId: (id) => filas.find((f) => f.id === id),
    porReferencia: (r) => filas.find((f) => f.referencia === r),
    cerrar: () => new Promise((ok) => { servidor.closeAllConnections?.(); servidor.close(ok); }),
  };
}
