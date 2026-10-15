// ═══════════════════════════════════════════════════════════════
//  CVPro · Edge Function: n1co-confirmar
//  Verifica el estado de una orden CONTRA N1CO (no contra el navegador)
//  y registra el pago en Supabase con el monto que reporta n1co.
// ═══════════════════════════════════════════════════════════════

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const N1CO_ENTORNO = (Deno.env.get('N1CO_ENTORNO') ?? 'sandbox').toLowerCase();
const N1CO_SECRET_KEY = Deno.env.get('N1CO_SECRET_KEY') ?? '';

const API_BASE = N1CO_ENTORNO === 'live'
  ? 'https://api-pay.n1co.shop/api'
  : 'https://api-pay-sandbox.n1co.shop/api';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Mismos umbrales que verificar_pago(). Fuente única de verdad.
function planDesdeMonto(monto: number): string {
  if (monto >= 14.99) return 'premium';
  if (monto >= 9.99)  return 'estandar';
  if (monto >= 4.99)  return 'basico';
  return 'ninguno';
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function metaValor(metadata: any[], nombre: string): string {
  if (!Array.isArray(metadata)) return '';
  const m = metadata.find((x) => x?.name === nombre);
  return m?.value ? String(m.value) : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!N1CO_SECRET_KEY || !SUPABASE_URL || !SERVICE_KEY) {
    console.error('n1co-confirmar: faltan variables de entorno');
    return json({ error: 'Servicio no configurado' }, 500);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const orderCode = String(body?.orderCode ?? '').trim().slice(0, 64);

    if (!orderCode || !/^[A-Za-z0-9_-]+$/.test(orderCode)) {
      return json({ pagado: false, error: 'Código de orden no válido' }, 400);
    }

    // 1. Preguntarle a n1co el estado REAL de la orden
    const r = await fetch(`${API_BASE}/paymentlink/order/${orderCode}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${N1CO_SECRET_KEY}`,
        'Accept': 'application/json',
      },
    });

    if (!r.ok) {
      console.error('n1co-confirmar: n1co respondió', r.status, await r.text());
      return json({ pagado: false, error: 'No se pudo verificar el pago' }, 502);
    }

    const orden = await r.json();
    const estado = String(orden?.orderStatus ?? '').toUpperCase();

    if (estado !== 'PAID' && estado !== 'FINALIZED') {
      console.log(`n1co-confirmar: orden ${orderCode} en estado ${estado}`);
      return json({ pagado: false, estado });
    }

    // 2. El monto viene de n1co, NO del navegador
    const monto = Number(orden?.total ?? 0);
    if (!(monto > 0)) {
      console.error('n1co-confirmar: monto inválido', orden?.total);
      return json({ pagado: false, error: 'Monto no válido' }, 502);
    }

    const plan     = planDesdeMonto(monto);
    const codigoCv = metaValor(orden?.metadata, 'codigo_cv');
    const pago     = orden?.payment ?? {};
    const buyer    = pago?.buyer ?? {};

    if (!codigoCv) {
      console.error('n1co-confirmar: orden sin codigo_cv en metadata', orderCode);
      return json({ pagado: false, error: 'Orden sin código asociado' }, 502);
    }

    // 3. Idempotencia: no duplicar si ya se registró
    const yaExiste = await fetch(
      `${SUPABASE_URL}/rest/v1/pagos?orden_id=eq.${encodeURIComponent(orderCode)}&select=id&limit=1`,
      { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
    );
    const filas = await yaExiste.json().catch(() => []);
    if (Array.isArray(filas) && filas.length > 0) {
      console.log(`n1co-confirmar: orden ${orderCode} ya registrada — no se duplica`);
      return json({ pagado: true, plan, monto, codigo_cv: codigoCv, duplicado: true });
    }

    // 4. Registrar el pago
    const registro = {
      orden_id:  orderCode,
      codigo_cv: codigoCv,
      plan,
      monto,
      moneda:    String(orden?.store?.currencyCode ?? 'USD'),
      email:     String(buyer?.email ?? ''),
      nombre:    String(buyer?.name ?? '').trim(),
      estado:    'completado',
      entorno:   N1CO_ENTORNO === 'live' ? 'live' : 'sandbox',
    };

    const ins = await fetch(`${SUPABASE_URL}/rest/v1/pagos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(registro),
    });

    if (!ins.ok) {
      const txt = await ins.text();
      console.error('n1co-confirmar: Supabase rechazó el insert', ins.status, txt);
      return json({ pagado: false, error: 'Pago cobrado pero no registrado' }, 500);
    }

    console.log(`n1co-confirmar OK · ${orderCode} · ${plan} · $${monto} · ${registro.entorno}`);

    return json({
      pagado: true,
      plan,
      monto,
      codigo_cv: codigoCv,
      email: registro.email,
      nombre: registro.nombre,
    });

  } catch (err) {
    console.error('n1co-confirmar error:', err);
    return json({ pagado: false, error: 'Error al verificar el pago' }, 500);
  }
});
