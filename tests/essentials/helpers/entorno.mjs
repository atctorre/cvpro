// Arma un entorno de prueba completo: Supabase simulado + n1co simulado + las dos funciones cargadas.
//
// Las funciones tienen escritas las URLs reales de n1co (https://api-pay-sandbox.n1co.shop/api o
// https://api-pay.n1co.shop/api). El `fetch` global se envuelve para REENCAMINAR esas dos direcciones al
// servidor n1co simulado, registrando la dirección original: así el código bajo prueba es el de producción y
// los tests pueden afirmar a qué endpoint exacto llamó. Cualquier otra salida a red se bloquea.

import { iniciarN1coSim } from './n1co-sim.mjs';
import { iniciarSupabaseSim } from './supabase-sim.mjs';
import { cargarFuncion, RUTA_REFERENCIA } from './cargar-funcion.mjs';

const URL_PAGO = 'https://lljmqyejwkgcbuwkgjkh.supabase.co/functions/v1/essentials-pago';
const URL_CONFIRMAR = 'https://lljmqyejwkgcbuwkgjkh.supabase.co/functions/v1/essentials-confirmar';
const URL_N1CO_CONFIRMAR = 'https://lljmqyejwkgcbuwkgjkh.supabase.co/functions/v1/n1co-confirmar';

export const CLAVE_N1CO = 'sk-n1co-de-prueba-no-es-real';
export const CLAVE_SERVICIO = 'service-role-de-prueba-no-es-real';

export async function crearEntorno({ env: extra = {}, sinFunciones = false, conReferencia = false } = {}) {
  const supa = await iniciarSupabaseSim({ serviceKey: CLAVE_SERVICIO });
  const n1co = await iniciarN1coSim({ secret: CLAVE_N1CO });

  const salidas = [];                           // { url original, anfitrion, ruta, metodo }
  const fetchReal = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
    const u = new URL(url);
    if (u.hostname === 'api-pay-sandbox.n1co.shop' || u.hostname === 'api-pay.n1co.shop') {
      salidas.push({ url, anfitrion: u.hostname, ruta: u.pathname, metodo: (init?.method || 'GET').toUpperCase() });
      return fetchReal(`http://127.0.0.1:${n1co.puerto}${u.pathname}${u.search}`, init);
    }
    if (u.hostname === '127.0.0.1') return fetchReal(input, init);
    return Promise.reject(new Error(`Salida a red NO permitida en las pruebas: ${url}`));
  };

  const env = {
    N1CO_ENTORNO: 'sandbox',
    N1CO_SECRET_KEY: CLAVE_N1CO,
    SUPABASE_URL: supa.url,
    SUPABASE_SERVICE_ROLE_KEY: CLAVE_SERVICIO,
    ...extra,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];

  const hPago = sinFunciones ? null : await cargarFuncion('essentials-pago', env);
  const hConfirmar = sinFunciones ? null : await cargarFuncion('essentials-confirmar', env);
  // Opcional: la n1co-confirmar REAL (copia en referencia/), para comprobar cómo trata una orden de /essentials/
  const hN1coConfirmar = conReferencia ? await cargarFuncion('n1co-confirmar', env, { base: RUTA_REFERENCIA }) : null;

  async function llamar(handler, url, cuerpo, { metodo = 'POST', headers = {} } = {}) {
    const init = { method: metodo, headers: { 'content-type': 'application/json', ...headers } };
    if (metodo !== 'GET' && metodo !== 'HEAD' && metodo !== 'OPTIONS') {
      init.body = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    }
    const r = await handler(new Request(url, init));
    const texto = await r.text();
    let body = null;
    try { body = texto ? JSON.parse(texto) : null; } catch { /* no JSON */ }
    return { status: r.status, headers: r.headers, body, texto };
  }

  return {
    env, supa, n1co, salidas,
    pago: (cuerpo, opts) => llamar(hPago, URL_PAGO, cuerpo, opts),
    confirmar: (cuerpo, opts) => llamar(hConfirmar, URL_CONFIRMAR, cuerpo, opts),
    n1coConfirmarReal: (cuerpo, opts) => llamar(hN1coConfirmar, URL_N1CO_CONFIRMAR, cuerpo, opts),
    async cerrar() {
      globalThis.fetch = fetchReal;
      await supa.cerrar();
      await n1co.cerrar();
    },
  };
}

// ── Datos de prueba ──
export const UUID1 = '3f2b8c1e-5d4a-4b7e-9a10-6c2d8e4f1a01';
let seq = 0;
export function nuevoUuid() {
  seq += 1;
  return `3f2b8c1e-5d4a-4b7e-9a10-${String(seq).padStart(12, '0')}`;
}

export function envioValido(extra = {}) {
  return {
    nombre: 'Jane Q. Buyer', linea1: '1600 Pennsylvania Ave NW', linea2: 'Apt 4B', ciudad: 'Washington',
    estado: 'DC', zip: '20500', pais: 'US', telefono: '(202) 555-0143', ...extra,
  };
}

export function pedidoValido(extra = {}) {
  return {
    accion: 'pagar',
    items: [
      { sku: 'leather-briefcase-17-inch', variante: 'black', qty: 1 },
      { sku: 'leather-card-holder', variante: 'navy', qty: 2 },
    ],
    email: 'Jane.Buyer@Example.com',
    envio: envioValido(),
    acepta_terminos: true,
    idem: nuevoUuid(),
    sesion: 'abc123def456',
    lang: 'en',
    ...extra,
  };
}

// 217.03 + 2 x 77.50
export const TOTAL_PEDIDO_CENTS = 21703 + 2 * 7750;

// Quita de un texto los valores que el servidor genera al azar (UUID, referencia ESS-..., orderReference, token hex, fechas ISO).
// Las pruebas de "no hay datos personales" buscan trozos cortos (un ZIP, un teléfono) y, sin esta limpieza, un UUID o una
// hora pueden contenerlos por pura casualidad (p. ej. "555" en hexadecimal) y la prueba fallaría de forma intermitente.
export function sinAleatorios(texto) {
  return String(texto).toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/ess-[2-9a-hj-np-z]{10}(?:-[0-9a-z]+)?/g, '<ref>')
    .replace(/\b[0-9a-f]{32}\b/g, '<token>')
    .replace(/\d{4}-\d\d-\d\dt[\d:.]+z/g, '<fecha>');
}
