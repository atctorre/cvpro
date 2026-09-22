# Fase 2 — Motor v2 integrado en chat-cv.html detrás de bandera (2026-09-21)

## Cómo activar / desactivar
- Activar: `https://getcvpro.com/chat-cv.html?motor=v2` (queda en sessionStorage `cvpro_motor` para toda la sesión).
- Desactivar: `?motor=v1`. Sin bandera → v1 (flujo actual, intacto).
- Tester (exento de límites): añadir `&tester=pruebacvpro123321` la primera vez.

## Qué cambió (commits ed648bb + 262aa16, GitHub Pages construido)
chat-cv.html:
- `_motorCV()`, `_cvJsonV2()` — bandera y lector del JSON v2.
- `generarConIA()` → si motor v2, delega en `generarConMotorV2()`; cualquier generación borra el JSON v2 anterior.
- `generarConMotorV2()` → POST `generar-cv` con las 14 respuestas crudas (lista blanca, nunca *_enriquecido) + 3 banderas; 429 y reintento como v1; guarda `cvpro_cv_v2 = {cv, cv_texto, validacion}`; eventos `ai_completed{modo:chat_v2}` y `cv_generado_v2{vinetas_total, degradadas, correcciones, errores, reintento, ms_servidor}`.
- `construirCVDataDesdeJSON(cv)` → cv_data con la misma forma que el parser de texto. `construirCVData()` la usa SOLO si `cvGenerado === cv_texto`; si el CV fue adaptado/traducido/editado/recuperado, sigue el parser de siempre (probado: la edición del resumen cae al parser y parsea bien el texto v2).
- `_renderErrorGeneracion()` compartido v1/v2.
- Copy pre-generación honesto (ya no promete "cuantificar con métricas del sector").
- Bachillerato ya no se oculta cuando la carrera superior está "En curso" (aplica a v1 y v2).

Servidor: `generar-cv` v7 — `cv_texto` con encabezados idénticos a v1 (RESUMEN PROFESIONAL / EXPERIENCIA PROFESIONAL / EDUCACIÓN / HABILIDADES con línea "Idiomas:") para editor, guardar-cv, adaptación, traducción, carta.

## Prueba real en producción (persona E2, mismo input, misma sesión)
| | v1 (39 s) | v2 (19 s) |
|---|---|---|
| Viñetas puesto 1 | 3, con "proveedores y clientes", "sistema contable SAP", "horas trabajadas, deducciones legales y prestaciones" — nada de eso lo dijo la candidata | 3 literales: "Registro de facturas." "Realización de conciliaciones bancarias." "Apoyo en planillas." |
| Perfil | "entorno de distribución comercial", "sistemas ERP", frase rota "su responsabilidad, atención al detalle…" | oración correcta, solo hechos declarados |
| Institución | "Universidad de El Salvador" (expandida) | "UES" (literal) |
| Bachillerato | omitido | conservado |
| Flujo posterior | — | editor ✔, código de recuperación + email ✔, plantillas ✔, parser fallback tras edición ✔ |

## Lo que NO está probado todavía
- Adaptar a vacante / traducir / carta sobre un CV v2 (rutas v1 que leen cv_texto — el formato es idéntico, pero no se ejecutó de punta a punta).
- PDF descargado desde plantillas con CV v2 (la vista previa sí).
- Inglés de punta a punta en el cliente (solo la Edge Function).
- Regresión con las 13 personas (Fase 3).

---

# Fase 2b — "la IA complementa sin inventar" (2026-09-21, tarde)

## 1. Tolerancia de paráfrasis por oficio (servidor, generar-cv v8/v9)
- Nuevo `lexico.mjs`: 12 oficios (contabilidad, retail/caja, mecánica, electricidad, construcción, gastronomía, salud, educación, logística, oficina, seguridad, TI) + 6 clústeres genéricos. Un clúster se activa si el candidato usó cualquiera de sus miembros para ESE puesto; entonces el modelo puede usar los demás ("checkout" → "register transactions", "conciliaciones bancarias" → "saldos / estados de cuenta").
- La fuente de sustantivos vuelve a ser TODO lo que el candidato dijo de ese puesto + el título objetivo (v3 solo usaba la evidencia citada — demasiado estricto).
- RELLENO (parte, tareas, empresa, área asignada…) se tolera; ADJETIVOS_CALIDAD (accurate, preciso, eficiente, oportuno…) se rechazan siempre.
- Prompt: reglas 3 (sin adjetivos de calidad), 12 (sinónimos del oficio sí, objetos nuevos no), 13 (evidencia compuesta "tarea | cifra"), 16 (usar las cifras declaradas).
- v9: evidencia puede ser varios fragmentos literales separados por , ; |; "N años de experiencia" se conserva si el candidato lo dijo; montos operativos ($200 de caja) ya no se confunden con salario; número con punto final ("200.") ya no falla.
- Tests: 54/54.

## 2. Checklist de funciones típicas (cliente, chat-cv.html)
- `mostrarChecklistFunciones(key)`: la repregunta obligatoria de funciones muestra 8 chips (IA vía super-service, JSON, sin cifras/marcas/adjetivos) + texto libre. Clic = se agrega al input; el candidato envía; entra en `datos.logrosN` por el mecanismo de concatenación existente.
- Primer "solo cargo" → checklist una vez (y `datos[key]=''` para que "solo cargo" no quede en el CV); si insiste → se respeta.
- Respuesta con ≥1 chip confirmado ya no se marca "sin funciones" aunque sea corta.
- Probado en producción (Rosa, cajera): chips correctos para supermercado; 3 chips + 1 libre → `logros1` limpio.

## 3. Cifras opcionales con "No sé"
- `preguntarCifras(key)`: sustituye la pregunta élite en texto libre para logros1/logros2. 2-3 preguntas de magnitud generadas por IA (sin sugerir valores) + chip "No sé". "No sé" no se concatena y marca `logrosN_sin_cifras`; cifras reales se concatenan a `logrosN` → el validador las acepta como declaradas.
- Se hace aunque haya "fuente cruzada" (antes eso saltaba el seguimiento).
- Probado: "unas 150 transacciones por turno, la caja abre con $200" quedó en logros1.

## Hallazgo de la prueba real (Rosa) que motivó v9
Con v8 el CV salió SIN las cifras: el modelo citó la evidencia como "Cobro en efectivo y tarjeta, unas 150 transacciones por turno" (dos fragmentos no contiguos) y el validador la rechazó por no literal → viñeta borrada. Y el perfil quedó "Cajera con en supermercado" porque se quitó "3 años de experiencia" aunque ella lo había escrito. Ambos corregidos en v9; PENDIENTE re-generar a Rosa contra v9 (la Mac se desconectó justo al lanzar la regeneración).

## Quirk detectado (pre-existente, no corregido)
Una respuesta negativa ("no") a un seguimiento de habilidades/estudios se concatena al campo ("Excel básico\nno"). En v2 el validador lo filtra; en v1 puede colarse. Pendiente.
