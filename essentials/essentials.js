/* CVPro Essentials: carrito, fichas de producto y analitica de /essentials/ (Tarea 13).
   - El carrito vive aqui: lineas {sku, variante, qty} en la clave essentials_cart de localStorage. Los precios nunca se guardan ni se envian.
   - "Add to cart" suma la linea y actualiza el contador del nav. "Buy now" fija la linea de esa ficha y lleva a /essentials/checkout.html.
     El enlace "Cart" del nav es un enlace normal a /essentials/checkout.html. Ya no hay dialogo de carrito ni pago en estas paginas:
     el total (calculado por el servidor), la direccion, la aceptacion de la politica y el pago estan en checkout.js.
   - Usa solo la URL de Supabase y la clave anon (publicable) que ya estan en el frontend del sitio (index.html, chat-cv.html)
     para la tabla de eventos. No hay ningun otro secreto en este archivo.
   - Claves de almacenamiento propias: essentials_cart, essentials_sesion. Esta seccion no lee ni escribe claves de otros flujos del sitio. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://lljmqyejwkgcbuwkgjkh.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxsam1xeWVqd2tnY2J1d2tnamtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNzc5MzEsImV4cCI6MjEwMjc1MzkzMX0.5zyP9cb9wnkjlPeafe8zBOBPU-joameF0UzxUXDgq60';
  var CATALOG = window.ESSENTIALS_CATALOG;
  var CART_KEY = 'essentials_cart';
  var CHECKOUT_URL = '/essentials/checkout.html';
  var MAX_LINES = 5;

  if (!CATALOG) { return; }

  // ── Almacenamiento a prueba de navegadores embebidos (patron blindar() de index.html) ──
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
    } catch (e) { /* sin almacenamiento: el carrito vive solo en memoria de la pagina */ }
  }
  blindar('localStorage');
  blindar('sessionStorage');

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignorar */ } }

  // ── Utilidades ──
  function $(sel, root) { return (root || document).querySelector(sel); }
  function idle(fn) {
    if (window.requestIdleCallback) { window.requestIdleCallback(fn, { timeout: 4000 }); } else { setTimeout(fn, 1500); }
  }
  function money(cents) { return window.essentialsMoney(cents); }

  // ── Analitica (mismo formato que index.html: GA4 + tabla eventos; lang fijo "en") ──
  // now = true: se envia en el acto (para eventos justo antes de cambiar de pagina; fetch con keepalive sobrevive a la navegacion).
  function ev(nombre, extra, now) {
    function send() {
      try {
        if (window.gtag) { window.gtag('event', nombre, extra || {}); }
        fetch(SUPABASE_URL + '/rest/v1/eventos', {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ evento: nombre, pagina: location.pathname, lang: 'en', extra: extra || null })
        }).catch(function () { /* la analitica nunca bloquea */ });
      } catch (e) { /* ignorar */ }
    }
    if (now) { send(); } else { idle(send); }
  }

  // ── Carrito: solo {sku, variante, qty}; los precios nunca se guardan ni se envian ──
  function validLine(l) {
    var p = l && CATALOG.products[l.sku];
    return !!(p && typeof l.qty === 'number' && l.qty >= 1 && l.qty <= CATALOG.maxQty &&
      p.variants.some(function (v) { return v.id === l.variante; }));
  }
  function readCart() {
    try {
      var a = JSON.parse(lsGet(CART_KEY) || '[]');
      return Array.isArray(a) ? a.filter(validLine).slice(0, MAX_LINES) : [];
    } catch (e) { return []; }
  }
  function writeCart(cart) {
    lsSet(CART_KEY, JSON.stringify(cart.map(function (l) { return { sku: l.sku, variante: l.variante, qty: l.qty }; })));
    updateCount();
  }
  function updateCount() {
    var el = $('#cartCount');
    if (!el) { return; }
    var n = readCart().reduce(function (s, l) { return s + l.qty; }, 0);
    el.textContent = String(n);
    el.hidden = n === 0;
  }
  // "Buy now": esta ficha define la linea del carrito (no suma otra unidad si ya se pulso "Add to cart").
  function setInCart(sku, variante, qty) {
    var cart = readCart();
    var i = cart.map(function (l) { return l.sku; }).indexOf(sku);
    if (i >= 0) {
      cart[i] = { sku: sku, variante: variante, qty: qty };
    } else {
      if (cart.length >= MAX_LINES) { return { ok: false, msg: 'The cart holds up to ' + MAX_LINES + ' different items.' }; }
      cart.push({ sku: sku, variante: variante, qty: qty });
    }
    writeCart(cart);
    return { ok: true, msg: '' };
  }
  // El contrato no admite el mismo sku dos veces en un pedido: una linea por sku.
  function addToCart(sku, variante, qty) {
    var cart = readCart();
    var i = cart.map(function (l) { return l.sku; }).indexOf(sku);
    var msg = 'Added to cart.';
    if (i >= 0) {
      if (cart[i].variante === variante) {
        cart[i].qty = Math.min(CATALOG.maxQty, cart[i].qty + qty);
      } else {
        cart[i] = { sku: sku, variante: variante, qty: qty };
        msg = 'Cart updated. An order holds one option per item, so this item now has the option you chose.';
      }
    } else {
      if (cart.length >= MAX_LINES) { return { ok: false, msg: 'The cart holds up to ' + MAX_LINES + ' different items.' }; }
      cart.push({ sku: sku, variante: variante, qty: qty });
    }
    writeCart(cart);
    return { ok: true, msg: msg };
  }

  // ── Ficha de producto ──
  function initPdp(buy) {
    var sku = buy.getAttribute('data-sku');
    var prod = CATALOG.products[sku];
    if (!prod) { return; }
    var vSel = $('#variant'), qSel = $('#qty'), selPrice = $('#selPrice'), stickyPrice = $('#stickyPrice');
    var status = $('#buyStatus');
    function current() {
      var v = prod.variants.filter(function (x) { return x.id === vSel.value; })[0] || prod.variants[0];
      return { sku: sku, variante: v.id, qty: parseInt(qSel.value, 10) || 1, key: v.key };
    }
    function refresh() {
      var c = current();
      [selPrice, stickyPrice].forEach(function (el) {
        if (el) { el.setAttribute('data-price', c.key); el.textContent = money(CATALOG.tokens[c.key]); }
      });
    }
    function say(text, err) { status.textContent = text; status.className = 'buy-status' + (err ? ' err' : ''); }
    function track(c, now) {
      ev('add_to_cart', { currency: 'USD', value: CATALOG.tokens[c.key] * c.qty / 100, item_category: 'essentials', items: [{ item_id: c.sku, item_variant: c.variante, quantity: c.qty }] }, now);
    }
    function add() {
      var c = current();
      var r = addToCart(c.sku, c.variante, c.qty);
      say(r.msg, !r.ok);
      if (r.ok) { track(c, false); }
      return r.ok;
    }
    vSel.addEventListener('change', refresh);
    $('#add-to-cart').addEventListener('click', add);
    function buyNow() {
      var c = current();
      var r = setInCart(c.sku, c.variante, c.qty);
      say(r.msg, !r.ok);
      if (r.ok) { track(c, true); window.location.assign(CHECKOUT_URL); }
    }
    $('#buyForm').addEventListener('submit', function (e) { e.preventDefault(); buyNow(); });
    var sb = $('#stickyBuyBtn');
    if (sb) { sb.addEventListener('click', buyNow); }
    refresh();
    var c0 = current();
    ev('view_item', { currency: 'USD', value: CATALOG.tokens[c0.key] / 100, item_category: 'essentials', items: [{ item_id: sku, item_name: prod.name }] }, false);
  }

  function init() {
    updateCount();
    var buy = $('#buy');
    if (buy) { initPdp(buy); }
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
