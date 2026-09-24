// Tests de regresión de la lógica pura del cliente (chat-cv.html).
// Ejecutar: node tests/cliente/cliente.test.mjs   (desde la raíz del repo)
// No requiere navegador. Extrae las funciones del monolito con extraer.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sandbox, plano } from './extraer.mjs';

let pasados = 0, fallidos = 0;
const _cola = [];
function test(nombre, fn) { _cola.push([nombre, fn]); }
async function correr() {
  for (const [nombre, fn] of _cola) {
    try { await fn(); pasados++; console.log(`✅ ${nombre}`); }
    catch (e) { fallidos++; console.log(`❌ ${nombre}\n   ${e.message.split('\n')[0]}`); }
  }
}

// ── 1. Detección de negaciones / respuestas sin funciones ─────────────────
const ctxNeg = sandbox({
  consts: ['_RE_NEG', '_RE_FUENTE_CRUZADA_TAREAS', '_RE_NO_SE_CIFRAS'],
  funciones: ['_contarPalabras', '_respuestaSinFunciones', '_esSoloCargo', '_exp2Negativa', '_tieneFuenteCruzadaTareas', '_esNoSeCifras'],
});
const { _respuestaSinFunciones, _esSoloCargo, _exp2Negativa, _tieneFuenteCruzadaTareas, _esNoSeCifras, _RE_NEG } = ctxNeg;

test('exp2 negativa: "no", "ninguno", "solo uno" → true; "Solo practitioner" → false', () => {
  for (const v of ['no', 'No.', 'ninguno', 'none', 'solo uno', 'only one', 'n/a']) assert.equal(_exp2Negativa(v), true, v);
  for (const v of ['Solo practitioner', 'no tengo dos, tengo tres', 'Cajera en Selectos']) assert.equal(_exp2Negativa(v), false, v);
});
test('_respuestaSinFunciones: lista telegráfica de 3 tareas NO es "sin funciones" (D7)', () => {
  assert.equal(_respuestaSinFunciones('atender clientes, arreglar la tienda, cobrar'), false);
  // Limitación documentada: 2 ítems y <8 palabras sigue disparando el checklist (no es un error: el checklist es inocuo y la respuesta se conserva).
  assert.equal(_respuestaSinFunciones('cambios de aceite y frenos'), true);
});
test('_respuestaSinFunciones: negaciones y textos vacíos → true', () => {
  for (const v of ['', 'no', 'ninguna', 'no recuerdo', 'nothing', "i don't remember"]) assert.equal(_respuestaSinFunciones(v), true, JSON.stringify(v));
});
test('_respuestaSinFunciones: frase corta sin verbos de tarea → true; frase larga → false', () => {
  assert.equal(_respuestaSinFunciones('cosas varias'), true);
  assert.equal(_respuestaSinFunciones('me encargaba de recibir a los pacientes y agendar sus citas cada mañana'), false);
});
test('_esSoloCargo acepta las 4 variantes y rechaza texto con contenido', () => {
  for (const v of ['solo cargo', 'Sólo el cargo', 'only title', 'ONLY THE TITLE']) assert.equal(_esSoloCargo(v), true, v);
  assert.equal(_esSoloCargo('levantamientos topográficos; solo cargo'), false);
});
test('_RE_NEG (negación genérica) anclada: "no" sí, "no tengo experiencia en ventas" no', () => {
  assert.equal(_RE_NEG.test('no'), true);
  assert.equal(_RE_NEG.test('Nada más.'), true);
  assert.equal(_RE_NEG.test("I don't have any"), true);
  assert.equal(_RE_NEG.test('no tengo experiencia en ventas'), false);
});
test('_tieneFuenteCruzadaTareas: resumen libre con tareas y ≥12 palabras → true', () => {
  assert.equal(_tieneFuenteCruzadaTareas({ resumen_personal: 'trabajo en Super Selectos como cajera haciendo cobros y atención al cliente todos los días', exp1: '' }), true);
  assert.equal(_tieneFuenteCruzadaTareas({ resumen_personal: 'cajera', exp1: 'Selectos' }), false);
});
test('_esNoSeCifras: "no sé" / "skip" / "no numbers" → true', () => {
  for (const v of ['no sé', 'No lo se', 'skip', 'no numbers', 'not sure']) assert.equal(_esNoSeCifras(v), true, v);
  assert.equal(_esNoSeCifras('unos 200 clientes al día'), false);
});

// ── 1b. Negación tras el checklist NO vacía un puesto con contenido (v19 cliente, E3/E4) ──
test('evaluarFuncionesPuesto: "no" tras el checklist conserva "cambios de aceite y frenos" (no marca sin_funciones)', async () => {
  const ctx = sandbox({
    consts: ['_RE_NEG', '_RE_FUENTE_CRUZADA_TAREAS'],
    funciones: ['_contarPalabras', '_respuestaSinFunciones', '_esSoloCargo', '_exp2Negativa', '_tieneFuenteCruzadaTareas', '_confirmadasDeSugeridas', 'evaluarFuncionesPuesto'],
    globales: { FUNCIONES_PREGUNTADO: { logros2: true }, FUNCIONES_SUGERIDAS: {}, CIFRAS_PREGUNTADO: {}, seguimientosDados: {}, mostrarChecklistFunciones: async () => {}, mostrarTyping: async () => {}, actualizarUI() {}, paso: 5 },
  });
  const datosRef = { exp2: 'ayudante en taller de mi tio - 2013 a 2016', logros2: 'cambios de aceite y frenos' };
  const r = await ctx.evaluarFuncionesPuesto('logros2', 'no', datosRef);
  assert.equal(r, false);
  assert.equal(!!datosRef.logros2_sin_funciones, false, 'con contenido previo no se vacía el puesto');
  const vacio = { exp2: 'ayudante en taller', logros2: '' };
  await ctx.evaluarFuncionesPuesto('logros2', 'no', vacio);
  assert.equal(vacio.logros2_sin_funciones, true, 'sin contenido previo sí se marca');
});

// ── 2. Negación breve tras repregunta (FASE 4) ─────────────────────────────
// La regex vive dentro de enviar(); se extrae la línea `const _RE_NEGACION_BREVE`.
const ctxBreve = sandbox({ consts: ['_RE_NEGACION_BREVE'] });
test('_RE_NEGACION_BREVE: "no", "nada más", "eso es todo", "no sé", "that\'s all" → true; contenido real → false', () => {
  const re = ctxBreve._RE_NEGACION_BREVE;
  for (const v of ['no', 'Nada más', 'eso es todo.', 'no sé', "that's all", 'done', 'listo']) assert.equal(re.test(v), true, v);
  for (const v of ['no, también atendía la caja', 'nada más que cobrar y limpiar', 'none of the above but I did sales']) assert.equal(re.test(v), false, v);
});

// ── 3. Parser de encabezado de puesto (rescate) ───────────────────────────
// _parsearExpTexto está anidada dentro de construirCVData(); se extrae por nombre igualmente.
const ctxParse = sandbox({ funciones: ['_parsearExpTexto'] });
const { _parsearExpTexto } = ctxParse;
test('_parsearExpTexto: "Cargo | Empresa | 2022 – Actualidad"', () => {
  assert.deepEqual(plano(_parsearExpTexto('Cajera | Super Selectos | 2022 – Actualidad')), { titulo: 'Cajera', empresa: 'Super Selectos', periodo: '2022 – Actualidad' });
});
test('_parsearExpTexto: rango "2013-2016" no se parte en dos campos (D4)', () => {
  assert.deepEqual(plano(_parsearExpTexto('Ayudante | Taller de su tío | 2013-2016')), { titulo: 'Ayudante', empresa: 'Taller de su tío', periodo: '2013 – 2016' });
});
test('_parsearExpTexto: "desde 2019" → "2019 – Actualidad"', () => {
  const r = _parsearExpTexto('Electricista — Electrosur desde 2019');
  assert.equal(r.periodo, '2019 – Actualidad');
  assert.equal(r.titulo, 'Electricista');
  assert.equal(r.empresa, 'Electrosur');
});
test('_parsearExpTexto: "marzo 2021 a la fecha" (sin guion, D5)', () => {
  const r = _parsearExpTexto('Contadora general | Distribuidora La Fuente | marzo 2021 a la fecha');
  assert.equal(r.periodo, 'marzo 2021 – Actualidad');
});
test('_parsearExpTexto: duración sin fechas "| 3 meses" (motor v2)', () => {
  assert.deepEqual(plano(_parsearExpTexto('Practicante | Alcaldía de Santa Tecla | 3 meses')), { titulo: 'Practicante', empresa: 'Alcaldía de Santa Tecla', periodo: '3 meses' });
});
test('_parsearExpTexto: tercer segmento "|" sin patrón de fecha se asume periodo (D5)', () => {
  assert.equal(_parsearExpTexto('Vendedora | Tienda de ropa | Temporada 2019').periodo, 'Temporada 2019');
});
test('_parsearExpTexto: texto sin separadores → todo a título, capitalizado', () => {
  assert.deepEqual(plano(_parsearExpTexto('ayudante de bodega')), { titulo: 'Ayudante de bodega', empresa: '', periodo: '' });
});
test('_parsearExpTexto EN: "2019-2021" con LANG=en → "2019 – 2021"; "2021 - present" → "Present"', () => {
  const ctxEn = sandbox({ funciones: ['_parsearExpTexto'], globales: { LANG: 'en' } });
  assert.equal(ctxEn._parsearExpTexto('Apprentice | HVAC company | 2019-2021').periodo, '2019 – 2021');
  assert.equal(ctxEn._parsearExpTexto('HVAC Technician | Buckeye Comfort | 2021 - present').periodo, '2021 – Present');
});
// Documenta una LIMITACIÓN conocida (no un fallo del test): "2013 a 2016" sin guion no se reconoce.
test('[limitación documentada] _parsearExpTexto: "2013 a 2016" (rango con "a", sin guion) queda sin periodo', () => {
  const r = _parsearExpTexto('ayudante en taller de mi tio - 2013 a 2016');
  assert.equal(r.periodo, '', 'si este test falla, la limitación se resolvió: actualizar el test y DEPLOY.md');
});

// ── 4. construirCVDataDesdeJSON: formato de periodo idéntico al servidor ───
const ctxJSON = sandbox({
  funciones: ['construirCVDataDesdeJSON'],
  globales: { validarContacto: (d) => d, ordenarExperiencia: (e) => e, datos: { nombre: 'X', pais: 'El Salvador', puesto: 'Cajera' } },
});
const { construirCVDataDesdeJSON } = ctxJSON;
const cvBase = (exp) => ({ lang: 'es', nombre: 'Rosa', titulo_objetivo: 'Cajera', contacto: {}, perfil: 'p', experiencia: [exp], educacion: [], habilidades: { tecnicas: [], blandas: [] }, idiomas: [], extra: [] });
test('periodo: "2021-03" + actual → "Marzo 2021 – Actualidad"', () => {
  const d = construirCVDataDesdeJSON(cvBase({ cargo: 'Contadora', empresa: 'X', inicio: '2021-03', fin: null, actual: true, vinetas: [] }));
  assert.equal(d.experiencia[0].periodo, 'Marzo 2021 – Actualidad');
});
test('periodo: inicio === fin → un solo año', () => {
  const d = construirCVDataDesdeJSON(cvBase({ cargo: 'Sales Associate', empresa: 'Target', inicio: '2025', fin: '2025', actual: false, vinetas: [] }));
  assert.equal(d.experiencia[0].periodo, '2025');
});
test('periodo: sin fechas pero con duracion → "3 meses"', () => {
  const d = construirCVDataDesdeJSON(cvBase({ cargo: 'Practicante', empresa: 'Alcaldía', inicio: null, fin: null, actual: false, duracion: '3 meses', vinetas: [] }));
  assert.equal(d.experiencia[0].periodo, '3 meses');
});
test('periodo EN: "2018-06" + actual → "June 2018 – Present"', () => {
  const cv = cvBase({ cargo: 'RN', empresa: 'Mercy', inicio: '2018-06', fin: null, actual: true, vinetas: [] }); cv.lang = 'en';
  assert.equal(construirCVDataDesdeJSON(cv).experiencia[0].periodo, 'June 2018 – Present');
});
test('viñetas: acepta objetos {texto} y strings; descarta vacías; empresa vacía se conserva como ""', () => {
  const d = construirCVDataDesdeJSON(cvBase({ cargo: 'Apprentice', empresa: '', inicio: '2019', fin: '2021', actual: false, vinetas: [{ texto: 'A', evidencia: 'a' }, 'B', { texto: '' }] }));
  assert.deepEqual(plano(d.experiencia[0].bullets), ['A', 'B']);
  assert.equal(d.experiencia[0].empresa, '');
});
test('educación: en_curso → "En curso"; idioma con nivel null → nivel ""', () => {
  const cv = cvBase({ cargo: 'C', empresa: 'E', inicio: null, fin: null, actual: false, vinetas: [] });
  cv.educacion = [{ titulo: '2.º año de Administración', institucion: 'UFG', anio: null, en_curso: true }];
  cv.idiomas = [{ idioma: 'Español', nivel: null }, { idioma: 'Inglés', nivel: 'básico' }];
  const d = construirCVDataDesdeJSON(cv);
  assert.equal(d.educacion[0]['año'], 'En curso');
  assert.deepEqual(plano(d.idiomas), [{ nombre: 'Español', nivel: '' }, { nombre: 'Inglés', nivel: 'básico' }]);
});

// ── 5. Utilidades de adaptación/traducción ────────────────────────────────
const ctxUtil = sandbox({ funciones: ['_normalizarSkill', '_extraerHabilidadesDeTexto', '_parsearBloquesExperiencia', 'limpiarPreambuloIA'] });
test('_normalizarSkill: acentos, plural y puntuación final', () => {
  assert.equal(ctxUtil._normalizarSkill('Conciliaciones bancarias.'), 'conciliaciones bancaria');
  assert.equal(ctxUtil._normalizarSkill('Excel'), 'excel');
});
test('_parsearBloquesExperiencia: 2 puestos con sus viñetas desde el texto serializado del motor v2', () => {
  const txt = 'EXPERIENCIA PROFESIONAL\n───────────────────\nCajera | Super Selectos | 2022 – Actualidad\n\nVendedora | Tienda de ropa | 2019 – 2021\n• Atendió clientes.\n• Cobró.\n\nEDUCACIÓN\n───────────────────\nBachillerato | 2018';
  const b = ctxUtil._parsearBloquesExperiencia(txt);
  assert.equal(b.length, 2);
  assert.deepEqual(plano(b[1].bullets), ['Atendió clientes.', 'Cobró.']);
});
test('_extraerHabilidadesDeTexto: quita las etiquetas "Técnicas:/Blandas:/Idiomas:" (limitación documentada: los idiomas entran en la lista blanca)', () => {
  const txt = 'HABILIDADES\n───────────────────\nTécnicas: manejo de caja, atención al cliente\nBlandas: Ordenado\nIdiomas: Español, Inglés — Básico\n';
  const h = ctxUtil._extraerHabilidadesDeTexto(txt);
  assert.deepEqual(plano(h), ['manejo de caja', 'atención al cliente', 'Ordenado', 'Español', 'Inglés — Básico']);
});
test('limpiarPreambuloIA: quita narración previa y conserva el CV desde el nombre', () => {
  const cv = 'Perfecto, aquí está el CV corregido:\n1. Quité un dato\n\nROSA MÁRQUEZ\nCajera | El Salvador\n' + 'x'.repeat(200);
  const r = ctxUtil.limpiarPreambuloIA(cv);
  assert.equal(r.startsWith('ROSA MÁRQUEZ'), true);
});

// ── 6. Sintaxis global de chat-cv.html (cada <script> debe parsear) ───────
test('todos los <script> inline de chat-cv.html parsean (new Function)', () => {
  const html = fs.readFileSync(new URL('../../chat-cv.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/(?:ld\+)?json")[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  assert.ok(scripts.length >= 3, 'se esperaban varios bloques <script>');
  scripts.forEach((s, i) => { try { new Function(s); } catch (e) { throw new Error(`script #${i}: ${e.message}`); } });
});

await correr();
console.log(`\n──────────────────────────────\nTotal: ${pasados + fallidos} · Pasados: ${pasados} · Fallidos: ${fallidos}`);
process.exit(fallidos ? 1 : 0);
