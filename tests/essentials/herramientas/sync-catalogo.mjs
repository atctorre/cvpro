#!/usr/bin/env node
// Sincroniza el catálogo mínimo embebido en essentials-pago/index.ts con catalogo.json (el catálogo interno de la tienda).
// catalogo.json lleva datos del proveedor y NO está en este repositorio: define ESSENTIALS_CATALOGO_JSON con su ruta.
//
//   ESSENTIALS_CATALOGO_JSON=/ruta/catalogo.json node tests/essentials/herramientas/sync-catalogo.mjs            escribe el bloque en index.ts
//   ESSENTIALS_CATALOGO_JSON=/ruta/catalogo.json node tests/essentials/herramientas/sync-catalogo.mjs --check    no escribe; sale con código 1 si el bloque difiere
//   ESSENTIALS_CATALOGO_JSON=/ruta/catalogo.json node tests/essentials/herramientas/sync-catalogo.mjs --print    imprime el bloque
//
// Solo Node ≥ 20, sin dependencias. El bloque vive entre los marcadores
// "// <CATALOGO:BEGIN>" y "// <CATALOGO:END>" de index.ts.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
export const RUTA_CATALOGO = process.env.ESSENTIALS_CATALOGO_JSON ? resolve(process.env.ESSENTIALS_CATALOGO_JSON) : null;
const RUTA_INDEX = resolve(aqui, '../../../supabase/functions/essentials-pago/index.ts');
const BEGIN = '// <CATALOGO:BEGIN>';
const END = '// <CATALOGO:END>';

export function construirBloque(catalogo) {
  const plazo = catalogo.meta?.plazo_declarado_dias;
  if (!plazo || !Number.isInteger(plazo.min) || !Number.isInteger(plazo.max)) {
    throw new Error('catalogo.json: falta meta.plazo_declarado_dias {min, max}');
  }
  const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const lineas = [];
  lineas.push(`${BEGIN} generado por herramientas/sync-catalogo.mjs desde tarea-4/catalogo.json; no editar a mano`);
  lineas.push('const CATALOGO: Record<string, Producto> = {');
  for (const p of catalogo.productos) {
    lineas.push(`  ${q(p.sku)}: {`);
    lineas.push(`    nombre: ${q(p.nombre_comercial)},`);
    lineas.push(`    corto: ${q(p.nombre_corto)},`);
    lineas.push('    variantes: {');
    for (const v of p.variantes) {
      if (v.disponible !== true) continue; // una variante no disponible no se vende
      const cents = Math.round(v.precio * 100);
      if (Math.abs(cents / 100 - v.precio) > 1e-9) {
        throw new Error(`${p.sku}/${v.id}: el precio ${v.precio} no tiene exactamente 2 decimales`);
      }
      lineas.push(`      ${q(v.id)}: { etiqueta: ${q(v.etiqueta_publica)}, precio_cents: ${cents} },`);
    }
    lineas.push('    },');
    lineas.push('  },');
  }
  lineas.push('};');
  lineas.push(`const ENTREGA_DIAS = { min: ${plazo.min}, max: ${plazo.max} };`);
  lineas.push(END);
  return lineas.join('\n');
}

export function extraerBloque(fuente) {
  const i = fuente.indexOf(BEGIN);
  const j = fuente.indexOf(END);
  if (i < 0 || j < 0 || j < i) throw new Error('index.ts: no están los marcadores CATALOGO:BEGIN/END');
  return { i, j: j + END.length, bloque: fuente.slice(i, j + END.length) };
}

export function cargar() {
  if (!RUTA_CATALOGO) throw new Error('Define ESSENTIALS_CATALOGO_JSON con la ruta de catalogo.json (no está en este repositorio).');
  const catalogo = JSON.parse(readFileSync(RUTA_CATALOGO, 'utf8'));
  const fuente = readFileSync(RUTA_INDEX, 'utf8');
  return { catalogo, fuente };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const modo = process.argv[2] || '';
  let datos;
  try { datos = cargar(); } catch (e) { console.error(e.message); process.exit(2); }
  const { catalogo, fuente } = datos;
  const nuevo = construirBloque(catalogo);
  if (modo === '--print') {
    console.log(nuevo);
  } else {
    const { i, j, bloque } = extraerBloque(fuente);
    if (modo === '--check') {
      if (bloque !== nuevo) {
        console.error('El catálogo embebido en essentials-pago/index.ts NO coincide con catalogo.json. Ejecuta: ESSENTIALS_CATALOGO_JSON=... node tests/essentials/herramientas/sync-catalogo.mjs');
        process.exit(1);
      }
      console.log('Catálogo embebido sincronizado con catalogo.json');
    } else {
      writeFileSync(RUTA_INDEX, fuente.slice(0, i) + nuevo + fuente.slice(j));
      console.log(bloque === nuevo ? 'Sin cambios' : 'Bloque de catálogo actualizado');
    }
  }
}
