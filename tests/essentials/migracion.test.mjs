// Migración essentials_pedidos: comprobaciones estáticas del SQL (siempre) y verificación en un PostgreSQL REAL
// (solo si defines ESSENTIALS_TEST_PG con la conexión a una base DESECHABLE; ver README).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { RAIZ, RAIZ_REPO } from './helpers/cargar-funcion.mjs';
import { COLUMNAS } from './helpers/supabase-sim.mjs';

const RUTA_MIGRACIONES = resolve(RAIZ_REPO, 'supabase/migrations');
// En el repositorio puede haber otras migraciones: aquí solo se revisa la de essentials_pedidos.
const archivos = readdirSync(RUTA_MIGRACIONES).filter((f) => f.endsWith('_essentials_pedidos.sql'));
const SQL = readFileSync(resolve(RUTA_MIGRACIONES, archivos[0]), 'utf8');
const SQL_SIN_COMENTARIOS = SQL.replace(/--[^\n]*/g, '');

function columnasDeLaTabla() {
  const m = SQL_SIN_COMENTARIOS.match(/create table if not exists public\.essentials_pedidos \(([\s\S]*?)\n\);/);
  assert.ok(m, 'no se encontró create table public.essentials_pedidos');
  const cols = new Map();
  for (const l of m[1].split('\n')) {
    const c = l.match(/^\s{2}([a-z_0-9]+)\s+(uuid|text|timestamptz|jsonb|numeric\(\d+,\d+\))(?=[\s,]|$)/);
    if (c) cols.set(c[1], c[2]);
  }
  return cols;
}

test('hay una sola migración de essentials_pedidos y se llama <timestamp>_essentials_pedidos.sql', () => {
  assert.equal(archivos.length, 1);
  assert.match(archivos[0], /^\d{14}_essentials_pedidos\.sql$/);
});

test('la tabla tiene todas las columnas exigidas, con los tipos pedidos', () => {
  const cols = columnasDeLaTabla();
  const exigidas = {
    id: 'uuid', created_at: 'timestamptz', estado: 'text', order_code: 'text', items: 'jsonb', subtotal: 'numeric(10,2)',
    total: 'numeric(10,2)', moneda: 'text', nombre: 'text', email: 'text', envio_line1: 'text', envio_line2: 'text',
    envio_city: 'text', envio_state: 'text', envio_zip: 'text', acepto_politica_at: 'timestamptz', user_agent: 'text',
    actualizado_at: 'timestamptz',
  };
  for (const [nombre, tipo] of Object.entries(exigidas)) {
    assert.equal(cols.get(nombre), tipo, `columna ${nombre}`);
  }
  assert.match(SQL_SIN_COMENTARIOS, /\bid\s+uuid primary key default gen_random_uuid\(\)/);
  assert.match(SQL_SIN_COMENTARIOS, /\bestado\s+text not null default 'creado'/);
  assert.match(SQL_SIN_COMENTARIOS, /\bacepto_politica_at\s+timestamptz not null/);
});

test('las columnas de la simulación de Supabase son exactamente las de la migración', () => {
  assert.deepEqual([...columnasDeLaTabla().keys()].sort(), [...COLUMNAS].sort());
});

test('RLS activado, sin ninguna política y sin privilegios para anon/authenticated', () => {
  assert.match(SQL_SIN_COMENTARIOS, /alter table public\.essentials_pedidos enable row level security;/);
  assert.ok(!/create\s+policy/i.test(SQL_SIN_COMENTARIOS), 'no debe haber políticas (ni de lectura pública)');
  assert.ok(!/\bgrant\b/i.test(SQL_SIN_COMENTARIOS), 'no debe conceder privilegios a nadie');
  assert.match(SQL_SIN_COMENTARIOS, /revoke all on table public\.essentials_pedidos from anon, authenticated;/);
  assert.ok(!/disable row level security/i.test(SQL_SIN_COMENTARIOS));
});

test('índices por order_code (único) y por email', () => {
  assert.match(SQL_SIN_COMENTARIOS, /create unique index if not exists essentials_pedidos_order_code_uidx\s+on public\.essentials_pedidos \(order_code\)/);
  assert.match(SQL_SIN_COMENTARIOS, /create index if not exists essentials_pedidos_email_idx\s+on public\.essentials_pedidos \(lower\(email\)\)/);
});

test('hay trigger y restricciones que impiden una segunda confirmación', () => {
  assert.match(SQL_SIN_COMENTARIOS, /create or replace function public\.essentials_pedidos_guard\(\)/);
  assert.match(SQL_SIN_COMENTARIOS, /before insert or update on public\.essentials_pedidos/);
  assert.match(SQL_SIN_COMENTARIOS, /old\.estado = 'pagado'/);
  assert.match(SQL_SIN_COMENTARIOS, /new\.pagado_en\s+is distinct from old\.pagado_en/);
  assert.match(SQL_SIN_COMENTARIOS, /essentials_pedidos_pagado_chk check \(\(estado = 'pagado'\) = \(pagado_en is not null\)\)/);
  assert.match(SQL_SIN_COMENTARIOS, /essentials_pedidos_pagado_codigo_chk check \(estado <> 'pagado' or order_code is not null\)/);
});

test('el SQL no usa nada específico de un proveedor ni borra datos (sin drop table, truncate ni delete)', () => {
  assert.ok(!/drop\s+table|truncate|delete\s+from/i.test(SQL_SIN_COMENTARIOS));
});

const PG = process.env.ESSENTIALS_TEST_PG;
test('migración verificada en un PostgreSQL real (tests/essentials/sql/verificar-migracion.sql)', {
  skip: !PG && 'define ESSENTIALS_TEST_PG con la conexión a una base DESECHABLE para ejecutarla',
}, (t) => {
  const r = spawnSync('psql', [
    PG, '-v', 'ON_ERROR_STOP=1', '-v', `migracion=${resolve(RUTA_MIGRACIONES, archivos[0])}`,
    '-f', resolve(RAIZ, 'sql/verificar-migracion.sql'),
  ], { encoding: 'utf8' });
  const salida = `${r.stdout}\n${r.stderr}`;
  assert.equal(r.status, 0, `psql terminó con ${r.status}:\n${salida}`);
  const oks = [...salida.matchAll(/NOTICE:\s+OK: (.*)/g)].map((m) => m[1]);
  assert.ok(oks.length >= 30, `se esperaban >= 30 comprobaciones OK y hubo ${oks.length}`);
  assert.match(salida, /NOTICE:\s+PASS: migración verificada en PostgreSQL/);
  assert.ok(!/FALLO/.test(salida));
  t.diagnostic(`${oks.length} comprobaciones OK en ${(salida.match(/PostgreSQL ([\d.]+)/) || [])[1] || 'PostgreSQL'}`);
});
