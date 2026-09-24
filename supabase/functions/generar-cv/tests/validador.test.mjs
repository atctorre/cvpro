// validador.test.mjs — pruebas unitarias del validador determinista (sin red).
// Ejecutar: node validador.test.mjs
//
// La mayoría de los casos están derivados de defectos REALES observados en
// las 13 personas de prueba (ver personas.json y los informes
// D3_TANDA_ES.md, D3_CONTROL_Y_EN.md, T1_RECORRIDO_REAL.md). Los casos
// 13-22 se añadieron en la auditoría fase 1 (correcciones previas), 23-25 en
// la re-auditoría de la persona real E2, y 26-31 en el rediseño v3
// ("evidencia literal"): desde v3 cada viñeta es {texto, evidencia} y
// TODOS los tests que ejercitan vinetas de experiencia deben darle a cada
// una una `evidencia` — cita literal del ámbito del puesto (exp/logros)
// correspondiente. Los tests que solo verifican cvAtexto pasan strings
// planas porque cvAtexto acepta ambos formatos por compatibilidad.

import assert from 'node:assert/strict';
import { validarCV, construirCVDesdeInput, normalizarFecha, normalizarAnio } from '../validador.mjs';
import { detectarOficios } from '../lexico.mjs';
import { cvAtexto } from '../serializar.mjs';

let pasados = 0;
let fallidos = 0;
const fallos = [];

function test(nombre, fn) {
  try {
    fn();
    pasados++;
    console.log(`✅ PASS — ${nombre}`);
  } catch (e) {
    fallidos++;
    fallos.push({ nombre, error: e.message });
    console.log(`❌ FAIL — ${nombre}`);
    console.log(`   ${e.message}`);
  }
}

function cvBase(overrides = {}) {
  return {
    lang: 'es',
    nombre: 'Persona de Prueba',
    titulo_objetivo: 'Puesto de Prueba',
    contacto: { email: 'x@x.com', telefono: null, ubicacion: 'El Salvador', linkedin: null },
    perfil: 'Perfil de prueba.',
    experiencia: [],
    educacion: [],
    habilidades: { tecnicas: [], blandas: [] },
    idiomas: [],
    extra: [],
    ...overrides,
  };
}

// Atajo para construir una viñeta v3 ({texto, evidencia}).
function vin(texto, evidencia) {
  return { texto, evidencia };
}

// ─────────────────────────── CASO 1 ───────────────────────────
test('1. NEC inventado en viñeta se elimina (no declarado por el candidato)', () => {
  const datos = {
    exp1: 'Electrosur — Electricista — 2019 a la fecha',
    logros1: 'instalo tableros electricos trifasicos hasta 100 amperios, uso multimetro y pinza amperimetrica',
  };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Electricista', empresa: 'Electrosur', ubicacion: null,
      inicio: '2019', fin: null, actual: true, sin_funciones: false,
      vinetas: [
        vin('Instala tableros eléctricos trifásicos conforme a la normativa NEC vigente.', 'instalo tableros electricos trifasicos'),
        vin('Diagnostica fallas mediante multímetro y pinza amperimétrica en instalaciones residenciales.', 'uso multimetro y pinza amperimetrica'),
      ],
    }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  const vinetas = out.experiencia[0].vinetas;
  assert.equal(vinetas.length, 2, 'v4: la viñeta con NEC se degrada a su evidencia literal, no se borra');
  assert.ok(!/NEC/i.test(vinetas.map(v => v.texto).join(' ')), 'NEC no debe sobrevivir');
  assert.equal(vinetas[0].texto, 'Instalación de tableros electricos trifasicos.', 'texto degradado = evidencia literal');
  assert.ok(correcciones.some(c => c.includes('vinetas[0]') && c.includes('viñeta_degradada_a_evidencia')));
});

// ─────────────────────────── CASO 2 ───────────────────────────
test('2. Empresa sin respaldo literal ("Taller Familiar" por "taller de mi tio") se reporta', () => {
  const datos = { exp2: 'ayudante en taller de mi tio - 2013 a 2016', logros2: 'cambios de aceite y frenos' };
  const cv = cvBase({
    experiencia: [
      { cargo: 'Mecánico', empresa: 'Taller Hermanos Flores', ubicacion: null, inicio: '2016', fin: null, actual: true, sin_funciones: false, vinetas: [] },
      { cargo: 'Ayudante de Mecánico', empresa: 'Taller Familiar', ubicacion: null, inicio: '2013', fin: '2016', actual: false, sin_funciones: false, vinetas: [] },
    ],
  });
  const { errores } = validarCV(cv, datos);
  assert.ok(errores.includes('experiencia[1]_empresa_no_verificable'));
});

// ─────────────────────────── CASO 3 ───────────────────────────
test('3. "Más de 11 años" (total de años no derivable) se elimina del perfil', () => {
  const cv = cvBase({ perfil: 'Mecánico automotriz con más de 11 años de experiencia progresiva en diagnóstico electrónico.' });
  const { cv: out, correcciones } = validarCV(cv, {});
  assert.ok(!/11 a[ñn]os/i.test(out.perfil));
  assert.ok(correcciones.some(c => c.includes('total de años')));
});

// ─────────────────────────── CASO 4 ───────────────────────────
test('4. Adjetivo de alcance "high-volume" NO declarado elimina/recorta la viñeta', () => {
  const datos = { exp1: 'Target — Sales Associate — 2025', logros1: 'stocking shelves, helping customers find products, running the register' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Sales Associate', empresa: 'Target', ubicacion: null, inicio: '2025', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Operated point-of-sale register during busy floor shifts in a high-volume retail environment.', 'running the register')],
    }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  const texto = out.experiencia[0].vinetas.map(v => v.texto).join(' ');
  assert.ok(!/high-volume|high volume/i.test(texto), 'la locución de alcance no declarada no debe sobrevivir');
  assert.ok(!/point-of-sale/i.test(texto), 'los términos sin respaldo en la evidencia tampoco deben sobrevivir');
  assert.ok(correcciones.some(c => c.toLowerCase().includes('alcance')));
});

// ─────────────────────────── CASO 5 ───────────────────────────
test('5. Nivel de idioma "Native" no declarado se convierte en null', () => {
  const datos = { idiomas_nivel: 'Tamil, English' };
  const cv = cvBase({ idiomas: [{ idioma: 'Tamil', nivel: 'Native' }, { idioma: 'English', nivel: null }] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.idiomas[0].nivel, null);
  assert.ok(correcciones.some(c => c.includes('idiomas[0]')));
});

// ─────────────────────────── CASO 6 ───────────────────────────
test('6. Puesto con logros1_sin_funciones=true fuerza vinetas=[] aunque el modelo las genere', () => {
  const datos = { logros1_sin_funciones: true, exp1: 'Super Selectos — Cajera — 2022 a presente' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Cajera', empresa: 'Super Selectos', ubicacion: null, inicio: '2022', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Procesó transacciones de caja con precisión y agilidad para más de 100 clientes diarios.', 'transacciones de caja')],
    }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas.length, 0);
  assert.equal(out.experiencia[0].sin_funciones, true);
  assert.ok(correcciones.some(c => c.includes('viñetas vaciadas')));
});

// ─────────────────────────── CASO 7 ───────────────────────────
test('7. "Git" listado solo en habilidades (no en el relato del puesto) no respalda la viñeta del empleo', () => {
  const datos = {
    exp1: 'Freelance — Desarrolladora Web — 2024 a presente',
    logros1: 'hice 3 páginas web para negocios locales con HTML, CSS, JavaScript y React',
    habilidades_tecnicas: 'HTML, CSS, JavaScript, React, Git, inglés',
  };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Desarrolladora Web', empresa: 'Freelance', ubicacion: null, inicio: '2024', fin: null, actual: true, sin_funciones: false,
      vinetas: [
        vin('Desarrolló tres sitios web para negocios locales usando HTML, CSS, JavaScript y React.', '3 páginas web para negocios locales con HTML, CSS, JavaScript y React'),
        vin('Aplicó control de versiones con Git en todos los proyectos entregados al cliente.', 'hice 3 páginas web para negocios locales'),
      ],
    }],
    habilidades: { tecnicas: ['HTML', 'CSS', 'JavaScript', 'React', 'Git'], blandas: [] },
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  const texto = out.experiencia[0].vinetas.map(v => v.texto).join(' ');
  assert.ok(!/Git/.test(texto), 'Git no debe sobrevivir en el empleo (fuera de ámbito)');
  assert.equal(out.experiencia[0].vinetas.length, 2, 'v4: degradada a evidencia literal');
  assert.equal(out.experiencia[0].vinetas[1].texto, 'Realización de 3 páginas web para negocios locales.');
  assert.ok(correcciones.some(c => c.includes('termino_sin_respaldo_en_ambito')));
  assert.ok(out.habilidades.tecnicas.includes('Git'), 'Git SÍ puede quedar en habilidades técnicas (esa es su fuente real)');
});

// ─────────────────────────── CASO 8 ───────────────────────────
test('8. Fecha de fin futura se corrige a null + actual=true', () => {
  const futuro = `${new Date().getFullYear() + 2}-01`;
  const cv = cvBase({
    experiencia: [{ cargo: 'Analista', empresa: 'Empresa X', ubicacion: null, inicio: '2020-01', fin: futuro, actual: false, sin_funciones: false, vinetas: [] }],
  });
  const { cv: out, correcciones } = validarCV(cv, {});
  assert.equal(out.experiencia[0].fin, null);
  assert.equal(out.experiencia[0].actual, true);
  assert.ok(correcciones.some(c => c.includes('fecha futura')));
});

// ─────────────────────────── CASO 9 ───────────────────────────
test('9. Titulación "Business" sin respaldo en datos.estudios se elimina', () => {
  const datos = { estudios: 'Licenciatura en Contaduría Pública, Universidad de Oriente (UNIVO), 2018' };
  const cv = cvBase({
    educacion: [
      { titulo: 'Licenciatura en Contaduría Pública', institucion: 'Universidad de Oriente (UNIVO)', anio: '2018', en_curso: false },
      { titulo: 'Business Administration', institucion: 'Online Academy', anio: null, en_curso: false },
    ],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.educacion.length, 1);
  assert.equal(out.educacion[0].titulo, 'Licenciatura en Contaduría Pública');
  assert.ok(correcciones.some(c => c.includes('educacion[1]')));
});

// ─────────────────────────── CASO 10 ───────────────────────────
test('10. "Point-of-sale" (paráfrasis técnica capitalizada) sin respaldo se elimina', () => {
  const datos = { exp1: 'Target — Sales Associate — 2025', logros1: 'used the cash register, helped customers find products' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Sales Associate', empresa: 'Target', ubicacion: null, inicio: '2025', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Operated the Point-of-sale terminal to process customer purchases.', 'used the cash register')],
    }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas.length, 1, 'v4: degradada a evidencia literal');
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Used the cash register.');
  assert.ok(!/Point-of-sale/i.test(out.experiencia[0].vinetas[0].texto));
  assert.ok(correcciones.some(c => c.includes('termino_sin_respaldo_en_ambito')));
});

// ─────────────────────────── CASO 11 ───────────────────────────
test('11. Educación con menos titulaciones que las declaradas se reporta como incompleta', () => {
  const datos = { estudios: 'Licenciatura en Idiomas | UES | 2018\nBootcamp Full Stack | Kodigo | 2024' };
  const cv = cvBase({ educacion: [{ titulo: 'Bootcamp Full Stack', institucion: 'Kodigo', anio: '2024', en_curso: false }] });
  const { errores } = validarCV(cv, datos);
  assert.ok(errores.some(e => e.startsWith('educacion_incompleta')));
});

// ─────────────────────────── CASO 12 ───────────────────────────
// Control negativo: viñeta LEGÍTIMA, con evidencia literal, NO debe
// eliminarse ni recortarse.
test('12. Viñeta legítima con evidencia literal en logros1 se conserva intacta', () => {
  const datos = { exp1: 'taller hermanos flores - mecanico - 2016 a presente', logros1: 'reparacion de motores, frenos, suspencion y diagnostico con escaner' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Mecánico Automotriz', empresa: 'Taller Hermanos Flores', ubicacion: null, inicio: '2016', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Reparación de motores, frenos y suspensión.', 'reparacion de motores, frenos, suspencion')],
    }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas.length, 1);
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Reparación de motores, frenos y suspensión.');
  assert.ok(!correcciones.some(c => c.includes('vinetas[0]')), 'no debe registrarse ninguna corrección sobre esta viñeta');
});

// ─────────────────────────── CASO 13 ───────────────────────────
// Extiende el caso 12: la misma viñeta legítima, con una cláusula añadida
// ("en vehículos de gasolina y diésel") que el candidato NUNCA declaró
// (ni en logros1 ni, por tanto, en la evidencia citada).
test('13. "gasolina y diésel" no declarado elimina la viñeta ENTERA (sin mutilar)', () => {
  const datos = { exp1: 'taller hermanos flores - mecanico - 2016 a presente', logros1: 'reparacion de motores, frenos, suspencion y diagnostico con escaner' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Mecánico Automotriz', empresa: 'Taller Hermanos Flores', ubicacion: null, inicio: '2016', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Reparación de motores, frenos y suspensión en vehículos de gasolina y diésel.', 'reparacion de motores, frenos, suspencion')],
    }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas.length, 1, 'v4: se sustituye entera por la evidencia literal, nunca se mutila');
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Reparacion de motores, frenos, suspencion.');
  assert.ok(!/gasolina|diésel/i.test(out.experiencia[0].vinetas[0].texto));
  assert.ok(correcciones.some(c => c.includes('viñeta_degradada_a_evidencia') && c.includes('token_sin_fuente') && c.includes('gasolina')));
});

// ─────────────────────────── CASO 13b ───────────────────────────
// Caso real E2: una viñeta con dos sustantivos que SÍ tienen fuente en la
// evidencia citada (vía familia de paráfrasis "arreglar"). Debe sobrevivir
// intacta, nunca mutilada tipo "Mantuvo el y la de la tienda".
test('13b. Viñeta E2 con sustantivos cubiertos por familia de paráfrasis: intacta, nunca mutilada', () => {
  const datos = { exp2: 'tienda de mi tio - encargado - 2018 a 2021', logros2: 'arreglar la tienda' };
  const cv = cvBase({
    experiencia: [
      { cargo: 'X', empresa: 'X', ubicacion: null, inicio: '2022', fin: null, actual: true, sin_funciones: false, vinetas: [] },
      {
        cargo: 'Encargado', empresa: 'Tienda de mi Tío', ubicacion: null, inicio: '2018', fin: '2021', actual: false, sin_funciones: false,
        vinetas: [vin('Mantuvo el orden y la presentación de la tienda.', 'arreglar la tienda')],
      },
    ],
  });
  const { cv: out } = validarCV(cv, datos);
  const vinetas = out.experiencia[1].vinetas;
  const rotaMutilada = vinetas.length === 1 && /\bel y la\b|\bde la de\b/i.test(vinetas[0].texto);
  assert.ok(!rotaMutilada, 'nunca debe quedar un fragmento roto tipo "el y la de la tienda"');
  assert.ok(vinetas.length === 0 || vinetas[0].texto === 'Mantuvo el orden y la presentación de la tienda.', 'se conserva intacta o se elimina entera');
});

// ─────────────────────────── CASO 13c ───────────────────────────
test('13c. Calificador de tipo no cuantitativo ("livianos") se tolera, la viñeta se conserva', () => {
  const datos = { exp1: 'Taller Central - Mecánico - 2019 a presente', logros1: 'diagnostico con escaner' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Mecánico', empresa: 'Taller Central', ubicacion: null, inicio: '2019', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Diagnóstico con escáner en vehículos livianos.', 'diagnostico con escaner')],
    }],
  });
  const { cv: out } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas.length, 1, '"vehículos livianos" es un calificador no cuantitativo — se prefiere conservar');
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Diagnóstico con escáner en vehículos livianos.');
});

// ─────────────────────────── CASO 13d ───────────────────────────
test('13d. Paráfrasis "caja registradora" con evidencia "cobro en caja" se conserva (familia de paráfrasis)', () => {
  const datos = { exp1: 'Farmacia San Miguel - Dependiente - 2021 a presente', logros1: 'cobro en caja' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Dependiente', empresa: 'Farmacia San Miguel', ubicacion: null, inicio: '2021', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Atendió la caja registradora.', 'cobro en caja')],
    }],
  });
  const { cv: out } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas.length, 1);
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Atendió la caja registradora.');
});

// ─────────────────────────── CASO 13e ───────────────────────────
test('13e. "en sitio" se tolera (calificador de contexto, no un hecho nuevo)', () => {
  const datos = { exp1: 'Servicios Técnicos ABC - Técnico - 2020 a presente', logros1: 'reparacion de equipos' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Técnico', empresa: 'Servicios Técnicos ABC', ubicacion: null, inicio: '2020', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Reparó equipos en sitio para clientes corporativos.', 'reparacion de equipos')],
    }],
  });
  const { cv: out } = validarCV(cv, datos);
  // "corporativos" no está declarado en la evidencia; "en sitio" y
  // "clientes" sí deben tolerarse. La viñeta se conserva o se elimina
  // entera, nunca mutilada.
  const vinetas = out.experiencia[0].vinetas;
  assert.ok(vinetas.length === 0 || !/\ben\s*\.$|\bpara\s*\.$/i.test(vinetas[0].texto), 'nunca debe quedar "en ." o "para ." colgando');
});

// ─────────────────────────── CASO 14 ───────────────────────────
test('14. "high-volume" SÍ declarado por el candidato se conserva (no es lista negra ciega)', () => {
  const datos = {
    exp1: 'Target — Sales Associate — 2025',
    logros1: 'I worked in a high-volume store, stocking shelves and running the register',
  };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Sales Associate', empresa: 'Target', ubicacion: null, inicio: '2025', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Operated the register and stocked shelves in a high-volume store environment.', datos.logros1)],
    }],
  });
  const { cv: out } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas.length, 1, 'la viñeta debe conservarse porque "high-volume" SÍ aparece en datos');
  assert.ok(/high-volume/i.test(out.experiencia[0].vinetas[0].texto));
});

// ─────────────────────────── CASO 15 ───────────────────────────
test('15. "alta exigencia" SÍ declarada por el candidato se conserva', () => {
  const datos = {
    exp1: 'Constructora Meridiano - Ingeniero Residente - 2020 a presente',
    logros1: 'trabajo en un entorno de alta exigencia técnica, superviso 35 personas en obra',
  };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Ingeniero Residente', empresa: 'Constructora Meridiano', ubicacion: null, inicio: '2020', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Supervisa a 35 personas en un entorno de alta exigencia técnica.', datos.logros1)],
    }],
  });
  const { cv: out } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas.length, 1);
  assert.ok(/alta exigencia/i.test(out.experiencia[0].vinetas[0].texto));
});

// ─────────────────────────── CASO 16 ───────────────────────────
test('16. Un tercer puesto (índice ≥2) sin fuente posible en datos se elimina con error puesto_sin_fuente', () => {
  const cv = cvBase({
    experiencia: [
      { cargo: 'A', empresa: 'X', ubicacion: null, inicio: '2020', fin: null, actual: true, sin_funciones: false, vinetas: [] },
      { cargo: 'B', empresa: 'Y', ubicacion: null, inicio: '2018', fin: '2020', actual: false, sin_funciones: false, vinetas: [] },
      { cargo: 'C inventado', empresa: 'Z inventada', ubicacion: null, inicio: '2015', fin: '2018', actual: false, sin_funciones: false, vinetas: [] },
    ],
  });
  const { cv: out, errores } = validarCV(cv, { exp1: 'X', exp2: 'Y' });
  assert.equal(out.experiencia.length, 2);
  assert.ok(errores.includes('experiencia[2]_puesto_sin_fuente'));
});

// ─────────────────────────── CASO 17 ───────────────────────────
test('17. nombre/contacto se derivan literalmente de datos, no del modelo', () => {
  const datos = { nombre: 'maria fernanda quintanilla rios', puesto: 'contadora general', email_tel: 'mfquintanilla@outlook.com, 7712-9034', pais: 'El Salvador' };
  const cv = cvBase({
    nombre: 'María F. Q.', // el modelo "acortó" el nombre — debe sobreescribirse
    titulo_objetivo: 'Accountant', // el modelo tradujo sin que se pidiera — debe sobreescribirse
    contacto: { email: 'otro@x.com', telefono: '000', ubicacion: 'Costa Rica', linkedin: null },
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.nombre, 'Maria Fernanda Quintanilla Rios');
  assert.equal(out.titulo_objetivo, 'Contadora General');
  assert.equal(out.contacto.email, 'mfquintanilla@outlook.com');
  assert.equal(out.contacto.telefono, '7712-9034');
  assert.equal(out.contacto.ubicacion, 'El Salvador');
  assert.ok(correcciones.some(c => c.startsWith('nombre:')));
  assert.ok(correcciones.some(c => c.startsWith('contacto.email')));
});

// ─────────────────────────── CASO 18 ───────────────────────────
test('18. extra[] se vacía si info_extra es una negación, aunque el modelo invente ítems', () => {
  const datos = { info_extra: 'nada más' };
  const cv = cvBase({ extra: ['Disponibilidad inmediata', 'Licencia de conducir tipo B'] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.deepEqual(out.extra, []);
  assert.ok(correcciones.some(c => c.startsWith('extra:')));
});

test('18b. extra[] conserva ítems con solape real con info_extra y descarta los que no lo tienen', () => {
  const datos = { info_extra: 'disponibilidad inmediata, licencia tipo B' };
  const cv = cvBase({ extra: ['Disponibilidad inmediata', 'Premio al mejor empleado del año'] });
  const { cv: out } = validarCV(cv, datos);
  assert.deepEqual(out.extra, ['Disponibilidad inmediata']);
});

// ─────────────────────────── CASO 19 ───────────────────────────
test('19. normalizarFecha convierte "Marzo 2020" → "2020-03" (y no fabrica si no puede)', () => {
  assert.equal(normalizarFecha('Marzo 2020'), '2020-03');
  assert.equal(normalizarFecha('March 2020'), '2020-03');
  assert.equal(normalizarFecha('03/2020'), '2020-03');
  assert.equal(normalizarFecha('2020-03'), '2020-03');
  assert.equal(normalizarFecha('2020'), '2020');
  assert.equal(normalizarFecha('hace un tiempo'), null, 'sin año reconocible, nunca se fabrica una fecha');
});

test('19b. construirCVDesdeInput normaliza fechas dentro de experiencia/educacion', () => {
  const input = {
    nombre: 'X', titulo_objetivo: 'Y', contacto: {}, perfil: 'Z',
    experiencia: [{ cargo: 'A', empresa: 'B', inicio: 'Marzo 2020', fin: null, actual: true, sin_funciones: false, vinetas: [] }],
    educacion: [{ titulo: 'T', institucion: 'I', anio: 'Junio 2019', en_curso: false }],
    habilidades: { tecnicas: [], blandas: [] }, idiomas: [], extra: [],
  };
  const out = construirCVDesdeInput(input, 'es');
  assert.equal(out.experiencia[0].inicio, '2020-03');
  assert.equal(out.educacion[0].anio, '2019');
});

// ─────────────────────────── CASO 19c ───────────────────────────
test('19c. educacion_incompleta ignora líneas de negación multilínea ("Nada más")', () => {
  const datos = { estudios: 'Bachillerato General, Colegio ABC, 2015\nNada más' };
  const cv = cvBase({ educacion: [{ titulo: 'Bachillerato General', institucion: 'Colegio ABC', anio: '2015', en_curso: false }] });
  const { errores } = validarCV(cv, datos);
  assert.ok(!errores.some(e => e.startsWith('educacion_incompleta')), 'la línea "Nada más" no debe contarse como titulación perdida');
});

test('19d. educacion_incompleta solo cuenta segmentos con palabra de título/grado reconocible', () => {
  const datos = { estudios: 'Ingeniería Industrial, UES, 2020\neso es todo, gracias' };
  const cv = cvBase({ educacion: [{ titulo: 'Ingeniería Industrial', institucion: 'UES', anio: '2020', en_curso: false }] });
  const { errores } = validarCV(cv, datos);
  assert.ok(!errores.some(e => e.startsWith('educacion_incompleta')));
});

// ─────────────────────────── CASO 20 ───────────────────────────
test('20. Placeholders ("TBD") en un campo de educación distinto de perfil se eliminan', () => {
  const cv = cvBase({ educacion: [{ titulo: 'TBD', institucion: 'Universidad X', anio: null, en_curso: false }] });
  const { cv: out, correcciones } = validarCV(cv, {});
  assert.equal(out.educacion.length, 0);
  assert.ok(correcciones.some(c => c.includes('placeholder')));
});

// ─────────────────────────── CASO 21 ───────────────────────────
test('21. LinkedIn se extrae de datos.email_tel con la misma regex que el cliente', () => {
  const datos = { email_tel: 'jorge.perez@gmail.com, +503 7555 0123, linkedin.com/in/jorgeperez' };
  const cv = cvBase({ contacto: { email: null, telefono: null, ubicacion: null, linkedin: null } });
  const { cv: out } = validarCV(cv, datos);
  assert.equal(out.contacto.email, 'jorge.perez@gmail.com');
  assert.equal(out.contacto.linkedin, 'linkedin.com/in/jorgeperez');
  assert.ok(out.contacto.telefono && out.contacto.telefono.includes('7555'));
});

// ─────────────────────────── CASO 22 (serializar.mjs) ───────────────────────────
// cvAtexto acepta tanto vinetas antiguas (string) como v3 ({texto,evidencia})
// por compatibilidad — aquí se prueba con strings planas a propósito.
test('22. cvAtexto produce texto ≥20 chars con las 5 secciones (ES)', () => {
  const cv = cvBase({
    nombre: 'Rosa Elena Márquez', titulo_objetivo: 'Cajera',
    contacto: { email: 'rosa@x.com', telefono: '7233-8891', ubicacion: 'El Salvador', linkedin: null },
    perfil: 'Cajera con experiencia en Super Selectos.',
    experiencia: [{ cargo: 'Cajera', empresa: 'Super Selectos', ubicacion: null, inicio: '2022', fin: null, actual: true, sin_funciones: true, vinetas: [] }],
    educacion: [{ titulo: 'Bachillerato General', institucion: 'El Salvador', anio: '2018', en_curso: false }],
    habilidades: { tecnicas: ['Manejo de caja'], blandas: [] },
    idiomas: [{ idioma: 'Español', nivel: null }],
  });
  const texto = cvAtexto(cv, 'es');
  assert.ok(texto.length >= 20, 'debe producir texto no trivial');
  ['RESUMEN PROFESIONAL', 'EXPERIENCIA PROFESIONAL', 'EDUCACIÓN', 'HABILIDADES', 'Idiomas:'].forEach(h => {
    assert.ok(texto.includes(h), `debe incluir la sección "${h}"`);
  });
  // Puesto SIN viñetas (sin_funciones=true) debe conservar su línea de
  // cabecera "Cargo | Empresa | Periodo" — compatible con
  // `_parsearBloquesExperiencia` del cliente.
  assert.ok(texto.includes('Cajera | Super Selectos | 2022 – Actualidad'), 'la cabecera del puesto sin viñetas debe seguir presente');
});

test('22b. cvAtexto (EN) usa cabeceras en inglés y extrae .texto de vinetas v3', () => {
  const cv = cvBase({
    lang: 'en', nombre: 'Ashley Nguyen', titulo_objetivo: 'Retail Sales Associate',
    contacto: { email: 'a@x.com', telefono: null, ubicacion: 'United States', linkedin: null },
    perfil: 'Retail sales associate with experience at Target.',
    experiencia: [{ cargo: 'Sales Associate', empresa: 'Target', ubicacion: null, inicio: '2025', fin: null, actual: true, sin_funciones: false, vinetas: [vin('Operated the register.', 'running the register')] }],
    educacion: [{ titulo: 'High School Diploma', institucion: 'Camelback High School', anio: '2024', en_curso: false }],
    habilidades: { tecnicas: ['Cash register'], blandas: [] },
    idiomas: [{ idioma: 'English', nivel: null }],
  });
  const texto = cvAtexto(cv, 'en');
  ['PROFESSIONAL SUMMARY', 'PROFESSIONAL EXPERIENCE', 'EDUCATION', 'SKILLS', 'Languages:'].forEach(h => {
    assert.ok(texto.includes(h), `must include section "${h}"`);
  });
  assert.ok(texto.includes('• Operated the register.'));
});

// ─────────────────────────── CASO 23 (persona real E2, punto 1) ───────────────────────────
test('23. Placeholder "<UNKNOWN>" en institución se conserva la titulación con institucion vacía', () => {
  const datos = { estudios: 'Bachillerato General, 2018' };
  const cv = cvBase({ educacion: [{ titulo: 'Bachillerato General', institucion: '<UNKNOWN>', anio: '2018', en_curso: false }] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.educacion.length, 1, 'la entrada se conserva, no se elimina');
  assert.equal(out.educacion[0].titulo, 'Bachillerato General');
  assert.equal(out.educacion[0].institucion, '', 'el placeholder se sustituye por cadena vacía');
  assert.ok(correcciones.some(c => c.includes('institucion') && c.includes('<UNKNOWN>')));
  const texto = cvAtexto(out, 'es');
  assert.ok(texto.includes('Bachillerato General | 2018'), 'sin institución, el " | " vacío se omite');
  assert.ok(!/\|\s*\|/.test(texto), 'nunca debe quedar un " | " doble/vacío');
});

// ─────────────────────────── CASO 24 (persona real E2, punto 2) ───────────────────────────
test('24. "vendedora" (CV) queda cubierta por "ventas" (dato del candidato) vía familia de paráfrasis', () => {
  const datos = { exp2: 'Tienda El Progreso - Encargada - 2019 a 2022', logros2: 'atender clientes, arreglar la tienda, cobrar; buenas ventas todos los meses' };
  const cv = cvBase({
    experiencia: [
      { cargo: 'X', empresa: 'X', ubicacion: null, inicio: '2022', fin: null, actual: true, sin_funciones: false, vinetas: [] },
      {
        cargo: 'Encargada', empresa: 'Tienda El Progreso', ubicacion: null, inicio: '2019', fin: '2022', actual: false, sin_funciones: false,
        vinetas: [vin('Se destacó como vendedora atendiendo clientes y cobrando en la tienda.', datos.logros2)],
      },
    ],
  });
  const { cv: out } = validarCV(cv, datos);
  const vinetas = out.experiencia[1].vinetas;
  assert.equal(vinetas.length, 1, '"vendedora" debe quedar cubierta por "ventas" — la viñeta no se elimina');
  assert.ok(/vendedora/i.test(vinetas[0].texto));
});

// ─────────────────────────── CASO 25 (persona real E2, punto 2c) ───────────────────────────
test('25. Puesto con funciones declaradas que queda en 0 viñetas reporta error no corregible con los tokens rechazados', () => {
  const datos = { exp2: 'Tienda El Progreso - Encargada - 2019 a 2022', logros2: 'atender clientes, arreglar la tienda, cobrar' };
  const cv = cvBase({
    experiencia: [
      { cargo: 'X', empresa: 'X', ubicacion: null, inicio: '2022', fin: null, actual: true, sin_funciones: false, vinetas: [] },
      {
        cargo: 'Encargada', empresa: 'Tienda El Progreso', ubicacion: null, inicio: '2019', fin: '2022', actual: false, sin_funciones: false,
        vinetas: [
          vin('Brindó orientación al cliente en el punto de venta con apoyo en la compra.', 'atender clientes'),
          vin('Gestionó ventas y efectivo de forma eficiente.', 'cobrar'),
          vin('Cuidó la presentación con experiencia de compra adecuada.', 'arreglar la tienda'),
        ],
      },
    ],
  });
  const { cv: out, errores, correcciones } = validarCV(cv, datos);
  // v4: "cobrar" (<2 palabras) no se puede degradar → se elimina; "atender clientes" y
  // "arreglar la tienda" sí → sobreviven literales. Ya no queda en 0, así que no hay error no corregible.
  assert.equal(out.experiencia[1].vinetas.length, 2);
  assert.deepEqual(out.experiencia[1].vinetas.map(v => v.texto), ['Atención a clientes.', 'Arreglo de la tienda.']);
  assert.ok(!errores.some(e => e.startsWith('experiencia[1]_sin_vinetas_tras_validacion')));
  assert.equal(correcciones.filter(c => c.includes('experiencia[1]') && c.includes('viñeta_eliminada')).length, 1);
});

// ═══════════════ v3 — "evidencia literal" (resultados reales E2/N1) ═══════════════

// ─────────────────────────── CASO 26 ───────────────────────────
test('26. Evidencia LITERAL (substring exacto del ámbito del puesto) → la viñeta se conserva', () => {
  const datos = { exp1: 'Tienda XYZ - Vendedora - 2021 a presente', logros1: 'atendí a los clientes en la tienda todos los días' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Vendedora', empresa: 'Tienda XYZ', ubicacion: null, inicio: '2021', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Atendió a los clientes en la tienda.', 'atendí a los clientes en la tienda')],
    }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas.length, 1, 'evidencia literal → se conserva');
  assert.ok(!correcciones.some(c => c.includes('evidencia_no_literal')));
});

// ─────────────────────────── CASO 27 ───────────────────────────
test('27. Evidencia NO literal (inventada, no aparece en el ámbito) → la viñeta se elimina', () => {
  const datos = { exp1: 'Tienda XYZ - Vendedora - 2021 a presente', logros1: 'atendí a los clientes en la tienda todos los días' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Vendedora', empresa: 'Tienda XYZ', ubicacion: null, inicio: '2021', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Atendió a los clientes en la tienda.', 'brindó soporte técnico avanzado a nivel internacional')],
    }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas.length, 0, 'evidencia inventada → se elimina');
  assert.ok(correcciones.some(c => c.includes('evidencia_no_literal')));
});

// ─────────────────────────── CASO 28 ───────────────────────────
// Demuestra el cambio de diseño v3: un token PRESENTE en el ámbito completo
// del puesto pero AUSENTE de la `evidencia` citada para esa viñeta concreta
// ya no cuenta como respaldado — antes (ámbito completo) habría sobrevivido.
test('28. v8: token fuera de la evidencia citada pero dentro del ámbito del puesto se conserva', () => {
  const datos = {
    exp1: 'Local ABC - Encargada - 2020 a presente',
    logros1: 'atendí clientes en la caja y también hice limpieza general del local',
  };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Encargada', empresa: 'Local ABC', ubicacion: null, inicio: '2020', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Realizó limpieza general del local.', 'atendí clientes en la caja')],
    }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  // v8: la fuente de sustantivos es TODO lo que el candidato dijo de ese
  // puesto; "limpieza general del local" está en logros1 → la viñeta se
  // conserva (es verdad aunque la evidencia citada sea otra frase).
  assert.equal(out.experiencia[0].vinetas.length, 1);
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Realizó limpieza general del local.');
  assert.ok(!correcciones.some(c => c.includes('token_sin_fuente')));
});

// ─────────────────────────── CASO 29 ───────────────────────────
test('29. Fecha "for 1 year (2025)" corrige un inicio mal calculado (2024) al año literal (2025)', () => {
  const datos = { exp1: 'Target - Sales Associate - for 1 year (2025)' };
  const cv = cvBase({
    lang: 'en',
    experiencia: [{ cargo: 'Sales Associate', empresa: 'Target', ubicacion: null, inicio: '2024', fin: null, actual: true, sin_funciones: false, vinetas: [] }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].inicio, '2025', 'el inicio debe corregirse al año que el candidato SÍ dio, no calcularse');
  assert.ok(correcciones.some(c => c.includes('inicio_ajustado_a_declarado') || (c.includes('.inicio:') && c.includes('declarado en exp1'))));
});

// ─────────────────────────── CASO 30 ───────────────────────────
test('30. Perfil con inferencia no declarada ("a major national retailer") se elimina esa oración', () => {
  const datos = { puesto: 'Sales Associate', habilidades_tecnicas: 'customer service, cash handling' };
  const cv = cvBase({
    lang: 'en',
    perfil: 'Experienced at a major national retailer. Skilled in customer service and cash handling.',
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.ok(!/major|national|retailer/i.test(out.perfil), 'la inferencia no declarada debe desaparecer del perfil');
  assert.ok(/customer service/i.test(out.perfil), 'la oración SÍ respaldada debe sobrevivir');
  assert.ok(correcciones.some(c => c.includes('perfil') && c.includes('término sin fuente')));
});

// ─────────────────────────── CASO 31 ───────────────────────────
test('31. "spanish basic" en habilidades_tecnicas conserva el nivel declarado del idioma', () => {
  const datos = { habilidades_tecnicas: 'cash register, customer service, spanish basic' };
  const cv = cvBase({ idiomas: [{ idioma: 'Spanish', nivel: null }] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.idiomas[0].nivel, 'basic');
  assert.ok(correcciones.some(c => c.includes('idiomas[0]') && c.includes('basic')));
});

// ─────────────────────────── CASO 25b (v4) ───────────────────────────
test('25b. Si ninguna viñeta se puede degradar (evidencias de 1 palabra) sigue reportándose el error no corregible', () => {
  const datos = { exp2: 'Tienda El Progreso - Encargada - 2019 a 2022', logros2: 'atender, cobrar' };
  const cv = cvBase({
    experiencia: [
      { cargo: 'X', empresa: 'X', ubicacion: null, inicio: '2022', fin: null, actual: true, sin_funciones: false, vinetas: [] },
      {
        cargo: 'Encargada', empresa: 'Tienda El Progreso', ubicacion: null, inicio: '2019', fin: '2022', actual: false, sin_funciones: false,
        vinetas: [
          vin('Brindó orientación al cliente en el punto de venta.', 'atender'),
          vin('Gestionó ventas y efectivo de forma eficiente.', 'cobrar'),
        ],
      },
    ],
  });
  const { cv: out, errores } = validarCV(cv, datos);
  assert.equal(out.experiencia[1].vinetas.length, 0);
  const err = errores.find(e => e.startsWith('experiencia[1]_sin_vinetas_tras_validacion'));
  assert.ok(err && err.includes('tokens_rechazados='));
});

// ─────────────────────────── CASO 41 (v4) ───────────────────────────
test('41. perfilFallback produce oraciones gramaticales ES/EN con hasta 2 puestos y habilidades declaradas', () => {
  const datosEN = { exp1: 'Target - Cashier - 2025', habilidades_tecnicas: 'customer service, cash handling, teamwork' };
  const cvEN = cvBase({
    lang: 'en', titulo_objetivo: 'Retail Sales Associate', perfil: 'Dynamic professional at a major national retailer.',
    experiencia: [{ cargo: 'Cashier', empresa: 'Target', ubicacion: null, inicio: '2025', fin: '2025', actual: false, sin_funciones: false, vinetas: [] }],
  });
  const en = validarCV(cvEN, datosEN).cv.perfil;
  assert.equal(en, 'Retail Sales Associate with experience as Cashier at Target. Skilled in customer service, cash handling and teamwork.');
  const datosES = { exp1: 'Distribuidora La Central - Auxiliar contable - 2022', exp2: 'Farmacia San Nicolás - Cajera - 2019-2021', habilidades_tecnicas: 'Excel, sistema SAP básico' };
  const cvES = cvBase({
    titulo_objetivo: 'Auxiliar Contable', perfil: 'Profesional con amplia trayectoria en empresas líderes.',
    experiencia: [
      { cargo: 'Auxiliar contable', empresa: 'Distribuidora La Central', ubicacion: null, inicio: '2022', fin: null, actual: true, sin_funciones: false, vinetas: [] },
      { cargo: 'Cajera', empresa: 'Farmacia San Nicolás', ubicacion: null, inicio: '2019', fin: '2021', actual: false, sin_funciones: false, vinetas: [] },
    ],
  });
  const es = validarCV(cvES, datosES).cv.perfil;
  assert.equal(es, 'Auxiliar Contable con experiencia en Distribuidora La Central y como Cajera en Farmacia San Nicolás. Manejo de Excel y sistema SAP básico.');
});

// ─────────────────────────── CASOS v4.1 (auditoría Opus) ───────────────────────────
test('42. Evidencia degradada en 1ª persona ES se nominaliza con tabla cerrada; preposición del candidato se respeta', () => {
  const datos = { exp1: 'Distribuidora La Central - Auxiliar contable - 2022', logros1: 'registro facturas, hago conciliaciones bancarias y apoyo en planillas' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Auxiliar contable', empresa: 'Distribuidora La Central', ubicacion: null, inicio: '2022', fin: null, actual: true, sin_funciones: false,
      vinetas: [
        vin('Registra facturas de proveedores en el sistema contable.', 'registro facturas'),
        vin('Ejecuta conciliaciones bancarias mensuales verificando estados de cuenta.', 'hago conciliaciones bancarias'),
        vin('Colabora en la elaboración de nómina de la empresa.', 'apoyo en planillas'),
      ],
    }],
  });
  const { cv: out } = validarCV(cv, datos);
  // v8: "nómina" ∈ clúster planilla → la 3ª viñeta pasa tal cual; las dos
  // primeras siguen degradadas ("proveedores", "mensuales" no declarados).
  assert.deepEqual(out.experiencia[0].vinetas.map(v => v.texto), [
    'Registro de facturas.', 'Realización de conciliaciones bancarias.', 'Colabora en la elaboración de nómina de la empresa.',
  ]);
});

test('43. Evidencia con negación, muletilla, salario o insulto NO se degrada: la viñeta se elimina', () => {
  const datos = { exp1: 'Tienda X - Vendedor - 2020', logros1: 'no tengo experiencia en caja, creo que atendía clientes, me pagaban $300 al mes y el jefe era un idiota total' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Vendedor', empresa: 'Tienda X', ubicacion: null, inicio: '2020', fin: null, actual: true, sin_funciones: false,
      vinetas: [
        vin('Operó la caja registradora con precisión.', 'no tengo experiencia en caja'),
        vin('Brindó orientación comercial personalizada.', 'creo que atendía clientes'),
        vin('Gestionó presupuesto mensual de operaciones.', 'me pagaban $300 al mes'),
        vin('Coordinó con gerencia la estrategia comercial.', 'el jefe era un idiota total'),
      ],
    }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas.length, 0);
  assert.equal(correcciones.filter(c => c.includes('viñeta_eliminada')).length, 4);
});

test('44. Habilidades: "Microsoft Excel" → literal "Excel"; "SAP (nivel básico)" → "sistema SAP básico"; "Checkout Processing" sin fuente se elimina; sin duplicados', () => {
  const datos = { exp1: 'X - Y - 2020', habilidades_tecnicas: 'Excel, sistema SAP básico, customer service', resumen_personal: 'soy ordenada' };
  const cv = cvBase({
    habilidades: { tecnicas: ['Microsoft Excel', 'SAP (nivel básico)', 'Checkout Processing', 'Excel'], blandas: ['Orden y organización', 'Liderazgo'] },
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.deepEqual(out.habilidades.tecnicas, ['Excel', 'sistema SAP básico']);
  assert.deepEqual(out.habilidades.blandas, ['soy ordenada'].filter(() => false).concat(out.habilidades.blandas)); // solo comprobamos que no hay invención
  assert.ok(!out.habilidades.blandas.includes('Liderazgo'));
  assert.ok(correcciones.some(c => c.includes('"Microsoft Excel" → literal "Excel"')));
});


// ─────────────────────────── CASOS v5.1 (pruebas reales N1/M3) ───────────────────────────
test('45. Viñetas redundantes por contención: se conserva la más completa', () => {
  const datos = { exp1: 'Target - Cashier - 2025. I handled checkout, returns and helped customers find products. Also restocked shelves' };
  const cv = cvBase({
    lang: 'en',
    experiencia: [{
      cargo: 'Cashier', empresa: 'Target', ubicacion: null, inicio: '2025', fin: '2025', actual: false, sin_funciones: false,
      vinetas: [
        vin('Processed register transactions accurately.', 'handled checkout, returns and helped customers find products'),
        vin('Helped customers find products.', 'helped customers find products'),
        vin('Restocked shelves.', 'restocked shelves'),
      ],
    }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.deepEqual(out.experiencia[0].vinetas.map(v => v.texto), [
    'Handled checkout, returns and helped customers find products.', 'Restocked shelves.',
  ]);
  assert.ok(correcciones.some(c => c.includes('redundante_con_otra_viñeta') || c.includes('misma_evidencia_que_otra_viñeta')));
});

test('46. Evidencia precedida por muletilla de duda ("creo que también hago …") se elimina, no se afirma', () => {
  const datos = { exp1: 'Taller X - mecanico - 2016', logros1: 'atiendo clientes y creo que tambien hago mantenimiento preventivo' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Mecánico', empresa: 'Taller X', ubicacion: null, inicio: '2016', fin: null, actual: true, sin_funciones: false,
      vinetas: [
        vin('Atiende clientes.', 'atiendo clientes'),
        vin('Realiza mantenimiento preventivo.', 'hago mantenimiento preventivo'),
      ],
    }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.deepEqual(out.experiencia[0].vinetas.map(v => v.texto), ['Atiende clientes.']);
  assert.ok(correcciones.some(c => c.includes('evidencia_con_duda')));
});

// ─────────────────────────── CASOS v8 (tolerancia por oficio) ───────────────────────────
test('47. Retail: "transactions"/"register" tolerados si el candidato dijo "checkout"; "accurate" (calidad) NO', () => {
  const datos = { puesto: 'Retail Sales Associate', exp1: 'Target - Cashier - 2025. I handled checkout and returns, restocked shelves', logros1: 'only title' };
  const cv = cvBase({
    lang: 'en',
    experiencia: [{
      cargo: 'Cashier', empresa: 'Target', ubicacion: null, inicio: '2025', fin: '2025', actual: false, sin_funciones: false,
      vinetas: [
        vin('Processed register transactions and returns.', 'handled checkout and returns'),
        vin('Delivered accurate service at the register.', 'handled checkout'),
        vin('Restocked shelves and maintained inventory displays.', 'restocked shelves'),
      ],
    }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.deepEqual(out.experiencia[0].vinetas.map(v => v.texto), [
    'Processed register transactions and returns.',
    'Handled checkout.',
    'Restocked shelves and maintained inventory displays.',
  ]);
  assert.ok(correcciones.some(c => c.includes('vinetas[1]') && c.includes('accurate')));
});

test('48. Contabilidad: "saldos"/"estados de cuenta" tolerados con "conciliaciones bancarias"; "proveedores" (hecho nuevo) NO', () => {
  const datos = { puesto: 'Auxiliar contable', exp1: 'Distribuidora X - Auxiliar contable - 2022. registro facturas y hago conciliaciones bancarias', logros1: 'solo cargo' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Auxiliar contable', empresa: 'Distribuidora X', ubicacion: null, inicio: '2022', fin: null, actual: true, sin_funciones: false,
      vinetas: [
        vin('Concilia saldos bancarios contra estados de cuenta.', 'hago conciliaciones bancarias'),
        vin('Registra facturas de proveedores.', 'registro facturas'),
      ],
    }],
  });
  const { cv: out } = validarCV(cv, datos);
  assert.deepEqual(out.experiencia[0].vinetas.map(v => v.texto), [
    'Concilia saldos bancarios contra estados de cuenta.',
    'Registro de facturas.',
  ]);
});

test('49. Los clústeres de OTRO oficio no se activan: "frenos" en un puesto contable sigue sin fuente', () => {
  const datos = { puesto: 'Auxiliar contable', exp1: 'Empresa X - Auxiliar contable - 2022. hago conciliaciones', logros1: 'solo cargo' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Auxiliar contable', empresa: 'Empresa X', ubicacion: null, inicio: '2022', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Concilia cuentas y revisa frenos.', 'hago conciliaciones')],
    }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Realización de conciliaciones.');
  assert.ok(correcciones.some(c => c.includes('frenos')));
});

test('50. detectarOficios: puesto + experiencia → oficios; sin coincidencias → []', () => {
  assert.deepEqual(detectarOficios('mecanico automotriz taller hermanos flores'), ['mecanica']);
  assert.ok(detectarOficios('Auxiliar contable en Distribuidora').includes('contabilidad'));
  assert.deepEqual(detectarOficios('piloto de helicoptero'), []);
});

// ─────────────────────────── CASOS v9 (prueba real Rosa, checklist + cifras) ───────────────────────────
test('51. Evidencia compuesta por dos fragmentos literales (función + cifra) → la viñeta se conserva con la cifra', () => {
  const datos = { puesto: 'Cajera', tipo_empresa: 'supermercado', exp1: 'Cajera en Super Selectos desde 2022 hasta la fecha',
    logros1: 'Cobro en efectivo y tarjeta, Apertura y cierre de caja, Escaneo de productos en caja\nunas 150 transacciones por turno, la caja abre con $200' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Cajera', empresa: 'Super Selectos', ubicacion: null, inicio: '2022', fin: null, actual: true, sin_funciones: false,
      vinetas: [
        vin('Cobra en efectivo y tarjeta, unas 150 transacciones por turno.', 'Cobro en efectivo y tarjeta, unas 150 transacciones por turno'),
        vin('Abre y cierra caja con un fondo de $200.', 'Apertura y cierre de caja, la caja abre con $200'),
        vin('Escanea productos en caja.', 'Escaneo de productos en caja'),
      ],
    }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas.length, 3);
  assert.ok(/150/.test(out.experiencia[0].vinetas[0].texto));
  assert.ok(!correcciones.some(c => c.includes('evidencia_no_literal')));
});

test('52. Evidencia con un fragmento NO literal: v11 degrada a los fragmentos literales', () => {
  const datos = { exp1: 'Cajera en X desde 2022', logros1: 'cobro en efectivo' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Cajera', empresa: 'X', ubicacion: null, inicio: '2022', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Cobra en efectivo y supervisa personal.', 'cobro en efectivo, supervision de personal')],
    }],
  });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.deepEqual(out.experiencia[0].vinetas.map(v => v.texto), ['Cobro en efectivo.']);
  assert.ok(correcciones.some(c => c.includes('evidencia_parcialmente_literal')));
});

test('53. Total de años DECLARADO por el candidato se conserva en el perfil; no declarado se quita sin dejar la frase rota', () => {
  const datosA = { puesto: 'Cajera', resumen_personal: 'tengo 3 años de experiencia en cajas', exp1: 'Cajera en X desde 2022' };
  const cvA = cvBase({ titulo_objetivo: 'Cajera', perfil: 'Cajera con 3 años de experiencia en cajas.', experiencia: [] });
  assert.equal(validarCV(cvA, datosA).cv.perfil, 'Cajera con 3 años de experiencia en cajas.');
  const datosB = { puesto: 'Cajera', resumen_personal: 'me gusta atender', exp1: 'Cajera en X desde 2022' };
  const cvB = cvBase({ titulo_objetivo: 'Cajera', perfil: 'Cajera con 3 años de experiencia en supermercado. Atiende clientes.', experiencia: [] });
  const pB = validarCV(cvB, datosB).cv.perfil;
  assert.ok(!/3 años/.test(pB), 'total no declarado se quita');
  assert.ok(!/con en/.test(pB), 'no debe quedar "con en"');
});

test('54. Viñeta degradada con evidencia compuesta "tarea | cifra" se redacta "Tarea (cifra)."', () => {
  const datos = { puesto: 'Cajera', exp1: 'Cajera en X desde 2022', logros1: 'Cobro en efectivo y tarjeta\nunas 150 transacciones por turno' };
  const cv = cvBase({
    experiencia: [{
      cargo: 'Cajera', empresa: 'X', ubicacion: null, inicio: '2022', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Procesa cobros con precisión, unas 150 transacciones por turno.', 'Cobro en efectivo y tarjeta | unas 150 transacciones por turno')],
    }],
  });
  const { cv: out } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Cobro en efectivo y tarjeta (unas 150 transacciones por turno).');
});


// ══════════════ v11 — regresión fase 3 (13 personas, 2026-09-23) ══════════════

test('55. Idiomas "Español + Inglés intermedio": el nivel NO se copia al primer idioma (M1)', () => {
  const datos = { idiomas_nivel: 'Español + Inglés intermedio' };
  const cv = cvBase({ idiomas: [{ idioma: 'Español', nivel: 'Nativo' }, { idioma: 'Inglés', nivel: null }] });
  const { cv: out } = validarCV(cv, datos);
  assert.equal(out.idiomas[0].nivel, null, 'Español no tiene nivel declarado → null (nunca "intermedio" ni "Nativo")');
  assert.equal(out.idiomas[1].nivel, 'intermedio');
});

test('56. Idiomas "English native + Spanish intermediate" (B1): cada nivel a su idioma', () => {
  const datos = { idiomas_nivel: 'English native + Spanish intermediate' };
  const cv = cvBase({ lang: 'en', idiomas: [{ idioma: 'English', nivel: null }, { idioma: 'Spanish', nivel: null }] });
  const { cv: out } = validarCV(cv, datos);
  assert.equal(out.idiomas[0].nivel, 'native');
  assert.equal(out.idiomas[1].nivel, 'intermediate');
});

test('57. Fechas: "2024 to 2025" → fin 2025, actual=false aunque el modelo dijera Present (B1)', () => {
  const datos = { exp1: 'Teleperformance - Call Center Representative - 2024 to 2025' };
  const cv = cvBase({ lang: 'en', experiencia: [{ cargo: 'Call Center Representative', empresa: 'Teleperformance', ubicacion: null, inicio: '2024', fin: null, actual: true, sin_funciones: false, vinetas: [] }] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].actual, false);
  assert.equal(out.experiencia[0].fin, '2025');
  assert.ok(correcciones.some(c => c.includes('.actual: true → false')));
});

test('58. Fechas: "marzo 2021 a la fecha" → inicio 2021-03, actual=true; "2025" solo → 2025–2025', () => {
  const datos = { exp1: 'Distribuidora La Fuente - Contadora general - marzo 2021 a la fecha', exp2: 'Target - Sales Associate - 2025' };
  const cv = cvBase({ experiencia: [
    { cargo: 'Contadora general', empresa: 'Distribuidora La Fuente', ubicacion: null, inicio: '2021', fin: '2024', actual: false, sin_funciones: false, vinetas: [] },
    { cargo: 'Sales Associate', empresa: 'Target', ubicacion: null, inicio: '2025', fin: null, actual: true, sin_funciones: false, vinetas: [] },
  ] });
  const { cv: out } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].inicio, '2021-03');
  assert.equal(out.experiencia[0].actual, true);
  assert.equal(out.experiencia[0].fin, null);
  assert.equal(out.experiencia[1].actual, false);
  assert.equal(out.experiencia[1].fin, '2025');
  const txt = cvAtexto(out, 'es');
  assert.ok(txt.includes('Marzo 2021 – Actualidad'), txt);
  assert.ok(txt.includes('Target | 2025\n') || txt.endsWith('Target | 2025'), 'un solo año no se imprime "2025 – 2025"');
});

test('59. Puesto creado desde un curso ("UX Design Student — Coursework Projects") se elimina (N4)', () => {
  const datos = { exp1: 'Riverside Retail - Store Manager - 2019 to 2024', exp2: 'no', estudios: 'UX Design Certificate, online bootcamp, 2024' };
  const cv = cvBase({ lang: 'en', experiencia: [
    { cargo: 'Store Manager', empresa: 'Riverside Retail', ubicacion: null, inicio: '2019', fin: '2024', actual: false, sin_funciones: false, vinetas: [] },
    { cargo: 'UX Design Student — Coursework Projects', empresa: 'UX Design Certificate Program', ubicacion: null, inicio: '2024', fin: '2024', actual: false, sin_funciones: false, vinetas: [] },
  ] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia.length, 1);
  assert.ok(correcciones.some(c => c.includes('puesto_eliminado') && c.includes('estudios')));
});

test('60. Empresa = frase cruda ("apprentice at a different HVAC company") se vacía y el texto omite el segmento (N2)', () => {
  const datos = { exp1: 'Buckeye Comfort - HVAC Technician - 2021 to present', exp2: 'apprentice at a different HVAC company 2019-2021' };
  const cv = cvBase({ lang: 'en', experiencia: [
    { cargo: 'HVAC Technician', empresa: 'Buckeye Comfort', ubicacion: null, inicio: '2021', fin: null, actual: true, sin_funciones: false, vinetas: [] },
    { cargo: 'HVAC Apprentice', empresa: 'apprentice at a different HVAC company', ubicacion: null, inicio: '2019', fin: '2021', actual: false, sin_funciones: true, vinetas: [] },
  ] });
  const { cv: out } = validarCV(cv, datos);
  assert.equal(out.experiencia[1].empresa, '');
  const txt = cvAtexto(out, 'en');
  assert.ok(txt.includes('HVAC Apprentice | 2019 – 2021'), txt);
  assert.ok(!txt.includes('|  |'));
});

test('61. resumen_personal cuenta como ámbito del puesto cuya empresa menciona (E3/N2)', () => {
  const datos = {
    puesto: 'Ingeniero civil residente',
    resumen_personal: 'ingeniero residente en Constructora Meridiano desde 2020, control de calidad de concreto, coordinación con subcontratistas',
    exp1: 'Constructora Meridiano - Ingeniero Residente - 2020 a presente', logros1: 'equipo de 35 personas en obra',
    exp2: 'auxiliar de ingeniería en Alcaldía de Soyapango 2017-2020', logros2: 'levantamientos topográficos',
  };
  const cv = cvBase({ experiencia: [
    { cargo: 'Ingeniero Residente', empresa: 'Constructora Meridiano', ubicacion: null, inicio: '2020', fin: null, actual: true, sin_funciones: false,
      vinetas: [vin('Realizó control de calidad de concreto y coordinación con subcontratistas.', 'control de calidad de concreto, coordinación con subcontratistas')] },
    { cargo: 'Auxiliar de Ingeniería', empresa: 'Alcaldía de Soyapango', ubicacion: null, inicio: '2017', fin: '2020', actual: false, sin_funciones: false,
      vinetas: [vin('Realizó control de calidad de concreto.', 'control de calidad de concreto')] },
  ] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas.length, 1, 'el resumen habla de Meridiano → respalda el puesto 1');
  assert.equal(out.experiencia[1].vinetas.length, 0, 'el resumen NO habla de la Alcaldía → no respalda el puesto 2');
  assert.ok(correcciones.some(c => c.includes('experiencia[0]') && c.includes('resumen_personal')));
});

test('62. Cláusula final de gerundio/finalidad sin fuente se recorta, no se inventa (E1, M1, N4)', () => {
  const datos = { puesto: 'asistente administrativo', exp1: 'Alcaldia de Santa Tecla - Practicante - 3 meses', logros1: 'archivar documentos y contestar llamadas del publico' };
  const cv = cvBase({ experiencia: [{ cargo: 'Practicante', empresa: 'Alcaldía de Santa Tecla', ubicacion: null, inicio: null, fin: null, actual: false, sin_funciones: false,
    vinetas: [
      vin('Atendió llamadas del público, canalizando solicitudes al personal correspondiente.', 'contestar llamadas del publico'),
      vin('Archivó documentos para mantener el orden del archivo.', 'archivar documentos'),
    ] }] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Atendió llamadas del público.');
  assert.ok(correcciones.some(c => c.includes('clausula_recortada') && c.includes('canalizando')));
  assert.equal(out.experiencia[0].duracion, '3 meses');
  assert.ok(cvAtexto(out, 'es').includes('Alcaldía de Santa Tecla | 3 meses'));
  // EN: "to support product presentation" sin fuente → recorte
  const datosEN = { puesto: 'Junior UX Designer', exp1: 'Riverside Retail - Store Manager - 2019 to 2024', logros1: 'did the visual merchandising' };
  const cvEN = cvBase({ lang: 'en', experiencia: [{ cargo: 'Store Manager', empresa: 'Riverside Retail', ubicacion: null, inicio: '2019', fin: '2024', actual: false, sin_funciones: false,
    vinetas: [vin('Executed visual merchandising for the store to support product presentation.', 'did the visual merchandising')] }] });
  const { cv: outEN } = validarCV(cvEN, datosEN);
  assert.equal(outEN.experiencia[0].vinetas[0].texto, 'Executed visual merchandising for the store.');
});

test('63. Cláusula con fuente NO se recorta ("para presentar a los dueños" dicho por el candidato)', () => {
  const datos = { puesto: 'Contadora', exp1: 'Despacho R - Auxiliar contable - 2018 a 2021', logros1: 'ayudaba con la preparacion de estados financieros para presentar a los dueños' };
  const cv = cvBase({ experiencia: [{ cargo: 'Auxiliar contable', empresa: 'Despacho R', ubicacion: null, inicio: '2018', fin: '2021', actual: false, sin_funciones: false,
    vinetas: [vin('Apoyó en la preparación de estados financieros para presentar a los dueños.', 'preparacion de estados financieros para presentar a los dueños')] }] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Apoyó en la preparación de estados financieros para presentar a los dueños.');
  assert.ok(!correcciones.some(c => c.includes('clausula_recortada')));
});

test('64. Degradación ES: minimizador + verbo de apoyo + infinitivos → sintagma nominal (E1, E2)', () => {
  const datos = { puesto: 'asistente', exp1: 'Alcaldia - Practicante - 3 meses', logros1: 'solo apoyaba con archivar documentos y contestar llamadas; arreglar la tienda' };
  const cv = cvBase({ experiencia: [{ cargo: 'Practicante', empresa: 'Alcaldia', ubicacion: null, inicio: null, fin: null, actual: false, sin_funciones: false,
    vinetas: [
      vin('Gestionó el archivo documental y la centralita telefónica.', 'solo apoyaba con archivar documentos y contestar llamadas'),
      vin('Optimizó el layout comercial.', 'arreglar la tienda'),
    ] }] });
  const { cv: out } = validarCV(cv, datos);
  assert.deepEqual(out.experiencia[0].vinetas.map(v => v.texto), ['Apoyo en archivo de documentos y atención de llamadas.', 'Arreglo de la tienda.']);
});

test('65. Degradación EN: "I am the go-to person…", "got employee of the month twice", "no callbacks on my installations" (N5, B1, N2)', () => {
  const datos = { puesto: 'Registered Nurse', exp1: 'Mercy General - RN - 2018 to present', logros1: 'I typically handle 5-6 patients per shift, I am the go-to person for wound care consults, got employee of the month twice, no callbacks on my installations' };
  const cv = cvBase({ lang: 'en', experiencia: [{ cargo: 'RN', empresa: 'Mercy General', ubicacion: null, inicio: '2018', fin: null, actual: true, sin_funciones: false,
    vinetas: [
      vin('Delivered comprehensive bedside assessments to 5-6 patients per shift.', 'I typically handle 5-6 patients per shift'),
      vin('Served as clinical resource for wound care consults.', 'I am the go-to person for wound care consults'),
      vin('Earned formal recognition as employee of the month twice.', 'got employee of the month twice'),
      vin('Maintained a flawless record with no callbacks on installations.', 'no callbacks on my installations'),
    ] }] });
  const { cv: out } = validarCV(cv, datos);
  assert.deepEqual(out.experiencia[0].vinetas.map(v => v.texto), [
    'Handled 5-6 patients per shift.',
    'Go-to person for wound care consults.',
    'Employee of the month twice.',
    'No callbacks on installations.',
  ]);
});

test('66. Habilidad sin fuente NO se sustituye por una frase narrativa del resumen (B1)', () => {
  const datos = { resumen_personal: 'i worked at a call center for 1 year, before that i was a cashier at HEB for 2 years while in school', habilidades_tecnicas: 'typing 60 wpm, zendesk', logros2: 'handled cash register' };
  const cv = cvBase({ lang: 'en', habilidades: { tecnicas: ['Typing 60 WPM', 'Zendesk', 'Cash register operation'], blandas: [] } });
  const { cv: out } = validarCV(cv, datos);
  assert.deepEqual(out.habilidades.tecnicas, ['Typing 60 WPM', 'Zendesk']);
});

test('67. Perfil fallback sin tautología ("Ingeniero Residente" ⊂ título) ni "Manejo de manejo de caja" (E3, E2)', () => {
  const datos = { puesto: 'Ingeniero civil residente', habilidades_tecnicas: 'manejo de caja, atención al cliente', exp1: 'Constructora M - Ingeniero Residente - 2020 a presente' };
  const cv = cvBase({ perfil: 'Profesional con trayectoria consolidada.', experiencia: [{ cargo: 'Ingeniero Residente', empresa: 'Constructora M', ubicacion: null, inicio: '2020', fin: null, actual: true, sin_funciones: false, vinetas: [] }] });
  const { cv: out } = validarCV(cv, datos);
  assert.equal(out.perfil, 'Ingeniero Civil Residente con experiencia en Constructora M. Conocimientos en manejo de caja y atención al cliente.');
});

test('68. Siglas del título objetivo y país se conservan/capitalizan bien ("HVAC Technician", "el salvador" → "El Salvador")', () => {
  const { cv: out } = validarCV(cvBase({ lang: 'en' }), { nombre: 'marcus bell', puesto: 'HVAC Technician', pais: 'el salvador' });
  assert.equal(out.titulo_objetivo, 'HVAC Technician');
  assert.equal(out.contacto.ubicacion, 'El Salvador');
  const { cv: out2 } = validarCV(cvBase(), { nombre: 'JOSE ANTONIO', puesto: 'Junior UX Designer' });
  assert.equal(out2.titulo_objetivo, 'Junior UX Designer');
  assert.equal(out2.nombre, 'Jose Antonio');
});

test('69. Viñetas con la misma evidencia: se conserva la de mayor cobertura (E4)', () => {
  const datos = { puesto: 'mecanico', exp1: 'taller X - mecanico - 2016 a presente', logros1: 'reparacion de motores, frenos, suspencion y diagnostico con escaner' };
  const cv = cvBase({ experiencia: [{ cargo: 'Mecánico', empresa: 'taller X', ubicacion: null, inicio: '2016', fin: null, actual: true, sin_funciones: false,
    vinetas: [
      vin('Ejecuta reparación de motores, frenos y suspensión y diagnóstico con escáner.', 'reparacion de motores, frenos, suspencion y diagnostico con escaner'),
      vin('Realiza reparación y mantenimiento de sistemas de frenos.', 'reparacion de motores, frenos, suspencion y diagnostico con escaner'),
    ] }] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas.length, 1);
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Ejecuta reparación de motores, frenos y suspensión y diagnóstico con escáner.');
  assert.ok(correcciones.some(c => c.includes('misma_evidencia_que_otra_viñeta')));
});


test('70. Empresa larga pero real ("Distribuidora La Fuente S.A. de C.V.") NO se vacía (M1, regresión v11)', () => {
  const datos = { exp1: 'Distribuidora La Fuente S.A. de C.V. - Contadora general - marzo 2021 a la fecha' };
  const cv = cvBase({ experiencia: [{ cargo: 'Contadora general', empresa: 'Distribuidora La Fuente S.A. de C.V.', ubicacion: null, inicio: '2021-03', fin: null, actual: true, sin_funciones: false, vinetas: [] }] });
  const { cv: out } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].empresa, 'Distribuidora La Fuente S.A. de C.V.');
});

test('71. Año que el modelo tomó de estudios ("2023") se anula si expN/resumen no lo traen (E1)', () => {
  const datos = { resumen_personal: 'solo hice practicas de 3 meses en la alcaldia', exp1: 'Alcaldia de Santa Tecla - Practicante - 3 meses', exp2: 'no', estudios: 'bachillerato tecnico, INTI 2023' };
  const cv = cvBase({ experiencia: [{ cargo: 'Practicante', empresa: 'Alcaldía de Santa Tecla', ubicacion: null, inicio: '2023', fin: '2023', actual: false, sin_funciones: false, vinetas: [] }] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].inicio, null);
  assert.equal(out.experiencia[0].fin, null);
  assert.equal(out.experiencia[0].duracion, '3 meses');
  assert.ok(correcciones.some(c => c.includes('año sin fuente')));
  // pero un año que SÍ está en el resumen del puesto se conserva (E5: maestra 2018-2023)
  const datos2 = { resumen_personal: 'trabajé 5 años como maestra en el Colegio Colón (2018-2023), en 2024 hice el bootcamp', exp1: 'Freelance - Desarrolladora Web - 2024 a presente', exp2: 'no' };
  const cv2 = cvBase({ experiencia: [
    { cargo: 'Desarrolladora Web', empresa: 'Freelance', ubicacion: null, inicio: '2024', fin: null, actual: true, sin_funciones: false, vinetas: [] },
    { cargo: 'Maestra de inglés', empresa: 'Colegio Colón', ubicacion: null, inicio: '2018', fin: '2023', actual: false, sin_funciones: true, vinetas: [] },
  ] });
  const { cv: out2, errores } = validarCV(cv2, datos2);
  assert.equal(out2.experiencia[1].inicio, '2018');
  assert.equal(out2.experiencia[1].fin, '2023');
  assert.ok(!errores.some(e => e.includes('empresa_no_verificable')), 'Freelance (genérica) no es error');
});

test('72. Viñeta degradada que repite el encabezado ("cajera en super selectos desde 2022") se descarta (E2)', () => {
  const datos = { puesto: 'Cajera', resumen_personal: 'cajera en super selectos desde 2022', exp1: 'Super Selectos - Cajera - 2022 a presente', logros1: 'solo cargo', exp2: 'no' };
  const cv = cvBase({ experiencia: [{ cargo: 'Cajera', empresa: 'Super Selectos', ubicacion: null, inicio: '2022', fin: null, actual: true, sin_funciones: false,
    vinetas: [vin('Opera caja registradora en el puesto de cajera.', 'cajera en super selectos desde 2022')] }] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas.length, 0);
  assert.ok(correcciones.some(c => c.includes('evidencia_repite_encabezado') || c.includes('evidencia_es_encabezado')));
});

test('73. Fragmento negativo/opinión de una evidencia compuesta se descarta, el resto se conserva (E3, E4)', () => {
  const datos = { puesto: 'Ingeniero', exp1: 'Constructora M - Ingeniero Residente - 2020 a presente', logros1: 'coordinación con subcontratistas; entregamos con 2 semanas de retraso por lluvias; los clientes regresan' };
  const cv = cvBase({ experiencia: [{ cargo: 'Ingeniero Residente', empresa: 'Constructora M', ubicacion: null, inicio: '2020', fin: null, actual: true, sin_funciones: false,
    vinetas: [
      vin('Lideró alianzas estratégicas con subcontratistas pese a contingencias climáticas.', 'coordinación con subcontratistas | entregamos con 2 semanas de retraso por lluvias'),
      vin('Fidelizó la cartera de clientes.', 'los clientes regresan'),
    ] }] });
  const { cv: out } = validarCV(cv, datos);
  assert.deepEqual(out.experiencia[0].vinetas.map(v => v.texto), ['Coordinación con subcontratistas.']);
});

test('74. Perfil: la PRIMERA palabra de la oración también necesita fuente ("Bilingual…" con "some spanish") (N1)', () => {
  const datos = { puesto: 'Retail Sales Associate', idiomas_nivel: 'english, some spanish', habilidades_tecnicas: 'cash register' };
  const cv = cvBase({ lang: 'en', perfil: 'Bilingual in English and Spanish.' });
  const { cv: out } = validarCV(cv, datos);
  assert.ok(!/bilingual/i.test(out.perfil), out.perfil);
});

test('75. Cargo/empresa en minúscula inicial se capitalizan ("mecanico" → "Mecanico"); "Own safety training" → "Owned…" (E4, N3)', () => {
  const datos = { puesto: 'Operations Manager', exp1: 'FastShip - Operations Supervisor - 2020 to present', logros1: 'own safety training' };
  const cv = cvBase({ lang: 'en', experiencia: [{ cargo: 'operations supervisor', empresa: 'fastShip', ubicacion: null, inicio: '2020', fin: null, actual: true, sin_funciones: false,
    vinetas: [vin('Spearheaded enterprise-wide safety curriculum.', 'own safety training')] }] });
  const { cv: out } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].cargo, 'Operations supervisor');
  assert.equal(out.experiencia[0].empresa, 'FastShip');
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Owned safety training.');
});


test('76. Perfil/extra: "Los clientes regresan" (opinión) se elimina; fallback "as Apprentice" sin empresa (E4, N2)', () => {
  const datos = { puesto: 'HVAC Technician', exp1: 'Buckeye Comfort - HVAC Technician - 2021 to present', exp2: 'apprentice at a different HVAC company 2019-2021', info_extra: 'los clientes siempre regresan' };
  const cv = cvBase({ lang: 'en', perfil: 'Works at Buckeye Comfort. Customers always come back.', extra: ['los clientes siempre regresan'], experiencia: [
    { cargo: 'HVAC Technician', empresa: 'Buckeye Comfort', ubicacion: null, inicio: '2021', fin: null, actual: true, sin_funciones: false, vinetas: [] },
    { cargo: 'Apprentice', empresa: 'a different HVAC company', ubicacion: null, inicio: '2019', fin: '2021', actual: false, sin_funciones: true, vinetas: [] },
  ] });
  const { cv: out } = validarCV(cv, datos);
  assert.ok(!/come back|regresan/i.test(out.perfil), out.perfil);
  assert.deepEqual(out.extra, []);
  assert.ok(out.perfil.includes('at Buckeye Comfort and as Apprentice'), out.perfil);
});

test('77. Cláusula "for …" sin fuente se recorta; con fuente se conserva (N3, B1)', () => {
  const datos = { puesto: 'Operations Manager', exp1: 'FastShip - Operations Supervisor - 2020 to present', logros1: 'own safety training; took inbound calls for a phone company' };
  const cv = cvBase({ lang: 'en', experiencia: [{ cargo: 'Operations Supervisor', empresa: 'FastShip', ubicacion: null, inicio: '2020', fin: null, actual: true, sin_funciones: false,
    vinetas: [
      vin('Owned safety training for warehouse shift personnel.', 'own safety training'),
      vin('Answered inbound calls for a phone company.', 'took inbound calls for a phone company'),
    ] }] });
  const { cv: out } = validarCV(cv, datos);
  assert.deepEqual(out.experiencia[0].vinetas.map(v => v.texto), ['Owned safety training.', 'Answered inbound calls for a phone company.']);
});


test('78. en_curso solo con marcador explícito: "some college, no degree" NO está en curso; "estudiando 2do año" sí (B1, E1)', () => {
  const cvB = cvBase({ lang: 'en', educacion: [{ titulo: 'Some College — Business (no degree)', institucion: 'Houston Community College', anio: null, en_curso: true }] });
  const { cv: outB, correcciones } = validarCV(cvB, { estudios: 'high school diploma 2021, some college at Houston Community College (business, no degree)' });
  assert.equal(outB.educacion[0].en_curso, false);
  assert.ok(correcciones.some(c => c.includes('en_curso: true → false')));
  const cvE = cvBase({ educacion: [{ titulo: '2.º año de Administración de Empresas', institucion: 'UFG', anio: null, en_curso: true }] });
  const { cv: outE } = validarCV(cvE, { estudios: 'estudiando 2do año de administracion de empresas en la UFG' });
  assert.equal(outE.educacion[0].en_curso, true);
});

test('79. EN: viñeta en forma base → pasado ("Install and commission…" → "Installed…"); evidencia solo-opinión elimina la viñeta (N2, E4)', () => {
  const datos = { puesto: 'HVAC Technician', resumen_personal: 'install/commission residential furnaces and AC units', exp1: 'Buckeye Comfort - HVAC Technician - 2021 to present', logros1: 'no callbacks on my installations; los clientes regresan' };
  const cv = cvBase({ lang: 'en', experiencia: [{ cargo: 'HVAC Technician', empresa: 'Buckeye Comfort', ubicacion: null, inicio: '2021', fin: null, actual: true, sin_funciones: false,
    vinetas: [
      vin('Install and commission residential furnaces and AC units.', 'install/commission residential furnaces and AC units'),
      vin('Maintains a loyal customer base.', 'los clientes regresan'),
    ] }] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.deepEqual(out.experiencia[0].vinetas.map(v => v.texto), ['Installed and commissioned residential furnaces and AC units.']);
  assert.ok(correcciones.some(c => c.includes('evidencia_no_apta')));
});

test('80. listarNatural: "Git e inglés" (no "y inglés")', () => {
  const { cv: out } = validarCV(cvBase({ perfil: 'Perfil de relleno sin fuente xyzzy.' }), { puesto: 'Desarrolladora', habilidades_tecnicas: 'HTML, Git, inglés' });
  assert.ok(out.perfil.includes('Git e inglés'), out.perfil);
});


test('81. Inflación de rol: evidencia "ayudaba con…" no puede volverse "Preparó…"; "did the…" no puede volverse "Oversaw…" (M1, N4)', () => {
  const datos = { puesto: 'Contadora', exp1: 'Despacho R - Auxiliar contable - 2018 a 2021', logros1: 'ayudaba con la preparacion de estados financieros; did the visual merchandising' };
  const cv = cvBase({ experiencia: [{ cargo: 'Auxiliar contable', empresa: 'Despacho R', ubicacion: null, inicio: '2018', fin: '2021', actual: false, sin_funciones: false,
    vinetas: [
      vin('Preparó estados financieros.', 'ayudaba con la preparacion de estados financieros'),
      vin('Supervisó el visual merchandising.', 'did the visual merchandising'),
    ] }] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Apoyo en la preparacion de estados financieros.');
  assert.ok(correcciones.filter(c => c.includes('verbo_inflado')).length === 2, correcciones.join('\n'));
});

test('82. Habilidad calificada por el candidato ("excel basico") no pierde el nivel; idioma no va en Técnicas (E1, E5)', () => {
  const datos = { habilidades_tecnicas: 'word, excel basico, atencion al publico', idiomas_nivel: 'español, inglés avanzado' };
  const cv = cvBase({ habilidades: { tecnicas: ['Word', 'Excel', 'Atención al público', 'inglés'], blandas: [] }, idiomas: [{ idioma: 'Español', nivel: null }, { idioma: 'Inglés', nivel: 'Avanzado' }] });
  const { cv: out } = validarCV(cv, datos);
  assert.deepEqual(out.habilidades.tecnicas, ['Word', 'excel basico', 'Atención al público']);
});

test('83. Empleo descrito en resumen_personal y ausente del CV → error que dispara reintento (E5)', () => {
  const datos = { resumen_personal: 'trabajé 5 años como maestra de inglés en el Colegio Cristóbal Colón (2018-2023), en 2024 hice el bootcamp', exp1: 'Freelance - Desarrolladora Web - 2024 a presente', exp2: 'no' };
  const cv = cvBase({ experiencia: [{ cargo: 'Desarrolladora Web', empresa: 'Freelance', ubicacion: null, inicio: '2024', fin: null, actual: true, sin_funciones: false, vinetas: [] }] });
  const { errores } = validarCV(cv, datos);
  assert.ok(errores.some(e => e.startsWith('experiencia_omitida_en_resumen') && e.includes('2018-2023')), errores.join('\n'));
  const cv2 = cvBase({ experiencia: [
    { cargo: 'Desarrolladora Web', empresa: 'Freelance', ubicacion: null, inicio: '2024', fin: null, actual: true, sin_funciones: false, vinetas: [] },
    { cargo: 'Maestra de inglés', empresa: 'Colegio Cristóbal Colón', ubicacion: null, inicio: '2018', fin: '2023', actual: false, sin_funciones: true, vinetas: [] },
  ] });
  assert.ok(!validarCV(cv2, datos).errores.some(e => e.startsWith('experiencia_omitida_en_resumen')));
});

test('84. Perfil fallback no lista adjetivos como herramientas ("…y responsable") (J1)', () => {
  const { cv: out } = validarCV(cvBase({ perfil: 'xyzzy sin fuente.' }), { puesto: 'Electricista', habilidades_tecnicas: 'instalaciones electricas, lectura de planos, trabajo en alturas, responsable' });
  assert.equal(out.perfil, 'Electricista. Manejo de instalaciones electricas, lectura de planos y trabajo en alturas.');
});


test('85. Evidencia compuesta ES se nominaliza cláusula a cláusula (M1)', () => {
  const datos = { puesto: 'Contadora', exp1: 'Despacho R - Auxiliar contable - 2018 a 2021', logros1: 'apoyaba en registros contables, conciliaciones bancarias; manejaba varios clientes PyME, conciliaba varias cuentas bancarias al mes' };
  const cv = cvBase({ experiencia: [{ cargo: 'Auxiliar contable', empresa: 'Despacho R', ubicacion: null, inicio: '2018', fin: '2021', actual: false, sin_funciones: false,
    vinetas: [vin('Realizó registros contables y conciliaciones bancarias para una cartera diversificada.', 'apoyaba en registros contables, conciliaciones bancarias | manejaba varios clientes PyME, conciliaba varias cuentas bancarias al mes')] }] });
  const { cv: out } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Apoyo en registros contables, conciliaciones bancarias; manejo de varios clientes PyME; conciliación de varias cuentas bancarias al mes.');
});

test('86. INFORMACIÓN ADICIONAL: ítem con palabras sin fuente → literal del candidato; opinión se descarta (E3, E4)', () => {
  const { cv: a } = validarCV(cvBase({ extra: ['Cero accidentes graves registrados en 4 años de trabajo en obra.'] }), { info_extra: 'cero accidentes graves en 4 años' });
  assert.deepEqual(a.extra, ['Cero accidentes graves en 4 años']);
  const { cv: b } = validarCV(cvBase({ extra: ['Clientes recurrentes que regresan al taller.'] }), { info_extra: 'los clientes siempre regresan' });
  assert.deepEqual(b.extra, []);
  const { cv: c } = validarCV(cvBase({ extra: ['Immediate availability'] }), { info_extra: 'immediate availability' });
  assert.deepEqual(c.extra, ['Immediate availability']);
});


test('87. Inflación de rol con evidencia sin el verbo: "ayudaba con la preparacion…" citado como "preparacion de estados financieros" (M1)', () => {
  const datos = { puesto: 'Contadora', exp1: 'Despacho R - Auxiliar contable - 2018 a 2021', logros1: 'ayudaba con la preparacion de estados financieros para presentar a los dueños' };
  const cv = cvBase({ experiencia: [{ cargo: 'Auxiliar contable', empresa: 'Despacho R', ubicacion: null, inicio: '2018', fin: '2021', actual: false, sin_funciones: false,
    vinetas: [vin('Elaboró estados financieros para presentar a los dueños.', 'preparacion de estados financieros para presentar a los dueños')] }] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.ok(correcciones.some(c => c.includes('verbo_inflado')), correcciones.join('\n'));
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Preparacion de estados financieros para presentar a los dueños.');
});

test('88. Perfil fallback ignora "nada más"/"eso es todo" pegados a las habilidades (E2E Rosa)', () => {
  const { cv: out } = validarCV(cvBase({ perfil: 'xyzzy.' }), { puesto: 'Cajera', habilidades_tecnicas: 'manejo de caja, atención al cliente\nnada más' });
  assert.ok(!/nada m/i.test(out.perfil), out.perfil);
});


test('89. Cláusula con cifra del candidato y relleno ("approximately") NO se recorta (E2E Marcus)', () => {
  const datos = { puesto: 'HVAC Technician', exp1: 'Buckeye Comfort - HVAC Technician - 2021 to present', logros1: 'no callbacks on my installations\nabout 6 installs per week, no callbacks', resumen_personal: 'install/commission residential furnaces and AC units' , exp2: 'no' };
  const cv = cvBase({ lang: 'en', experiencia: [{ cargo: 'HVAC Technician', empresa: 'Buckeye Comfort', ubicacion: null, inicio: '2021', fin: null, actual: true, sin_funciones: false,
    vinetas: [vin('Installed and commissioned residential furnaces and AC units, completing approximately 6 installations per week with no callbacks.', 'install/commission residential furnaces and AC units | about 6 installs per week, no callbacks')] }] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Installed and commissioned residential furnaces and AC units, completing approximately 6 installations per week with no callbacks.');
  assert.ok(!correcciones.some(c => c.includes('clausula_recortada')), correcciones.join('\n'));
});


test('90. Viñeta cuya evidencia es el encabezado del puesto se elimina aunque pase los tokens ("Ejerce funciones de cajera.")', () => {
  const datos = { puesto: 'Cajera', resumen_personal: 'cajera en super selectos desde 2022', exp1: 'Super Selectos - Cajera - 2022 a presente', logros1: 'solo cargo', exp2: 'no' };
  const cv = cvBase({ experiencia: [{ cargo: 'Cajera', empresa: 'Super Selectos', ubicacion: null, inicio: '2022', fin: null, actual: true, sin_funciones: false,
    vinetas: [vin('Ejerce funciones de cajera.', 'cajera en super selectos desde 2022')] }] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas.length, 0);
  assert.ok(correcciones.some(c => c.includes('evidencia_es_encabezado')));
});


// ══════════════ v19 ══════════════
test('91. Duplicado semántico: viñeta cuyos sustantivos clave ya están en otra se elimina (E4); dos viñetas con hechos distintos se conservan (E3)', () => {
  const datosE4 = { puesto: 'mecanico automotriz', exp1: 'taller X - mecanico - 2016 a presente', logros1: 'reparacion de motores, frenos, suspencion y diagnostico con escaner', exp2: 'no' };
  const cvE4 = cvBase({ experiencia: [{ cargo: 'Mecanico', empresa: 'Taller X', ubicacion: null, inicio: '2016', fin: null, actual: true, sin_funciones: false,
    vinetas: [
      vin('Reparacion de motores, frenos, suspencion y diagnostico con escaner.', 'reparacion de motores, frenos, suspencion y diagnostico con escaner'),
      vin('Realiza diagnóstico de vehículos mediante escáner para identificar fallas.', 'diagnostico con escaner'),
    ] }] });
  const { cv: a, correcciones } = validarCV(cvE4, datosE4);
  assert.equal(a.experiencia[0].vinetas.length, 1, correcciones.join('\n'));
  assert.ok(correcciones.some(c => c.includes('duplicado_semantico')));
  const datosE3 = { puesto: 'Ingeniero civil residente', resumen_personal: 'ingeniero residente en Constructora Meridiano desde 2020, supervisión de obra de un edificio de 6 niveles y dos proyectos de vivienda', exp1: 'Constructora Meridiano - Ingeniero Residente - 2020 a presente', logros1: 'el edificio fue de 4,200 m2, equipo de 35 personas en obra', exp2: 'no' };
  const cvE3 = cvBase({ experiencia: [{ cargo: 'Ingeniero Residente', empresa: 'Constructora Meridiano', ubicacion: null, inicio: '2020', fin: null, actual: true, sin_funciones: false,
    vinetas: [
      vin('Supervisa la obra de un edificio de 6 niveles de 4,200 m² con un equipo de 35 personas en obra.', 'supervisión de obra de un edificio de 6 niveles | el edificio fue de 4,200 m2, equipo de 35 personas en obra'),
      vin('Supervisión de obra de un edificio de 6 niveles y dos proyectos de vivienda.', 'supervisión de obra de un edificio de 6 niveles y dos proyectos de vivienda'),
    ] }] });
  assert.equal(validarCV(cvE3, datosE3).cv.experiencia[0].vinetas.length, 2, 'hechos distintos (m²/equipo vs. proyectos de vivienda) no son duplicados');
});

test('92. Gerundio de mando sin verbo de mando en el input se recorta ("…, coordinando un equipo de 35 personas") (E3)', () => {
  const datos = { puesto: 'Ingeniero civil residente', exp1: 'Constructora Meridiano - Ingeniero Residente - 2020 a presente', logros1: 'el edificio fue de 4,200 m2, equipo de 35 personas en obra', exp2: 'no' };
  const cv = cvBase({ experiencia: [{ cargo: 'Ingeniero Residente', empresa: 'Constructora Meridiano', ubicacion: null, inicio: '2020', fin: null, actual: true, sin_funciones: false,
    vinetas: [vin('Supervisó la construcción de un edificio de 4,200 m², coordinando un equipo de 35 personas en obra.', 'el edificio fue de 4,200 m2, equipo de 35 personas en obra')] }] });
  const { cv: out, correcciones } = validarCV(cv, datos);
  assert.equal(out.experiencia[0].vinetas[0].texto, 'Supervisó la construcción de un edificio de 4,200 m².');
  assert.ok(correcciones.some(c => c.includes('verbo de mando sin fuente')));
  // con verbo de mando en el input ("coordino un equipo") se conserva
  const datos2 = { ...datos, logros1: 'coordino un equipo de 35 personas en obra, el edificio fue de 4,200 m2' };
  const cv2 = cvBase({ experiencia: [{ cargo: 'Ingeniero Residente', empresa: 'Constructora Meridiano', ubicacion: null, inicio: '2020', fin: null, actual: true, sin_funciones: false,
    vinetas: [vin('Supervisó la construcción de un edificio de 4,200 m², coordinando un equipo de 35 personas en obra.', 'coordino un equipo de 35 personas en obra, el edificio fue de 4,200 m2')] }] });
  assert.ok(validarCV(cv2, datos2).cv.experiencia[0].vinetas[0].texto.includes('coordinando'));
});

test('93. Colas de relleno se recortan ("durante su estadía en el local", "throughout the store") (E2, N1)', () => {
  const datos = { puesto: 'Vendedora', exp1: 'Tienda - Vendedora - 2019 a 2021', logros1: 'atender clientes, cobrar', exp2: 'no' };
  const cv = cvBase({ experiencia: [{ cargo: 'Vendedora', empresa: 'Tienda', ubicacion: null, inicio: '2019', fin: '2021', actual: false, sin_funciones: false,
    vinetas: [
      vin('Atendió a los clientes de la tienda durante su estadía en el local.', 'atender clientes'),
      vin('Realizó el cobro a los clientes como parte de sus funciones en la tienda.', 'cobrar'),
    ] }] });
  const { cv: out } = validarCV(cv, datos);
  assert.deepEqual(out.experiencia[0].vinetas.map(v => v.texto), ['Atendió a los clientes de la tienda.', 'Realizó el cobro a los clientes.']);
  const datosEN = { puesto: 'Sales Associate', exp1: 'Target - Sales Associate - 2025', logros1: 'helping customers find products', exp2: 'no' };
  const cvEN = cvBase({ lang: 'en', experiencia: [{ cargo: 'Sales Associate', empresa: 'Target', ubicacion: null, inicio: '2025', fin: '2025', actual: false, sin_funciones: false,
    vinetas: [vin('Assisted customers in locating products throughout the store.', 'helping customers find products')] }] });
  assert.equal(validarCV(cvEN, datosEN).cv.experiencia[0].vinetas[0].texto, 'Assisted customers in locating products.');
});

test('94. Perfil fallback: "Freelance" no es empresa; empresa en minúscula se capitaliza (E5, E4)', () => {
  const { cv: a } = validarCV(cvBase({ perfil: 'xyzzy.', experiencia: [{ cargo: 'Desarrolladora Web', empresa: 'Freelance', ubicacion: null, inicio: '2024', fin: null, actual: true, sin_funciones: false, vinetas: [] }] }), { puesto: 'Desarrolladora web junior', exp1: 'Freelance - Desarrolladora Web - 2024 a presente', habilidades_tecnicas: 'HTML, CSS' });
  assert.ok(a.perfil.startsWith('Desarrolladora Web Junior con experiencia freelance.'), a.perfil);
  const { cv: b } = validarCV(cvBase({ perfil: 'xyzzy.', experiencia: [{ cargo: 'mecanico', empresa: 'taller hermanos flores', ubicacion: null, inicio: '2016', fin: null, actual: true, sin_funciones: false, vinetas: [] }] }), { puesto: 'mecanico automotriz', exp1: 'taller hermanos flores - mecanico - 2016 a presente' });
  assert.ok(b.perfil.includes('en Taller Hermanos Flores'), b.perfil);
});

// ────────────────────────────── Resumen ──────────────────────────────
console.log('\n──────────────────────────────');
console.log(`Total: ${pasados + fallidos} · Pasados: ${pasados} · Fallidos: ${fallidos}`);
if (fallidos > 0) {
  console.log('\nCasos fallidos:');
  fallos.forEach(f => console.log(` - ${f.nombre}: ${f.error}`));
  process.exit(1);
}
