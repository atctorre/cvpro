# Tests

- `npm test` — todo (motor v2 + cliente). Sin dependencias: solo Node ≥ 20.
- `supabase/functions/generar-cv/tests/validador.test.mjs` — 95 casos del validador determinista del motor v2.
- `tests/cliente/cliente.test.mjs` — 30 casos de la lógica pura de `chat-cv.html`, extraída del monolito por nombre con `tests/cliente/extraer.mjs` (sin navegador).
- `supabase/functions/generar-cv/tests/verificar_deploy.py <respuesta_get_edge_function.json> <carpeta>` — compara byte a byte lo desplegado con los `.deploy` locales (ver `DEPLOY.md`).
- `supabase/functions/generar-cv/tests/personas.json` — 13 personas de regresión contra producción.

Regla del repo: ningún cambio en `chat-cv.html` ni en `validador.mjs` sin `npm test` verde; cada bug corregido en lógica pura añade un caso.
