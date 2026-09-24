import { detectarOficios, raicesToleradas, esRelleno, esAdjetivoCalidad } from './lexico.mjs';
// validador.mjs — Motor v2 CVPro
// Validador determinista en servidor: recibe el CV en JSON (esquema en
// ESQUEMA_CV.md) y las respuestas crudas del chat (`datos`), y devuelve
// { ok, errores[], correcciones[], cv } donde `cv` es la versión CORREGIDA.
//
// Filosofía (heredada del pipeline v1, ver chat-cv.html generarConIA/
// pasadaVeracidad): nada que el candidato no haya dicho sobrevive. Cuando
// una corrección determinista es posible (fecha futura, nivel de idioma no
// declarado, viñeta sin fuente, adjetivo de alcance no declarado) se aplica
// aquí, sin depender de que el modelo la respete. Cuando no es corregible
// con confianza (p.ej. una titulación declarada que falta por completo en
// el CV) se reporta como error para forzar un reintento con el informe.
//
// AUDITORÍA FASE 1 (correcciones aplicadas sobre la v1 de este archivo):
//  1. Adjetivos de alcance: dejan de ser lista negra ciega — solo se
//     eliminan si el término NO aparece en `datos`, y se elimina la
//     locución (con limpieza de conectores colgantes), no la viñeta
//     entera, salvo que la eliminación deje la unidad rota (entonces se
//     elimina la unidad completa como último recurso).
//  2. Se añade verificación de sustantivos técnicos en MINÚSCULAS (no solo
//     capitalizados/acrónimos/cifras) con eliminación a nivel de token.
//  3. Ámbito y verificación de empresa generalizados a TODOS los puestos:
//     i≥2 sin fuente en `datos` (el chat solo alimenta 2 empleos) se
//     elimina con error `puesto_sin_fuente`.
//  4. `nombre`, `titulo_objetivo` y `contacto.*` se derivan literalmente de
//     `datos` (no se confía en lo que devuelva el modelo).
//  5. `extra[]` se filtra contra `info_extra` (vacío si es una negación).
//  6. Placeholders ("N/A", "TBD", "no especificado"...) se buscan en más
//     campos, no solo `perfil`.
//  7. `construirCVDesdeInput` (conformidad de esquema: fechas, maxItems,
//     maxLength) vive aquí para que `generar-cv.ts` y los tests compartan
//     una sola implementación.
//
// Sin dependencias externas — Deno y Node lo importan igual (ESM puro).

// ───────────────────────── Utilidades de texto ─────────────────────────

function normalizar(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
    .toLowerCase()
    .trim();
}

function palabrasSignificativas(s, minLen = 3) {
  return normalizar(s)
    .split(/[^a-z0-9#\.\+]+/i)
    .filter(w => w.length >= minLen);
}

function contarPalabras(t) {
  return String(t || '').trim().split(/\s+/).filter(Boolean).length;
}

// v3 (evidencia literal), punto 3a: normalización TOLERANTE para comparar
// `evidencia` (cita literal) contra el ámbito del puesto — colapsa espacios
// múltiples y quita puntuación (además del acento/mayúsculas que ya quita
// `normalizar`), para que una coma o un salto de línea distintos entre lo
// que el candidato escribió y lo que el modelo citó no rompan la comparación.
function normalizarLaxo(s) {
  return normalizar(s).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Palabras funcionales (artículos/preposiciones/conjunciones) en ES/EN.
// Se usan para (a) no tratarlas como nombre propio aunque empiecen en
// mayúscula, y (b) limpiar conectores que quedan "colgando" cuando se
// elimina una locución o un token sin fuente en medio de una frase.
const CONECTORES = new Set([
  'el','la','los','las','un','una','unos','unas','de','del','y','o','en','con','para','por','su','sus','que','a','al',
  'the','a','an','of','in','on','with','for','and','to','at','his','her','its','their','or'
]);

// Palabras funcionales adicionales (≥5 letras) que NO deben tratarse como
// "sustantivo técnico sin fuente" aunque tengan longitud suficiente.
const STOPWORDS_LARGAS = new Set([
  'donde','desde','hasta','sobre','entre','porque','cuando','acerca','durante','dentro','mismo','misma',
  'otros','otras','cada','todo','toda','todos','todas','segun','tambien','ademas','mientras','despues','antes',
  'mediante', // preposición ("por medio de"), no un sustantivo de contenido — regresión detectada en caso 1
  'about','through','during','within','without','between','because','where','which','their','there','these',
  'those','being','while','after','before','other','others','still','again','further','once',
  // v3 (evidencia literal), punto 3c: la comprobación de tokens ahora usa
  // `evidencia` (más corta y específica que el ámbito completo del puesto),
  // así que hacen falta más conectores/cuantificadores genéricos exentos.
  'throughout','across','alongside','according','towards','including','regarding','various','several',
  'daily','weekly','monthly','diario','diaria','semanal','mensual','incluyendo','respecto','varios','varias',
  'diversos','diversas',
].map(normalizar));

// Re-auditoría (causa única): edición intra-oración prohibida. Los tokens
// "sin fuente" ya NO se recortan palabra a palabra dejando fragmentos rotos
// ("Mantuvo el y la de la tienda") — la decisión pasa a ser a nivel de
// VIÑETA/ORACIÓN completa (ver `tokensSinFuenteEnUnidad`). Para reducir el
// número de viñetas buenas que esa política más agresiva tira a la basura,
// se añaden tres mecanismos de tolerancia (punto 2 de la re-auditoría):
// raíz de 4 letras (antes 5), exención de verbos conjugados, y un mapa breve
// de familias de paráfrasis (cobrar↔caja registradora, etc.).

// Sufijos que delatan un verbo conjugado (no un sustantivo/objeto nuevo) —
// se comprueban sobre la palabra CON acentos, antes de normalizar, porque
// normalizar() quita la tilde de "-ó" y lo confundiría con cualquier "-o".
// Se incluyen también los gerundios ES (-ando/-iendo, p. ej. "usando",
// "aplicando") — son la misma idea de "verbo conjugado" que -ó/-ió/-aba/-ía,
// solo que el listado original del punto 2 de la re-auditoría no los
// mencionó explícitamente; se añaden aquí porque sin ellos "usando" quedaba
// mal clasificado como sustantivo técnico sin fuente (regresión detectada
// al re-correr el caso 7 tras aplicar el resto de esta re-auditoría).
const RE_VERBO_CONJUGADO = /(ó|ió|aba|ía|aban|ían|ando|iendo)$/i;
const RE_VERBO_CONJUGADO_EN = /(ed|ing)$/i;

// Familias de paráfrasis (re-auditoría, punto 2): un token del CV se
// considera respaldado si él o cualquier miembro de su misma familia
// aparece en el ámbito del puesto — cubre el caso real "cobro en caja"
// (dato) → "Atendió la caja registradora" (CV), donde "registradora" no
// comparte raíz literal con "cobro" pero es la misma idea.
// Persona real E2, punto 2b: se amplían las familias con los sustantivos
// concretos que el candidato usa habitualmente para cada verbo (cobro →
// efectivo/pagos/caja; atender → clientes/público; arreglar/ordenar →
// presentación/acomodar) y se añade 'vendedor'/'vendedora'/'vend' a la
// familia de "vender" para que cubra 'ventas' aunque la raíz literal de 4
// letras no coincida entre "vend-" y "vent-" (ver `familiaCubierta`).
const FAMILIAS_PARAFRASIS = [
  ['cobrar', 'cobro', 'cobros', 'caja registradora', 'cash register', 'charge', 'charging', 'charged',
    'efectivo', 'pagos', 'pago', 'caja', 'cash'],
  ['arreglar', 'ordenar', 'arreglo', 'orden', 'organizar', 'organizacion', 'tidy', 'arrange', 'arranged',
    'organizing', 'organized', 'presentacion', 'acomodar', 'acomodo'],
  ['atender', 'atencion', 'servicio', 'servicios', 'attend', 'attention', 'service', 'services', 'assist',
    'assisting', 'assisted', 'cliente', 'clientes', 'customer', 'customers', 'publico', 'public'],
  ['reparar', 'reparacion', 'repair', 'repairing', 'repaired'],
  ['instalar', 'instalacion', 'install', 'installing', 'installed', 'installation'],
  ['vender', 'vendedor', 'vendedora', 'vend', 'venta', 'ventas', 'sale', 'sales', 'selling', 'sold'],
  ['supervisar', 'supervision', 'supervise', 'supervising', 'supervised'],
].map(fam => fam.map(normalizar));

// ¿El token pertenece a alguna familia Y esa familia tiene un miembro
// presente en el ámbito del puesto? Si sí, se considera respaldado aunque
// su propia raíz no coincida literalmente con nada en `datos`.
//
// Persona real E2, punto 2b: la comprobación de "¿aparece en el ámbito?"
// ahora compara por RAÍZ de 4 letras palabra a palabra (con `startsWith`
// en ambos sentidos) en vez de exigir coincidencia literal completa del
// miembro — así "vendedora" (token del CV, familia "vender") cubre
// "ventas" (palabra real del candidato) aunque ninguna de las dos
// contenga literalmente a la otra.
function familiaCubierta(tokenNorm, alcanceNorm) {
  const alcancePalabras = alcanceNorm.split(/\s+/).filter(Boolean);
  for (const fam of FAMILIAS_PARAFRASIS) {
    const perteneceFamilia = fam.some(miembro =>
      miembro.split(/\s+/).some(palabra => palabra.slice(0, RAIZ_LEN) === tokenNorm.slice(0, RAIZ_LEN))
    );
    if (!perteneceFamilia) continue;
    const enAlcance = fam.some(miembro => {
      if (miembro.includes(' ')) return construirRegexFrase(miembro).test(alcanceNorm); // frase multi-palabra
      const raizMiembro = miembro.slice(0, RAIZ_LEN);
      return alcancePalabras.some(p => p.startsWith(raizMiembro) || raizMiembro.startsWith(p.slice(0, RAIZ_LEN)));
    });
    if (enAlcance) return true;
  }
  return false;
}

// Calificadores de contexto/tipo NO cuantitativos (re-auditoría, punto 2,
// caso "vehículos livianos"): sustantivos de categoría genérica y adjetivos
// de tamaño/tipo que no constituyen una afirmación verificable específica
// (a diferencia de una cifra, una marca/herramienta o un adjetivo de
// alcance/intensidad de ADJETIVOS_ALCANCE). DECISIÓN DOCUMENTADA: se
// prefiere conservarlos a arriesgar borrar una viñeta legítima por una
// palabra de contexto sin carga de "hecho verificable" (p. ej. "trabajó en
// vehículos livianos" no es una afirmación que necesite respaldo literal
// palabra por palabra, a diferencia de "gasolina y diésel" — un dato técnico
// específico que si no se declaró, sí se elimina).
const CONTEXTO_TOLERADO = new Set([
  'vehiculo', 'vehiculos', 'vehicle', 'vehicles', 'cliente', 'clientes', 'customer', 'customers',
  'producto', 'productos', 'product', 'products', 'equipo', 'equipos', 'equipment', 'tienda', 'tiendas',
  'store', 'stores', 'shop', 'shops', 'sistema', 'sistemas', 'system', 'systems', 'proceso', 'procesos',
  'process', 'processes', 'area', 'areas', 'department', 'departamento', 'departamentos',
  'liviano', 'liviana', 'livianos', 'livianas', 'light', 'pesado', 'pesada', 'pesados', 'pesadas', 'heavy',
  'pequeno', 'pequena', 'pequenos', 'pequenas', 'small', 'grande', 'grandes', 'large', 'big',
  'sitio', 'sitios', 'site', 'sites', 'website', 'websites', 'pagina', 'paginas', 'page', 'pages',
  // "entorno/ambiente/environment": descriptor genérico del lugar de trabajo
  // (p. ej. "...store environment"), no una afirmación verificable en sí.
  'entorno', 'entornos', 'ambiente', 'ambientes', 'environment', 'environments',
  // Objeto genérico de un diagnóstico/reparación (no es un hecho nuevo,
  // sino el resultado esperado de usar las herramientas que sí declaró).
  'falla', 'fallas', 'failure', 'failures', 'residencial', 'residenciales', 'residential',
].map(normalizar));

// Prefijos (5 letras, normalizados) de verbos de acción habituales en CVs.
// Un token que EMPIEZA por uno de estos prefijos se trata como verbo de
// transformación de redacción (lo que el prompt pide: "transforma y
// mejora"), no como un hecho/objeto que necesite respaldo literal.
const VERBO_PREFIJOS = [
  // ES
  'gestio','lider','dirig','coordi','desarr','implem','ejecut','brind','instal','repar','manten',
  'aplic','manej','elabor','superv','disen','redact','negoci','capacit','docume','analiz','optimi',
  'reduc','increm','mejor','resolv','atend','contro','planif','organi','entren','constr','monito',
  'proces','revis','audit','diagno','fideli','cumpli','asegur','garant','identif','establ','impuls','verif','concil',
  // EN
  'manag','lead','led','direct','coordi','develo','implem','execut','deliv','instal','repair','mainta',
  'apply','handl','elabor','superv','design','draft','negoti','train','docume','analyz','optimi',
  'reduc','increa','improv','resolv','assist','contro','plan','organi','build','operat','monito',
  'suppor','provid','conduc','perfor','achiev','creat','establ','ensure','identi','streng','verif','reconc'
];
function esVerboPermitido(norm) {
  return VERBO_PREFIJOS.some(p => norm.startsWith(p));
}

// Re-auditoría, punto 2: exención de verbos conjugados. Un token que es la
// forma conjugada de un verbo (pretérito/imperfecto ES, pasado/gerundio EN)
// es una transformación de redacción de lo que el candidato ya contó, no un
// hecho/objeto nuevo — no debe tratarse como "sustantivo técnico sin
// fuente" aunque su raíz no aparezca literalmente en `datos`.
function esVerboConjugado(rawWord) {
  return RE_VERBO_CONJUGADO.test(rawWord) || RE_VERBO_CONJUGADO_EN.test(rawWord);
}

// ── Adjetivos/sustantivos de alcance-volumen-intensidad ──
// Copiados de las reglas 5o2 y de la pasada de veracidad de chat-cv.html
// (líneas ~2394 y ~3701-3707): frases que "amplían el alcance" CUANDO el
// candidato no dio esa magnitud. Auditoría fase 1: ya NO es lista negra
// ciega — cada frase se busca solo si NO aparece en `datos` (ver
// `limpiarAdjetivosEnUnidad`). Se retiraron 'multiple(s)' y 'exigente' de
// la lista por ser palabras cotidianas que un candidato puede usar
// legítimamente para describir su propio puesto (p. ej. "manejo múltiples
// clientes" declarado por el propio candidato).
export const ADJETIVOS_ALCANCE = [
  // ES
  'alta afluencia','alto volumen','alta exigencia','picos de demanda','entorno dinamico',
  'entorno complejo','controles internos','riguroso','rigurosa','sostenido','sostenida',
  'reconocido por','reconocida por','metodologia propia','cultura de','alta rotacion',
  'alta concurrencia','alta demanda operativa','alto flujo','entorno de alta exigencia',
  'de alto impacto','gran escala','a gran escala',
  // EN
  'high foot traffic','high volume','high-volume','high demand','high demands','demand peaks',
  'dynamic environment','complex environment','internal controls','rigorous','sustained',
  'recognized for','proprietary methodology','culture of','high-acuity','fast-paced',
  'large scale','large-scale','at scale'
].map(normalizar);

// Frases de "totales de años" que solo son válidas si derivan EXACTAMENTE
// de las fechas dadas (regla 5f3 / TOTALES DE AÑOS del prompt v1).
const RE_TOTAL_ANIOS = /(m[aá]s de\s+)?(\d{1,2})\+?\s*(a[nñ]os?)\s+(de\s+)?(experiencia|trayectoria)/gi;
const RE_TOTAL_YEARS = /(\d{1,2})\+?\s*years?\s+(of\s+)?(combined\s+|progressive\s+)?experience/gi;

// Tokens tecnicos/estandares comunes que SUELEN colarse sin fuente cuando
// el modelo "completa" el sector (regla 5c PROHIBIDO AMPLIAR EL ALCANCE).
const ACRONIMOS_CONOCIDOS = /^[A-Z]{2,6}(\.\d+)?$/;

// Placeholders que nunca deben llegar al cliente (regla 7 del prompt v1 y
// `validarCV`/`limpiarFormatoCV` de chat-cv.html).
const PLACEHOLDERS = new Set([
  'n/a', 'na', 'no especificado', 'not specified', 'no disponible', 'undefined', 'null', 'nan',
  'tbd', 'to be determined', 'pendiente', 'por definir', 'sin especificar'
]);

// Persona real E2 (v1 desplegada en sombra), punto 1a: el modelo emitió un
// placeholder de institución no cubierto por la lista anterior
// ("<UNKNOWN>"). Se añaden formas de marcador entre "<...>" y las variantes
// textuales de "desconocido/a"/"sin institución"/"no institution".
const RE_PLACEHOLDER_GENERICO = /^<[^>]*>$|^(unknown|desconocid[oa]|sin instituci[oó]n|no institution)$/i;
function esPlaceholder(s) {
  if (typeof s !== 'string') return false;
  if (PLACEHOLDERS.has(normalizar(s))) return true;
  return RE_PLACEHOLDER_GENERICO.test(s.trim());
}

// Negaciones que significan "el candidato no tiene nada que aportar aquí"
// (usadas para `info_extra` → `extra[]`).
const RE_NEGACION = /^(nada( m[aá]s)?|ninguno|ninguna|no|none|nothing|n\/a|na|done|listo|no tengo nada)\.?$/i;

// Re-auditoría, punto 3: líneas negativas dentro de una respuesta multilínea
// de `datos.estudios` ("Bachillerato... \nNada más") que NO deben contarse
// como una titulación perdida.
const RE_NEGACION_LINEA = /^(nada( m[aá]s)?|eso es todo|eso ser[ií]a todo|ninguno|ninguna|no aplica|no|none|nothing|n\/a|na|listo|no tengo nada|no tengo m[aá]s)\.?$/i;

// Palabras de título/grado reconocibles — un segmento de `datos.estudios`
// solo cuenta como "titulación declarada" para la heurística de
// `educacion_incompleta` si contiene alguna de estas.
const RE_NIVEL_HABILIDAD = /\b(basico|basica|intermedio|intermedia|avanzado|avanzada|basic|intermediate|advanced|nivel|level)\b/;
const RE_EN_CURSO = /\b(en curso|estudiando|cursando|actualmente|estoy en|voy en|\d+(?:º|°|do|er|to|mo)?\s*a[nñ]o|semestre|ciclo|in progress|currently|pursuing|ongoing|enrolled|attending|expected|sophomore|junior year|senior year|freshman)\b/i;
const RE_TITULACION = /\b(licenciatura|ingenier[ií]a|t[eé]cnic[oa]|bachillerato|maestr[ií]a|doctorado|diplomado|diploma|certificad[oa]|degree|bachelor|master|ph\.?d|associate|certificate|bootcamp|carrera|posgrado|postgrado)\b/i;

// ─────────────────────── Fechas ───────────────────────

const MESES_ES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
};
const MESES_EN = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Normaliza una fecha a "YYYY-MM" o "YYYY". Si no se puede interpretar con
 * confianza, devuelve null (nunca se fabrica una fecha). Acepta ya-normalizadas
 * ("2020-03","2020"), "Mes AAAA"/"AAAA Mes" en ES/EN ("Marzo 2020","March 2020"),
 * y "MM/AAAA"/"MM-AAAA".
 */
export function normalizarFecha(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{4}$/.test(s)) return s;

  let m = s.match(/^([a-zA-ZÁÉÍÓÚÑáéíóúñ]+)\.?\s+de\s+(\d{4})$/i) || s.match(/^([a-zA-ZÁÉÍÓÚÑáéíóúñ]+)\.?\s+(\d{4})$/i);
  if (m) {
    const mes = normalizar(m[1]);
    const num = MESES_ES[mes] || MESES_EN[mes];
    if (num) return `${m[2]}-${String(num).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})\s+([a-zA-ZÁÉÍÓÚÑáéíóúñ]+)\.?$/i);
  if (m) {
    const mes = normalizar(m[2]);
    const num = MESES_ES[mes] || MESES_EN[mes];
    if (num) return `${m[1]}-${String(num).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const mm = Number(m[1]);
    if (mm >= 1 && mm <= 12) return `${m[2]}-${String(mm).padStart(2, '0')}`;
  }
  // Última red: buscar un año de 4 dígitos suelto en el texto.
  m = s.match(/\b(19|20)\d{2}\b/);
  if (m) return m[0];
  return null;
}

/** Igual que normalizarFecha pero fuerza el resultado a solo "YYYY". */
export function normalizarAnio(raw) {
  const f = normalizarFecha(raw);
  return f ? f.slice(0, 4) : null;
}

function anioActual() { return new Date().getFullYear(); }
function mesActualISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fechaEsFutura(f) {
  if (!f) return false;
  const hoy = mesActualISO();
  if (/^\d{4}-\d{2}$/.test(f)) return f > hoy;
  if (/^\d{4}$/.test(f)) return Number(f) > anioActual();
  return false;
}

// v3, punto 4: primer año de 4 dígitos mencionado literalmente en el texto
// crudo de expN ("Target — Sales Associate — for 1 year (2025)" → "2025").
// Se usa para corregir un `inicio` que el modelo calculó mal (p. ej. restó
// "1 año" a la fecha actual en vez de usar el año que el candidato SÍ dio).
function primerAnioEnTexto(s) {
  const m = String(s || '').match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}

// ─────────────────── Construcción del alcance por puesto ───────────────────
// Regla de ámbito (idéntica a pasadaVeracidad en chat-cv.html ~L3694): un
// hecho solo respalda afirmaciones del campo donde aparece. Una viñeta del
// puesto 1 solo puede apoyarse en exp1+logros1 (+resumen_personal si
// datos.logros1_fuente_cruzada es true); el puesto 2 en exp2+logros2. El
// chat solo alimenta dos empleos — cualquier puesto de índice ≥2 no tiene
// fuente posible (ver §puesto_sin_fuente en validarCV).
// Palabras genéricas de negocio que NO identifican a un empleador concreto
// (se usan para verificar empresa y para decidir si resumen_personal habla
// de ESE puesto).
const GENERICAS_NEGOCIO = new Set([
  'taller', 'tienda', 'empresa', 'compania', 'compañia', 'negocio', 'negocios', 'restaurante',
  'oficina', 'clinica', 'hospital', 'despacho', 'constructora', 'fabrica', 'company', 'store',
  'shop', 'business', 'office', 'clinic', 'firm', 'restaurant', 'factory', 'workshop', 'local',
  'freelance', 'independiente', 'propio', 'propia',
]);

// v11 (fase 3, patrón 5): resumen_personal cuenta como ámbito del puesto
// cuando habla de ESE puesto: (a) el candidato lo marcó (logros1_fuente_cruzada),
// (b) solo hay un empleo (exp2 vacío o negación) → no hay riesgo de
// atribución cruzada, o (c) alguna palabra identificativa de la empresa
// (del CV o del propio expN) aparece en el resumen. Regresión fase 3: E3
// perdió "6 niveles, control de calidad de concreto, subcontratistas" y N2
// perdió "install/commission furnaces, EPA 608, troubleshoot" por vivir
// en resumen_personal.
function resumenHablaDelPuesto(datos, indice, empresaCV) {
  const resumen = normalizar(datos.resumen_personal);
  if (!resumen) return false;
  if (indice === 0 && datos.logros1_fuente_cruzada) return true;
  const exp2 = String(datos.exp2 || '').trim();
  if (indice === 0 && (!exp2 || RE_NEGACION.test(exp2))) return true;
  const expN = indice === 0 ? datos.exp1 : datos.exp2;
  const candidatas = palabrasSignificativas(`${empresaCV || ''} ${String(expN || '').split(/\s[-–—|]\s|,/)[0]}`, 4)
    .filter(w => !GENERICAS_NEGOCIO.has(w) && !CONECTORES.has(w) && !STOPWORDS_LARGAS.has(w) && !/^\d+$/.test(w));
  return candidatas.some(w => resumen.includes(w));
}

function alcancePuesto(datos, indice, empresaCV) {
  const partes = [];
  if (indice === 0) {
    partes.push(datos.exp1, datos.logros1);
  } else if (indice === 1) {
    partes.push(datos.exp2, datos.logros2);
  } else {
    return '';
  }
  if (resumenHablaDelPuesto(datos, indice, empresaCV)) partes.push(datos.resumen_personal);
  return normalizar(partes.filter(Boolean).join(' '));
}

// v11 (patrón 2): fechas/estado laboral declarados literalmente en expN.
// Devuelve {inicio, fin, actual} o null si el texto no trae un año.
//   "2024 to 2025" / "2019-2021" / "2017 a 2020"        → rango cerrado
//   "2022 a presente" / "since 2021" / "marzo 2021 a la fecha" → abierto
//   "2025" (un solo año, sin "desde/presente")           → inicio=fin=2025
const RE_PRESENTE = /\b(presente|present|actualidad|actual|la fecha|hoy|current|currently|now|ongoing|today)\b/;
const RE_DESDE = /\b(desde|since|from|a partir de)\b/;
function fechasDeclaradas(expTexto) {
  const t = normalizar(expTexto).replace(/[()]/g, ' ');
  if (!t) return null;
  const reFecha = /(?:\b([a-z]{3,10})\.?\s+(?:de\s+)?)?\b((?:19|20)\d{2})\b/g;
  const fechas = [];
  let m;
  while ((m = reFecha.exec(t)) !== null) {
    const mes = m[1] && (MESES_ES[m[1]] || MESES_EN[m[1]]);
    fechas.push({ iso: mes ? `${m[2]}-${String(mes).padStart(2, '0')}` : m[2], pos: m.index });
  }
  if (!fechas.length) return null;
  const primera = fechas[0];
  const ultima = fechas[fechas.length - 1];
  const despuesPrimera = t.slice(primera.pos + 4);
  if (fechas.length >= 2 && ultima.iso.slice(0, 4) >= primera.iso.slice(0, 4)) {
    return { inicio: primera.iso, fin: ultima.iso, actual: false };
  }
  if (RE_PRESENTE.test(despuesPrimera) || RE_DESDE.test(t.slice(0, primera.pos))) {
    return { inicio: primera.iso, fin: null, actual: true };
  }
  return { inicio: primera.iso, fin: primera.iso, actual: false };
}

// v11: duración declarada sin fechas ("3 meses", "for 1 year") → texto literal
// para el periodo del puesto cuando no hay inicio/fin.
function duracionDeclarada(expTexto) {
  const m = String(expTexto || '').match(/\b(\d{1,2})\s*(meses|mes|months?|a[nñ]os?|years?|yrs?|semanas?|weeks?)\b/i);
  return m ? `${m[1]} ${m[2].toLowerCase()}` : null;
}

// v11 (patrón 4): un puesto "creado" a partir de un curso/certificado/
// bootcamp del candidato (N4: "UX Design Student — Coursework Projects |
// UX Design Certificate Program") no es experiencia laboral. Se elimina
// salvo que el propio candidato haya usado esa palabra en expN.
const RE_ORIGEN_ESTUDIOS = /\b(student|estudiante|alumn[oa]|coursework|course\s+project|proyectos?\s+de\s+(curso|pr[aá]ctica)|practice\s+projects?|certificate\s+program|programa\s+de\s+certificaci|bootcamp|diplomado)\b/i;

// v11 (patrón 4): empresa = frase cruda del candidato ("apprentice at a
// different HVAC company") en vez de un nombre.
const RE_EMPRESA_CRUDA = /\b(at an?|a different|another|other|en un|en una|otra|otro|different|my|mi|i)\b/i;

const CLAVES_DATOS = ['nombre', 'puesto', 'pais', 'email_tel', 'tipo_empresa', 'resumen_personal',
  'exp1', 'logros1', 'exp2', 'logros2', 'estudios', 'habilidades_tecnicas', 'idiomas_nivel', 'info_extra'];

function textoCompletoDatos(datos) {
  return normalizar(CLAVES_DATOS.map(k => datos[k] || '').join(' '));
}

// v3, punto 6: nivel de idioma declarado en la MISMA frase/segmento que el
// nombre del idioma, buscado tanto en `idiomas_nivel` como en
// `habilidades_tecnicas` (el candidato a veces mete el idioma ahí, p. ej.
// "cash register, customer service, spanish basic").
const NIVEL_PALABRAS = [
  'basico', 'basic', 'intermedio', 'intermediate', 'avanzado', 'advanced', 'fluido', 'fluent',
  'nativo', 'native', 'conversacional', 'conversational', 'profesional', 'professional',
].map(normalizar);
const RE_NIVEL_ESCASO = /\b(some|un poco(?: de)?|algo de|basico|basic)\b/i;

function extraerNivelParaIdioma(idioma, texto) {
  if (!idioma || !texto) return null;
  const idiomaNorm = normalizar(idioma);
  if (!idiomaNorm) return null;
  // v11 (patrón 1): también se separa por "+", "/", "|", " y ", " and " —
  // "Español + Inglés intermedio" son DOS segmentos; antes el nivel del
  // segundo idioma se copiaba al primero (M1, B1 en la regresión fase 3).
  const segmentos = String(texto).split(/[,;.\n]|\s*[+\/|]\s*|\s+(?:y|e|and)\s+/i).map(s => s.trim()).filter(Boolean);
  for (const seg of segmentos) {
    const segNorm = normalizar(seg);
    if (!segNorm.includes(idiomaNorm.slice(0, RAIZ_LEN))) continue;
    const nivelEncontrado = NIVEL_PALABRAS.find(n => segNorm.includes(n));
    if (nivelEncontrado) return nivelEncontrado;
    // "some spanish" / "un poco de español": sin palabra de nivel explícita
    // pero con calificador de escasez ⇒ se interpreta como nivel básico.
    if (RE_NIVEL_ESCASO.test(seg)) return 'basic';
  }
  return null;
}

// ─────────────────── Extracción de "tokens de reclamo" (cifras/propios) ───────────────────

function tokensDeReclamo(bullet) {
  const numeros = (bullet.match(/\d[\d.,%$]*/g) || []).map(n => n.replace(/[.,]+$/, ''));
  const palabras = bullet.trim().split(/\s+/);
  const capitalizados = [];
  palabras.forEach((w, i) => {
    const limpio = w.replace(/^[^a-zA-Z0-9#]+|[^a-zA-Z0-9#]+$/g, '');
    if (!limpio) return;
    if (i === 0) return; // arranque de oración: no cuenta como nombre propio
    const esCap = /^[A-ZÁÉÍÓÚÑ]/.test(limpio) && !CONECTORES.has(limpio.toLowerCase());
    const esAcronimo = ACRONIMOS_CONOCIDOS.test(limpio);
    if (esCap || esAcronimo) capitalizados.push(limpio);
  });
  return { numeros, capitalizados };
}

function tokenRespaldado(token, alcanceNorm) {
  return alcanceNorm.includes(normalizar(token));
}

// ─────────────── Sustantivos técnicos en minúsculas sin fuente ───────────────
// Auditoría fase 1, punto 5: cualquier token de ≥5 letras que no sea
// conector/stopword ni verbo de acción permitido debe tener su raíz (5
// primeras letras normalizadas) presente en el ALCANCE del puesto — no en
// datos global, para no dejar colar "Git" (habilidades) como si respaldara
// un empleo que nunca lo mencionó (ver regla de ámbito).

// Raíz de 4 letras (re-auditoría, punto 2 — antes 5): más tolerante a
// variaciones de conjugación/plural entre lo que dijo el candidato y cómo
// lo redactó el modelo.
const RAIZ_LEN = 4;

// v8 — tolerancia por oficio (ver lexico.mjs). `extra` = { raices: Set, } con
// las raíces de clúster toleradas para el puesto; se calcula una vez por
// puesto en validarCV y se pasa aquí.
function indicesTokensSinFuente(bullet, alcanceNorm, extra) {
  const raicesExtra = (extra && extra.raices) || null;
  const palabras = bullet.split(/\s+/);
  const indices = [];
  // v11: en el PERFIL la primera palabra de cada oración también se evalúa
  // ("Bilingual in English and Spanish." con "some spanish" declarado —
  // N1 en fase 3); en viñetas sigue exenta (es el verbo de acción).
  const incluirPrimera = !!(extra && extra.incluirPrimera);
  palabras.forEach((w, i) => {
    if (i === 0 && !incluirPrimera) return; // primera palabra de la viñeta: verbo/arranque, exenta
    const limpio = w.replace(/^[^a-zA-Z0-9ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÑñ]+|[^a-zA-Z0-9ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÑñ]+$/g, '');
    if (!limpio) return;
    if (/\d/.test(limpio)) return;                 // cifras: ya cubiertas aparte
    if (/^[A-ZÁÉÍÓÚÑ]/.test(limpio) && !(i === 0 && incluirPrimera)) return; // capitalizados: ya cubiertos aparte
    const norm = normalizar(limpio);
    if (norm.length < 5) return;
    if (CONECTORES.has(norm) || STOPWORDS_LARGAS.has(norm)) return;
    // v8: adjetivos de calidad/desempeño → siempre sin fuente (afirmación no hecha por el candidato)
    if (esAdjetivoCalidad(norm)) { indices.push(i); return; }
    if (esRelleno(norm)) return;                    // v8: relleno sin hechos
    if (esVerboPermitido(norm)) return;
    if (esVerboConjugado(limpio)) return;           // re-auditoría pt.2: verbo conjugado, no un hecho nuevo
    if (CONTEXTO_TOLERADO.has(norm)) return;        // re-auditoría pt.2: calificador de contexto no cuantitativo
    const raiz = norm.slice(0, RAIZ_LEN);
    if (alcanceNorm.includes(raiz)) return;         // respaldado (tolerante a variaciones/errores ortográficos menores)
    if (familiaCubierta(norm, alcanceNorm)) return; // re-auditoría pt.2: paráfrasis conocida (cobro ↔ caja registradora, etc.)
    if (raicesExtra && raicesExtra.has(raiz)) return; // v8: paráfrasis del mismo oficio (clúster activado por el candidato)
    indices.push(i);
  });
  return indices;
}

// Re-auditoría, punto 1 [CRÍTICO]: PROHIBIDA la edición intra-oración. Ya no
// se quitan palabras sueltas dejando un fragmento potencialmente roto
// ("Mantuvo el y la de la tienda") — si la viñeta contiene algún sustantivo
// técnico sin fuente, la decisión es a nivel de VIÑETA COMPLETA: se elimina
// entera y se registra el motivo + el/los token(s) que la dispararon.
function tokensSinFuenteEnUnidad(bullet, alcanceNorm, extra) {
  const indicesInvalidos = indicesTokensSinFuente(bullet, alcanceNorm, extra);
  if (indicesInvalidos.length === 0) return { sinFuente: false, tokens: [] };
  const palabras = bullet.split(/\s+/);
  const tokens = indicesInvalidos.map(i => palabras[i]);
  return { sinFuente: true, tokens };
}

// ─────────────── Adjetivos de alcance: filtrado NO ciego ───────────────
// Auditoría fase 1, punto 2: solo se toca una frase si NO aparece en
// `datos` normalizados. Se elimina la LOCUCIÓN (con sus conectores
// colgantes), no la unidad completa — salvo que el resultado quede roto
// (menos de 4 palabras en una viñeta / 3 en una oración de perfil), en
// cuyo caso se elimina la unidad completa como último recurso.

function construirRegexFrase(fraseNorm) {
  const mapa = { a: '[aàáâä]', e: '[eèéêë]', i: '[iìíîï]', o: '[oòóôö]', u: '[uùúûü]', n: '[nñ]' };
  let pat = '';
  for (const ch of fraseNorm) {
    if (ch === ' ') { pat += '[\\s-]+'; continue; }
    if (mapa[ch]) { pat += mapa[ch]; continue; }
    pat += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(pat, 'i');
}

function limpiarConectoresColgantes(texto) {
  const palabras = texto.trim().split(/\s+/);
  while (palabras.length > 0) {
    const ultima = palabras[palabras.length - 1].replace(/[^a-zA-Z0-9ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÑñ]/g, '');
    if (CONECTORES.has(normalizar(ultima))) { palabras.pop(); continue; }
    break;
  }
  let out = palabras.join(' ').trim();
  out = out.replace(/\s+([,.;:])/g, '$1').replace(/[,;:]\s*$/, '.');
  if (out && !/[.!?]$/.test(out)) out += '.';
  return out;
}

// Re-auditoría, punto 1 [CRÍTICO]: detector de "esqueleto roto" — patrones
// que delatan que una edición intra-oración dejó conectores colgando sin
// sustantivo entre ellos (el caso real "Mantuvo el y la de la tienda").
// Se usa como red de seguridad tanto para la eliminación de locuciones de
// alcance como (en teoría) para cualquier otra edición interior.
function pareceRoto(texto) {
  const t = ' ' + normalizar(texto) + ' ';
  return /\s(el|la|los|las|un|una|the|a|an)\s+(y|o|and|or)\s+(el|la|los|las|un|una|the|a|an)\s/.test(t)
    || /\s(de|del|of|en|con|para|y|o|and|or)\s*\.\s*$/.test(t)
    || /\s(de|del|of|en|con|para)\s+(el|la|los|las|un|una|the|a|an)\s*\.\s*$/.test(t);
}

// Re-auditoría, punto 1 [CRÍTICO]: solo se intenta la eliminación INTERIOR
// de una locución de alcance cuando esta es puramente adjetival/preposicional
// y por tanto "desmontable sin romper" el resto de la oración (p. ej. un
// modificador delante de un sustantivo: "high-volume store" → "store"; "en
// un entorno de alta exigencia" → la frase preposicional completa se puede
// quitar dejando el resto intacto). Las frases que son más bien una
// cláusula/afirmación propia (p. ej. "reconocido por", "cultura de",
// "metodología propia") NO se intentan desmontar — si aparecen sin
// declarar, se elimina la unidad (viñeta/oración) completa directamente,
// porque recortarlas a medias tiende a dejar una oración sin sujeto o sin
// objeto coherente.
const ADJETIVOS_ALCANCE_DESMONTABLES = new Set([
  'alta afluencia', 'alto volumen', 'alta exigencia', 'picos de demanda', 'entorno dinamico',
  'entorno complejo', 'alta rotacion', 'alta concurrencia', 'alta demanda operativa', 'alto flujo',
  'entorno de alta exigencia', 'de alto impacto', 'gran escala', 'a gran escala',
  'high foot traffic', 'high volume', 'high-volume', 'high demand', 'high demands', 'demand peaks',
  'dynamic environment', 'complex environment', 'high-acuity', 'fast-paced', 'large scale', 'large-scale', 'at scale',
].map(normalizar));

/**
 * @param {string} texto        Viñeta u oración a limpiar.
 * @param {string} datosNorm    Texto completo de `datos`, normalizado.
 * @param {number} minPalabras  Mínimo de palabras para no descartar la unidad completa.
 */
function limpiarAdjetivosEnUnidad(texto, datosNorm, minPalabras) {
  let resultado = texto;
  let recortado = false;
  for (const frase of ADJETIVOS_ALCANCE) {
    const regex = construirRegexFrase(frase);
    // Misma regex (tolerante a acentos y a espacio/guion) para decidir si
    // está "declarada" y para localizarla en el texto — así "high-volume"
    // en datos SÍ cubre "high volume"/"high-volume" en el CV por igual.
    if (regex.test(datosNorm)) continue; // el candidato SÍ lo declaró: se respeta, no se toca.
    if (!regex.test(resultado)) continue;
    recortado = true;

    // No adjetival/preposicional-desmontable → se elimina la unidad entera,
    // sin intentar cirugía interior (punto 1 de la re-auditoría).
    if (!ADJETIVOS_ALCANCE_DESMONTABLES.has(frase)) {
      return { texto: null, recortado: true, eliminarUnidadCompleta: true };
    }

    const intento = resultado.replace(regex, ' ').replace(/\s{2,}/g, ' ').trim();
    const limpio = limpiarConectoresColgantes(intento);
    const roto = !limpio || contarPalabras(limpio) < minPalabras || pareceRoto(limpio);
    if (!roto) {
      resultado = limpio;
    } else {
      return { texto: null, recortado: true, eliminarUnidadCompleta: true };
    }
  }
  return { texto: resultado, recortado, eliminarUnidadCompleta: false };
}

// Perfil: se procesa oración por oración (una oración rota por eliminación
// de adjetivo se descarta sola, no arrastra el resto del párrafo).
function limpiarAdjetivosEnParrafo(parrafo, datosNorm) {
  if (!parrafo) return { texto: parrafo, recortado: false };
  const oraciones = parrafo.split(/(?<=[.!?])\s+/);
  let recortado = false;
  const resultado = [];
  oraciones.forEach(o => {
    const r = limpiarAdjetivosEnUnidad(o, datosNorm, 3);
    if (r.recortado) recortado = true;
    if (!r.eliminarUnidadCompleta && r.texto && r.texto.trim()) resultado.push(r.texto.trim());
  });
  return { texto: resultado.join(' ').trim(), recortado };
}

// v9 (prueba real Rosa): "3 años de experiencia" SÍ es un dato si el
// candidato lo escribió ("tengo 3 años de experiencia en cajas") — solo se
// quita el total cuando ese número no aparece junto a "años/years" en las
// respuestas. Y si al quitarlo la oración queda rota ("Cajera con en
// supermercado"), se elimina la oración entera en vez de imprimir el hueco.
function quitarTotalesAnios(parrafo, datosNorm) {
  if (!parrafo) return { texto: parrafo, recortado: false };
  let recortado = false;
  const declarado = (m) => {
    const n = String(m).match(/\d{1,2}/);
    if (!n || !datosNorm) return false;
    return new RegExp('\\b' + n[0] + '\\+?\\s*(anos?|years?|yrs?)\\b').test(datosNorm);
  };
  const oraciones = parrafo.split(/(?<=[.!?])\s+/);
  const resultado = [];
  oraciones.forEach(o => {
    let out = o.replace(RE_TOTAL_ANIOS, (m) => { if (declarado(m)) return m; recortado = true; return ''; });
    out = out.replace(RE_TOTAL_YEARS, (m) => { if (declarado(m)) return m; recortado = true; return ''; });
    out = out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').trim();
    if (!out) return;
    if (out !== o.trim() && (pareceRoto(out) || /\b(con|with)\s+(en|in|de|of)\b/i.test(out) || contarPalabras(out) < 3)) return;
    resultado.push(out);
  });
  return { texto: resultado.join(' ').trim(), recortado };
}

// v3, punto 5: el perfil pasa por la MISMA verificación de "sustantivos ≥5
// letras sin fuente" que las viñetas (`tokensSinFuenteEnUnidad`), pero
// contra el texto GLOBAL de `datos` (el perfil no pertenece a un puesto
// concreto). Se procesa oración por oración — una oración con un término
// inventado ("a major national retailer") se descarta sola, sin arrastrar
// el resto del perfil.
function limpiarTokensSinFuenteEnParrafo(parrafo, alcanceGlobalNorm) {
  if (!parrafo) return { texto: parrafo, recortado: false };
  const oraciones = parrafo.split(/(?<=[.!?])\s+/);
  let recortado = false;
  const resultado = [];
  oraciones.forEach(o => {
    if (!o || !o.trim()) return;
    const r = tokensSinFuenteEnUnidad(o, alcanceGlobalNorm, { incluirPrimera: true });
    if (r.sinFuente) { recortado = true; return; }
    resultado.push(o.trim());
  });
  return { texto: resultado.join(' ').trim(), recortado };
}

// v3, punto 5: si el perfil queda vacío tras toda la limpieza (adjetivos +
// totales de años + tokens sin fuente), se reconstruye determinísticamente
// a partir de datos ya verificados en vez de dejarlo en blanco.
// v4 (prueba real N1/E2 en producción): el fallback anterior producía
// "Retail Sales Associate with experience in Cashier at Target. customer
// service, cash handling, teamwork." — gramaticalmente roto. Ahora arma una
// oración correcta en ES/EN a partir de los MISMOS datos verificados (título,
// hasta 2 puestos cargo+empresa, habilidades declaradas tal cual).
function listarNatural(items, enIngles) {
  const xs = items.map(s => String(s || '').trim()).filter(Boolean);
  if (!xs.length) return '';
  if (xs.length === 1) return xs[0];
  const ultimo = xs[xs.length - 1];
  const conj = enIngles ? ' and ' : (/^h?i(?!e)/i.test(normalizar(ultimo)) ? ' e ' : ' y ');
  return xs.slice(0, -1).join(', ') + conj + xs[xs.length - 1];
}

function perfilFallback(datos, out, enIngles) {
  const titulo = String(out.titulo_objetivo || '').trim();
  const puestos = (Array.isArray(out.experiencia) ? out.experiencia : [])
    .filter(p => p && p.cargo)
    .slice(0, 2)
    .map(p => {
      // v4.1 (hallazgo 6): si el cargo coincide con el título objetivo no se
      // repite ("Auxiliar Contable con experiencia como Auxiliar contable en…").
      // v11: coincidencia por inclusión de palabras ("Ingeniero Residente" ⊂
      // "Ingeniero Civil Residente"; "Registered Nurse" ⊂ "Registered Nurse,
      // Med-Surg") — evita "X con experiencia como X" (E3, N5 en fase 3).
      const wCargo = palabrasSignificativas(p.cargo, 3);
      const wTitulo = palabrasSignificativas(titulo, 3);
      const mismoCargo = normalizar(p.cargo) === normalizar(titulo)
        || (wCargo.length > 0 && wTitulo.length > 0
          && (wCargo.every(w => wTitulo.includes(w)) || wTitulo.every(w => wCargo.includes(w))));
      // v19: "Freelance/independiente" no es una empresa → "experiencia freelance como X";
      // nombres de empresa en minúscula ("taller hermanos flores") → Title Case.
      const esFreelance = /^(freelance|freelancer|independiente|por cuenta propia|self[- ]employed|autonom[oa])$/i.test(String(p.empresa || '').trim());
      const empresaTxt = (String(p.empresa || '').length > 1 && !/[A-ZÁÉÍÓÚÑ]/.test(String(p.empresa).slice(1))) ? capitalizarNombre(p.empresa, true) : p.empresa;
      if (esFreelance) return mismoCargo ? 'freelance' : (enIngles ? `as a freelance ${p.cargo}` : `freelance como ${p.cargo}`);
      if (!p.empresa) return mismoCargo ? null : (enIngles ? `as ${p.cargo}` : `como ${p.cargo}`);
      if (mismoCargo) return enIngles ? `at ${empresaTxt}` : `en ${empresaTxt}`;
      return enIngles ? `as ${p.cargo} at ${empresaTxt}` : `como ${p.cargo} en ${empresaTxt}`;
    })
    .filter(Boolean);
  const habilidades = String(datos.habilidades_tecnicas || '')
    .split(/[,;\n]+|\s+y\s+|\s+and\s+/i)
    .map(s => s.trim().replace(/\.$/, ''))
    .filter(s => s && !/^(no|none|ninguna|ninguno|n\/a|nada|nada m[aá]s|eso es todo|listo|nothing|nothing else|that'?s all|done)$/i.test(s))
    // v11.4 (J1): adjetivos/blandas ("responsable", "ordenado", "patient with customers") no van en "Manejo de…"
    .filter(s => !/^(responsable|puntual|ordenad[oa]|honest[oa]|proactiv[oa]|amable|paciente|comprometid[oa]|trabajador[a]?|reliable|punctual|organized|honest|patient|hardworking|hard-working|team player|friendly|dedicated)\b/i.test(s));
  const partes = [];
  if (puestos.length) {
    partes.push(enIngles
      ? `${titulo || 'Professional'} with experience ${puestos.join(' and ')}.`
      : `${titulo || 'Profesional'} con experiencia ${puestos.join(' y ')}.`);
  } else if (titulo) {
    partes.push(enIngles ? `${titulo}.` : `${titulo}.`);
  }
  if (habilidades.length) {
    // v11: si alguna habilidad ya empieza por "manejo/uso/dominio de", se
    // evita "Manejo de manejo de caja" (E2 en fase 3).
    const repite = habilidades.some(h => /^(manejo|uso|dominio|conocimiento)s?\s+(de|en)\b/i.test(h));
    partes.push(enIngles
      ? `Skilled in ${listarNatural(habilidades, true)}.`
      : `${repite ? 'Conocimientos en' : 'Manejo de'} ${listarNatural(habilidades, false)}.`);
  }
  return partes.join(' ').trim();
}

// v4: cuando el `texto` de una viñeta falla la verificación de tokens pero su
// `evidencia` SÍ es literal del candidato, en vez de borrar la viñeta (lo que
// dejaba CVs "cortos y a medias": N1 1/3, E2 1/3 en producción) se degrada el
// texto a la propia evidencia, limpiada de forma determinista: sin "I "/"yo "
// inicial, mayúscula inicial, punto final. Cero riesgo de invención porque la
// evidencia ya pasó el filtro de literalidad (paso 0). Umbral: ≥2 palabras
// (prueba real E2: "registro facturas" es una función válida de 2 palabras).
// v4.1 (auditoría Opus, hallazgo 5): la evidencia es texto crudo del
// candidato. Si contiene negaciones, muletillas valorativas, datos de salario
// o de despido, o insultos, NO sirve como viñeta — se descarta la viñeta.
// v5.1: muletillas de duda que, si aparecen justo ANTES de la evidencia en el
// texto del candidato, invalidan la viñeta (texto ya normalizado laxo).
const RE_HEDGE_PREVIO = /(creo que|me parece que|supongo que|tal vez|quizas?|a veces|de vez en cuando|casi nunca|i think|i guess|maybe|sometimes|occasionally|not sure if|kind of)(\s+\w+){0,3}\s*$/;

const RE_EVIDENCIA_NO_APTA = new RegExp([
  // negaciones / carencias
  '\\b(no|nunca|jam[aá]s|tampoco|sin)\\s+(tengo|tuve|hice|s[eé]|pude|me\\s+dej|experiencia|conocimiento)',
  '\\b(not|never|no)\\s+(have|had|know|able|experience|allowed)\\b', "\\b(don'?t|didn'?t|can'?t|couldn'?t|wasn'?t)\\b",
  // muletillas / hedges valorativos
  '\\b(creo que|me parece|supongo|tal vez|quiz[aá]s?|la verdad|pues|o sea|b[aá]sicamente|m[aá]s o menos)\\b',
  '\\b(i think|i guess|maybe|kind of|sort of|basically|honestly|not sure|i believe)\\b',
  // salario / despido / conflictos laborales
  '\\b(salario|sueldo|me pagaban|ganaba|pago mensual|despid|me echaron|renunci|demanda|jefe\\s+(malo|t[oó]xico))\\b',
  '\\b(salary|wage|paid me|got fired|fired|laid off|quit|lawsuit|toxic)\\b',
  '\\b(salario|sueldo|me pagaban|ganaba|pago mensual|salary|wage|paid me)\\b[^.]{0,20}[$€£]?\\s?\\d',
  // v11: retrasos/incidencias negativas y "los clientes regresan" (opinión, no función)
  '\\b(retraso|retrasos|atraso|atrasos|delay|delayed|behind schedule|incumpl|reclamo del jefe)\\w*',
  '\\b(clientes|customers|clients)\\s+(siempre\\s+|always\\s+)?(regresan|vuelven|return|come back|keep coming)\\b',
  // insultos frecuentes (ES/EN)
  '\\b(mierda|pendej|cabr[oó]n|puta|idiota|imb[eé]cil|est[uú]pid|fuck|shit|damn|asshole|stupid|idiot)\\w*',
].join('|'), 'i');

// v4.1 (hallazgo 4): tabla CERRADA de verbos en 1ª persona (ES presente y
// pretérito frecuentes en respuestas de chat) → sintagma nominal de CV. Solo
// se transforma lo que está en la tabla; lo demás se deja como está. No hay
// conjugación genérica (irregulares, "registro" es nombre y verbo, etc.).
const NOMINAL_ES = {
  hago: 'Realización de', hice: 'Realización de', hacia: 'Realización de', realizo: 'Realización de', realice: 'Realización de',
  registro: 'Registro de', registre: 'Registro de', registraba: 'Registro de',
  apoyo: 'Apoyo en', apoye: 'Apoyo en', apoyaba: 'Apoyo en',
  atiendo: 'Atención a', atendi: 'Atención a', atendia: 'Atención a',
  manejo: 'Manejo de', maneje: 'Manejo de', manejaba: 'Manejo de',
  superviso: 'Supervisión de', supervise: 'Supervisión de', supervisaba: 'Supervisión de',
  elaboro: 'Elaboración de', elabore: 'Elaboración de', elaboraba: 'Elaboración de',
  coordino: 'Coordinación de', coordine: 'Coordinación de', coordinaba: 'Coordinación de',
  controlo: 'Control de', controle: 'Control de', controlaba: 'Control de',
  vendo: 'Venta de', vendi: 'Venta de', vendia: 'Venta de',
  cobro: 'Cobro de', cobre: 'Cobro de', cobraba: 'Cobro de',
  limpio: 'Limpieza de', limpie: 'Limpieza de', limpiaba: 'Limpieza de',
  reparo: 'Reparación de', repare: 'Reparación de', reparaba: 'Reparación de',
  instalo: 'Instalación de', instale: 'Instalación de', instalaba: 'Instalación de',
  administro: 'Administración de', administre: 'Administración de', administraba: 'Administración de',
  gestiono: 'Gestión de', gestione: 'Gestión de', gestionaba: 'Gestión de',
  organizo: 'Organización de', organice: 'Organización de', organizaba: 'Organización de',
  preparo: 'Preparación de', prepare: 'Preparación de', preparaba: 'Preparación de',
  reviso: 'Revisión de', revise: 'Revisión de', revisaba: 'Revisión de',
  capacito: 'Capacitación de', capacite: 'Capacitación de', capacitaba: 'Capacitación de',
  mantengo: 'Mantenimiento de', mantuve: 'Mantenimiento de', mantenia: 'Mantenimiento de',
  ayudo: 'Apoyo a', ayude: 'Apoyo a', ayudaba: 'Apoyo a',
  llevo: 'Manejo de', llevaba: 'Manejo de',
  concilio: 'Conciliación de', concilie: 'Conciliación de', conciliaba: 'Conciliación de',
  facturo: 'Facturación de', facture: 'Facturación de', facturaba: 'Facturación de',
  digito: 'Digitación de', digite: 'Digitación de', digitaba: 'Digitación de',
  redacto: 'Redacción de', redacte: 'Redacción de', redactaba: 'Redacción de',
  entrego: 'Entrega de', entregue: 'Entrega de', entregaba: 'Entrega de',
  recibo: 'Recepción de', recibi: 'Recepción de', recibia: 'Recepción de',
  despacho: 'Despacho de', despache: 'Despacho de', despachaba: 'Despacho de',
  empaco: 'Empaque de', empaque: 'Empaque de', empacaba: 'Empaque de',
  cocino: 'Preparación de', cocine: 'Preparación de', cocinaba: 'Preparación de',
  cuido: 'Cuidado de', cuide: 'Cuidado de', cuidaba: 'Cuidado de',
  enseno: 'Enseñanza de', ensene: 'Enseñanza de', ensenaba: 'Enseñanza de',
  diseno: 'Diseño de', disene: 'Diseño de', disenaba: 'Diseño de',
  programo: 'Programación de', programe: 'Programación de', programaba: 'Programación de',
  archivo: 'Archivo de', archive: 'Archivo de', archivaba: 'Archivo de',
  contesto: 'Atención de', conteste: 'Atención de', contestaba: 'Atención de',
  arreglo: 'Arreglo de', arregle: 'Arreglo de', arreglaba: 'Arreglo de',
  soldo: 'Soldadura de', solde: 'Soldadura de', soldaba: 'Soldadura de',
  pinto: 'Pintura de', pinte: 'Pintura de', pintaba: 'Pintura de',
};
const PREPOSICIONES_ES = new Set(['a', 'al', 'de', 'del', 'en', 'con', 'para', 'por', 'sobre']);

function nominalizarPrimeraPersonaES(texto) {
  const palabras = texto.split(/\s+/);
  if (palabras.length < 2) return texto;
  const clave = normalizar(palabras[0]).replace(/[^a-z]/g, '');
  const nominal = NOMINAL_ES[clave];
  if (!nominal) return texto;
  const siguiente = normalizar(palabras[1]).replace(/[^a-z]/g, '');
  const partesNominal = nominal.split(' ');
  // Si el candidato ya puso preposición ("apoyo EN planillas", "ayudo A clientes"),
  // se usa la suya y se descarta la de la tabla → nunca "Apoyo en en planillas".
  if (PREPOSICIONES_ES.has(siguiente)) partesNominal.pop();
  // Artículo tras preposición de la tabla: "hago la limpieza" → "Realización de la limpieza" (correcto).
  return [...partesNominal, ...palabras.slice(1)].join(' ');
}

// v11 (patrón 6): la evidencia cruda suele venir en infinitivo ("arreglar la
// tienda", "atender clientes") o precedida de un verbo de apoyo ("apoyaba con
// archivar documentos y contestar llamadas"). Tabla CERRADA infinitivo →
// sintagma nominal; se aplica a cada miembro de una coordinación "A y B".
const INFINITIVO_ES = {
  archivar: 'Archivo de', contestar: 'Atención de', atender: 'Atención a', arreglar: 'Arreglo de',
  ordenar: 'Orden de', acomodar: 'Acomodo de', limpiar: 'Limpieza de', cobrar: 'Cobro a', vender: 'Venta de',
  reparar: 'Reparación de', instalar: 'Instalación de', supervisar: 'Supervisión de', coordinar: 'Coordinación de',
  elaborar: 'Elaboración de', preparar: 'Preparación de', revisar: 'Revisión de', registrar: 'Registro de',
  controlar: 'Control de', manejar: 'Manejo de', administrar: 'Administración de', gestionar: 'Gestión de',
  organizar: 'Organización de', capacitar: 'Capacitación de', mantener: 'Mantenimiento de', apoyar: 'Apoyo en',
  ayudar: 'Apoyo a', recibir: 'Recepción de', despachar: 'Despacho de', entregar: 'Entrega de', cargar: 'Carga de',
  descargar: 'Descarga de', empacar: 'Empaque de', surtir: 'Surtido de', inventariar: 'Inventario de',
  conciliar: 'Conciliación de', facturar: 'Facturación de', digitar: 'Digitación de', redactar: 'Redacción de',
  programar: 'Programación de', diseñar: 'Diseño de', disenar: 'Diseño de', pintar: 'Pintura de', soldar: 'Soldadura de',
  cocinar: 'Preparación de', servir: 'Servicio de', cuidar: 'Cuidado de', enseñar: 'Enseñanza de', ensenar: 'Enseñanza de',
};
// "apoyaba con X" / "ayudaba a X" / "me encargaba de X" → "Apoyo en X" / "Encargado de X"
const RE_VERBO_APOYO_ES = /^(apoyaba|apoyo|apoye|ayudaba|ayudo|ayude|colaboraba|colaboro)\s+(con|en|a)\s+/i;
const RE_ENCARGO_ES = /^(me encargaba de|me encargo de|estaba a cargo de|estoy a cargo de|me tocaba)\s+/i;
// Minimizadores/muletillas al inicio de la evidencia — no aportan hechos.
// v11.4: verbos de apoyo en la evidencia y verbos "de rol superior" en la viñeta
const RE_EVIDENCIA_APOYO = /^(solo\s+|only\s+|just\s+)?(apoyaba|apoyo|apoye|ayudaba|ayudo|ayude|colaboraba|colaboro|asistia|assisted|helped|supported|aided)\b/;
const RE_EVIDENCIA_HACER = /^(solo\s+|only\s+|just\s+)?(hacia|hice|hago|did|do|made|make)\b/;
const RE_VERBO_APOYO_OK = /^(apoyo|apoya|apoyaba|apoye|apoyó|ayudo|ayuda|ayudaba|ayude|ayudó|colaboro|colabora|colaboró|colaboraba|asistio|asiste|asistió|asistia|brindo|brinda|brindó|assisted|assists|helped|helps|supported|supports|aided|contributed|contributes|participated|participates|participo|participa|participó)$/;
const RE_VERBO_ROL_SUPERIOR = /^(oversaw|oversee|led|lead|managed|manage|supervised|supervise|directed|direct|headed|spearheaded|owned|dirigio|dirigió|lidero|lideró|superviso|supervisó|gestiono|gestionó|encabezo|encabezó|coordino|coordinó)$/;
const RE_COLA_RELLENO = /,?\s+(durante\s+(su|la|el)\s+(estad[ií]a|jornada|turno)(\s+en\s+(el|la)\s+\w+)?|como parte de (sus|las|los)\s+(funciones|tareas|labores|responsabilidades|operaciones)(\s+\w+){0,3}|en (las|los)\s+(intervenciones|labores|tareas|operaciones)(\s+\w+){0,2}|en el (d[ií]a a d[ií]a|desempe[ñn]o de sus funciones)|throughout (the|each|every)\s+\w+(\s+\w+)?|across the\s+\w+(\s+floor)?|as part of (daily|regular|routine|store|shift)\s+\w+|on a daily basis|during (each|every|the)\s+shift)\s*(?=[.,;]|$)/gi;
const RE_MANDO_EN_AMBITO = /\b(coordin\w*|lider\w*|dirig\w*|supervis\w*|gestion\w*|encabez\w*|a cargo|jefe|jefa|encargad[oa]|responsable de|lead|led|leading|manag\w*|oversee|oversaw|overseeing|supervis\w*|direct\w*|head\w*|in charge)\b/;
const RE_MINIMIZADOR = /^(solo|sólo|solamente|nada mas|básicamente|basicamente|normalmente|generalmente|a veces|only|just|typically|usually|mostly|mainly|basically|generally|sometimes|also|también|tambien)\s+/i;

function nominalizarInfinitivosES(texto) {
  return texto.split(/\s+(y|e)\s+/i).map((parte, idx) => {
    if (idx % 2 === 1) return parte; // el conector
    const palabras = parte.trim().split(/\s+/);
    const clave = normalizar(palabras[0]).replace(/[^a-z]/g, '');
    const nominal = INFINITIVO_ES[clave];
    if (!nominal || palabras.length < 2) return parte;
    const partesNominal = nominal.split(' ');
    if (PREPOSICIONES_ES.has(normalizar(palabras[1]))) partesNominal.pop();
    if (idx > 0) partesNominal[0] = partesNominal[0].charAt(0).toLowerCase() + partesNominal[0].slice(1);
    return [...partesNominal, ...palabras.slice(1)].join(' ');
  }).join(' ');
}

// EN: verbo base en 1ª persona al inicio → pasado simple (tabla cerrada).
const VERBO_EN_PASADO = {
  handle: 'Handled', train: 'Trained', take: 'Took', took: 'Took', help: 'Helped', run: 'Ran', work: 'Worked',
  manage: 'Managed', use: 'Used', operate: 'Operated', stock: 'Stocked', assist: 'Assisted', answer: 'Answered',
  process: 'Processed', prepare: 'Prepared', clean: 'Cleaned', install: 'Installed', repair: 'Repaired',
  supervise: 'Supervised', coordinate: 'Coordinated', lead: 'Led', teach: 'Taught', serve: 'Served', sell: 'Sold',
  deliver: 'Delivered', drive: 'Drove', maintain: 'Maintained', troubleshoot: 'Troubleshot', schedule: 'Scheduled',
  organize: 'Organized', support: 'Supported', provide: 'Provided', perform: 'Performed', complete: 'Completed',
  receive: 'Received', check: 'Checked', count: 'Counted', greet: 'Greeted', file: 'Filed', enter: 'Entered',
  own: 'Owned', oversee: 'Oversaw', build: 'Built', create: 'Created', write: 'Wrote', make: 'Made', set: 'Set', keep: 'Kept',
  commission: 'Commissioned', explain: 'Explained', diagnose: 'Diagnosed', inspect: 'Inspected', test: 'Tested', resolve: 'Resolved',
  respond: 'Responded', document: 'Documented', monitor: 'Monitored', order: 'Ordered', track: 'Tracked', update: 'Updated', review: 'Reviewed',
  cut: 'Cut', reduce: 'Reduced', increase: 'Increased', improve: 'Improved', ensure: 'Ensured', develop: 'Developed', design: 'Designed', plan: 'Planned',
};
const RE_ARRANQUE_EN = /^(i\s+)?(am|was|got|did|do|have been|have|had)\s+(the\s+|a\s+|an\s+)?/i;

function limpiarEvidenciaEN(t) {
  t = t.replace(/^i\s+/i, '');
  // "am the go-to person for…" → "Go-to person for…"; "got employee of the month twice" → "Employee of the month twice"
  t = t.replace(RE_ARRANQUE_EN, '');
  t = t.replace(/\bmy\b\s*/gi, '').replace(/\s{2,}/g, ' ').trim();
  const palabras = t.split(/\s+/);
  const clave = normalizar(palabras[0]).replace(/[^a-z]/g, '');
  if (VERBO_EN_PASADO[clave]) palabras[0] = VERBO_EN_PASADO[clave];
  return palabras.join(' ');
}

function nominalizarUnaClausulaES(c) {
  c = c.trim();
  if (!c) return c;
  if (RE_ENCARGO_ES.test(c)) return 'Encargado de ' + c.replace(RE_ENCARGO_ES, '');
  if (RE_VERBO_APOYO_ES.test(c)) {
    const resto = nominalizarInfinitivosES(c.replace(RE_VERBO_APOYO_ES, ''));
    return 'Apoyo en ' + resto.charAt(0).toLowerCase() + resto.slice(1);
  }
  const n1 = nominalizarPrimeraPersonaES(c);
  return n1 !== c ? n1 : nominalizarInfinitivosES(c);
}
function esVerboClausulaES(w) {
  const k = normalizar(w).replace(/[^a-z]/g, '');
  return !!(NOMINAL_ES[k] || INFINITIVO_ES[k]) || /^(apoyaba|apoyo|ayudaba|ayudo|colaboraba|colaboro)$/.test(k);
}
// v11.5: separa por "; " y por ", " SOLO cuando lo que sigue empieza con un verbo
// de la tabla; nominaliza cada cláusula y las une con "; ".
function nominalizarClausulasES(texto) {
  const partes = texto.split(/\s*;\s*/).flatMap(seg => {
    const piezas = seg.split(/,\s+/);
    const out = [];
    piezas.forEach((pz, idx) => {
      if (idx > 0 && esVerboClausulaES(pz.split(/\s+/)[0])) out.push(pz);
      else if (out.length) out[out.length - 1] += ', ' + pz;
      else out.push(pz);
    });
    return out;
  }).map(nominalizarUnaClausulaES).filter(Boolean);
  if (!partes.length) return texto;
  return partes.map((pz, idx) => idx === 0 ? pz : pz.charAt(0).toLowerCase() + pz.slice(1)).join('; ');
}

function vinetaDesdeEvidencia(evidencia, enIngles) {
  let t = String(evidencia || '').trim()
    .replace(/^(i|we|yo|nosotros|también|also|and|y)\s+/i, '')
    .replace(/^(i|we|yo|nosotros)\s+/i, '')
    .replace(/[.;,]+$/, '')
    .trim();
  // v11: minimizadores al inicio ("solo apoyaba con…", "typically handle…")
  for (let k = 0; k < 3; k++) t = t.replace(RE_MINIMIZADOR, '');
  if (t.split(/\s+/).length < 2) return '';
  // v11: la aptitud se evalúa por FRAGMENTO — "coordinación con subcontratistas |
  // entregamos con 2 semanas de retraso por lluvias" conserva el primero.
  const partes = t.split(/\s*[;|]\s*/).map(x => x.trim()).filter(x => x && !RE_EVIDENCIA_NO_APTA.test(x));
  if (!partes.length) return '';
  if (partes.length === 1) t = partes[0];
  // v10: evidencia compuesta "tarea | cifra" → "Tarea (cifra)." / "tarea, otra".
  if (partes.length > 1) {
    const base = partes[0];
    const resto = partes.slice(1);
    const cifras = resto.filter(x => /\d/.test(x));
    const otras = resto.filter(x => !/\d/.test(x));
    t = base + (otras.length ? '; ' + otras.join('; ') : '') + (cifras.length ? ' (' + cifras.join('; ') + ')' : '');
  }
  if (enIngles) {
    t = limpiarEvidenciaEN(t);
  } else {
    t = t.replace(/\b(mi|mis)\b\s*/gi, '').replace(/\s{2,}/g, ' ').trim();
    // v11.5 (M1): la evidencia compuesta se nominaliza CLÁUSULA a cláusula.
    t = nominalizarClausulasES(t);
  }
  if (t.split(/\s+/).length < 2) return '';
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t + '.';
}

// v11 (patrón 3): cláusulas subordinadas de gerundio/finalidad que "adornan"
// una viñeta con objetos que el candidato no mencionó ("…, canalizando
// solicitudes al personal correspondiente", "…, garantizando el cumplimiento
// tributario", "… to support product presentation"). Se recorta SOLO la
// cláusula final (desde el marcador hasta el final), nunca palabras sueltas
// intra-oración; lo que queda antes del marcador es una oración completa.
// Comprobación estricta: cada palabra significativa de la cláusula (≥5
// letras, no conector/stopword/contexto tolerado, no verbo) debe tener raíz
// en el ámbito del puesto — SIN tolerancia de clúster de oficio.
const RE_MARCADOR_CLAUSULA = /(,\s+\S+(?:ando|iendo|ing)\b|\s+\S+(?:ando|iendo)\b|,\s+\S+ing\b|\s+(?:para|to|for|in order to|con el fin de|a fin de|como parte de|as part of|while|mientras|ensuring|helping|supporting)\s+)/i;
function recortarClausulaSinFuente(texto, alcanceNorm) {
  const palabrasTexto = texto.trim().split(/\s+/);
  if (palabrasTexto.length < 4) return { texto, recortado: false, clausula: '' };
  const limpiarPal = (w) => w.replace(/^[^a-zA-Z0-9ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÑñ]+|[^a-zA-Z0-9ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÑñ]+$/g, '');
  const sinFuentePalabra = (w) => {
    if (!w || /\d/.test(w)) return false;
    if (/^[A-Z]{2,}$/.test(w)) return false; // siglas: ya cubiertas por el paso (ii)
    const norm = normalizar(w);
    if (norm.length < 5) return false;
    if (CONECTORES.has(norm) || STOPWORDS_LARGAS.has(norm) || CONTEXTO_TOLERADO.has(norm)) return false;
    if (esRelleno(norm)) return false; // v11.6 (E2E Marcus): "approximately"/"around" no son hechos; la cifra se verifica aparte
    if (esVerboPermitido(norm) || esVerboConjugado(w)) return false;
    if (alcanceNorm.includes(norm.slice(0, RAIZ_LEN))) return false;
    if (familiaCubierta(norm, alcanceNorm)) return false;
    return true;
  };
  // marcadores (posición en el texto), nunca en la primera palabra
  const marcadores = [];
  const re = new RegExp(RE_MARCADOR_CLAUSULA.source, 'gi');
  let m;
  while ((m = re.exec(texto)) !== null) {
    if (m.index === 0) continue;
    if (texto.slice(0, m.index).trim().split(/\s+/).length < 2) continue;
    marcadores.push(m.index);
  }
  if (!marcadores.length) return { texto, recortado: false, clausula: '' };
  // primera palabra sin fuente que esté DESPUÉS del primer marcador
  const primerMarcador = marcadores[0];
  let posSinFuente = -1;
  const reW = /\S+/g;
  let w;
  while ((w = reW.exec(texto)) !== null) {
    if (w.index < primerMarcador) continue;
    if (sinFuentePalabra(limpiarPal(w[0]))) { posSinFuente = w.index; break; }
  }
  if (posSinFuente < 0) return { texto, recortado: false, clausula: '' };
  // corte mínimo: el ÚLTIMO marcador anterior a esa palabra
  const idx = marcadores.filter(x => x < posSinFuente).pop();
  if (idx === undefined) return { texto, recortado: false, clausula: '' };
  const clausula = texto.slice(idx);
  const tokens = clausula.split(/\s+/).map(limpiarPal).filter(sinFuentePalabra);
  let resto = texto.slice(0, idx).trim().replace(/[,;:\s]+$/, '');
  if (resto.split(/\s+/).length < 2) return { texto, recortado: false, clausula: '' };
  if (!/[.!?]$/.test(resto)) resto += '.';
  return { texto: resto, recortado: true, clausula: clausula.trim(), tokens };
}

// v4.1 (hallazgo 1): una habilidad con palabra capitalizada no declarada
// ("Microsoft Excel" por "Excel") se sustituye por el segmento LITERAL de
// datos.habilidades_tecnicas que comparte palabra ("Excel"); si no hay
// segmento, se elimina. Nunca se expanden marcas ni siglas.
// Regla: TODA palabra significativa (≥4 letras, no conector) del ítem debe
// tener raíz en las respuestas del candidato; el Title Case del modelo no se
// usa como señal (es estilo, no nombre propio).
// v11 (patrón 4, B1): un segmento solo sirve como habilidad literal si parece
// una habilidad (≤4 palabras, sin pronombres ni verbos conjugados) — nunca
// una frase narrativa del resumen ("before that i was a cashier at HEB for
// 2 years while in school").
const RE_SEGMENTO_NARRATIVO = /\b(i|my|me|yo|mi|mis|was|were|am|fui|era|estuve|trabaj\w+|worked|before|after|antes|despues|después|desde|since|while|years?|anos?|años?)\b/i;
function segmentosHabilidadesDeclaradas(datos) {
  const deHabilidades = String(datos.habilidades_tecnicas || '')
    .split(/[,;\n]+|\s+y\s+|\s+and\s+/i).map(s => s.trim().replace(/\.$/, '')).filter(Boolean);
  const deResumen = String(datos.resumen_personal || '')
    .split(/[,;\n]+|\s+y\s+|\s+and\s+/i).map(s => s.trim().replace(/\.$/, ''))
    .filter(s => s && s.split(/\s+/).length <= 4 && !RE_SEGMENTO_NARRATIVO.test(s));
  return [...deHabilidades, ...deResumen];
}
function corregirHabilidadLiteral(item, segmentos, alcanceGlobal) {
  const significativas = palabrasSignificativas(item, 4).filter(w => !CONECTORES.has(w) && !STOPWORDS_LARGAS.has(w));
  const sinFuente = significativas.filter(w => !alcanceGlobal.includes(w.slice(0, RAIZ_LEN)));
  if (!sinFuente.length) return { item, cambiado: false };
  const seg = segmentos.find(s => palabrasSignificativas(s, 3).some(sw => significativas.some(w => w.slice(0, RAIZ_LEN) === sw.slice(0, RAIZ_LEN))));
  return seg ? { item: seg, cambiado: true, sinFuente } : { item: null, cambiado: true, sinFuente };
}

// ═══════════════════ CONFORMIDAD DE ESQUEMA (servidor) ═══════════════════
// Auditoría fase 1, punto 3: construye el objeto de salida CAMPO A CAMPO a
// partir de lo que devolvió la tool del modelo — nunca `{...toolUse.input}`
// — así ninguna clave inesperada sobrevive, las fechas quedan normalizadas
// o null (nunca fabricadas), y los arrays/strings quedan dentro de los
// límites del esquema (ESQUEMA_CV.md) ANTES de que el validador de
// veracidad los toque.

function clampArray(arr, max) {
  return (Array.isArray(arr) ? arr : []).slice(0, max);
}
function clampStr(s, max) {
  if (typeof s !== 'string') return '';
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trim() : t;
}
function strOrNull(v, max) {
  return typeof v === 'string' && v.trim() ? clampStr(v, max) : null;
}

/**
 * @param {object} input Lo que devolvió la tool `emitir_cv` del modelo (input crudo, sin validar).
 * @param {string} lang  'es' | 'en'
 */
export function construirCVDesdeInput(input, lang) {
  input = input && typeof input === 'object' ? input : {};
  const contacto = input.contacto && typeof input.contacto === 'object' ? input.contacto : {};

  return {
    lang: lang === 'en' ? 'en' : 'es',
    nombre: clampStr(input.nombre, 120),
    titulo_objetivo: clampStr(input.titulo_objetivo, 100),
    contacto: {
      email: strOrNull(contacto.email, 120),
      telefono: strOrNull(contacto.telefono, 40),
      ubicacion: strOrNull(contacto.ubicacion, 100),
      linkedin: strOrNull(contacto.linkedin, 200),
    },
    perfil: clampStr(input.perfil, 700),
    experiencia: clampArray(input.experiencia, 6).map(p => {
      p = p && typeof p === 'object' ? p : {};
      return {
        cargo: clampStr(p.cargo, 120),
        empresa: clampStr(p.empresa, 150),
        ubicacion: strOrNull(p.ubicacion, 100),
        inicio: normalizarFecha(p.inicio),
        fin: normalizarFecha(p.fin),
        actual: p.actual === true,
        sin_funciones: p.sin_funciones === true,
        // v3, punto 1: cada viñeta es ahora {texto, evidencia} — `evidencia`
        // es la cita literal (≤200 chars) de las respuestas del candidato
        // que respalda `texto`. Sin `evidencia` no hay forma de verificarla,
        // así que se descarta aquí mismo (nunca llega ni a `validarCV`).
        vinetas: clampArray(p.vinetas, 7)
          .map(v => (v && typeof v === 'object' ? v : null))
          .filter(v => v && typeof v.texto === 'string' && v.texto.trim() && typeof v.evidencia === 'string' && v.evidencia.trim())
          .map(v => ({ texto: clampStr(v.texto, 320), evidencia: clampStr(v.evidencia, 200) })),
      };
    }),
    educacion: clampArray(input.educacion, 8).map(e => {
      e = e && typeof e === 'object' ? e : {};
      return {
        titulo: clampStr(e.titulo, 150),
        institucion: clampStr(e.institucion, 150),
        anio: normalizarAnio(e.anio),
        en_curso: e.en_curso === true,
      };
    }),
    habilidades: {
      tecnicas: clampArray(
        (input.habilidades && Array.isArray(input.habilidades.tecnicas)) ? input.habilidades.tecnicas : [],
        15
      ).filter(x => typeof x === 'string' && x.trim()).map(x => clampStr(x, 60)),
      blandas: clampArray(
        (input.habilidades && Array.isArray(input.habilidades.blandas)) ? input.habilidades.blandas : [],
        8
      ).filter(x => typeof x === 'string' && x.trim()).map(x => clampStr(x, 60)),
    },
    idiomas: clampArray(input.idiomas, 6).map(it => {
      it = it && typeof it === 'object' ? it : {};
      return { idioma: clampStr(it.idioma, 40), nivel: strOrNull(it.nivel, 40) };
    }),
    extra: clampArray(input.extra, 8)
      .filter(x => typeof x === 'string' && x.trim())
      .map(x => clampStr(x, 200)),
  };
}

// ═════════════════ Derivación literal de identidad/contacto ═════════════════
// Auditoría fase 1, punto 4: nombre/titulo_objetivo/contacto NO se toman
// del modelo — se derivan determinísticamente de `datos`, igual que hace
// hoy el cliente (`generarConIA`/`validarContacto`, chat-cv.html).

// v11 (patrón 8): las siglas que el candidato escribió en mayúsculas (HVAC,
// UX, RN, IT, QA, CNC…) se conservan — antes salían "Hvac Technician",
// "Junior Ux Designer". Las partículas (de, del, la, y, of, and…) van en
// minúscula salvo al inicio.
const PARTICULAS_TITULO = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'of', 'and', 'the', 'for', 'a', 'al']);
function capitalizarNombre(s, esTitulo) {
  return String(s || '').trim().split(/\s+/)
    .map((w, i) => {
      if (!w) return w;
      if (esTitulo && (/^[A-Z0-9]{2,5}$/.test(w) || /^[A-Z]{2,5}[\/-][A-Z]{2,5}$/.test(w))) return w; // sigla tal cual
      if (i > 0 && PARTICULAS_TITULO.has(w.toLowerCase())) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

// Mismas regex que el cliente (generarConIA, chat-cv.html ~L2255-2264) para
// extraer email/teléfono/LinkedIn de la respuesta libre `email_tel`.
function derivarContacto(datos) {
  const ct = String(datos.email_tel || '');
  const emailM = ct.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
  const liM = ct.match(/(?:https?:\/\/)?(?:www\.)?((?:linkedin\.com|lnkd\.in)\/[^\s,;|]+)/i);
  const ctSinLi = liM ? ct.replace(liM[0], ' ') : ct;
  const telM = ctSinLi.match(/[\+\(\d][\d\s\-\(\)\.]{6,}/);
  return {
    email: emailM ? emailM[0] : null,
    telefono: telM ? telM[0].trim() : null,
    linkedin: liM ? liM[1].replace(/[),.;]+$/, '') : null,
    // Ubicación: solo el país tal como lo declaró el candidato — el chat no
    // tiene un campo de ciudad dedicado, así que nunca se infiere una
    // ciudad a partir del nombre de un empleador/institución (evita el
    // defecto documentado con Brandon Lee Carter, T1_RECORRIDO_REAL.md).
    ubicacion: datos.pais ? capitalizarNombre(String(datos.pais).trim(), true) : null, // v11: "el salvador" → "El Salvador"
  };
}

// ═════════════════════════ VALIDADOR PRINCIPAL ═════════════════════════

/**
 * @param {object} cv    Objeto YA conforme al esquema (usar construirCVDesdeInput primero)
 * @param {object} datos Respuestas crudas del chat (las 14 claves + flags)
 * @returns {{ok:boolean, errores:string[], correcciones:string[], cv:object}}
 */
export function validarCV(cv, datos) {
  const errores = [];
  const correcciones = [];
  datos = datos || {};

  if (!cv || typeof cv !== 'object') {
    return { ok: false, errores: ['cv_no_es_objeto'], correcciones: [], cv };
  }

  // Copia profunda para no mutar el objeto de entrada.
  const out = JSON.parse(JSON.stringify(cv));
  const datosNorm = textoCompletoDatos(datos);

  // ── 0. Placeholders en cualquier string simple (perfil, contacto, extra…) ──
  const revisarPlaceholder = (valor, ruta) => { if (esPlaceholder(valor)) errores.push(`placeholder_en_${ruta}`); };
  revisarPlaceholder(out.perfil, 'perfil');
  revisarPlaceholder(out.contacto?.ubicacion, 'contacto.ubicacion');
  out.extra = (Array.isArray(out.extra) ? out.extra : []).filter(x => !esPlaceholder(x));

  // ── 1. IDENTIDAD Y CONTACTO: se derivan literalmente de `datos`, nunca del modelo ──
  if (datos.nombre) {
    const nombreDerivado = capitalizarNombre(datos.nombre);
    if (normalizar(out.nombre) !== normalizar(nombreDerivado)) {
      correcciones.push(`nombre: sustituido por la forma literal de datos.nombre ("${nombreDerivado}")`);
    }
    out.nombre = nombreDerivado;
  }
  if (datos.puesto) {
    const tituloDerivado = capitalizarNombre(datos.puesto, true);
    if (normalizar(out.titulo_objetivo) !== normalizar(tituloDerivado)) {
      correcciones.push(`titulo_objetivo: sustituido por la forma literal de datos.puesto ("${tituloDerivado}")`);
    }
    out.titulo_objetivo = tituloDerivado;
  }
  {
    const contactoDerivado = derivarContacto(datos);
    out.contacto = out.contacto && typeof out.contacto === 'object' ? out.contacto : {};
    if (out.contacto.email !== contactoDerivado.email) correcciones.push('contacto.email: sustituido por el extraído de datos.email_tel');
    if (out.contacto.telefono !== contactoDerivado.telefono) correcciones.push('contacto.telefono: sustituido por el extraído de datos.email_tel');
    if ((out.contacto.linkedin || null) !== contactoDerivado.linkedin) correcciones.push('contacto.linkedin: sustituido por el extraído de datos.email_tel');
    if (contactoDerivado.ubicacion && out.contacto.ubicacion !== contactoDerivado.ubicacion) correcciones.push('contacto.ubicacion: sustituida por datos.pais');
    out.contacto.email = contactoDerivado.email;
    out.contacto.telefono = contactoDerivado.telefono;
    out.contacto.linkedin = contactoDerivado.linkedin;
    out.contacto.ubicacion = contactoDerivado.ubicacion || out.contacto.ubicacion || null;
  }

  // ── 1b (v11, patrón 4). Pre-pasada de experiencia ANTES del perfil (el
  // fallback del perfil usa cargo/empresa): puestos nacidos de un curso se
  // eliminan y las empresas que son frases crudas se vacían. ──
  if (Array.isArray(out.experiencia)) {
    out.experiencia = out.experiencia.filter((puesto, i) => {
      if (!puesto || typeof puesto !== 'object') return true;
      const expCampoRaw = String((i === 0 ? datos.exp1 : i === 1 ? datos.exp2 : '') || '');
      const textoPuesto = `${puesto.cargo || ''} ${puesto.empresa || ''}`;
      if (RE_ORIGEN_ESTUDIOS.test(textoPuesto) && !RE_ORIGEN_ESTUDIOS.test(expCampoRaw)) {
        correcciones.push(`experiencia[${i}]: puesto_eliminado — origen en estudios/curso, no es empleo ("${puesto.cargo} | ${puesto.empresa}")`);
        return false;
      }
      const nPalabrasEmpresa = String(puesto.empresa || '').trim().split(/\s+/).filter(Boolean).length;
      if (puesto.empresa && (nPalabrasEmpresa > 7 || RE_EMPRESA_CRUDA.test(puesto.empresa))) {
        correcciones.push(`experiencia[${i}].empresa: vaciada — no es un nombre sino una descripción ("${puesto.empresa}")`);
        puesto.empresa = '';
      }
      // v11: primera letra en mayúscula en cargo y empresa ("mecanico" → "Mecanico")
      ['cargo', 'empresa'].forEach(k => {
        if (typeof puesto[k] === 'string' && /^[a-záéíóúñ]/.test(puesto[k])) puesto[k] = puesto[k].charAt(0).toUpperCase() + puesto[k].slice(1);
      });
      return true;
    });
  }

  // ── 2. PERFIL: adjetivos de alcance + totales de años + (v3) tokens sin fuente ──
  if (typeof out.perfil === 'string') {
    const sinAdj = limpiarAdjetivosEnParrafo(out.perfil, datosNorm);
    if (sinAdj.recortado) correcciones.push('perfil: eliminada locución de alcance no declarada en datos');
    const sinAnios = quitarTotalesAnios(sinAdj.texto, datosNorm);
    if (sinAnios.recortado) correcciones.push('perfil: eliminado total de años no derivable de las fechas dadas');
    // v3, punto 5: misma verificación de sustantivos ≥5 letras sin fuente que
    // las viñetas, pero contra `datos` GLOBAL (el perfil no es de un puesto
    // concreto) — así "a major national retailer" (inferencia no declarada)
    // se elimina oración por oración, no palabra por palabra.
    const sinTokens = limpiarTokensSinFuenteEnParrafo(sinAnios.texto, datosNorm);
    if (sinTokens.recortado) correcciones.push('perfil: eliminada oración con término sin fuente en datos');
    // v11.2 (E4): oraciones de opinión/negativas ("Los clientes regresan.") no van en el perfil.
    const oracionesAptas = sinTokens.texto.split(/(?<=[.!?])\s+/).filter(o => o.trim() && !RE_EVIDENCIA_NO_APTA.test(o));
    if (oracionesAptas.join(' ').trim() !== sinTokens.texto.trim()) correcciones.push('perfil: eliminada oración de opinión/negativa');
    out.perfil = oracionesAptas.join(' ').trim();
    if (!out.perfil || !out.perfil.trim()) {
      out.perfil = perfilFallback(datos, out, out.lang === 'en');
      correcciones.push('perfil: reconstruido determinísticamente (quedó vacío tras la validación)');
    }
    const nPalabras = contarPalabras(out.perfil);
    if (nPalabras > 75) errores.push('perfil_excede_60_palabras'); // margen de 15 sobre el límite duro
  }

  // ── 3. EXPERIENCIA ──
  const flagsSinFunciones = [datos.logros1_sin_funciones === true, datos.logros2_sin_funciones === true];
  out.experiencia = Array.isArray(out.experiencia) ? out.experiencia : [];
  const eliminarPuesto = new Set();

  out.experiencia.forEach((puesto, i) => {
    if (!puesto || typeof puesto !== 'object') { eliminarPuesto.add(i); return; }

    // 3.0. Ámbito generalizado: el chat solo alimenta 2 empleos (exp1/exp2).
    // Cualquier puesto de índice ≥2 no tiene fuente posible → se elimina.
    if (i >= 2) {
      errores.push(`experiencia[${i}]_puesto_sin_fuente`);
      eliminarPuesto.add(i);
      return;
    }

    // v11 (patrón 2): fechas/estado laboral declarados en expN mandan sobre el modelo.
    {
      const expCampoRaw = i === 0 ? datos.exp1 : datos.exp2;
      const decl = fechasDeclaradas(expCampoRaw);
      if (decl) {
        const mismoAnio = (a, b) => (a || '').slice(0, 4) === (b || '').slice(0, 4);
        if (puesto.actual !== decl.actual) {
          correcciones.push(`experiencia[${i}].actual: ${puesto.actual} → ${decl.actual} (declarado en exp${i + 1}: "${expCampoRaw}")`);
          puesto.actual = decl.actual;
        }
        if (!(puesto.fin === null && decl.fin === null) && !mismoAnio(puesto.fin, decl.fin)) {
          correcciones.push(`experiencia[${i}].fin: "${puesto.fin}" → "${decl.fin}" (declarado en exp${i + 1})`);
          puesto.fin = decl.fin;
        }
        if (!mismoAnio(puesto.inicio, decl.inicio)) {
          correcciones.push(`experiencia[${i}].inicio: "${puesto.inicio}" → "${decl.inicio}" (declarado en exp${i + 1})`);
          puesto.inicio = decl.inicio;
        } else if (decl.inicio.length > 4 && (puesto.inicio || '').length === 4) {
          puesto.inicio = decl.inicio; // el candidato dio el mes
        }
        if (puesto.actual) puesto.fin = null;
      } else if (String(expCampoRaw || '').trim()) {
        // v11 (E1): expN no trae año → cualquier año que el modelo haya puesto
        // debe aparecer literal en el ámbito del puesto (exp+logros+resumen si
        // habla del puesto); si no, se anula (el modelo tomó "2023" de estudios).
        const ambitoFechas = normalizar(alcancePuesto(datos, i, puesto.empresa));
        ['inicio', 'fin'].forEach(k => {
          const anio = (puesto[k] || '').slice(0, 4);
          if (anio && !ambitoFechas.includes(anio)) {
            correcciones.push(`experiencia[${i}].${k}: "${puesto[k]}" anulada — año sin fuente en exp${i + 1}/resumen`);
            puesto[k] = null;
          }
        });
        if (!puesto.inicio && !puesto.fin) {
          const dur = duracionDeclarada(expCampoRaw) || duracionDeclarada(resumenHablaDelPuesto(datos, i, puesto.empresa) ? datos.resumen_personal : '');
          if (dur) puesto.duracion = dur; // "3 meses" → periodo textual (ver serializar)
        }
      }
    }

    // 3a. Fechas futuras → null/actual.
    if (fechaEsFutura(puesto.inicio)) {
      correcciones.push(`experiencia[${i}].inicio: fecha futura eliminada`);
      puesto.inicio = null;
    }
    if (fechaEsFutura(puesto.fin)) {
      correcciones.push(`experiencia[${i}].fin: fecha futura → actual`);
      puesto.fin = null;
      puesto.actual = true;
    }
    if (puesto.actual === true && puesto.fin) {
      correcciones.push(`experiencia[${i}].fin: forzado a null (actual=true)`);
      puesto.fin = null;
    }
    if (puesto.inicio && puesto.fin) {
      const ini = /^\d{4}/.test(puesto.inicio) ? Number(puesto.inicio.slice(0, 4)) : null;
      const fin = /^\d{4}/.test(puesto.fin) ? Number(puesto.fin.slice(0, 4)) : null;
      if (ini !== null && fin !== null && ini > fin) errores.push(`experiencia[${i}]_fechas_invertidas`);
    }

    // v3, punto 4: si el candidato dio un año/duración explícita en expN
    // ("for 1 year (2025)", "durante 1 año (2025)", "en 2025") y el modelo
    // calculó un `inicio` ANTERIOR a ese año (p. ej. restando la duración a
    // la fecha actual en vez de usar el año literal), se corrige a lo
    // declarado — nunca se infiere, se usa el año que el candidato mismo dio.
    {
      const expCampoRaw = i === 0 ? datos.exp1 : i === 1 ? datos.exp2 : '';
      const anioDeclarado = primerAnioEnTexto(expCampoRaw);
      if (anioDeclarado && puesto.inicio) {
        const inicioAnio = /^\d{4}/.test(puesto.inicio) ? Number(puesto.inicio.slice(0, 4)) : null;
        if (inicioAnio !== null && inicioAnio < Number(anioDeclarado)) {
          correcciones.push(`experiencia[${i}].inicio: inicio_ajustado_a_declarado — "${puesto.inicio}" → "${anioDeclarado}" (año literal en exp${i + 1})`);
          puesto.inicio = puesto.inicio.length > 4 ? `${anioDeclarado}-${puesto.inicio.slice(5)}` : anioDeclarado;
        }
      }
    }

    // 3b. sin_funciones declarado por el usuario → vinetas forzadas a [].
    const debeSerSinFunciones = flagsSinFunciones[i] === true;
    if (debeSerSinFunciones && Array.isArray(puesto.vinetas) && puesto.vinetas.length > 0) {
      correcciones.push(`experiencia[${i}]: viñetas vaciadas (logros${i + 1}_sin_funciones=true)`);
      puesto.vinetas = [];
    }
    if (debeSerSinFunciones) puesto.sin_funciones = true;

    // 3c. Viñetas — v3 (evidencia literal): cada viñeta es {texto, evidencia}.
    //     (0) `evidencia` debe ser una cita LITERAL (tolerante a espacios/
    //         tildes/puntuación) del ámbito del puesto → si no, se elimina
    //         (`evidencia_no_literal`), sin mirar siquiera el `texto`.
    //     (i) adjetivos de alcance no declarados en `texto` → recorte de
    //         locución o eliminación de la unidad si queda rota;
    //     (ii) cifras/tokens capitalizados sin respaldo en el ámbito →
    //         elimina la viñeta;
    //     (iii) sustantivos ≥5 letras de `texto` sin raíz en `evidencia`
    //         (∪ familias de paráfrasis ∪ CONTEXTO_TOLERADO ∪ verbos) →
    //         elimina la viñeta COMPLETA (nunca edición intra-oración). El
    //         ámbito completo del puesto ya NO se usa aquí — solo lo que el
    //         modelo citó como `evidencia`, más estricto y más verificable.
    // Persona real E2, punto 2c: acumula TODOS los tokens/frases rechazados
    // de este puesto (sin importar el paso que los rechazó) para poder
    // decírselos al modelo en el reintento si el puesto queda en 0 viñetas.
    const tokensRechazadosPuesto = [];
    const vinetasOriginales = Array.isArray(puesto.vinetas) ? puesto.vinetas.length : 0;

    if (Array.isArray(puesto.vinetas) && !debeSerSinFunciones) {
      const alcance = alcancePuesto(datos, i, puesto.empresa);
      if (resumenHablaDelPuesto(datos, i, puesto.empresa) && datos.resumen_personal) {
        correcciones.push(`experiencia[${i}]: ámbito ampliado con resumen_personal (habla de este puesto)`);
      }
      const alcanceLaxo = normalizarLaxo(alcance);
      const alcanceGlobal = textoCompletoDatos(datos);
      const fuentePuestoNorm = normalizar(`${alcance} ${datos.puesto || ''}`);
      const oficios = detectarOficios(`${datos.puesto || ''} ${i === 0 ? datos.exp1 : datos.exp2} ${datos.tipo_empresa || ''}`);
      const raicesPuesto = raicesToleradas(fuentePuestoNorm, oficios);
      const vinetasFiltradas = [];
      puesto.vinetas.forEach((vOriginal, j) => {
        if (!vOriginal || typeof vOriginal !== 'object') return;
        const evidenciaOriginal = typeof vOriginal.evidencia === 'string' ? vOriginal.evidencia : '';
        if (typeof vOriginal.texto !== 'string' || !vOriginal.texto.trim()) return;
        let b = vOriginal.texto;

        // (0) evidencia literal
        const evidenciaLaxa = normalizarLaxo(evidenciaOriginal);
        // v9: la evidencia puede ser UNA cita literal o VARIAS separadas por
        // coma/;/| (el modelo une "Cobro en efectivo y tarjeta" + "unas 150
        // transacciones por turno" en una viñeta — ambas literales).
        // v11 (N3): si la evidencia compuesta tiene fragmentos literales y otros
        // no ("own safety training | zero lost-time injuries in 2024" — el 2º
        // vive en info_extra), se conservan SOLO los literales y la viñeta se
        // degrada a ellos en vez de perderse entera.
        let evidenciaParcial = null;
        const fragmentosEvidencia = (() => {
          if (!evidenciaLaxa) return [];
          if (alcanceLaxo.includes(evidenciaLaxa)) return [evidenciaLaxa];
          const crudos = String(evidenciaOriginal).split(/\s*[;|]\s*|\s*,\s*|\s+\+\s+/).map(x => x.trim()).filter(Boolean);
          const frags = crudos.map(normalizarLaxo).filter(f => f && f.split(' ').length >= 2);
          if (frags.length >= 1 && frags.every(f => alcanceLaxo.includes(f))) return frags;
          const literales = crudos.filter(x => { const n = normalizarLaxo(x); return n && n.split(' ').length >= 2 && alcanceLaxo.includes(n); });
          if (literales.length) { evidenciaParcial = literales.join(' | '); return literales.map(normalizarLaxo); }
          return [];
        })();
        const evidenciaEsLiteral = fragmentosEvidencia.length > 0;
        // v5.1 (prueba real M3): si el candidato precedió la evidencia con una
        // muletilla de duda ("creo que también hago mantenimiento"), la viñeta
        // no puede afirmarlo como hecho → se elimina (sin degradar).
        if (evidenciaEsLiteral) {
          const conDuda = fragmentosEvidencia.some(f => {
            const pos = alcanceLaxo.indexOf(f);
            const previo = alcanceLaxo.slice(Math.max(0, pos - 30), pos);
            return RE_HEDGE_PREVIO.test(previo);
          });
          if (conDuda) {
            correcciones.push(`experiencia[${i}].vinetas[${j}]: viñeta_eliminada — motivo=evidencia_con_duda, evidencia="${evidenciaOriginal}"`);
            tokensRechazadosPuesto.push('evidencia_con_duda');
            return;
          }
        }
        if (!evidenciaEsLiteral) {
          correcciones.push(`experiencia[${i}].vinetas[${j}]: viñeta_eliminada — motivo=evidencia_no_literal, evidencia="${evidenciaOriginal}"`);
          tokensRechazadosPuesto.push('evidencia_no_literal');
          return;
        }

        // v4: en vez de borrar, degradar a la evidencia literal (si es usable).
        const evidenciaUsable = evidenciaParcial || evidenciaOriginal;
        const degradar = (motivo, tokens) => {
          tokensRechazadosPuesto.push(...tokens);
          const literal = vinetaDesdeEvidencia(evidenciaUsable, out.lang === 'en');
          if (!literal) {
            correcciones.push(`experiencia[${i}].vinetas[${j}]: viñeta_eliminada — motivo=${motivo}, token="${tokens.join(', ')}" (evidencia demasiado corta para degradar)`);
            return;
          }
          // v11 (E2/E5): si la evidencia es el propio encabezado del puesto
          // ("cajera en super selectos desde 2022", "trabajé 5 años como maestra
          // de inglés en el Colegio…") no es una función → se descarta.
          const litNorm = normalizar(literal);
          const repiteEncabezado = [puesto.cargo, puesto.empresa].filter(Boolean).map(normalizar).filter(x => x.length >= 4)
            .every(x => litNorm.includes(x)) && [puesto.cargo, puesto.empresa].filter(Boolean).length > 0;
          if (repiteEncabezado) {
            correcciones.push(`experiencia[${i}].vinetas[${j}]: viñeta_eliminada — motivo=evidencia_repite_encabezado (${motivo})`);
            return;
          }
          correcciones.push(`experiencia[${i}].vinetas[${j}]: viñeta_degradada_a_evidencia — motivo=${motivo}, token="${tokens.join(', ')}"`);
          vinetasFiltradas.push({ texto: literal, evidencia: evidenciaUsable, degradada: true });
        };
        if (evidenciaParcial) return degradar('evidencia_parcialmente_literal', ['evidencia_parcial']);
        // v11.7 (E2 v17): una viñeta cuya evidencia es el propio encabezado del
        // puesto ("cajera en super selectos desde 2022" → "Ejerce funciones de
        // cajera.") no aporta contenido → fuera, se haya degradado o no.
        {
          const evN = normalizar(evidenciaOriginal);
          const partesEnc = [puesto.cargo, puesto.empresa].filter(Boolean).map(normalizar).filter(x => x.length >= 4);
          const expN = normalizar(i === 0 ? datos.exp1 : datos.exp2);
          const esEncabezado = (partesEnc.length > 0 && partesEnc.every(x => evN.includes(x)))
            || (expN && normalizarLaxo(expN) === normalizarLaxo(evN));
          if (esEncabezado) {
            correcciones.push(`experiencia[${i}].vinetas[${j}]: viñeta_eliminada — motivo=evidencia_es_encabezado, evidencia="${evidenciaOriginal}"`);
            tokensRechazadosPuesto.push('evidencia_es_encabezado');
            return;
          }
        }
        // v11.3 (E4): si TODOS los fragmentos de la evidencia son opinión/negativos
        // ("los clientes regresan"), no respaldan ningún hecho → viñeta fuera.
        {
          const frags = String(evidenciaOriginal).split(/\s*[;|]\s*/).map(x => x.trim()).filter(Boolean);
          if (frags.length && frags.every(f => RE_EVIDENCIA_NO_APTA.test(f))) {
            correcciones.push(`experiencia[${i}].vinetas[${j}]: viñeta_eliminada — motivo=evidencia_no_apta (opinión/negativa), evidencia="${evidenciaOriginal}"`);
            tokensRechazadosPuesto.push('evidencia_no_apta');
            return;
          }
        }

        // v11 (patrón 3): cláusula final de gerundio/finalidad sin fuente → recorte.
        // v19 (E3): "…, coordinando un equipo de 35 personas" cuando el candidato
        // solo dijo "equipo de 35 personas en obra" — un gerundio de MANDO
        // (coordinando/liderando/dirigiendo/supervisando/gestionando/leading/
        // managing/overseeing) solo se conserva si el ámbito trae un verbo de
        // mando; si no, se recorta la cláusula y queda el hecho.
        {
          const mMando = b.match(/,?\s+\b(coordinando|liderando|dirigiendo|supervisando|gestionando|encabezando|leading|managing|overseeing|directing|supervising|coordinating|heading)\b[^.]*\.?$/i);
          if (mMando && !RE_MANDO_EN_AMBITO.test(fuentePuestoNorm)) {
            const resto = b.slice(0, mMando.index).trim().replace(/[,;:\s]+$/, '');
            if (resto.split(/\s+/).length >= 3) {
              correcciones.push(`experiencia[${i}].vinetas[${j}]: clausula_recortada — "${mMando[0].trim()}" (verbo de mando sin fuente)`);
              b = /[.!?]$/.test(resto) ? resto : resto + '.';
            }
          }
        }
        {
          const rCl = recortarClausulaSinFuente(b, fuentePuestoNorm);
          if (rCl.recortado) {
            correcciones.push(`experiencia[${i}].vinetas[${j}]: clausula_recortada — "${rCl.clausula}" (sin fuente: ${rCl.tokens.join(', ')})`);
            b = rCl.texto;
          }
        }

        // v11.4 (M1, N4): inflación de rol. Si la evidencia dice "ayudaba/apoyaba/
        // assisted/helped/did", la viñeta no puede empezar con un verbo de rol
        // superior ("Realizó", "Preparó", "Oversaw", "Led") → se degrada a la
        // evidencia ("Apoyo en …"). Hecho ≠ nivel de responsabilidad.
        // v19 (E2/N1/B1/J1): colas de relleno sin información ("durante su estadía
        // en el local", "como parte de sus funciones", "throughout the store",
        // "across the store floor", "en las intervenciones eléctricas") → fuera.
        {
          const antes = b;
          b = b.replace(RE_COLA_RELLENO, '').replace(/\s+([.,;])/g, '$1').trim();
          if (b !== antes) {
            if (!/[.!?]$/.test(b)) b += '.';
            if (b.split(/\s+/).length < 2) b = antes; else correcciones.push(`experiencia[${i}].vinetas[${j}]: cola_relleno_recortada`);
          }
        }
        {
          const evNorm = normalizar(evidenciaUsable);
          const primeraB = normalizar(b.split(/\s+/)[0]).replace(/[^a-z]/g, '');
          // v11.6 (M1): si el modelo citó solo el objeto ("preparacion de estados
          // financieros") pero el candidato lo introdujo con "ayudaba con la…",
          // el verbo de apoyo que PRECEDE a la evidencia en el ámbito también cuenta.
          const posEv = alcanceLaxo.indexOf(normalizarLaxo(evidenciaUsable.split(/\s*[;|]\s*/)[0]));
          const previoEv = posEv > 0 ? alcanceLaxo.slice(Math.max(0, posEv - 25), posEv) : '';
          const RE_PREVIO_APOYO = /\b(apoyaba|apoyo|apoye|ayudaba|ayudo|ayude|colaboraba|colaboro|asistia|assisted|helped|supported)\s+(con|en|a|la|el|with|in|on)?\s*(la|el|las|los|the)?\s*$/;
          const esApoyo = RE_EVIDENCIA_APOYO.test(evNorm) || RE_PREVIO_APOYO.test(previoEv);
          const esHacer = RE_EVIDENCIA_HACER.test(evNorm);
          if ((esApoyo && !RE_VERBO_APOYO_OK.test(primeraB)) || (esHacer && RE_VERBO_ROL_SUPERIOR.test(primeraB))) {
            return degradar('verbo_inflado', [b.split(/\s+/)[0]]);
          }
        }

        // (i) adjetivos de alcance
        const rAdj = limpiarAdjetivosEnUnidad(b, datosNorm, 4);
        if (rAdj.eliminarUnidadCompleta) {
          correcciones.push(`experiencia[${i}].vinetas[${j}]: eliminada — locución de alcance no declarada dejaba la viñeta sin contenido`);
          return;
        }
        if (rAdj.recortado) correcciones.push(`experiencia[${i}].vinetas[${j}]: eliminada locución de alcance no declarada`);
        b = rAdj.texto;

        // (ii) cifras/capitalizados sin respaldo → viñeta completa
        const { numeros, capitalizados } = tokensDeReclamo(b);
        const numeroSinRespaldo = numeros.find(n => !tokenRespaldado(n, alcance) && !tokenRespaldado(n, alcanceGlobal));
        const tokenSinRespaldo = capitalizados.find(t => !tokenRespaldado(t, alcance));
        if (numeroSinRespaldo) return degradar('cifra_sin_respaldo', [numeroSinRespaldo]);
        if (tokenSinRespaldo) return degradar('termino_sin_respaldo_en_ambito', [tokenSinRespaldo]);

        // (iii) sustantivos técnicos en minúsculas sin respaldo en `evidencia`
        // (v3 — antes se usaba el ámbito completo del puesto). Decisión a
        // nivel de VIÑETA COMPLETA, nunca edición intra-oración.
        // v8: la fuente de sustantivos vuelve a ser TODO lo que el candidato
        // escribió sobre ESE puesto (+ el título objetivo), no solo la
        // evidencia citada: mezclar dos frases del mismo puesto no inventa
        // nada. La evidencia sigue siendo obligatoria y literal (paso 0).
        // Además se toleran las raíces de clúster del oficio (lexico.mjs).
        const rTok = tokensSinFuenteEnUnidad(b, fuentePuestoNorm, { raices: raicesPuesto });
        if (rTok.sinFuente) return degradar('token_sin_fuente', rTok.tokens);

        // v11.3 (N2/N5): en inglés, viñeta que arranca en forma base ("Install…",
        // "Troubleshoot…", "Manage…") → pasado, para no mezclar tiempos con las
        // demás ("Handled…"). Tabla cerrada; lo que no está en la tabla no se toca.
        if (out.lang === 'en') {
          const pal = b.split(/\s+/);
          const clave = normalizar(pal[0]).replace(/[^a-z]/g, '');
          if (VERBO_EN_PASADO[clave] && VERBO_EN_PASADO[clave].toLowerCase() !== clave) {
            pal[0] = VERBO_EN_PASADO[clave];
            // "Install and commission…" → "Installed and commissioned…" (solo si la 2.ª también es verbo de la tabla)
            if (pal[1] && /^(and|&)$/i.test(pal[1]) && pal[2]) {
              const c2 = normalizar(pal[2]).replace(/[^a-z]/g, '');
              if (VERBO_EN_PASADO[c2]) pal[2] = VERBO_EN_PASADO[c2].toLowerCase();
            }
            b = pal.join(' ');
            correcciones.push(`experiencia[${i}].vinetas[${j}]: verbo_en_pasado — "${clave}" → "${pal[0]}"`);
          }
        }
        vinetasFiltradas.push({ texto: b, evidencia: evidenciaOriginal });
      });
      // v5.1 (prueba real N1): viñetas redundantes — si el texto normalizado
      // de una está contenido en otra ("Helped customers find products" ⊂
      // "Handled checkout, returns and helped customers find products"), se
      // conserva la más completa.
      const normsV = vinetasFiltradas.map(v => normalizarLaxo(v.texto));
      // v11 (patrón 6): dos viñetas que salen de la MISMA evidencia (o una
      // evidencia contenida en la otra) son la misma información dicha dos
      // veces (E4: "Reparacion de motores, frenos…" + "Realiza reparación y
      // mantenimiento de sistemas de frenos…" + "Aplica diagnóstico con
      // escáner…"). Se conserva la que más palabras de la evidencia refleja
      // en su texto (cobertura); a igualdad, la de evidencia más larga.
      const evidNorm = vinetasFiltradas.map(v => normalizarLaxo(v.evidencia));
      const cobertura = vinetasFiltradas.map((v, idx) => {
        const ev = palabrasSignificativas(v.evidencia, 4).filter(w => !CONECTORES.has(w) && !STOPWORDS_LARGAS.has(w));
        if (!ev.length) return 1;
        const txt = normalizarLaxo(v.texto);
        return ev.filter(w => txt.includes(w.slice(0, RAIZ_LEN))).length / ev.length;
      });
      const perdedoras = new Set();
      vinetasFiltradas.forEach((v, idx) => {
        vinetasFiltradas.forEach((w, k) => {
          if (k <= idx || perdedoras.has(idx) || perdedoras.has(k)) return;
          const a = evidNorm[idx], b = evidNorm[k];
          if (!a || !b) return;
          if (a !== b) {
            // evidencia contenida en la otra: solo cuenta como duplicado si los
            // TEXTOS también se parecen (J1: una evidencia larga puede respaldar
            // dos viñetas distintas — canalización vs mantenimiento).
            if (!(a.includes(b) || b.includes(a))) return;
            const sa = new Set(palabrasSignificativas(v.texto, 4)), sb = new Set(palabrasSignificativas(w.texto, 4));
            const inter = [...sa].filter(x => sb.has(x)).length;
            const union = new Set([...sa, ...sb]).size || 1;
            if (inter / union < 0.3) return;
          }
          // gana la de mayor cobertura; empate → evidencia más larga; empate → la primera
          let pierde;
          if (cobertura[idx] !== cobertura[k]) pierde = cobertura[idx] > cobertura[k] ? k : idx;
          else pierde = a.length >= b.length ? k : idx;
          perdedoras.add(pierde);
          correcciones.push(`experiencia[${i}].vinetas[${pierde}]: viñeta_eliminada — motivo=misma_evidencia_que_otra_viñeta`);
        });
      });
      // v19 (E3/E4 en v17): duplicado SEMÁNTICO — dos viñetas cuyos sustantivos
      // clave (≥5 letras, sin conectores/verbos/relleno) coinciden en ≥60 % y la
      // más corta no aporta ningún sustantivo propio ("Supervisa la obra de un
      // edificio de 6 niveles…" + "Supervisión de obra de un edificio de 6
      // niveles y dos proyectos de vivienda" → se conserva la que aporta más).
      const sustantivosClave = (t) => {
        const pal = palabrasSignificativas(t, 5).map(w => w.replace(/[.,;:]+$/, ''));
        return new Set(pal.slice(1).filter(w => w.length >= 5 && !CONECTORES.has(w) && !STOPWORDS_LARGAS.has(w) && !esRelleno(w) && !esVerboConjugado(w) && !CONTEXTO_TOLERADO.has(w)));
      };
      const claves = vinetasFiltradas.map(v => sustantivosClave(v.texto));
      vinetasFiltradas.forEach((v, idx) => {
        vinetasFiltradas.forEach((w, k) => {
          if (k <= idx || perdedoras.has(idx) || perdedoras.has(k)) return;
          const a = claves[idx], b = claves[k];
          if (a.size < 2 || b.size < 2) return;
          const [chica, grande, idxChica, idxGrande] = a.size <= b.size ? [a, b, idx, k] : [b, a, k, idx];
          const comunes = [...chica].filter(x => grande.has(x)).length;
          // una cifra propia (que la otra viñeta no tiene) es información nueva → no es duplicado
          const nums = (t) => (t.match(/\d[\d.,]*/g) || []).map(n => n.replace(/[.,]+$/, ''));
          const numsChica = nums(vinetasFiltradas[idxChica].texto), numsGrande = nums(vinetasFiltradas[idxGrande].texto);
          const cifraPropia = numsChica.some(n => !numsGrande.includes(n));
          if (!cifraPropia && comunes / chica.size >= 0.6 && comunes >= 2) {
            perdedoras.add(idxChica);
            correcciones.push(`experiencia[${i}].vinetas[${idxChica}]: viñeta_eliminada — motivo=duplicado_semantico (${comunes}/${chica.size} sustantivos en otra viñeta)`);
          }
        });
      });
      puesto.vinetas = vinetasFiltradas.filter((v, idx) => {
        if (perdedoras.has(idx)) return false;
        const n = normsV[idx];
        const redundante = normsV.some((m, k) => k !== idx && !perdedoras.has(k) && m !== n && m.includes(n))
          || normsV.some((m, k) => k < idx && !perdedoras.has(k) && m === n);
        if (redundante) correcciones.push(`experiencia[${i}].vinetas[${idx}]: viñeta_eliminada — motivo=redundante_con_otra_viñeta`);
        return !redundante;
      }).map(v => ({ texto: v.texto, evidencia: v.evidencia }));
    }

    // Persona real E2, punto 2c [NUEVO ERROR NO CORREGIBLE]: el puesto SÍ
    // tenía funciones declaradas por el candidato (logrosN no vacío, sin la
    // bandera logrosN_sin_funciones) pero, tras la validación, quedó con 0
    // viñetas — sobre-poda. Se reporta como error (no se "arregla" aquí)
    // para forzar un reintento con la lista exacta de sustantivos que SÍ
    // puede usar (ver generar-cv.ts). Si el reintento tampoco produce
    // viñetas, se acepta el puesto sin viñetas (mejor vacío que inventado)
    // y queda registrado en `errores` para telemetría.
    const logrosDeclarados = i === 0 ? datos.logros1 : i === 1 ? datos.logros2 : null;
    const huboFuncionesDeclaradas = !debeSerSinFunciones && typeof logrosDeclarados === 'string' && logrosDeclarados.trim().length > 0;
    if (huboFuncionesDeclaradas && (!Array.isArray(puesto.vinetas) || puesto.vinetas.length === 0)) {
      const tokensUnicos = [...new Set(tokensRechazadosPuesto.map(t => normalizar(t)))];
      errores.push(`experiencia[${i}]_sin_vinetas_tras_validacion: tokens_rechazados="${tokensUnicos.join(', ')}", vinetas_originales=${vinetasOriginales}`);
    }

    // 3d. Empresa: verificación laxa (solo reporta, no borra el puesto —
    // eliminar un empleo entero es demasiado destructivo para un falso
    // positivo). Si CERO palabras significativas del nombre de empresa
    // aparecen en el campo exp correspondiente, es sospechoso de haber
    // sido "rellenado" (p. ej. "Taller Familiar" por "taller de mi tío").
    // v11: la empresa también puede venir de resumen_personal (E5: la maestra
    // de inglés del Colegio Cristóbal Colón solo aparece ahí, exp2="no").
    const expCampo = i === 0 ? datos.exp1 : i === 1 ? datos.exp2 : '';
    if (puesto.empresa) {
      const wEmpresa = palabrasSignificativas(puesto.empresa).filter(w => !GENERICAS_NEGOCIO.has(w));
      const wCampo = normalizar(`${expCampo || ''} ${datos.resumen_personal || ''}`);
      // v11: si la "empresa" es solo una palabra genérica declarada (Freelance,
      // Independiente) no hay nada que verificar → no es error.
      const hayOverlap = wEmpresa.length === 0 || wEmpresa.some(w => wCampo.includes(w));
      if (!hayOverlap) errores.push(`experiencia[${i}]_empresa_no_verificable`);
    }
  });
  out.experiencia = out.experiencia.filter((_, i) => !eliminarPuesto.has(i));

  // v11.4 (E5): un rango de años en resumen_personal que ningún puesto del CV
  // cubre indica un empleo descrito por el candidato que el modelo omitió
  // ("trabajé 5 años como maestra en el Colegio X (2018-2023)"). Se reporta
  // como error no corregible → generar-cv.ts reintenta pidiendo incluirlo.
  {
    const resumen = normalizar(datos.resumen_personal);
    const rangos = [...resumen.matchAll(/\b((?:19|20)\d{2})\s*(?:-|–|—|a|al|to|hasta)\s*((?:19|20)\d{2})\b/g)];
    const aniosCV = new Set(out.experiencia.flatMap(p => [p.inicio, p.fin].map(x => (x || '').slice(0, 4)).filter(Boolean)));
    rangos.forEach(m => {
      if (!aniosCV.has(m[1]) && !aniosCV.has(m[2])) {
        errores.push(`experiencia_omitida_en_resumen: el resumen menciona un empleo ${m[1]}-${m[2]} que no aparece en el CV`);
      }
    });
  }

  // ── 4. EDUCACIÓN ──
  out.educacion = Array.isArray(out.educacion) ? out.educacion : [];
  const estudiosNorm = normalizar(datos.estudios);
  const educFiltrada = [];
  out.educacion.forEach((e, i) => {
    if (!e || typeof e !== 'object') return;
    if (esPlaceholder(e.titulo)) {
      correcciones.push(`educacion[${i}]: eliminada — placeholder en título`);
      return;
    }
    // Persona real E2, punto 1b: un placeholder ("<UNKNOWN>", "N/A"...) o
    // ausencia de institución YA NO elimina la entrada entera — se conserva
    // el título (que sí es un dato real) con institucion:'' en su lugar.
    // `cvAtexto` omite el segmento " | " vacío correspondiente.
    if (esPlaceholder(e.institucion) || !e.institucion) {
      if (e.institucion) correcciones.push(`educacion[${i}].institucion: placeholder ("${e.institucion}") sustituido por cadena vacía — se conserva la entrada`);
      e.institucion = '';
    }
    if (fechaEsFutura(e.anio)) {
      correcciones.push(`educacion[${i}].anio: fecha futura eliminada`);
      e.anio = null;
    }
    // v11.3 (B1): "en curso" solo si el candidato lo dijo ("estudiando", "2do año",
    // "in progress", "currently"…); "some college, no degree" NO está en curso.
    if (e.en_curso === true && !RE_EN_CURSO.test(String(datos.estudios || ''))) {
      correcciones.push(`educacion[${i}].en_curso: true → false (sin marcador de estudio en curso en datos.estudios)`);
      e.en_curso = false;
    }
    const wTitulo = palabrasSignificativas(e.titulo).concat(palabrasSignificativas(e.institucion));
    const overlap = wTitulo.some(w => estudiosNorm.includes(w));
    if (!overlap && estudiosNorm) {
      correcciones.push(`educacion[${i}]: eliminada — ni título ni institución aparecen en datos.estudios`);
      return;
    }
    educFiltrada.push(e);
  });
  out.educacion = educFiltrada;

  // 4b. Educación incompleta (re-auditoría, punto 3 [MENOR]): heurística
  // robustecida. Se parte de segmentos por línea/';'/"Año, Titulación", pero
  // ahora se descartan (a) líneas de negación ("nada más", "eso es todo",
  // "no", "none"...) y (b) cualquier segmento que NO contenga una palabra de
  // título/grado reconocible — así una respuesta multilínea con relleno
  // conversacional ya no infla el conteo de titulaciones "perdidas".
  if (datos.estudios) {
    const segmentos = String(datos.estudios)
      .split(/\n|;|(?<=\d{4})\s*[,]\s*(?=[A-ZÁÉÍÓÚÑ])/)
      .map(s => s.trim())
      .filter(s => s.length > 6)
      .filter(s => !RE_NEGACION_LINEA.test(s))
      .filter(s => RE_TITULACION.test(s));
    if (segmentos.length > out.educacion.length) {
      errores.push('educacion_incompleta: datos.estudios sugiere más titulaciones de las presentes en el CV');
    }
  }

  // ── 5. HABILIDADES ──
  if (out.habilidades && typeof out.habilidades === 'object') {
    const alcanceGlobal = textoCompletoDatos(datos);
    const filtrarLista = (lista) => (Array.isArray(lista) ? lista : []).filter(s => {
      if (typeof s !== 'string' || !s.trim() || esPlaceholder(s)) return false;
      const w = palabrasSignificativas(s);
      if (w.length === 0) return true; // token corto tipo "C", "R" — se deja pasar
      return w.some(word => alcanceGlobal.includes(word));
    });
    const tecOriginal = out.habilidades.tecnicas;
    const blOriginal = out.habilidades.blandas;
    // v4.1 (hallazgo 1): tras el filtro de solape, cada ítem se corrige a la
    // forma literal del candidato si contiene palabras sin fuente
    // ("Microsoft Excel" → "Excel"; "SAP (nivel básico)" → "sistema SAP básico";
    // "Checkout Processing" sin segmento declarado → se elimina).
    const segmentos = segmentosHabilidadesDeclaradas(datos);
    const idiomasCV = (Array.isArray(out.idiomas) ? out.idiomas : []).map(it => normalizar(it && it.idioma)).filter(x => x && x.length >= 4);
    const literalizar = (lista, ruta) => {
      const vistos = new Set();
      const out2 = [];
      lista.forEach(item => {
        const r = corregirHabilidadLiteral(item, segmentos, alcanceGlobal);
        if (r.cambiado) {
          correcciones.push(r.item
            ? `${ruta}: "${item}" → literal "${r.item}" (sin fuente: ${r.sinFuente.join(', ')})`
            : `${ruta}: "${item}" eliminada (sin fuente: ${r.sinFuente.join(', ')})`);
        }
        if (!r.item) return;
        let item2 = r.item;
        // v11.4 (E1): si el candidato calificó la habilidad ("excel basico") y el
        // modelo la dejó sin calificar ("Excel"), se usa el segmento literal del
        // candidato — quitar el nivel hace la afirmación MÁS fuerte de lo dicho.
        {
          const itemNorm = normalizar(item2);
          const seg = segmentos.find(sg => {
            const sgNorm = normalizar(sg);
            return RE_NIVEL_HABILIDAD.test(sgNorm) && !RE_NIVEL_HABILIDAD.test(itemNorm)
              && palabrasSignificativas(item2, 3).some(w => sgNorm.includes(w.slice(0, RAIZ_LEN)));
          });
          if (seg) { correcciones.push(`${ruta}: "${item2}" → literal "${seg}" (el candidato declaró un nivel)`); item2 = seg; }
        }
        // v11.4 (E5/N1): un idioma no es una habilidad técnica/blanda si ya está en idiomas.
        if (idiomasCV.some(idm => idm && normalizar(item2).includes(idm))) {
          correcciones.push(`${ruta}: "${item2}" eliminada (es un idioma, ya listado en Idiomas)`);
          return;
        }
        const k = normalizar(item2);
        if (vistos.has(k)) return;
        vistos.add(k);
        out2.push(item2);
      });
      return out2;
    };
    out.habilidades.tecnicas = literalizar(filtrarLista(tecOriginal), 'habilidades.tecnicas');
    out.habilidades.blandas = literalizar(filtrarLista(blOriginal), 'habilidades.blandas');
    if (Array.isArray(tecOriginal) && out.habilidades.tecnicas.length < tecOriginal.length) {
      correcciones.push('habilidades.tecnicas: eliminado(s) ítem(s) sin fuente en las respuestas del candidato');
    }
    if (Array.isArray(blOriginal) && out.habilidades.blandas.length < blOriginal.length) {
      correcciones.push('habilidades.blandas: eliminado(s) ítem(s) sin fuente en las respuestas del candidato');
    }
  }

  // ── 6. IDIOMAS: nivel no declarado → null; v3 punto 6: si el nivel SÍ está
  // declarado (en idiomas_nivel O en habilidades_tecnicas, en la misma frase
  // que el idioma), se usa ese nivel literal aunque el modelo haya puesto
  // otra cosa o nada — así "spanish basic"/"some spanish"/"inglés intermedio"
  // no se pierden solo porque vivían en el campo de habilidades. ──
  if (Array.isArray(out.idiomas)) {
    const idiomasNorm = normalizar(datos.idiomas_nivel);
    out.idiomas.forEach((it, i) => {
      if (!it || typeof it !== 'object') return;
      const nivelDeclarado = extraerNivelParaIdioma(it.idioma, datos.idiomas_nivel)
        || extraerNivelParaIdioma(it.idioma, datos.habilidades_tecnicas);
      if (nivelDeclarado) {
        if (normalizar(it.nivel || '') !== normalizar(nivelDeclarado)) {
          correcciones.push(`idiomas[${i}]: nivel ajustado a "${nivelDeclarado}" (declarado junto a "${it.idioma}")`);
          it.nivel = nivelDeclarado;
        }
        return;
      }
      if (it.nivel) {
        const palabrasNivel = palabrasSignificativas(it.nivel, 3);
        const respaldado = palabrasNivel.length === 0
          ? idiomasNorm.includes(normalizar(it.idioma))
          : palabrasNivel.some(p => idiomasNorm.includes(p));
        if (!respaldado) {
          correcciones.push(`idiomas[${i}]: nivel "${it.nivel}" no declarado para "${it.idioma}" → null`);
          it.nivel = null;
        }
      }
    });
  }

  // ── 7. EXTRA: solo si info_extra no es una negación, y con solape real ──
  {
    const infoExtra = String(datos.info_extra || '').trim();
    const esNegacion = !infoExtra || RE_NEGACION.test(infoExtra);
    const original = Array.isArray(out.extra) ? out.extra : [];
    if (esNegacion) {
      if (original.length) correcciones.push('extra: vaciado — datos.info_extra es una negación o está vacío');
      out.extra = [];
    } else {
      const infoNorm = normalizar(infoExtra);
      // v11.5 (E3/E4): un ítem con palabras sin fuente ("registrados", "recurrentes")
      // se sustituye por el texto literal del candidato; si ese literal es
      // opinión/negativo, se descarta.
      const literalExtra = infoExtra.charAt(0).toUpperCase() + infoExtra.slice(1).replace(/[.\s]+$/, '');
      const vistosExtra = new Set();
      const filtrado = original.map(x => {
        const w = palabrasSignificativas(x);
        const solapa = w.length === 0 || w.some(word => infoNorm.includes(word));
        if (!solapa) { correcciones.push(`extra: "${x}" eliminado (sin solape con datos.info_extra)`); return null; }
        const r = tokensSinFuenteEnUnidad(x, infoNorm, { incluirPrimera: true });
        let y = x;
        if (r.sinFuente) { correcciones.push(`extra: "${x}" → literal de info_extra (sin fuente: ${r.tokens.join(', ')})`); y = literalExtra; }
        if (RE_EVIDENCIA_NO_APTA.test(y)) { correcciones.push(`extra: "${y}" eliminado (opinión/negativo)`); return null; }
        const k = normalizar(y);
        if (vistosExtra.has(k)) return null;
        vistosExtra.add(k);
        return y;
      }).filter(Boolean);
      out.extra = filtrado;
    }
  }

  // ── 8. Resultado ──
  const ok = errores.length === 0;
  return { ok, errores, correcciones, cv: out };
}

export default validarCV;
