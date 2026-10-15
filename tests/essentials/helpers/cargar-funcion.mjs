// Carga el index.ts de una Edge Function de Supabase (Deno/TypeScript) dentro de Node, sin dependencias.
//
// 1. Quita los tipos con node:module.stripTypeScriptTypes (Node >= 22.13). Si no existe, usa el paquete
//    `typescript` SI está instalado (Node 20: `npm i --no-save typescript`); si tampoco, falla con un mensaje claro.
// 2. Simula el global `Deno` (env + serve) con el entorno que se le pase.
// 3. Importa el módulo y devuelve el handler que la función registró en Deno.serve.
//
// El código de la función NO se modifica ni se reescribe: se ejecuta tal cual, tipos aparte.

import { readFileSync } from 'node:fs';
import * as modulo from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
export const RAIZ = resolve(aqui, '..');                          // tests/essentials/
export const RAIZ_REPO = resolve(RAIZ, '../..');                  // raíz del repositorio
export const RUTA_FUNCIONES = resolve(RAIZ_REPO, 'supabase/functions');

let contador = 0;

export function quitarTipos(codigoTs, nombre) {
  if (typeof modulo.stripTypeScriptTypes === 'function') {
    return modulo.stripTypeScriptTypes(codigoTs, { mode: 'strip' });
  }
  try {
    const ts = modulo.createRequire(import.meta.url)('typescript');
    return ts.transpileModule(codigoTs, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      fileName: nombre,
    }).outputText;
  } catch (_e) {
    throw new Error(
      `No se pueden quitar los tipos de ${nombre}: se necesita Node >= 22.13 (module.stripTypeScriptTypes) ` +
      'o el paquete "typescript" instalado (en Node 20: npm i --no-save typescript). ' +
      `Node actual: ${process.version}.`,
    );
  }
}

export const RUTA_REFERENCIA = resolve(RAIZ, 'referencia');

export function leerFuente(slug, base = RUTA_FUNCIONES) {
  return readFileSync(resolve(base, slug, 'index.ts'), 'utf8');
}

/**
 * @param {string} slug  'essentials-pago' | 'essentials-confirmar'
 * @param {Record<string,string>} env  variables que verá Deno.env.get
 * @param {{base?: string}} [opciones]  carpeta que contiene <slug>/index.ts (por defecto supabase/functions; también sirve referencia/)
 * @returns {Promise<(req: Request) => Promise<Response>>}
 */
export async function cargarFuncion(slug, env, { base = RUTA_FUNCIONES } = {}) {
  const js = quitarTipos(leerFuente(slug, base), `${slug}/index.ts`);
  let handler = null;
  const previo = globalThis.Deno;
  globalThis.Deno = {
    env: { get: (k) => (Object.prototype.hasOwnProperty.call(env, k) ? env[k] : undefined) },
    serve: (h) => { handler = h; return {}; },
  };
  try {
    // Un comentario distinto en cada carga da una URL distinta: módulo nuevo, con su propio entorno leído al cargar.
    const url = 'data:text/javascript;base64,' +
      Buffer.from(`${js}\n//# carga-${++contador}`, 'utf8').toString('base64');
    await import(url);
  } finally {
    if (previo === undefined) delete globalThis.Deno; else globalThis.Deno = previo;
  }
  if (typeof handler !== 'function') throw new Error(`${slug}: no llamó a Deno.serve(handler)`);
  return handler;
}
