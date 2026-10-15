// Servidor n1co SIMULADO (HTTP real en 127.0.0.1) con los dos endpoints que usan n1co-pago y n1co-confirmar:
//   POST /api/paymentlink/checkout        crea el enlace de pago
//   GET  /api/paymentlink/order/{code}    consulta el estado de la orden
// Forma de las respuestas tomada del código real de n1co-pago/n1co-confirmar (ver referencia/LEEME.md).
// Lo que n1co hace por dentro en realidad (formatos de orderCode, estados no pagados, límites) NO se conoce:
// esta simulación solo cubre lo que las funciones reales ya dan por hecho.

import { createServer } from 'node:http';

export async function iniciarN1coSim({ secret }) {
  const ordenes = new Map();      // orderCode -> orden
  const peticiones = [];          // { metodo, ruta, auth, cuerpo }
  const opciones = {
    falloCrear: null,             // { status, cuerpo }  respuesta de error al crear
    sinOrderCode: false,          // responde 200 sin orderCode
    falloConsulta: null,          // { status }
    retardoMs: 0,                 // retardo de cada respuesta
  };
  let n = 0;

  const servidor = createServer(async (req, res) => {
    const trozos = [];
    for await (const t of req) trozos.push(t);
    const texto = Buffer.concat(trozos).toString('utf8');
    let cuerpo = null;
    try { cuerpo = texto ? JSON.parse(texto) : null; } catch { cuerpo = '<<json inválido>>'; }
    const auth = req.headers['authorization'] || '';
    peticiones.push({
      metodo: req.method, ruta: req.url, auth, accept: req.headers['accept'], contentType: req.headers['content-type'], cuerpo,
    });

    const responder = (status, obj) => {
      const enviar = () => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (opciones.retardoMs > 0) setTimeout(enviar, opciones.retardoMs); else enviar();
    };

    if (auth !== `Bearer ${secret}`) return responder(401, { message: 'Unauthorized' });

    if (req.method === 'POST' && req.url === '/api/paymentlink/checkout') {
      if (opciones.falloCrear) return responder(opciones.falloCrear.status, opciones.falloCrear.cuerpo ?? { message: 'error' });
      const p = cuerpo;
      const faltan = ['orderReference', 'orderName', 'orderDescription', 'successUrl', 'cancelUrl']
        .filter((k) => typeof p?.[k] !== 'string' || !p[k]);
      if (faltan.length || typeof p?.amount !== 'number' || !(p.amount > 0) || !Array.isArray(p.metadata)) {
        return responder(400, { message: 'payload inválido', faltan });
      }
      n += 1;
      const orderCode = `N1TEST${String(n).padStart(4, '0')}X`;
      const orden = {
        orderCode, orderId: 9000 + n, payload: p, orderStatus: 'PENDING', total: p.amount, currency: 'USD',
        metadata: p.metadata, buyer: { email: 'pagador@n1co.test', name: 'Pagador n1co' },
      };
      ordenes.set(orderCode, orden);
      if (opciones.sinOrderCode) return responder(200, { paymentLinkUrl: `https://pay.n1co.test/checkout/${orderCode}` });
      return responder(200, {
        paymentLinkUrl: `https://pay.n1co.test/checkout/${orderCode}`, orderCode, orderId: orden.orderId,
      });
    }

    const m = req.method === 'GET' && req.url.match(/^\/api\/paymentlink\/order\/([^/?]+)$/);
    if (m) {
      if (opciones.falloConsulta) return responder(opciones.falloConsulta.status, { message: 'error' });
      const o = ordenes.get(m[1]);
      if (!o) return responder(404, { message: 'Order not found' });
      return responder(200, {
        orderCode: o.orderCode,
        orderStatus: o.orderStatus,
        total: o.total,
        metadata: o.metadata,
        store: { currencyCode: o.currency },
        payment: { buyer: o.buyer },
      });
    }
    return responder(404, { message: 'ruta desconocida' });
  });

  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const puerto = servidor.address().port;

  return {
    puerto,
    ordenes,
    peticiones,
    opciones,
    // Acciones del "comprador" en n1co
    pagar(orderCode, { total, currency, status = 'PAID' } = {}) {
      const o = ordenes.get(orderCode);
      if (!o) throw new Error(`orden n1co inexistente en la simulación: ${orderCode}`);
      o.orderStatus = status;
      if (total !== undefined) o.total = total;
      if (currency !== undefined) o.currency = currency;
    },
    fijarEstado(orderCode, status) { ordenes.get(orderCode).orderStatus = status; },
    consultas(orderCode) {
      return peticiones.filter((p) => p.metodo === 'GET' && p.ruta === `/api/paymentlink/order/${orderCode}`).length;
    },
    creaciones() { return peticiones.filter((p) => p.metodo === 'POST'); },
    cerrar: () => new Promise((ok) => { servidor.closeAllConnections?.(); servidor.close(ok); }),
  };
}
