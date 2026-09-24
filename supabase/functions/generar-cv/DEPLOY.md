# Despliegue de generar-cv

Los módulos `.mjs` se despliegan MINIFICADOS (terser) por límite de tamaño de la llamada de deploy:

```
npx terser validador.mjs --module --compress --mangle --format max_line_len=400 -o validador.mjs.deploy
npx terser lexico.mjs    --module --compress --mangle --format max_line_len=400 -o lexico.mjs.deploy
npx terser serializar.mjs --module --compress --mangle --format max_line_len=400 -o serializar.mjs.deploy
```

## Procedimiento (obligatorio, 4 archivos SIEMPRE)

Cada deploy reemplaza el conjunto completo de archivos. Si falta uno o va vacío, la función arranca rota
(el cliente cae a v1 por `fallbackV1`, pero el motor v2 queda caído sin aviso).

1. `node tests/validador.test.mjs` sobre las fuentes → 0 fallos.
2. Copiar los `.deploy` a una carpeta temporal con nombres `.mjs` y volver a correr los tests contra ellos.
3. Deploy con `index.ts`, `validador.mjs`, `lexico.mjs`, `serializar.mjs` (verify_jwt = true).
   - Regla: quien construye el payload NO usa placeholders "a reemplazar luego". Dos incidentes (Edge v12 y v20)
     subieron `PLACEHOLDER_*` en validador.mjs; Edge v19 subió validador vacío y sin lexico.
4. Descargar la función (`get_edge_function`) y comparar byte a byte con los `.deploy`
   (`tests/verificar_deploy.py`). Diferencias tolerables: `[̀-ͯ]` ↔ `[̀-ͯ]`.
5. Correr los tests contra la copia DESCARGADA (no contra la local).
6. Regresión con `tests/personas.json` contra producción y guardar `FASE3_REGRESION_vN.md`.

## Historial de versiones Edge ↔ código
- Edge v17 = código v11.6 · Edge v18 = v11.7 · Edge v19/v20 = ROTOS (no usar) · Edge v21 = código v19 (v11.8).
