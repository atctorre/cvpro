// serializar.mjs — motor v2 CVPro — v11 (fechas legibles, año único, duración, empresa vacía); v7: encabezados idénticos a v1
// (RESUMEN PROFESIONAL / EXPERIENCIA PROFESIONAL / EDUCACIÓN / HABILIDADES
// con línea Idiomas:) para que el editor, guardar-cv y el parser de texto
// del cliente traten un CV v2 igual que uno v1.
// `cvAtexto(cv, lang)`: produce el texto plano del CV con el MISMO formato
// de secciones/encabezados que hoy sabe parsear el cliente (chat-cv.html:
// constante `_HEADERS_CV` ~L4394 reconoce RESUMEN|PERFIL|PROFESSIONAL,
// EXPERIENCIA|EXPERIENCE|WORK, EDUCACI[ÓO]N|EDUCATION, HABILIDADES|SKILLS,
// IDIOMAS|LANGUAGES — los headers usados aquí son un subconjunto exacto de
// esa lista). Puesto: "Cargo | Empresa | Periodo". Viñetas: "• texto".
//
// La Edge Function usa esto para devolver `cv_texto` junto a `cv` (JSON),
// de forma que las rutas del cliente que todavía dependen de texto plano
// (adaptar a vacante, traducir, carta de presentación — ver NOTAS_MOTORV2.md
// §"Coexistencia v1/v2") sigan funcionando sin cambios durante la migración.

// v11 (patrón 8): "2021-03" → "Marzo 2021" / "March 2021"; inicio === fin →
// un solo año ("2025", no "2025 – 2025"); sin fechas pero con duración
// declarada ("3 meses") → la duración; empresa vacía → se omite el segmento.
const MESES_TXT = {
  es: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
function formatearFecha(f, lang) {
  if (!f) return '';
  const m = String(f).match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(f);
  const mes = MESES_TXT[lang === 'en' ? 'en' : 'es'][Number(m[2]) - 1];
  return mes ? `${mes} ${m[1]}` : m[1];
}
function formatearPeriodo(puesto, etiquetaPresente, lang) {
  const inicio = formatearFecha(puesto.inicio, lang);
  const fin = puesto.actual ? etiquetaPresente : formatearFecha(puesto.fin, lang);
  if (!inicio && !fin) return puesto.duracion ? String(puesto.duracion) : '';
  if (!inicio) return fin;
  if (!fin) return inicio;
  if (inicio === fin) return inicio;
  return `${inicio} – ${fin}`;
}

/**
 * @param {object} cv   CV conforme a ESQUEMA_CV.md (ya validado/corregido)
 * @param {string} lang 'es' | 'en'
 * @returns {string} Texto plano, ≥1 línea por sección, sin markdown.
 */
export function cvAtexto(cv, lang) {
  cv = cv || {};
  const en = lang === 'en';
  const L = en
    ? {
      perfil: 'PROFESSIONAL SUMMARY', experiencia: 'PROFESSIONAL EXPERIENCE', educacion: 'EDUCATION',
      habilidades: 'SKILLS', idiomas: 'LANGUAGES', extra: 'ADDITIONAL INFORMATION',
      tecnicas: 'Technical', blandas: 'Soft skills', idiomasLinea: 'Languages', presente: 'Present', enCurso: 'In progress',
    }
    : {
      perfil: 'RESUMEN PROFESIONAL', experiencia: 'EXPERIENCIA PROFESIONAL', educacion: 'EDUCACIÓN',
      habilidades: 'HABILIDADES', idiomas: 'IDIOMAS', extra: 'INFORMACIÓN ADICIONAL',
      tecnicas: 'Técnicas', blandas: 'Blandas', idiomasLinea: 'Idiomas', presente: 'Actualidad', enCurso: 'En curso',
    };

  const sep = '─'.repeat(19);
  const lineas = [];

  lineas.push(String(cv.nombre || '').toUpperCase());
  const cabecera = [cv.titulo_objetivo, cv.contacto?.ubicacion, cv.contacto?.email, cv.contacto?.telefono].filter(Boolean);
  if (cabecera.length) lineas.push(cabecera.join(' | '));
  if (cv.contacto?.linkedin) lineas.push(cv.contacto.linkedin);
  lineas.push('═'.repeat(40));
  lineas.push('');

  lineas.push(L.perfil);
  lineas.push(sep);
  lineas.push(cv.perfil || '');
  lineas.push('');

  lineas.push(L.experiencia);
  lineas.push(sep);
  (Array.isArray(cv.experiencia) ? cv.experiencia : []).forEach(p => {
    const periodo = formatearPeriodo(p, L.presente, lang);
    // La línea de cabecera del puesto se escribe SIEMPRE, aunque no tenga
    // viñetas (puesto "sin funciones" / solo cargo+empresa+fechas) — es lo
    // que espera `_parsearBloquesExperiencia` del cliente para no perder
    // el empleo entero.
    lineas.push([p.cargo || '', p.empresa || '', periodo].filter(Boolean).join(' | '));
    // v3, punto 1: cada viñeta es {texto, evidencia} — el texto plano solo
    // usa `texto`; `evidencia` es para el validador, no para el cliente.
    (Array.isArray(p.vinetas) ? p.vinetas : []).forEach(v => {
      const texto = typeof v === 'string' ? v : (v && typeof v.texto === 'string' ? v.texto : '');
      if (texto) lineas.push(`• ${texto}`);
    });
    lineas.push('');
  });

  lineas.push(L.educacion);
  lineas.push(sep);
  (Array.isArray(cv.educacion) ? cv.educacion : []).forEach(e => {
    const anio = e.en_curso ? L.enCurso : (e.anio || '');
    // Persona real E2, punto 1b: si `institucion` quedó vacía (placeholder
    // eliminado por el validador), se omite el segmento " | " vacío en vez
    // de imprimir "Bachillerato General |  | 2018".
    const partes = [e.titulo || ''];
    if (e.institucion) partes.push(e.institucion);
    if (anio) partes.push(anio);
    lineas.push(partes.join(' | '));
  });
  lineas.push('');

  lineas.push(L.habilidades);
  lineas.push(sep);
  const tecnicas = cv.habilidades?.tecnicas || [];
  const blandas = cv.habilidades?.blandas || [];
  if (tecnicas.length) lineas.push(`${L.tecnicas}: ${tecnicas.join(', ')}`);
  if (blandas.length) lineas.push(`${L.blandas}: ${blandas.join(', ')}`);
  // v7 (Fase 2): los idiomas van como línea "Idiomas: …" dentro de
  // HABILIDADES, exactamente como el formato v1 que ya parsea
  // construirCVData (regex /(?:Idiomas?|Languages?):\s*([^\n]+)/).
  const idiomasTxt = (Array.isArray(cv.idiomas) ? cv.idiomas : [])
    .filter(it => it && it.idioma)
    .map(it => `${it.idioma}${it.nivel ? ' — ' + it.nivel.charAt(0).toUpperCase() + it.nivel.slice(1) : ''}`)
    .join(', ');
  if (idiomasTxt) lineas.push(`${L.idiomasLinea}: ${idiomasTxt}`);

  if (Array.isArray(cv.extra) && cv.extra.length) {
    lineas.push('');
    lineas.push(L.extra);
    lineas.push(sep);
    cv.extra.forEach(x => lineas.push(x));
  }

  return lineas.join('\n').trim();
}

export default cvAtexto;
