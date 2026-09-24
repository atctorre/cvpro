# Regresión Edge v22 (código v20 / v11.9) — 13 personas, 2026-09-24 (resumen del supervisor)
13/13 HTTP 200, 0 reintentos, 0 errores del validador.
Mejoras confirmadas vs Edge v21: E1 "Excel (básico)" y perfil con oficio; E2 recupera la viñeta de cobro; E4 perfil "Mecánico automotriz desde 2016…" y viñeta del puesto 2 ("Apoyó en cambios de aceite"); E3 viñeta del puesto 2; N3 "Met daily quotas." como resultado (regla 31), colas "across daily operations" recortadas; J1 colas recortadas; N5/M1/N2 sin cambios relevantes.
Defectos nuevos detectados (motivan v20.1, en repo, pendiente de deploy):
- E3: "Coordina un equipo de 35 personas en obra." — el candidato dijo "equipo de 35 personas en obra" (sin verbo) y "coordinación con subcontratistas": verbo de mando atribuido → inflación. También "Dos proyectos de vivienda." (fragmento nominal) y perfil sin oficio.
- J1: "Instalación de tableros electricos, canalizacion y hago mantenimiento…" (1.ª persona sobrevive tras "y"); "Ha más de 30 instalaciones" (participio "completado" recortado tras auxiliar).
- N1: perfil "Tasks included stocking shelves…" (copia, sin oficio) — variación del LLM; E5 perfil sin identidad ("Crea páginas web…").
- B1: reaparece "Bilingual english spanish helped with spanish speaking customers." (degradación literal pobre).
