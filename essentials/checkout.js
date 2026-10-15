/* CVPro Essentials: logica de compra de /essentials/ (Tarea 11).
   - checkout.html: lee el carrito, pide el total a essentials-pago (accion "cotizar"), valida la direccion de EE.UU., exige la
     aceptacion de la politica y llama a "pagar"; guarda el token del pedido y redirige a la URL de pago devuelta.
   - thanks.html: lee ?ref= y el token guardado, llama a essentials-confirmar y muestra el estado (pagado / pendiente / revision).
   - Resto de paginas que cargan este archivo (terms, shipping-returns): solo el contador del carrito.
   Reglas:
   - Los importes salen SIEMPRE de la respuesta del servidor: aqui no se suman ni se multiplican precios.
   - Contrato: tarea-10/README.md. Usa solo la URL de Supabase y la clave anon (publicable) que ya estan en essentials.js e index.html
     (el generador las inyecta al construir el sitio; en este archivo fuente van como marcadores).
   - Claves de almacenamiento propias: essentials_cart (compartida con las fichas), essentials_orden, essentials_pedido,
     essentials_sesion, essentials_idem, essentials_draft, essentials_purchase_<pedido>. Esta seccion no lee ni escribe claves
     de otros flujos del sitio.
   - Todo texto entra por textContent (nada de innerHTML). */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://lljmqyejwkgcbuwkgjkh.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxsam1xeWVqd2tnY2J1d2tnamtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNzc5MzEsImV4cCI6MjEwMjc1MzkzMX0.5zyP9cb9wnkjlPeafe8zBOBPU-joameF0UzxUXDgq60';
  var FN_PAGO = SUPABASE_URL + '/functions/v1/essentials-pago';
  var FN_CONFIRMAR = SUPABASE_URL + '/functions/v1/essentials-confirmar';
  var CATALOG = window.ESSENTIALS_CATALOG || null;
  var K = {
    cart: 'essentials_cart', pedido: 'essentials_pedido', orden: 'essentials_orden', sesion: 'essentials_sesion',
    idem: 'essentials_idem', draft: 'essentials_draft', purchase: 'essentials_purchase_'
  };
  var MAX_QTY = 5;     // el servidor acepta 1 a 5 por linea; catalog.js declara el mismo maximo (maxQty 5)
  var MAX_LINES = 5;
  var RETRY_DELAY_MS = 2500;
  var MAX_RETRIES = 3;
  var CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var TOKEN_RE = /^[0-9a-f]{32}$/i;
  var EMAIL_RE = /^[\w.+-]+@[\w.-]+\.\w{2,}$/;
  var ZIP_RE = /^\d{5}(-\d{4})?$/;
  var TEL_RE = /^[0-9+()\-\s.]{7,20}$/;
  var STATE_CODES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
    'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
    'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];
  var PAGE = (document.body && document.body.getAttribute('data-page')) || '';

  // ── Almacenamiento a prueba de navegadores embebidos (mismo patron blindar() de essentials.js e index.html) ──
  function blindar(nombre) {
    var mem = {};
    var nativo = null;
    try { nativo = window[nombre]; } catch (e) { nativo = null; }
    var sirve = false;
    try {
      nativo.setItem('__essentials_t__', '1');
      sirve = nativo.getItem('__essentials_t__') === '1';
      nativo.removeItem('__essentials_t__');
    } catch (e) { sirve = false; }
    if (sirve) { return; }
    var falso = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; },
      clear: function () { mem = {}; },
      key: function (i) { return Object.keys(mem)[i] || null; }
    };
    try {
      Object.defineProperty(window, nombre, { configurable: true, get: function () { return falso; } });
      if (window[nombre] === falso) { return; }
    } catch (e) { /* sigue */ }
    try {
      nativo.getItem = falso.getItem; nativo.setItem = falso.setItem;
      nativo.removeItem = falso.removeItem; nativo.clear = falso.clear;
    } catch (e) { /* sin almacenamiento: el estado vive solo en la memoria de la pagina */ }
  }
  blindar('localStorage');
  blindar('sessionStorage');

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignorar */ } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignorar */ } }
  function ssGet(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* ignorar */ } }
  function ssDel(k) { try { window.sessionStorage.removeItem(k); } catch (e) { /* ignorar */ } }

  // ── Utilidades ──
  function $(sel, root) { return (root || document).querySelector(sel); }
  function byId(id) { return document.getElementById(id); }
  function idle(fn) {
    if (window.requestIdleCallback) { window.requestIdleCallback(fn, { timeout: 4000 }); } else { setTimeout(fn, 1500); }
  }
  // Solo da formato a centavos que ya vienen del servidor.
  function money(cents) {
    if (typeof cents !== 'number' || !isFinite(cents)) { return '-'; }
    return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function uuid() {
    var c = window.crypto;
    if (c && c.randomUUID) { return c.randomUUID(); }
    var b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var x = Array.prototype.map.call(b, function (n) { return ('0' + n.toString(16)).slice(-2); }).join('');
    return x.slice(0, 8) + '-' + x.slice(8, 12) + '-' + x.slice(12, 16) + '-' + x.slice(16, 20) + '-' + x.slice(20);
  }
  function sesion() {
    var s = ssGet(K.sesion);
    if (!s) { s = uuid().replace(/-/g, '').slice(0, 24); ssSet(K.sesion, s); }
    return s;
  }
  function param(name) {
    try { return new URLSearchParams(window.location.search).get(name) || ''; } catch (e) { return ''; }
  }
  // Crea elementos sin innerHTML: el texto entra por textContent.
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') { el.textContent = attrs[k]; } else if (attrs[k] !== false && attrs[k] != null) { el.setAttribute(k, attrs[k]); }
    });
    (kids || []).forEach(function (c) { if (c) { el.appendChild(c); } });
    return el;
  }
  function txt(s) { return document.createTextNode(s); }
  function clear(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // ── Analitica (mismo formato que essentials.js: GA4 + tabla eventos; lang fijo "en") ──
  function ev(nombre, extra) {
    idle(function () {
      try {
        if (window.gtag) { window.gtag('event', nombre, extra || {}); }
        fetch(SUPABASE_URL + '/rest/v1/eventos', {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ evento: nombre, pagina: window.location.pathname, lang: 'en', extra: extra || null })
        }).catch(function () { /* la analitica nunca bloquea */ });
      } catch (e) { /* ignorar */ }
    });
  }

  // ── Carrito: solo {sku, variante, qty}; los precios nunca se guardan ni se envian ──
  var clamped = false;
  function prod(sku) {
    return (CATALOG && CATALOG.products && has(CATALOG.products, sku)) ? CATALOG.products[sku] : null;
  }
  function variantOf(l) {
    var p = prod(l.sku);
    if (!p) { return null; }
    return p.variants.filter(function (v) { return v.id === l.variante; })[0] || null;
  }
  function readCart() {
    var a;
    try { a = JSON.parse(lsGet(K.cart) || '[]'); } catch (e) { a = []; }
    if (!Array.isArray(a)) { return []; }
    var seen = {};
    var out = [];
    clamped = false;
    a.forEach(function (l) {
      if (!l || typeof l.sku !== 'string' || typeof l.variante !== 'string' || typeof l.qty !== 'number') { return; }
      if (!isFinite(l.qty) || Math.floor(l.qty) !== l.qty || l.qty < 1) { return; }
      if (CATALOG) {
        var p = prod(l.sku);
        if (!p || !p.variants.some(function (v) { return v.id === l.variante; })) { return; }
      }
      if (has(seen, l.sku)) { return; }   // el contrato no admite el mismo sku dos veces
      seen[l.sku] = true;
      if (l.qty > MAX_QTY) { clamped = true; }
      out.push({ sku: l.sku, variante: l.variante, qty: Math.min(MAX_QTY, l.qty) });
    });
    return out.slice(0, MAX_LINES);
  }
  function writeCart(lines) {
    lsSet(K.cart, JSON.stringify(lines.map(function (l) { return { sku: l.sku, variante: l.variante, qty: l.qty }; })));
    updateBadge();
  }
  function updateBadge() {
    var el = byId('cartCount');
    if (!el) { return; }
    var n = readCart().reduce(function (s, l) { return s + l.qty; }, 0);
    el.textContent = String(n);
    el.hidden = n === 0;
  }
  function itemsPayload(lines) {
    return lines.map(function (l) { return { sku: l.sku, variante: l.variante, qty: l.qty }; });
  }

  // ── Orden guardada para thanks.html: {pedido, referencia, orderCode, token} en sessionStorage Y localStorage ──
  function saveOrden(d) {
    var o = { pedido: d.pedido || '', referencia: d.referencia || '', orderCode: d.orderCode || '', token: d.token || '', ts: Date.now() };
    var s = JSON.stringify(o);
    ssSet(K.orden, s); lsSet(K.orden, s);
    if (o.pedido) { ssSet(K.pedido, o.pedido); lsSet(K.pedido, o.pedido); }
  }
  function readOrden() {
    var raw = ssGet(K.orden) || lsGet(K.orden);
    if (!raw) { return null; }
    try {
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') { return null; }
      return {
        pedido: typeof o.pedido === 'string' ? o.pedido : '',
        referencia: (typeof o.referencia === 'string' && CODE_RE.test(o.referencia)) ? o.referencia : '',
        orderCode: (typeof o.orderCode === 'string' && CODE_RE.test(o.orderCode)) ? o.orderCode : '',
        token: (typeof o.token === 'string' && TOKEN_RE.test(o.token)) ? o.token.toLowerCase() : ''
      };
    } catch (e) { return null; }
  }

  // ── Cliente HTTP de las dos funciones ──
  function post(url, body) {
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 25000) : null;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
      body: JSON.stringify(body),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d || {} }; });
    }).then(function (res) { if (timer) { clearTimeout(timer); } return res; },
      function (err) { if (timer) { clearTimeout(timer); } throw err; });
  }
  var GENERIC = 'Checkout is not available right now. Please try again later or email hola@getcvpro.com.';
  function errText(res) {
    var d = res.data || {};
    if (res.status === 429) { return 'Too many attempts. Please try again in ' + (d.retry_after_seconds || 60) + ' seconds.'; }
    if (d.error) { return String(d.error); }
    return GENERIC;
  }

  /* ════════════════════════════════ CHECKOUT ════════════════════════════════ */
  var FIELD_IDS = ['email', 'nombre', 'linea1', 'linea2', 'ciudad', 'estado', 'zip', 'telefono'];
  var RULES = {
    email: { msg: 'Enter a valid email address.', ok: function (v) { return v.length <= 254 && EMAIL_RE.test(v) && !/[<>]/.test(v); } },
    nombre: { msg: 'Enter the full name for delivery (2 to 80 characters).', ok: function (v) { return v.length >= 2 && v.length <= 80 && !/[<>]/.test(v); } },
    linea1: { msg: 'Enter your street address (3 to 100 characters).', ok: function (v) { return v.length >= 3 && v.length <= 100 && !/[<>]/.test(v); } },
    linea2: { msg: 'Apartment or suite can have up to 100 characters.', ok: function (v) { return v.length <= 100 && !/[<>]/.test(v); } },
    ciudad: { msg: 'Enter your city (2 to 60 characters).', ok: function (v) { return v.length >= 2 && v.length <= 60 && !/[<>]/.test(v); } },
    estado: { msg: 'Select a valid U.S. state.', ok: function (v) { return STATE_CODES.indexOf(v) >= 0; } },
    zip: { msg: 'Enter a valid ZIP code (12345 or 12345-6789).', ok: function (v) { return ZIP_RE.test(v); } },
    telefono: { msg: 'Enter a valid phone number or leave it blank.', ok: function (v) { return v === '' || TEL_RE.test(v); } }
  };
  var SERVER_FIELD = { 'envio.nombre': 'nombre', 'envio.linea1': 'linea1', 'envio.linea2': 'linea2', 'envio.ciudad': 'ciudad',
    'envio.estado': 'estado', 'envio.zip': 'zip', 'envio.telefono': 'telefono', email: 'email' };

  var co = null;   // elementos y estado del checkout
  var quoteSeq = 0;

  function fieldVal(id) {
    var el = byId('co-' + id);
    return el ? String(el.value || '').replace(/\s+/g, ' ').trim() : '';
  }
  function setFieldError(id, msg) {
    var input = byId('co-' + id);
    var err = byId('err-' + id);
    if (!input || !err) { return; }
    if (msg) { err.textContent = msg; err.hidden = false; input.setAttribute('aria-invalid', 'true'); }
    else { err.textContent = ''; err.hidden = true; input.removeAttribute('aria-invalid'); }
  }
  function validateField(id) {
    var ok = RULES[id].ok(fieldVal(id));
    setFieldError(id, ok ? '' : RULES[id].msg);
    return ok;
  }
  function validateAll() {
    var first = null;
    FIELD_IDS.forEach(function (id) {
      if (!validateField(id) && !first) { first = id; }
    });
    if (first) { byId('co-' + first).focus(); }
    return !first;
  }
  function setAcceptError(msg) {
    var err = byId('err-accept');
    var box = byId('co-accept');
    if (msg) { err.textContent = msg; err.hidden = false; box.setAttribute('aria-invalid', 'true'); }
    else { err.textContent = ''; err.hidden = true; box.removeAttribute('aria-invalid'); }
  }
  function setStatus(content, cls) {
    clear(co.status);
    if (content) { co.status.appendChild(typeof content === 'string' ? txt(content) : content); }
    co.status.className = 'pf-status' + (cls ? ' ' + cls : '');
  }

  function saveDraft() {
    var d = {};
    FIELD_IDS.forEach(function (id) { d[id] = byId('co-' + id).value; });
    ssSet(K.draft, JSON.stringify(d));
  }
  function restoreDraft() {
    var d = null;
    try { d = JSON.parse(ssGet(K.draft) || 'null'); } catch (e) { d = null; }
    if (!d || typeof d !== 'object') { return; }
    FIELD_IDS.forEach(function (id) {
      if (typeof d[id] === 'string') { byId('co-' + id).value = d[id]; }
    });
  }

  function lineAmountEl(sku) { return co.lines.querySelector('[data-amt="' + sku + '"]'); }

  function renderLines() {
    clear(co.lines);
    co.state.lines.forEach(function (l) {
      var p = prod(l.sku);
      var v = variantOf(l);
      var shortName = p ? p.shortName : l.sku;
      var qsel = h('select', { id: 'qty-' + l.sku, 'aria-label': 'Quantity, ' + shortName });
      for (var n = 1; n <= MAX_QTY; n++) {
        var o = h('option', { value: String(n), text: String(n) });
        if (n === l.qty) { o.selected = true; }
        qsel.appendChild(o);
      }
      qsel.addEventListener('change', function () { setQty(l.sku, parseInt(qsel.value, 10)); });
      var rm = h('button', { type: 'button', 'class': 'pf-remove', 'aria-label': 'Remove ' + shortName + ' from your order', text: 'Remove' });
      rm.addEventListener('click', function () { removeLine(l.sku); });
      var thumb = (p && p.image) ? h('img', { 'class': 'pf-thumb', src: p.image, alt: p.imageAlt || p.name, width: '72', height: '72',
        'data-image-status': p.imageStatus || 'provisional' }) : h('span', { 'class': 'pf-thumb' });
      var name = h('div', { 'class': 'pf-name' }, [p ? h('a', { href: p.url, text: shortName }) : txt(shortName)]);
      // Importe del servidor y precio unitario en su propia fila, bajo el nombre: asi el ancho del nombre no depende de cuando llega
      // la cotizacion y la linea no cambia de altura al recibirla (evita layout shift).
      var amt = h('span', { 'class': 'pf-amt', 'data-amt': l.sku, text: '-' });
      var unit = h('span', { 'class': 'pf-unit', 'data-unit': l.sku });
      var info = h('div', { 'class': 'pf-info' }, [name, h('span', { 'class': 'pf-opt', text: v ? v.label : l.variante }),
        h('div', { 'class': 'pf-price' }, [amt, unit])]);
      var ctrl = h('div', { 'class': 'pf-ctrl' }, [
        h('label', { 'for': 'qty-' + l.sku }, [txt('Quantity'), qsel]),
        rm
      ]);
      var err = h('p', { 'class': 'pf-error', 'data-lineerr': l.sku, hidden: '' });
      co.lines.appendChild(h('li', { 'class': 'pf-line' }, [thumb, info, ctrl, err]));
    });
  }

  // Pone los importes del SERVIDOR en cada linea (la estructura de la lista no cambia: no se pierde el foco del selector).
  function updateLineAmounts() {
    var q = co.state.quote;
    co.state.lines.forEach(function (l) {
      var a = lineAmountEl(l.sku);
      var u = co.lines.querySelector('[data-unit="' + l.sku + '"]');
      var item = q && q.items ? q.items.filter(function (i) { return i.sku === l.sku; })[0] : null;
      if (a) { a.textContent = item ? money(item.subtotal_cents) : '-'; }
      if (u) { u.textContent = item ? money(item.precio_unit_cents) + ' each' : ''; }
    });
  }

  function renderTotals() {
    clear(co.totals);
    function row(label, value, cls) {
      co.totals.appendChild(h('div', { 'class': 'pf-row' + (cls ? ' ' + cls : '') }, [h('dt', { text: label }), h('dd', { text: value })]));
    }
    var s = co.state;
    if (s.quoting) { co.totals.appendChild(h('p', { 'class': 'pf-muted', text: 'Checking price…' })); co.delivery.textContent = ''; return; }
    if (!s.quote) {
      if (s.quoteError) {
        var retry = h('button', { type: 'button', 'class': 'btn-secondary pf-retry', text: 'Try again' });
        retry.addEventListener('click', fetchQuote);
        co.totals.appendChild(h('p', { 'class': 'pf-error', role: 'alert', text: s.quoteError }));
        co.totals.appendChild(retry);
      }
      co.delivery.textContent = '';
      return;
    }
    var q = s.quote;
    row('Subtotal', money(q.subtotal_cents));
    row('Shipping', q.envio_cents === 0 ? 'Included' : money(q.envio_cents));
    if (q.impuesto_cents > 0) { row('Tax', money(q.impuesto_cents)); }
    row('Total', money(q.total_cents), 'is-total');
    var mn = 0, mx = 0;
    (q.items || []).forEach(function (i) {
      if (typeof i.entrega_min_dias === 'number') { mn = Math.max(mn, i.entrega_min_dias); }
      if (typeof i.entrega_max_dias === 'number') { mx = Math.max(mx, i.entrega_max_dias); }
    });
    co.delivery.textContent = mx > 0
      ? 'Estimated delivery: ' + mn + ' to ' + mx + ' days from your order date, to addresses in the United States. Prices are in US dollars.'
      : 'Prices are in US dollars.';
  }

  function updatePay() {
    var s = co.state;
    var ready = !!s.quote && !s.quoting && !s.busy && s.lines.length > 0;
    co.pay.disabled = !(ready && co.accept.checked);
    co.pay.textContent = s.quote ? 'Pay ' + money(s.quote.total_cents) : 'Pay';
    byId('hint-accept').hidden = co.accept.checked;
  }

  function validQuote(d) {
    return d && d.ok === true && Array.isArray(d.items) && typeof d.total_cents === 'number' && typeof d.subtotal_cents === 'number' &&
      typeof d.envio_cents === 'number' && typeof d.impuesto_cents === 'number';
  }

  function fetchQuote() {
    var s = co.state;
    var seq = ++quoteSeq;
    s.quote = null; s.quoteError = ''; s.quoting = true;
    co.lines.querySelectorAll('[data-lineerr]').forEach(function (e) { e.hidden = true; e.textContent = ''; });
    renderTotals(); updateLineAmounts(); updatePay();
    post(FN_PAGO, { accion: 'cotizar', items: itemsPayload(s.lines), lang: 'en' }).then(function (res) {
      if (seq !== quoteSeq) { return; }
      s.quoting = false;
      if (res.ok && validQuote(res.data)) {
        s.quote = res.data;
        if (!s.beginSent) {
          s.beginSent = true;
          ev('begin_checkout', { currency: 'USD', value: res.data.total_cents / 100, item_category: 'essentials',
            items: res.data.items.map(function (i) { return { item_id: i.sku, item_variant: i.variante, quantity: i.qty }; }) });
        }
      } else {
        s.quoteError = errText(res);
        var m = /^items\[(\d+)\]/.exec((res.data && res.data.campo) || '');
        var line = m ? s.lines[parseInt(m[1], 10)] : null;
        var le = line ? co.lines.querySelector('[data-lineerr="' + line.sku + '"]') : null;
        if (le) { le.textContent = s.quoteError; le.hidden = false; }
      }
      renderTotals(); updateLineAmounts(); updatePay();
    }, function () {
      if (seq !== quoteSeq) { return; }
      s.quoting = false;
      s.quoteError = 'We could not check the price right now. Check your connection and try again.';
      renderTotals(); updateLineAmounts(); updatePay();
    });
  }

  function setQty(sku, qty) {
    co.state.lines.forEach(function (l) { if (l.sku === sku) { l.qty = qty; } });
    writeCart(co.state.lines);
    fetchQuote();
  }
  function removeLine(sku) {
    co.state.lines = co.state.lines.filter(function (l) { return l.sku !== sku; });
    writeCart(co.state.lines);
    if (!co.state.lines.length) { showEmpty(); return; }
    renderLines(); fetchQuote();
    var first = co.lines.querySelector('select');
    if (first) { first.focus(); }
  }
  function showEmpty() {
    byId('co-loading').hidden = true;
    co.form.hidden = true;
    var empty = byId('co-empty');
    empty.hidden = false;
    var head = empty.querySelector('h2');
    head.setAttribute('tabindex', '-1');
    head.focus();
  }

  function idemFor(key) {
    var cur = null;
    try { cur = JSON.parse(ssGet(K.idem) || 'null'); } catch (e) { cur = null; }
    if (cur && cur.k === key && typeof cur.v === 'string') { return cur.v; }
    var v = uuid();
    ssSet(K.idem, JSON.stringify({ k: key, v: v }));
    return v;
  }

  function buildPayload() {
    var items = itemsPayload(co.state.lines);
    var envio = { nombre: fieldVal('nombre'), linea1: fieldVal('linea1'), linea2: fieldVal('linea2'), ciudad: fieldVal('ciudad'),
      estado: byId('co-estado').value, zip: fieldVal('zip'), pais: 'US', telefono: fieldVal('telefono') };
    var email = fieldVal('email');
    var key = JSON.stringify([items, email, envio]);
    return {
      accion: 'pagar',
      items: items,
      email: email,
      envio: envio,
      acepta_terminos: co.accept.checked === true,
      idem: idemFor(key),
      sesion: sesion(),
      lang: 'en'
    };
  }

  function failPay(res, lastKnownRef) {
    var d = res.data || {};
    co.state.busy = false;
    var msg = errText(res);
    var cls = 'is-err';
    var code = d.codigo || '';
    if (code === 'pedido_ya_pagado' || code === 'pedido_en_revision') {
      var ref = lastKnownRef || (readOrden() || {}).referencia || '';
      var box = h('span', {}, [txt(msg + ' ')]);
      if (ref) { box.appendChild(h('a', { href: '/essentials/thanks.html?ref=' + encodeURIComponent(ref), text: 'Check the order status.' })); }
      setStatus(box, cls);
    } else if (code === 'idem_reutilizado') {
      ssDel(K.idem);
      setStatus('Something changed in your order. Review it and press Pay again.', cls);
    } else if (code === 'politica_no_aceptada') {
      setAcceptError('You must agree to the sales policy to pay.');
      setStatus('', '');
    } else {
      setStatus(msg, cls);
    }
    var campo = d.campo || '';
    if (has(SERVER_FIELD, campo)) {
      var id = SERVER_FIELD[campo];
      setFieldError(id, d.error ? String(d.error) : RULES[id].msg);
      byId('co-' + id).focus();
    }
    ev('payment_error', { proveedor: 'n1co', status: res.status, codigo: code || null, campo: campo || null });
    updatePay();
  }

  function submitPay(attempt) {
    var s = co.state;
    var body = buildPayload();
    s.busy = true; updatePay();
    if (!attempt) {
      setStatus('Creating your order…', '');
      ev('payment_started', { proveedor: 'n1co', currency: 'USD', value: s.quote ? s.quote.total_cents / 100 : null, item_category: 'essentials' });
    }
    post(FN_PAGO, body).then(function (res) {
      var d = res.data || {};
      if (res.ok && d.ok === true && typeof d.paymentLinkUrl === 'string' && /^https:\/\//.test(d.paymentLinkUrl)) {
        saveOrden(d);
        setStatus('Redirecting to n1co…', 'is-ok');
        s.redirecting = true;
        window.location.assign(d.paymentLinkUrl);
        return;
      }
      if (res.status === 409 && d.codigo === 'pedido_en_proceso' && (attempt || 0) < MAX_RETRIES) {
        setStatus('Still preparing your payment link… trying again.', '');
        setTimeout(function () { submitPay((attempt || 0) + 1); }, 3000);
        return;
      }
      if (res.status === 409 && d.codigo === 'pedido_en_proceso') {
        res.data.error = 'Your payment link is still being prepared. Wait a few seconds and press Pay again.';
      }
      failPay(res);
    }, function () {
      s.busy = false;
      setStatus('We could not reach the checkout service. Please try again in a moment or email hola@getcvpro.com.', 'is-err');
      ev('payment_error', { proveedor: 'n1co', status: 0 });
      updatePay();
    });
  }

  function onSubmit(e) {
    e.preventDefault();
    var s = co.state;
    if (s.busy) { return; }
    if (!co.accept.checked) {
      setAcceptError('You must agree to the sales policy to pay.');
      co.accept.focus();
      return;
    }
    if (!validateAll()) { setStatus('Check the highlighted fields and try again.', 'is-err'); return; }
    if (!s.quote) { return; }
    setStatus('', '');
    submitPay(0);
  }

  function initCheckout() {
    co = {
      form: byId('co-form'), lines: byId('co-lines'), totals: byId('co-totals'), delivery: byId('co-delivery'),
      status: byId('co-status'), pay: byId('co-pay'), accept: byId('co-accept'),
      state: { lines: readCart(), quote: null, quoteError: '', quoting: false, busy: false, redirecting: false, beginSent: false }
    };
    if (param('pago') === 'cancelado') {
      // Si n1co ya cancelo ese enlace, reutilizarlo dejaria al comprador sin poder pagar: la proxima vez se pide uno nuevo.
      ssDel(K.idem);
      var al = byId('co-alert');
      al.textContent = 'Payment cancelled. You left n1co’s payment page before completing the payment, and your cart is still here. Review your order below and try again when you are ready.';
      al.hidden = false;
      ev('payment_cancelled', { proveedor: 'n1co' });
    }
    if (clamped) {
      writeCart(co.state.lines);
      var note = byId('co-note');
      note.textContent = 'An order holds up to ' + MAX_QTY + ' units of each item. We adjusted the quantity.';
      note.hidden = false;
    }
    byId('co-loading').hidden = true;
    if (!co.state.lines.length) { showEmpty(); return; }
    co.form.hidden = false;
    restoreDraft();
    renderLines();
    FIELD_IDS.forEach(function (id) {
      var el = byId('co-' + id);
      el.addEventListener('blur', function () { if (el.value !== '' || el.hasAttribute('required')) { validateField(id); } });
      el.addEventListener('input', function () {
        if (el.getAttribute('aria-invalid') === 'true') { validateField(id); }
        saveDraft();
      });
      el.addEventListener('change', saveDraft);
    });
    co.accept.addEventListener('change', function () {
      setAcceptError(co.accept.checked ? '' : 'You must agree to the sales policy to pay.');
      updatePay();
    });
    co.form.addEventListener('submit', onSubmit);
    // Enter dentro de un campo con la casilla sin marcar: el boton esta deshabilitado, asi que se explica por que no pasa nada.
    co.form.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && !co.accept.checked) {
        e.preventDefault();
        setAcceptError('You must agree to the sales policy to pay.');
      }
    });
    // Volver desde n1co con el boton Atras: la pagina puede restaurarse de la cache con el boton ya bloqueado.
    window.addEventListener('pageshow', function (e) {
      if (e.persisted && co.state.redirecting) {
        co.state.busy = false; co.state.redirecting = false;
        setStatus('', '');
        updatePay();
      }
    });
    fetchQuote();
  }

  /* ════════════════════════════════ THANKS ════════════════════════════════ */
  var th = null;

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return ''; }
    try {
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) + ' (UTC)';
    } catch (e) { return String(iso).slice(0, 10); }
  }
  function setRoot(nodes) {
    clear(th.root);
    nodes.forEach(function (n) { if (n) { th.root.appendChild(n); } });
  }
  function actions(showCheckout) {
    var kids = [];
    if (showCheckout) { kids.push(h('a', { 'class': 'btn-primary', href: '/essentials/checkout.html', text: 'Back to checkout' })); }
    kids.push(h('a', { 'class': showCheckout ? 'btn-secondary' : 'btn-primary', href: '/essentials/', text: 'Continue shopping' }));
    kids.push(h('a', { 'class': 'btn-secondary', href: '/essentials/shipping-returns.html', text: 'Shipping and returns' }));
    return h('div', { 'class': 'ts-actions' }, kids);
  }
  function contactP() {
    var p = h('p', {}, [txt('Questions about this order? Email ')]);
    p.appendChild(h('a', { href: 'mailto:hola@getcvpro.com', text: 'hola@getcvpro.com' }));
    p.appendChild(txt(' with your order number.'));
    return p;
  }
  function refBlock(code) {
    return code ? [h('p', { 'class': 'pf-muted', text: 'Order number' }), h('span', { 'class': 'ts-ref', text: code })] : [];
  }

  function renderLoading() {
    setRoot([h('div', { 'class': 'ts-spinner', 'aria-hidden': 'true' }), h('h2', { text: 'Confirming your payment…' }),
      h('p', { text: 'One moment, we are checking your payment with n1co.' })]);
  }

  function renderPaid(d) {
    var items = Array.isArray(d.items) ? d.items : [];
    var list = h('ul', { 'class': 'ts-items' }, items.map(function (i) {
      var meta = [i.variante_etiqueta, 'Qty ' + i.qty].filter(Boolean).join(' · ');
      return h('li', { 'class': 'ts-item' }, [
        h('span', {}, [txt(String(i.nombre || i.sku || '')), h('small', { text: meta })]),
        h('span', { text: money(i.subtotal_cents) })]);
    }));
    var total = h('dl', { 'class': 'pf-totals' }, [h('div', { 'class': 'pf-row is-total' }, [
      h('dt', { text: 'Total paid (' + (d.moneda || 'USD') + ')' }), h('dd', { text: money(d.total_cents) })])]);
    var next = h('ul', { 'class': 'ts-list' }, [
      h('li', { text: 'Estimated delivery is 15 to 25 days from your order date, to the address you entered at checkout. Shipping is included in the price.' }),
      h('li', { text: 'To report a problem, email hola@getcvpro.com with your order number. We reply within 2 business days.' })]);
    var when = fmtDate(d.pagado_en);
    setRoot([
      h('h2', { text: 'Payment confirmed' }),
      h('p', { text: 'Thank you for your order. n1co confirmed your payment.' })
    ].concat(refBlock(d.referencia || th.code), [
      when ? h('p', { 'class': 'pf-muted', text: 'Payment confirmed on ' + when }) : null,
      h('h3', { text: 'Items' }), list, total,
      h('h3', { text: 'What happens next' }), next, actions(false)
    ]));
    th.policy.hidden = false;
    // Una sola vez por pedido: evento purchase y limpieza del carrito (recargar la pagina no repite nada).
    var flag = K.purchase + (d.pedido || d.referencia || th.code);
    if (!lsGet(flag)) {
      ev('purchase', {
        transaction_id: d.referencia || th.code, value: typeof d.total_cents === 'number' ? d.total_cents / 100 : 0, currency: 'USD',
        shipping: 0, tax: 0, item_category: 'essentials',
        items: items.map(function (i) { return { item_id: i.sku, item_name: i.nombre, item_variant: i.variante, price: i.precio_unit_cents / 100, quantity: i.qty }; })
      });
      lsSet(flag, '1');
      lsDel(K.cart); ssDel(K.draft); ssDel(K.idem); ssDel(K.pedido); lsDel(K.pedido);
      updateBadge();
    }
  }

  function renderReview(d) {
    setRoot([h('h2', { text: 'Your order is under review' }),
      h('p', { text: 'n1co reports a payment for this order, but we need to verify it before we can confirm the order.' })
    ].concat(refBlock(d.referencia || th.code), [
      h('p', { text: 'Please email hola@getcvpro.com with your order number and we will check it. We reply within 2 business days.' }),
      actions(false)]));
    ev('payment_review', { estado: d.estado });
  }

  function renderNotCompleted(d) {
    setRoot([h('h2', { text: 'Payment not completed' }),
      h('p', { text: 'n1co did not complete the payment for this order (status: ' + (d.estado === 'fallido' ? 'failed' : 'cancelled') + '). Your cart is still saved, so you can go back to checkout and try again.' })
    ].concat(refBlock(d.referencia || th.code), [actions(true), contactP()]));
    ev('payment_not_completed', { estado: d.estado });
  }

  function renderPending() {
    var again = h('button', { type: 'button', 'class': 'btn-primary', text: 'Check again' });
    again.addEventListener('click', function () { th.attempt = 0; renderLoading(); confirmar(); });
    setRoot([h('h2', { text: 'Payment still processing' }),
      h('p', { text: 'We have not received confirmation from n1co yet. This can take a few minutes. If you already paid, please do not pay again: your order will show as confirmed here once n1co confirms it.' })
    ].concat(refBlock(th.code), [h('div', { 'class': 'ts-actions' }, [again,
      h('a', { 'class': 'btn-secondary', href: '/essentials/shipping-returns.html', text: 'Shipping and returns' })]), contactP()]));
    ev('payment_pending');
  }

  function renderError(msg) {
    var again = h('button', { type: 'button', 'class': 'btn-primary', text: 'Check again' });
    again.addEventListener('click', function () { th.attempt = 0; renderLoading(); confirmar(); });
    setRoot([h('h2', { text: 'We could not check your payment' }),
      h('p', { text: (msg || 'Something went wrong while checking the payment.') + ' If you completed the payment, please do not pay again.' })
    ].concat(refBlock(th.code), [h('div', { 'class': 'ts-actions' }, [again,
      h('a', { 'class': 'btn-secondary', href: '/essentials/', text: 'Continue shopping' })]), contactP()]));
    ev('payment_confirm_error');
  }

  function renderNotFound() {
    setRoot([h('h2', { text: 'We could not find your order' }),
      h('p', { text: 'This page needs the order number from your payment. If you completed a payment, email hola@getcvpro.com with your order number and we will check it.' }),
      actions(false)]);
    ev('payment_confirm_error', { motivo: 'sin_pedido' });
  }

  // Sin token (otro dispositivo o navegador): el comprador prueba que el pedido es suyo con el email del checkout.
  function renderProof(message) {
    var input = h('input', { id: 'ts-email', name: 'email', type: 'email', required: 'required', maxlength: '254', autocomplete: 'email', inputmode: 'email', 'aria-describedby': 'ts-proof-err' });
    var err = h('p', { 'class': 'pf-error', id: 'ts-proof-err', hidden: '' });
    var form = h('form', { 'class': 'ts-proof', novalidate: '' }, [
      h('div', { 'class': 'pf-field' }, [h('label', { 'for': 'ts-email', text: 'Email used at checkout' }), input, err]),
      h('button', { type: 'submit', 'class': 'btn-primary', text: 'Show my order' })]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = String(input.value || '').trim();
      if (!EMAIL_RE.test(v) || v.length > 254) { err.textContent = 'Enter a valid email address.'; err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
      th.proof = { email: v };
      th.attempt = 0;
      renderLoading();
      confirmar();
    });
    setRoot([h('h2', { text: 'Find your order' }),
      h('p', { text: message || 'To show the status of this order, enter the email you used at checkout.' })
    ].concat(refBlock(th.code), [form, contactP()]));
  }

  function retryOr(finalFn) {
    if (th.attempt < MAX_RETRIES) {
      th.attempt += 1;
      setTimeout(confirmar, RETRY_DELAY_MS);
    } else {
      finalFn();
    }
  }

  function confirmar() {
    var body = { order_code: th.code };
    if (th.proof.token) { body.token = th.proof.token; } else if (th.proof.email) { body.email = th.proof.email; }
    post(FN_CONFIRMAR, body).then(function (res) {
      var d = res.data || {};
      if (res.ok && d.ok === true && d.pagado === true) { renderPaid(d); return; }
      if (res.ok && d.ok === true) {
        if (d.estado === 'revision') { renderReview(d); return; }
        if (d.estado === 'cancelado' || d.estado === 'fallido') { renderNotCompleted(d); return; }
        retryOr(renderPending);   // pendiente (o creado / fallido_pasarela): n1co puede tardar unos segundos
        return;
      }
      if (res.status === 404 || res.status === 400) {
        if (th.proof.token) {
          // el token guardado no corresponde a este pedido: se pide el email
          th.proof = {};
          renderProof('We could not match this device to the order. Enter the email you used at checkout to see its status.');
        } else {
          renderProof('We could not find an order with that number and email. Check the email and try again.');
        }
        return;
      }
      retryOr(function () { renderError(d.error ? String(d.error) : ''); });
    }, function () {
      retryOr(function () { renderError('We could not reach the payment service.'); });
    });
  }

  function initThanks() {
    th = { root: byId('ts-root'), policy: byId('ts-policy'), code: '', proof: {}, attempt: 0 };
    var fromUrl = param('ref').trim();
    var urlCode = CODE_RE.test(fromUrl) ? fromUrl : '';
    var orden = readOrden();
    var stored = orden ? (orden.referencia || orden.orderCode) : '';
    th.code = urlCode || (fromUrl ? '' : stored);
    ev('payment_confirmed_page_view');
    if (!th.code) { renderNotFound(); return; }
    // El token solo vale para el pedido para el que se guardo.
    if (orden && orden.token && (!urlCode || urlCode === orden.referencia || urlCode === orden.orderCode)) {
      th.proof = { token: orden.token };
      renderLoading();
      confirmar();
    } else {
      renderProof();
    }
  }

  /* ════════════════════════════════ INICIO ════════════════════════════════ */
  function init() {
    updateBadge();
    if (PAGE === 'checkout' && byId('co-form')) { initCheckout(); }
    else if (PAGE === 'thanks' && byId('ts-root')) { initThanks(); }
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
