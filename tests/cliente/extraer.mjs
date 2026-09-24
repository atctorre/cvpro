// Extrae funciones/constantes puras de chat-cv.html por nombre y las evalúa en
// un sandbox de Node (vm). chat-cv.html es un monolito de ~440 KB sin módulos:
// este harness permite probar la lógica pura sin abrir un navegador y sin
// tocar el archivo. Si una función cambia de nombre, el test falla en la
// extracción (mejor que pasar en silencio).
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RUTA_CHAT = process.env.CHAT_CV_HTML || path.resolve(__dirname, '../../chat-cv.html');
const html = fs.readFileSync(RUTA_CHAT, 'utf8');

// Devuelve el texto fuente de `function NOMBRE(...) { ... }` (top-level o anidada)
// emparejando llaves y respetando strings, template literals, regex y comentarios.
export function extraerFuncion(nombre) {
  const re = new RegExp(`(?:^|\\n)[ \\t]*(?:async\\s+)?function\\s+${nombre}\\s*\\(`);
  const m = re.exec(html);
  if (!m) throw new Error(`extraerFuncion: no se encontró function ${nombre}(`);
  const inicio = m.index + (m[0].includes('async') ? m[0].indexOf('async') : m[0].lastIndexOf('function'));
  const abre = html.indexOf('{', inicio);
  let i = abre, depth = 0, estado = null; // estado: '"', "'", '`', 'lc' (//), 'bc' (/* */), 're'
  for (; i < html.length; i++) {
    const c = html[i], n = html[i + 1];
    if (estado === 'lc') { if (c === '\n') estado = null; continue; }
    if (estado === 'bc') { if (c === '*' && n === '/') { estado = null; i++; } continue; }
    if (estado === 're') { if (c === '\\') { i++; continue; } if (c === '/') estado = null; continue; }
    if (estado) { if (c === '\\') { i++; continue; } if (c === estado) estado = null; continue; }
    if (c === '/' && n === '/') { estado = 'lc'; i++; continue; }
    if (c === '/' && n === '*') { estado = 'bc'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { estado = c; continue; }
    if (c === '/') {
      // regex literal si lo anterior (no espacio) es un operador/apertura
      let k = i - 1; while (k >= 0 && /\s/.test(html[k])) k--;
      if (k < 0 || /[(,=:[!&|?{};+\-*%<>~^]/.test(html[k]) || /\b(return|typeof|case|in|of)$/.test(html.slice(Math.max(0, k - 6), k + 1))) { estado = 're'; continue; }
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(inicio, i);
}

// Devuelve `const NOMBRE = ...;` (una sola línea) tal como está en el archivo.
export function extraerConst(nombre) {
  const re = new RegExp(`(?:^|\\n)[ \\t]*const\\s+${nombre}\\s*=\\s*[^\\n]*`);
  const m = re.exec(html);
  if (!m) throw new Error(`extraerConst: no se encontró const ${nombre}`);
  return m[0].trim();
}

// Evalúa un conjunto de funciones/consts en un sandbox con los globales
// mínimos del navegador que usan (LANG, datos, ev, console…). Devuelve el
// contexto para leer las funciones.
export function sandbox({ funciones = [], consts = [], globales = {} } = {}) {
  const ctx = vm.createContext({
    console, LANG: 'es', datos: {}, ev: () => {}, CIFRAS_PREGUNTADO: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { search: '', hostname: 'getcvpro.com' },
    ...globales,
  });
  // `const` dentro del script no se expone en el contexto: se reescribe a `var`.
  const src = [...consts.map(c => extraerConst(c).replace(/^const\s+/, 'var ')), ...funciones.map(extraerFuncion)].join('\n\n');
  vm.runInContext(src, ctx, { filename: 'chat-cv.extraido.js' });
  return ctx;
}

// Los objetos creados en otro realm (vm) no pasan deepStrictEqual por prototipo:
// se normalizan vía JSON para comparar solo estructura y valores.
export function plano(x) { return JSON.parse(JSON.stringify(x));
}
