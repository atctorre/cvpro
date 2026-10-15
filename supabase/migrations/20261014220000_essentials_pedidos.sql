-- ════════════════════════════════════════════════════════════════════════════
-- Professional Essentials by CVPro · pedidos de la tienda /essentials/
--
-- Tabla NUEVA e independiente de public.pagos:
--   · pagos.monto tiene CHECK (monto >= 4.99 AND monto <= 100), y los pedidos de la tienda
--     superan los 100 USD; además mezclaría bienes físicos con planes de CV.
--   · guarda datos personales (dirección de entrega) que pagos no debe contener.
--
-- Acceso: SOLO el service role (las Edge Functions essentials-pago y essentials-confirmar).
--   RLS activado y SIN políticas: anon y authenticated no pueden leer ni escribir nada.
--
-- Integridad del cobro:
--   · CHECK (estado = 'pagado') = (pagado_en IS NOT NULL) y un pedido pagado exige order_code.
--   · El trigger essentials_pedidos_guard impide modificar un pedido ya pagado (estado,
--     pagado_en, importes, items, order_code…): una segunda confirmación NO puede repetirse
--     ni sobrescribir la primera, ni siquiera con acceso directo a la tabla.
--   · essentials-confirmar hace además UPDATE ... WHERE estado <> 'pagado' (atómico).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.essentials_pedidos (
  id                  uuid primary key default gen_random_uuid(),          -- "pedido": identificador público
  created_at          timestamptz not null default now(),
  actualizado_at      timestamptz not null default now(),

  -- Estado y pasarela (n1co)
  estado              text not null default 'creado',
  referencia          text not null,                                       -- ESS-XXXXXXXXXX (propia; viaja en la URL de retorno)
  order_code          text,                                                -- orderCode de n1co
  n1co_order_id       text,
  payment_link_url    text,
  link_creado_at      timestamptz,
  n1co_estado         text,                                                -- orderStatus crudo de n1co (PAID, FINALIZED, ...)
  ultima_consulta     timestamptz,
  entorno             text not null default 'sandbox',                     -- 'sandbox' | 'live' (N1CO_ENTORNO)
  monto_n1co          numeric(10,2),                                       -- total que reportó n1co al confirmar
  pagado_en           timestamptz,

  -- Importes calculados en el servidor (USD). Envío incluido en el precio; sin impuestos en v1.
  items               jsonb not null,                                      -- foto: sku, variante, nombre, qty, precio_unit_cents, subtotal_cents
  subtotal            numeric(10,2) not null,
  costo_envio         numeric(10,2) not null default 0,
  impuesto            numeric(10,2) not null default 0,
  total               numeric(10,2) not null,
  moneda              text not null default 'USD',

  -- Comprador y dirección de envío normalizada (EE.UU.)
  nombre              text not null,
  email               text not null,                                       -- se guarda en minúsculas
  telefono            text,
  envio_line1         text not null,
  envio_line2         text,
  envio_city          text not null,
  envio_state         text not null,                                       -- código USPS de 2 letras
  envio_zip           text not null,                                       -- 12345 o 12345-6789
  envio_pais          text not null default 'US',

  -- Consentimiento y huella de la solicitud
  acepto_politica_at  timestamptz not null,                                -- momento (servidor) en que aceptó la política
  politica_version    text not null,
  user_agent          text,

  -- Idempotencia de "pagar" y prueba de posesión para "confirmar"
  idem                text,
  solicitud_hash      text,
  token_consulta      text not null,                                       -- 128 bits; solo lo ve el navegador que creó el pedido

  -- Cumplimiento (manual, desde el panel)
  cumplimiento        text not null default 'pendiente',
  seguimiento         text,

  constraint essentials_pedidos_estado_chk check (estado in
    ('creado', 'pendiente', 'pagado', 'fallido', 'cancelado', 'fallido_pasarela', 'revision')),
  constraint essentials_pedidos_entorno_chk check (entorno in ('sandbox', 'live')),
  constraint essentials_pedidos_moneda_chk check (moneda = 'USD'),
  constraint essentials_pedidos_items_chk check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 5),
  constraint essentials_pedidos_importes_chk check (
    subtotal > 0 and costo_envio >= 0 and impuesto >= 0 and total = subtotal + costo_envio + impuesto),
  constraint essentials_pedidos_referencia_chk check (referencia ~ '^ESS-[2-9A-HJ-NP-Z]{10}$'),
  constraint essentials_pedidos_order_code_chk check (order_code is null or order_code ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint essentials_pedidos_token_chk check (token_consulta ~ '^[0-9a-f]{32}$'),
  constraint essentials_pedidos_email_chk check (length(email) <= 254 and position('@' in email) > 1),
  constraint essentials_pedidos_state_chk check (envio_state ~ '^[A-Z]{2}$'),
  constraint essentials_pedidos_zip_chk check (envio_zip ~ '^\d{5}(-\d{4})?$'),
  constraint essentials_pedidos_pais_chk check (envio_pais = 'US'),
  constraint essentials_pedidos_cumplimiento_chk check (cumplimiento in
    ('pendiente', 'pedido_a_proveedor', 'enviado', 'entregado', 'reembolsado', 'cancelado')),
  -- pagado <=> tiene fecha de pago, y un pedido pagado siempre tiene order_code de n1co
  constraint essentials_pedidos_pagado_chk check ((estado = 'pagado') = (pagado_en is not null)),
  constraint essentials_pedidos_pagado_codigo_chk check (estado <> 'pagado' or order_code is not null),
  constraint essentials_pedidos_idem_key unique (idem),
  constraint essentials_pedidos_referencia_key unique (referencia)
);

comment on table public.essentials_pedidos is
  'Pedidos de /essentials/ (dropshipping, EE.UU.). Solo service role: RLS activado sin politicas. Contiene datos personales.';

-- Índices: order_code (consulta de confirmación) y email (soporte al cliente)
create unique index if not exists essentials_pedidos_order_code_uidx
  on public.essentials_pedidos (order_code) where order_code is not null;
create index if not exists essentials_pedidos_email_idx
  on public.essentials_pedidos (lower(email));
create index if not exists essentials_pedidos_created_at_idx
  on public.essentials_pedidos (created_at desc);
create index if not exists essentials_pedidos_abiertos_idx
  on public.essentials_pedidos (created_at) where estado in ('creado', 'pendiente', 'revision');

-- Un pedido pagado no se puede confirmar otra vez ni alterar sus datos de cobro.
create or replace function public.essentials_pedidos_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.actualizado_at := clock_timestamp();   -- clock_timestamp: cambia aunque haya varias escrituras en una transaccion

  if tg_op = 'UPDATE' and old.estado = 'pagado' then
    if new.estado             is distinct from old.estado
       or new.pagado_en          is distinct from old.pagado_en
       or new.order_code         is distinct from old.order_code
       or new.referencia         is distinct from old.referencia
       or new.items              is distinct from old.items
       or new.subtotal           is distinct from old.subtotal
       or new.costo_envio        is distinct from old.costo_envio
       or new.impuesto           is distinct from old.impuesto
       or new.total              is distinct from old.total
       or new.moneda             is distinct from old.moneda
       or new.entorno            is distinct from old.entorno
       or new.monto_n1co         is distinct from old.monto_n1co
       or new.acepto_politica_at is distinct from old.acepto_politica_at
    then
      raise exception 'essentials_pedidos: el pedido % ya esta pagado; no se puede confirmar de nuevo ni modificar sus datos de cobro', old.id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists essentials_pedidos_guard_trg on public.essentials_pedidos;
create trigger essentials_pedidos_guard_trg
  before insert or update on public.essentials_pedidos
  for each row execute function public.essentials_pedidos_guard();

-- Sin acceso público: RLS activado y SIN políticas (solo el service role, que ignora RLS).
alter table public.essentials_pedidos enable row level security;
revoke all on table public.essentials_pedidos from anon, authenticated;
revoke all on function public.essentials_pedidos_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';
