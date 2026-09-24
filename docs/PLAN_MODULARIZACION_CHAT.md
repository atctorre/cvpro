# chat-cv.html — diagnóstico y plan de modularización (2026-09-24)

## Medición (no opinión)
- `chat-cv.html`: 434 KB sin comprimir → **145 KB gzip** (lo que realmente viaja).
- Composición: **JS 396 KB (91 %)**, CSS 30 KB, HTML 9 KB. 11 bloques `<script>` inline, **179 funciones top-level**, sin módulos, sin bundler, sin tests hasta hoy.
- Un solo script externo (GA4). Todo lo demás es inline: el navegador tiene que descargar y parsear 396 KB de JS antes de que el chat sea interactivo. En un móvil de gama media con 4G esto se nota (parseo + compilación de ~400 KB de JS ≈ cientos de ms), aunque el gzip de 145 KB no es dramático.
- Comentarios de rondas anteriores (RONDA A…D7, FASE 4) ocupan una parte relevante del JS: son historia de decisiones, no código. Útiles para el equipo, inútiles para el usuario.

## Riesgo real de una modularización completa hoy
- **Cero usuarios de pago y un solo desarrollador.** Partir 179 funciones acopladas por globales (`datos`, `paso`, `LANG`, `PASOS`, `seguimientosDados`, `FUNCIONES_PREGUNTADO`, `CIFRAS_PREGUNTADO`…) en módulos ES implica reescribir el acoplamiento por estado global. Es la clase de refactor que introduce regresiones silenciosas (un `paso--` que deja de verse, un flag que deja de compartirse) en el flujo que **acabamos de estabilizar** (v2 por defecto, fallback v1, negaciones, checklist).
- El beneficio de rendimiento de dividir en módulos es casi nulo si todo se sigue cargando al inicio; el beneficio real vendría de **cargar tarde** lo que no se usa en los primeros segundos (plantillas, PDF, adaptación, traducción, carta), y eso se puede hacer sin modularizar el resto.
- Conclusión: **no hacer el split completo ahora.** Hacer las tres cosas de abajo, en este orden, cada una con red de seguridad.

## Red de seguridad que ya existe (desde hoy)
- `tests/cliente/cliente.test.mjs` extrae funciones puras del monolito por nombre y las prueba en Node (30 casos: negaciones, checklist, parser de encabezados, formato de periodos, utilidades de adaptación, sintaxis de los 11 scripts). `npm test` corre estos + los 95 del validador del motor.
- Regla: **ningún cambio en chat-cv.html sin `npm test` verde**, y cada bug que se corrija en lógica pura añade un caso.

## Plan por etapas (cada una es un PR pequeño y reversible)

### Etapa 1 — Comentarios y peso muerto (bajo riesgo, 1–2 h)
- Mover los comentarios históricos de "RONDA X — FIX #N" a `docs/HISTORIAL_CHAT_CV.md` y dejar en el código una línea de referencia. Meta: −15/20 % de bytes sin tocar lógica. Verificación: `npm test` + diff de comportamiento nulo (los tests no cambian).
- Buscar funciones muertas (v1 heredado que el motor v2 ya no ejecuta). Solo se eliminan si `grep` demuestra 0 llamadas **y** `?motor=v1` sigue funcionando (v1 es el fallback; no se elimina hasta que v2 tenga un mes de telemetría sin fallbacks).

### Etapa 2 — Extraer la lógica pura a `js/cv-logica.js` (riesgo medio, 1 día)
- Candidatas (ya probadas por el harness): `_parsearExpTexto`, `construirCVDataDesdeJSON`, `_respuestaSinFunciones`, `_esSoloCargo`, `_exp2Negativa`, `_RE_NEG`, `_RE_NEGACION_BREVE`, `_normalizarSkill`, `_extraerHabilidadesDeTexto`, `_parsearBloquesExperiencia`, `limpiarPreambuloIA`, `verificarCifrasLocal`, `_filtrarAdaptacionSinInvencion`.
- Un archivo clásico `<script src="js/cv-logica.js">` (no módulo ES): mantiene los globales y por tanto **no cambia el acoplamiento**; solo mueve texto. GitHub Pages lo sirve con caché propia (el HTML cambia más que la lógica).
- El harness pasa a importar el archivo directamente y deja de necesitar `extraer.mjs`.
- Verificación: tests + E2E manual de Rosa (ES) y Marcus (EN) como en Fase 4.

### Etapa 3 — Carga diferida de lo que no se usa al inicio (riesgo medio, beneficio real)
- Plantillas/PDF (html2canvas, pdfmake, 20 plantillas), adaptación a vacante, traducción, carta y el editor se cargan **cuando el CV ya existe**, no al abrir el chat. Patrón: `js/cv-salida.js` cargado con `import()` dinámico o inyección de `<script>` al llegar al paso final.
- Es la única etapa con impacto medible en móvil (TTI del chat). Medir antes/después con Lighthouse móvil sobre `chat-cv.html` y guardar los dos informes en `docs/`.

### Lo que NO se hará
- Framework (React/Vue/Svelte) ni bundler: el producto es un chat de 14 preguntas y una página de salida; añadir toolchain multiplica la superficie de fallo para un solo desarrollador.
- Reescritura "limpia" desde cero: perdería 20+ correcciones de comportamiento documentadas en los comentarios que solo existen en este archivo.

## Disparadores para acelerar el plan
- Telemetría de `motor_fallback_v1` = 0 durante 30 días → se puede eliminar v1 (−30 % de JS estimado).
- Primeros 50 CV pagados → hacer Etapa 3 antes de invertir en tráfico pagado (el móvil es la mayoría del tráfico esperado).
