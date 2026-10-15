-- Verifica la migración 20261014220000_essentials_pedidos.sql contra un PostgreSQL REAL.
-- Se ejecuta con psql dentro de una transacción que termina en ROLLBACK (no deja nada).
--
--   psql "<conninfo de una base DESECHABLE>" -v ON_ERROR_STOP=1 -v migracion=<ruta absoluta de la migración> \
--        -f tests/sql/verificar-migracion.sql
--
-- Lo lanza tests/migracion.test.mjs cuando existe ESSENTIALS_TEST_PG. NUNCA contra el proyecto de producción.
-- Cada comprobación imprime "NOTICE:  OK: ..." o aborta con "FALLO: ...".

\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
begin;

-- Roles que en Supabase ya existen (en un Postgres pelado se crean aquí; el rollback los deshace).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
-- Supabase da privilegios por defecto a anon/authenticated en tablas nuevas de public: se simulan DESPUÉS
-- de la migración para comprobar que RLS bloquea aunque existan privilegios.

\i :migracion
-- La migración es idempotente: aplicarla otra vez no falla ni duplica nada.
\i :migracion
do $$ begin
  if (select count(*) from pg_trigger where tgrelid = 'public.essentials_pedidos'::regclass and not tgisinternal) <> 1 then
    raise exception 'FALLO: el trigger se duplicó al reaplicar la migración';
  end if;
  raise notice 'OK: la migración se puede aplicar dos veces (idempotente), un solo trigger';
end $$;

-- ── Ayudas (solo esta sesión) ──
create function pg_temp.ref(n int) returns text language sql as $$ select 'ESS-AAAAAAAAA' || chr(50 + n) $$;

create function pg_temp.base(n int) returns jsonb language sql as $$
  select jsonb_build_object(
    'id', gen_random_uuid(), 'created_at', now(), 'actualizado_at', now(),
    'estado', 'creado', 'referencia', pg_temp.ref(n), 'entorno', 'sandbox',
    'items', '[{"sku":"leather-card-holder","variante":"navy","qty":1,"precio_unit_cents":7750,"subtotal_cents":7750}]'::jsonb,
    'subtotal', 77.50, 'costo_envio', 0, 'impuesto', 0, 'total', 77.50, 'moneda', 'USD',
    'nombre', 'Test Buyer', 'email', 'buyer@example.com',
    'envio_line1', '1 Main St', 'envio_city', 'Austin', 'envio_state', 'TX', 'envio_zip', '78701', 'envio_pais', 'US',
    'acepto_politica_at', now(), 'politica_version', 'essentials-terms-v1',
    'token_consulta', '0123456789abcdef0123456789abcdef',
    'cumplimiento', 'pendiente')
$$;

create function pg_temp.insertar(n int, extra jsonb default '{}') returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.essentials_pedidos
    select * from jsonb_populate_record(null::public.essentials_pedidos, pg_temp.base(n) || extra)
    returning id into v_id;
  return v_id;
end $$;

create function pg_temp.debe_fallar(p_sql text, p_sqlstate text, p_nombre text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_sqlstate then
      raise notice 'OK: %', p_nombre;
      return;
    end if;
    raise exception 'FALLO: % (esperaba %, llegó % %)', p_nombre, p_sqlstate, sqlstate, sqlerrm;
  end;
  raise exception 'FALLO: % (no falló)', p_nombre;
end $$;

-- ── 1. Estructura ──
do $$
declare faltan text;
begin
  select string_agg(c, ', ') into faltan
  from unnest(array['id','created_at','estado','order_code','items','subtotal','total','moneda','nombre','email',
                    'envio_line1','envio_line2','envio_city','envio_state','envio_zip','acepto_politica_at',
                    'user_agent','actualizado_at']) c
  where not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'essentials_pedidos' and column_name = c);
  if faltan is not null then raise exception 'FALLO: faltan columnas: %', faltan; end if;
  raise notice 'OK: columnas exigidas presentes';
end $$;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.essentials_pedidos'::regclass) then
    raise exception 'FALLO: RLS no está activado';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'essentials_pedidos') <> 0 then
    raise exception 'FALLO: hay políticas definidas (no debe haber ninguna)';
  end if;
  raise notice 'OK: RLS activado y sin políticas';
end $$;

do $$
begin
  if not exists (select 1 from pg_indexes where tablename = 'essentials_pedidos'
                 and indexdef ilike '%unique%' and indexdef ilike '%(order_code)%') then
    raise exception 'FALLO: falta el índice único por order_code';
  end if;
  if not exists (select 1 from pg_indexes where tablename = 'essentials_pedidos' and indexdef ilike '%lower(email)%') then
    raise exception 'FALLO: falta el índice por email';
  end if;
  raise notice 'OK: índices por order_code (único) y email';
end $$;

-- ── 2. Acceso público: bloqueado ──
do $$
begin
  if has_table_privilege('anon', 'public.essentials_pedidos', 'select')
     or has_table_privilege('authenticated', 'public.essentials_pedidos', 'select')
     or has_table_privilege('anon', 'public.essentials_pedidos', 'insert') then
    raise exception 'FALLO: anon/authenticated conservan privilegios sobre la tabla';
  end if;
  raise notice 'OK: anon y authenticated sin privilegios (REVOKE)';
end $$;

-- ── 3. Restricciones de datos ──
select pg_temp.insertar(0);   -- una fila válida
do $$ begin raise notice 'OK: fila válida aceptada'; end $$;

select pg_temp.debe_fallar($q$select pg_temp.insertar(1, '{"envio_zip":"ABCDE"}')$q$, '23514', 'ZIP inválido rechazado');
select pg_temp.debe_fallar($q$select pg_temp.insertar(1, '{"envio_zip":"1234"}')$q$, '23514', 'ZIP de 4 dígitos rechazado');
select pg_temp.debe_fallar($q$select pg_temp.insertar(1, '{"envio_state":"Texas"}')$q$, '23514', 'estado que no es código USPS rechazado');
select pg_temp.debe_fallar($q$select pg_temp.insertar(1, '{"envio_pais":"MX"}')$q$, '23514', 'país distinto de US rechazado');
select pg_temp.debe_fallar($q$select pg_temp.insertar(1, '{"total": 80.00}')$q$, '23514', 'total que no cuadra con subtotal+envío+impuesto rechazado');
select pg_temp.debe_fallar($q$select pg_temp.insertar(1, '{"estado":"enviado"}')$q$, '23514', 'estado fuera de lista rechazado');
select pg_temp.debe_fallar($q$select pg_temp.insertar(1, '{"moneda":"EUR"}')$q$, '23514', 'moneda distinta de USD rechazada');
select pg_temp.debe_fallar($q$select pg_temp.insertar(1, '{"items":[]}')$q$, '23514', 'items vacío rechazado');
select pg_temp.debe_fallar($q$select pg_temp.insertar(1, '{"token_consulta":"corto"}')$q$, '23514', 'token mal formado rechazado');
select pg_temp.debe_fallar($q$select pg_temp.insertar(1, '{"estado":"pagado"}')$q$, '23514', 'pagado sin pagado_en rechazado');
select pg_temp.debe_fallar($q$select pg_temp.insertar(1, '{"estado":"pagado","pagado_en":"2026-10-14T20:00:00Z"}')$q$, '23514', 'pagado sin order_code rechazado');
select pg_temp.debe_fallar($q$select pg_temp.insertar(1, '{"pagado_en":"2026-10-14T20:00:00Z"}')$q$, '23514', 'pagado_en con estado distinto de pagado rechazado');
select pg_temp.debe_fallar($q$select pg_temp.insertar(0)$q$, '23505', 'referencia repetida rechazada');
select pg_temp.debe_fallar($q$select pg_temp.insertar(1, '{"acepto_politica_at":null}')$q$, '23502', 'sin acepto_politica_at rechazado (NOT NULL)');

-- order_code y idem únicos; varios NULL permitidos
select pg_temp.insertar(2, '{"order_code":"N1CO-AAA","idem":"11111111-1111-4111-8111-111111111111"}');
select pg_temp.insertar(3);   -- order_code NULL, idem NULL
select pg_temp.insertar(4);   -- otro NULL: debe aceptarse
do $$ begin raise notice 'OK: varios pedidos sin order_code/idem conviven (NULL)'; end $$;
select pg_temp.debe_fallar($q$select pg_temp.insertar(5, '{"order_code":"N1CO-AAA"}')$q$, '23505', 'order_code repetido rechazado');
select pg_temp.debe_fallar($q$select pg_temp.insertar(5, '{"idem":"11111111-1111-4111-8111-111111111111"}')$q$, '23505', 'idem repetido rechazado');

-- ── 4. Una sola confirmación ──
do $$
declare
  v_id uuid;
  v_antes timestamptz;
  v_filas int;
  v_pagado timestamptz;
begin
  v_id := pg_temp.insertar(6, '{"order_code":"N1CO-PAGO-1"}');

  -- actualizado_at lo mantiene el trigger
  select actualizado_at into v_antes from public.essentials_pedidos where id = v_id;
  perform pg_sleep(0.01);
  update public.essentials_pedidos set n1co_estado = 'PENDING' where id = v_id;
  if (select actualizado_at from public.essentials_pedidos where id = v_id) <= v_antes then
    raise exception 'FALLO: actualizado_at no se actualiza';
  end if;
  raise notice 'OK: actualizado_at lo mantiene el trigger';

  -- primera confirmación: como la hace essentials-confirmar (UPDATE condicional)
  update public.essentials_pedidos
     set estado = 'pagado', pagado_en = now(), n1co_estado = 'PAID', monto_n1co = 77.50
   where id = v_id and estado <> 'pagado';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'FALLO: la primera confirmación debía actualizar 1 fila (fueron %)', v_filas; end if;
  select pagado_en into v_pagado from public.essentials_pedidos where id = v_id;
  raise notice 'OK: primera confirmación marca el pedido como pagado';

  -- segunda confirmación por la vía condicional: 0 filas
  update public.essentials_pedidos
     set estado = 'pagado', pagado_en = now() + interval '1 hour'
   where id = v_id and estado <> 'pagado';
  get diagnostics v_filas = row_count;
  if v_filas <> 0 then raise exception 'FALLO: la segunda confirmación condicional actualizó % filas', v_filas; end if;
  raise notice 'OK: segunda confirmación condicional afecta 0 filas';

  if (select pagado_en from public.essentials_pedidos where id = v_id) is distinct from v_pagado then
    raise exception 'FALLO: pagado_en cambió tras la segunda confirmación';
  end if;
  raise notice 'OK: pagado_en se fija una sola vez';
end $$;

-- Aunque alguien lo intente SIN la condición, el trigger lo impide
select pg_temp.debe_fallar(
  $q$update public.essentials_pedidos set estado = 'pagado', pagado_en = now() + interval '1 day' where order_code = 'N1CO-PAGO-1'$q$,
  '23514', 'trigger: no se puede reconfirmar un pedido pagado');
select pg_temp.debe_fallar(
  $q$update public.essentials_pedidos set estado = 'pendiente' where order_code = 'N1CO-PAGO-1'$q$, '23514',
  'trigger/CHECK: un pedido pagado no puede volver a otro estado');
select pg_temp.debe_fallar(
  $q$update public.essentials_pedidos set subtotal = 1, total = 1 where order_code = 'N1CO-PAGO-1'$q$, '23514',
  'trigger: no se pueden cambiar los importes de un pedido pagado');
select pg_temp.debe_fallar(
  $q$update public.essentials_pedidos set order_code = 'OTRO-CODIGO' where order_code = 'N1CO-PAGO-1'$q$, '23514',
  'trigger: no se puede cambiar el order_code de un pedido pagado');

-- Los campos de cumplimiento sí se pueden editar tras el pago (seguimiento del envío)
do $$
begin
  update public.essentials_pedidos
     set cumplimiento = 'enviado', seguimiento = 'TRACK-123' where order_code = 'N1CO-PAGO-1';
  if (select seguimiento from public.essentials_pedidos where order_code = 'N1CO-PAGO-1') <> 'TRACK-123' then
    raise exception 'FALLO: no se pudo guardar el seguimiento de un pedido pagado';
  end if;
  raise notice 'OK: cumplimiento/seguimiento editables después del pago';
end $$;

-- ── 5. RLS bloquea aunque existan privilegios (Supabase concede privilegios por defecto) ──
grant select, insert, update, delete on table public.essentials_pedidos to anon, authenticated;

set local role anon;
do $$
declare n int;
begin
  select count(*) into n from public.essentials_pedidos;
  if n <> 0 then raise exception 'FALLO: anon ve % filas (RLS debería ocultarlas todas)', n; end if;
  raise notice 'OK: anon no puede leer ningún pedido (RLS sin políticas)';
end $$;
select pg_temp.debe_fallar(
  $q$insert into public.essentials_pedidos select * from jsonb_populate_record(null::public.essentials_pedidos, pg_temp.base(7))$q$,
  '42501', 'anon no puede insertar (RLS)');
do $$
declare n int;
begin
  update public.essentials_pedidos set seguimiento = 'hack';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO: anon modificó % filas', n; end if;
  delete from public.essentials_pedidos;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO: anon borró % filas', n; end if;
  raise notice 'OK: anon no puede modificar ni borrar (RLS)';
end $$;
reset role;

set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.essentials_pedidos;
  if n <> 0 then raise exception 'FALLO: authenticated ve % filas', n; end if;
  raise notice 'OK: authenticated no puede leer ningún pedido (RLS sin políticas)';
end $$;
reset role;

-- service_role ignora RLS (así lo usan las Edge Functions)
grant select on table public.essentials_pedidos to service_role;
set local role service_role;
do $$
begin
  if (select count(*) from public.essentials_pedidos) < 1 then
    raise exception 'FALLO: service_role no ve los pedidos';
  end if;
  raise notice 'OK: service_role lee los pedidos (BYPASSRLS)';
end $$;
reset role;

do $$ begin raise notice 'PASS: migración verificada en PostgreSQL %', current_setting('server_version'); end $$;
rollback;
