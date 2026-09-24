// Corre las 13 personas contra generar-cv en producción DESDE la consola de
// getcvpro.com/chat-cv.html?tester=<codigo> (usa SUPABASE_URL/KEY y _iaExtra
// de la página). Pegar en la consola y luego leer window.__f3.
(async () => {
  const personas = await fetch('https://raw.githubusercontent.com/atctorre/cvpro/main/supabase/functions/generar-cv/tests/personas.json').then(r => r.json());
  window.__f3 = {};
  for (const p of personas) {
    const datos = Object.fromEntries(Object.entries(p.datos).filter(([k]) => !k.startsWith('logros1_') && !k.startsWith('logros2_')));
    const t0 = Date.now();
    const extra = _iaExtra(); delete extra.temperature;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/generar-cv`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, body: JSON.stringify({ datos, lang: p.lang, ...extra }) });
    const data = await res.json().catch(() => null);
    window.__f3[p.id] = { ok: res.ok && data && data.ok === true, status: res.status, ms: Date.now() - t0, data };
  }
  window.__f3done = true;
})();
