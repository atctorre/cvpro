# CVPro — Despliegue de las correcciones

**El orden importa.** Si subes los HTML antes de ejecutar el SQL, la función
`consumir_uso` no existirá todavía y las cartas, adaptaciones y traducciones
quedarán bloqueadas para todos.

---

## Paso 1 — Supabase (PRIMERO)

Abre Supabase → **SQL Editor** → **New query** → pega el contenido completo de
`SQL_CORRECCIONES.sql` → **Run**.

Debe decir *Success*. Crea:

- Tabla `usos` + funciones `consumir_uso()` y `consultar_usos()` → los límites reales por plan
- Columnas `expira_en` y `plan` en `cvs_guardados` + trigger `trg_retencion` → los 30/90/180 días
- Función `limpiar_cvs_vencidos()` → borrado de vencidos
- Tabla `eventos` → analítica del embudo

### Comprobación rápida

```sql
select * from consumir_uso('CODIGOFALSO', 'carta');
```
Debe devolver `permitido = false`, `plan = ninguno`. Si da error de función
inexistente, el SQL no se ejecutó completo.

---

## Paso 2 — GitHub

`github.com/atctorre/cvpro` → **Add file → Upload files** → arrastra los 6 archivos:

```
index.html
cv299-landing.html
chat-cv.html
plantillas-cv.html
analizar-cv.html
privacidad.html
```

**Commit changes.** No borres nada: los archivos con el mismo nombre se sobrescriben solos.

Espera 2-3 minutos a que GitHub Pages publique.

---

## Paso 3 — Limpieza semanal (una vez al mes te acuerdas)

Para cumplir la política de privacidad, ejecuta cada semana en el SQL Editor:

```sql
select limpiar_cvs_vencidos();
```

Devuelve cuántos CVs vencidos borró. Si quieres automatizarlo, activa la
extensión `pg_cron` (Database → Extensions) y ejecuta una sola vez:

```sql
select cron.schedule('limpiar-cvs', '0 4 * * 1', 'select limpiar_cvs_vencidos()');
```

---

## Paso 4 — Verificación en el navegador

Recuerda: **el modo tester salta todos los muros y no consume cupo.** Prueba en
incógnito sin activarlo, o todo te funcionará y no habrás probado nada.

### Estándar ($9.99) — el que revela si los límites funcionan

1. Incógnito nuevo → crear CV → pagar $9.99 en Sandbox
2. Generar carta de presentación → **debe funcionar**
3. Generar una **segunda** carta → **debe bloquear** con el aviso de subir a Premium
4. Adaptar a una vacante → **debe funcionar**
5. Adaptar a una **segunda** vacante → **debe bloquear**
6. Tocar **🌎 Traducir al inglés** → **debe traducir el CV completo**
7. Tocar el botón otra vez (ahora dirá "Traducir al español") → **vuelve al original sin gastar cupo**

### Premium ($14.99)

Los pasos 3, 5 y 7 **no deben bloquear nunca**. Ahí está la diferencia que antes no existía.

### Básico ($4.99)

Carta, adaptación y traducción deben mostrar el muro pidiendo subir a Estándar.

### Analítica

Supabase → Table Editor → tabla `eventos`. Debe llenarse sola mientras navegas.

```sql
select evento, count(*) from eventos group by evento order by count(*) desc;
```

---

## Qué se corrigió

| # | Problema | Solución |
|---|---|---|
| 1 | La landing prometía descarga gratis con el muro activo | Aviso sustituido por el de pago seguro |
| 2 | "15 preguntas" en 12 sitios, el chat tiene 14 | Corregido en toda la landing y en el bot de soporte |
| 3 | "CV en 2 idiomas" vendido pero inexistente | **Construido**: `traducirCV()` traduce el CV completo con IA |
| 4 | Premium no tenía ninguna función exclusiva | Cartas, adaptaciones y traducciones ilimitadas solo en Premium |
| 5 | "1 carta" y "1 adaptación" sin ningún contador | Contadores en servidor vía `consumir_uso()` |
| 6 | 30/90/180 días eran idénticos: nada caducaba | Trigger sobre `pagos` + borrado de vencidos |
| 7 | "Soporte prioritario" sin implementar | Replanteado como soporte por email en 24h, ya en términos |
| 8 | 12 eventos de embudo se perdían en el navegador | Tabla `eventos` en Supabase |
| 9 | `generarCarta` y `descargarCartaPDF` duplicadas | Versiones antiguas eliminadas (~4.8 KB) |
| 10 | Garantía de 7 días sin respaldo en términos | Sección completa en `privacidad.html`, ES y EN |
| 11 | Confirmación de pago repetía promesas falsas | Listas alineadas con lo que se entrega |
| 12 | El bot de soporte daba datos erróneos | Planes, garantía y nº de plantillas corregidos |

---

## Lo que sigue pendiente

- **PayPal en Live** — sigues en Sandbox (`PP_ENTORNO = 'sandbox'`). Cuando te
  aprueben la cuenta Business, son dos líneas en `chat-cv.html` y `plantillas-cv.html`.
- **Soporte prioritario 24h** — ahora es una promesa honesta, pero depende de que
  tú respondas los correos de Premium primero. Ninguna línea de código puede hacerlo por ti.
- **`index.html` y `cv299-landing.html` siguen siendo idénticos** — edítalos siempre juntos
  o consolídalos en uno solo.
