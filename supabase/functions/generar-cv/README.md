# generar-cv — motor v2 de CVPro

Edge Function (Supabase) que genera el CV como JSON estructurado (tool_use `emitir_cv`) y lo valida
en servidor contra las respuestas literales del candidato. Versión desplegada: v10.

- `index.ts` — prompt, esquema de la tool, gate de límites/tester, reintento.
- `validador.mjs` — validación determinista (evidencia literal, tokens sin fuente, degradación a evidencia, perfil, educación, habilidades, idiomas).
- `lexico.mjs` — tolerancia de paráfrasis por oficio (clústeres), relleno, adjetivos de calidad.
- `serializar.mjs` — `cv_texto` con los encabezados que entiende `chat-cv.html`.
- `tests/validador.test.mjs` — `node tests/validador.test.mjs` (55 casos).

Despliegue: los archivos se suben tal cual (index.ts + los tres .mjs). El cliente los usa detrás de `?motor=v2`.
Los comentarios se dejan en el repo; en el despliegue se han subido versiones sin comentarios (mismo código).
