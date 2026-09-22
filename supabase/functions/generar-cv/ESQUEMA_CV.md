# ESQUEMA_CV — motor v2

JSON Schema (draft-07) del objeto `cv` que devuelve `generar-cv`. Cada campo solo puede
contener información que las 14 preguntas del chat (`chat-cv.html`, claves de `datos`,
ver `NOTAS_MOTORV2.md`) puedan alimentar. No hay campos "por si acaso": si el chat no
pregunta por ello (ej. logo, foto, referencias, premios con nombre propio), no existe
en el esquema.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://cvpro/schemas/cv-v2.json",
  "title": "CVProCV",
  "type": "object",
  "additionalProperties": false,
  "required": ["lang", "nombre", "titulo_objetivo", "contacto", "perfil", "experiencia", "educacion", "habilidades", "idiomas", "extra"],
  "properties": {
    "lang": { "type": "string", "enum": ["es", "en"] },

    "nombre": { "type": "string", "minLength": 1, "maxLength": 120 },

    "titulo_objetivo": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100,
      "description": "Puesto objetivo (datos.puesto), tal cual lo declaró el candidato o con capitalización estándar. Nunca un título distinto inventado por la IA."
    },

    "contacto": {
      "type": "object",
      "additionalProperties": false,
      "required": ["email", "telefono", "ubicacion", "linkedin"],
      "properties": {
        "email": { "type": ["string", "null"], "format": "email" },
        "telefono": { "type": ["string", "null"] },
        "ubicacion": {
          "type": ["string", "null"],
          "description": "País (y ciudad SOLO si el candidato la declaró explícitamente como su ubicación, no si aparece solo en el nombre de un empleador/institución)."
        },
        "linkedin": {
          "type": ["string", "null"],
          "maxLength": 200,
          "description": "Solo si `datos.info_extra` contiene una URL linkedin.com/in/... o lnkd.in/...; se extrae con la misma regex que usa `derivarContacto()` en validador.mjs (auditoría fase 1, punto 8). Nunca inventado ni completado a partir del nombre."
        }
      }
    },

    "perfil": {
      "type": "string",
      "maxLength": 700,
      "description": "≤ 60 palabras. Sin cifras de 'años totales' que no se deriven exactamente de las fechas dadas. Sin adjetivos de alcance/volumen/intensidad no declarados (ver lista en validador.mjs)."
    },

    "experiencia": {
      "type": "array",
      "maxItems": 6,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["cargo", "empresa", "ubicacion", "inicio", "fin", "actual", "sin_funciones", "vinetas"],
        "properties": {
          "cargo": { "type": "string", "minLength": 1, "maxLength": 120 },
          "empresa": { "type": "string", "minLength": 1, "maxLength": 150 },
          "ubicacion": { "type": ["string", "null"], "maxLength": 100 },
          "inicio": { "type": ["string", "null"], "pattern": "^(\\d{4}-\\d{2}|\\d{4})$" },
          "fin": { "type": ["string", "null"], "pattern": "^(\\d{4}-\\d{2}|\\d{4})$" },
          "actual": { "type": "boolean" },
          "sin_funciones": {
            "type": "boolean",
            "description": "Refleja datos.logrosN_sin_funciones para el puesto N correspondiente. Si es true, vinetas DEBE ser []."
          },
          "vinetas": {
            "type": "array",
            "maxItems": 7,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["texto", "evidencia"],
              "properties": {
                "texto": { "type": "string", "minLength": 1, "maxLength": 320 },
                "evidencia": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200,
                  "description": "Cita LITERAL (substring exacto, tolerante solo a espacios/tildes/puntuación) de las respuestas del candidato (expN/logrosN) que respalda `texto`. Si el modelo no puede citar un fragmento real, no debe escribir la viñeta."
                }
              }
            }
          }
        },
        "allOf": [
          {
            "if": { "properties": { "sin_funciones": { "const": true } } },
            "then": { "properties": { "vinetas": { "maxItems": 0 } } }
          },
          {
            "if": { "properties": { "actual": { "const": true } } },
            "then": { "properties": { "fin": { "const": null } } }
          }
        ]
      }
    },

    "educacion": {
      "type": "array",
      "maxItems": 8,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["titulo", "institucion", "anio", "en_curso"],
        "properties": {
          "titulo": { "type": "string", "minLength": 1, "maxLength": 150 },
          "institucion": { "type": "string", "minLength": 1, "maxLength": 150 },
          "anio": { "type": ["string", "null"], "pattern": "^\\d{4}$" },
          "en_curso": { "type": "boolean" }
        }
      }
    },

    "habilidades": {
      "type": "object",
      "additionalProperties": false,
      "required": ["tecnicas", "blandas"],
      "properties": {
        "tecnicas": { "type": "array", "maxItems": 15, "items": { "type": "string", "minLength": 1, "maxLength": 60 } },
        "blandas": { "type": "array", "maxItems": 8, "items": { "type": "string", "minLength": 1, "maxLength": 60 } }
      }
    },

    "idiomas": {
      "type": "array",
      "maxItems": 6,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["idioma", "nivel"],
        "properties": {
          "idioma": { "type": "string", "minLength": 1, "maxLength": 40 },
          "nivel": {
            "type": ["string", "null"],
            "maxLength": 40,
            "description": "null si el candidato no declaró un nivel para ese idioma. Nunca inventar 'Nativo'/'Native' por defecto."
          }
        }
      }
    },

    "extra": {
      "type": "array",
      "maxItems": 8,
      "items": { "type": "string", "minLength": 1, "maxLength": 200 },
      "description": "Disponibilidad, licencias, movilidad, certificaciones sueltas, LinkedIn — solo lo declarado en datos.info_extra (o datos.idiomas_nivel/estudios si trae certificaciones incrustadas)."
    }
  }
}
```

## Reglas del esquema (no expresables en JSON Schema puro)

1. **Nada fuera de las 14 respuestas.** Cada valor final debe poder señalarse a una clave de
   `datos` (`nombre, puesto, pais, email_tel, tipo_empresa, resumen_personal, exp1, logros1,
   exp2, logros2, estudios, habilidades_tecnicas, idiomas_nivel, info_extra`) o a una
   combinación literal de ellas. Ver el validador para la aplicación en servidor.
2. **`sin_funciones`** se marca `true` cuando `datos.logrosN_sin_funciones` es `true` para el
   puesto N-ésimo (orden cronológico inverso de envío, no de aparición en el CV). El generador
   debe fijar `vinetas: []` para ese puesto; si el modelo devuelve viñetas de todas formas, el
   validador las vacía.
3. **`fin: null` + `actual: true`** es la única forma válida de representar un puesto vigente.
   Nunca una fecha futura.
4. **`idiomas[].nivel: null`** es preferible a inventar "Nativo"/"Native": el chat solo pregunta
   `idiomas_nivel` una vez, en texto libre — si el candidato no da nivel para un idioma
   mencionado, `nivel` queda `null`.
5. **Sin marcadores de posición.** Ningún campo puede contener `"N/A"`, `"no especificado"`,
   `"[dato]"`, corchetes, ni placeholders — si el dato falta, el campo es `null` o el array
   omite el ítem.
6. **Límites de longitud** existen para forzar el estilo del prompt (perfil ≤ 60 palabras,
   viñetas cortas) y para acotar el tamaño de payload; no son arbitrarios de UI.
7. **`contacto.linkedin`** (auditoría fase 1, punto 8) se deriva de `datos.info_extra` con la
   misma regex de extracción que usa el cliente hoy; si no hay URL de LinkedIn declarada, es
   `null`. No cuenta como parte de `extra[]` — tiene campo propio para que las plantillas lo
   puedan renderizar como enlace sin tener que parsear texto libre.
8. **`experiencia[].vinetas[].evidencia`** (v3, "evidencia literal"): cada viñeta trae su propia
   cita de respaldo, en vez de verificarse contra el ámbito completo del puesto por adivinanza
   token a token. El validador (a) descarta la viñeta entera si `evidencia` no es un substring
   literal (tolerante) del ámbito del puesto (`evidencia_no_literal`), y (b) para el resto de la
   verificación de contenido (sustantivos ≥5 letras) usa `evidencia` — no el ámbito completo —
   como fuente de verdad. `cvAtexto` y el mapeo a `cv_data` de las plantillas usan solo `texto`;
   `evidencia` nunca llega al CV visible.

## Mapeo a `cv_data` (plantillas-cv.html)

Ver `NOTAS_MOTORV2.md` §3 para el mapeo campo a campo con líneas citadas de
`plantillas-cv.html` (estructura `D`, líneas 1230-1242).
