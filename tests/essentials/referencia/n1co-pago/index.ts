// ═══════════════════════════════════════════════════════════════
//  CVPro · Edge Function: n1co-pago
//  Crea un link de pago en n1co. El PRECIO se define AQUÍ (servidor).
//  El navegador solo pide un plan por nombre; nunca envía montos.
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

const SITIO = 'https://getcvpro.com';

// FUENTE ÚNICA DE VERDAD DE PRECIOS
const PLANES: Record<string, { precio: number; nombre: string }> = {
  basico:   { precio: 4.99,  nombre: 'CVPro Básico' },
  estandar: { precio: 9.99,  nombre: 'CVPro Estándar' },
  premium:  { precio: 14.99, nombre: 'CVPro Premium' },
};

const DESCRIPCION: Record<string, string> = {
  basico:   'CV profesional con IA · 20 plantillas · PDF + versión ATS',
  estandar: 'CV + 1 carta de presentación · 1 adaptación · 1 traducción',
  premium:  'CV + cartas, adaptaciones y traducciones ilimitadas · 6 meses',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!N1CO_SECRET_KEY) {
    console.error('n1co-pago: falta N1CO_SECRET_KEY');
    return json({ error: 'Pasarela no configurada' }, 500);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const plan = String(body?.plan ?? '').toLowerCase().trim();
    const codigoCv = String(body?.codigo_cv ?? '').trim().slice(0, 64);

    if (!PLANES[plan]) {
      return json({ error: 'Plan no válido' }, 400);
    }
    if (!codigoCv) {
      return json({ error: 'Falta el código del CV' }, 400);
    }

    const { precio, nombre } = PLANES[plan];

    const referencia = `CVPRO-${codigoCv}-${Date.now().toString(36).toUpperCase()}`;

    const payload = {
      orderReference: referencia,
      orderName: nombre,
      orderDescription: DESCRIPCION[plan],
      amount: precio,
      successUrl: `${SITIO}/gracias.html`,
      cancelUrl: `${SITIO}/chat-cv.html?pago=cancelado`,
      metadata: [
        { name: 'codigo_cv', value: codigoCv },
        { name: 'plan', value: plan },
      ],
      expirationMinutes: 60,
    };

    const r = await fetch(`${API_BASE}/paymentlink/checkout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${N1CO_SECRET_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => null);

    if (!r.ok || !data?.paymentLinkUrl) {
      console.error('n1co-pago: n1co rechazó la creación', r.status, JSON.stringify(data));
      return json({ error: 'No se pudo iniciar el pago. Intenta de nuevo.' }, 502);
    }

    console.log(`n1co-pago OK · plan=${plan} · orderCode=${data.orderCode} · ref=${referencia}`);

    return json({
      paymentLinkUrl: data.paymentLinkUrl,
      orderCode: data.orderCode,
      orderId: data.orderId,
    });

  } catch (err) {
    console.error('n1co-pago error:', err);
    return json({ error: 'Error al iniciar el pago. Intenta de nuevo.' }, 500);
  }
});
