# Despliegue de generar-cv

Los módulos `.mjs` se despliegan MINIFICADOS (terser) por límite de tamaño de la llamada de deploy:

```
npx terser validador.mjs --module --compress --mangle --format max_line_len=400 -o validador.mjs.deploy
npx terser lexico.mjs    --module --compress --mangle --format max_line_len=400 -o lexico.mjs.deploy
npx terser serializar.mjs --module --compress --mangle --format max_line_len=400 -o serializar.mjs.deploy
```
Antes de desplegar: copiar los `.deploy` a una carpeta temporal con nombres `.mjs` y correr `tests/validador.test.mjs` contra ellos.
Después de desplegar: descargar la función y comparar byte a byte con los `.deploy` (una transcripción alterada `;`→`,` ya ocurrió una vez).
