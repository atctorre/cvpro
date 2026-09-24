# Regresión motor v2 — Edge v21 (código v19 / v11.8) — 13 personas, 2026-09-24

Método: POST directo a `generar-cv` desde getcvpro.com con `tests/personas.json` (raw GitHub). 13/13 HTTP 200, 0 reintentos, 0 errores del validador. Tiempos 9.9–18.3 s.

Contexto: Edge v19 (validador vacío, sin lexico) y v20 (placeholder en validador) quedaron ROTOS por deploys defectuosos del ejecutor; v21 fue desplegado por el supervisor y verificado byte a byte + 95/95 tests sobre la copia descargada.

## Veredicto rápido (supervisor, previo a auditoría Opus)
- Invención grave: 0/13.
- Regresiones de calidad vs v17 (variación del LLM + estrictez del validador, no invención):
  - E2: se perdió la viñeta de cobro (`token_sin_fuente "realizadas"`, evidencia de una palabra → no degradable). "Arregló la tienda." es pobre.
  - E3: viñeta 0 degradada a frase nominal fea: "Edificio de 6 niveles (el edificio fue de 4,200 m2, equipo de 35 personas en obra)." — la evidencia arranca sin verbo.
  - N1: perfil fallback incluye "spanish basic" como habilidad (el filtro de idiomas se aplica a skills pero no al fallback de perfil).
  - N3: colas de relleno no cubiertas por RE_COLA_RELLENO: "across daily operations", "across warehouse operations", "for the warehouse team".
  - B1: "Worked while attending school." como viñeta de Cashier (con fuente, pero irrelevante).
- Deuda para v20 de código: (1) fallback de perfil sin idiomas; (2) ampliar RE_COLA_RELLENO con `across (daily|warehouse|store)?\s*operations`, `for the \w+ team`; (3) degradación con evidencia sin verbo → intentar fragmento con verbo o eliminar; (4) evidencia de una sola palabra → conservar la viñeta si el único token sin fuente es un participio ("realizadas") recortable.

## E1_kevin_portillo (es)
```
RESUMEN PROFESIONAL
Practicante administrativo con experiencia en archivo de documentos y atención telefónica. Maneja Word y Excel.
EXPERIENCIA PROFESIONAL
Practicante | Alcaldía de Santa Tecla | 3 meses
• Apoyo en archivo de documentos y atención de llamadas.
EDUCACIÓN
Bachillerato Técnico en Contaduría | INTI | 2023
2.º año de Administración de Empresas | UFG | En curso
HABILIDADES
Técnicas: Word, excel basico, Atención al público
Blandas: Ordenado
Idiomas: Español
```
## E2_rosa_marquez (es)
```
RESUMEN PROFESIONAL
Cajera con experiencia en Super Selectos y como Vendedora en Tienda de Ropa. Conocimientos en manejo de caja y atención al cliente.
EXPERIENCIA PROFESIONAL
Cajera | Super Selectos | 2022 – Actualidad
Vendedora | Tienda de ropa | 2019 – 2021
• Atendió clientes en la tienda de ropa.
• Arregló la tienda.
EDUCACIÓN
Bachillerato general | 2018
HABILIDADES
Técnicas: manejo de caja, atención al cliente
Idiomas: Español
```
## E3_carlos_rivas (es)
```
RESUMEN PROFESIONAL
Ingeniero Civil Residente con experiencia en Constructora Meridiano y como Auxiliar de Ingeniería en Alcaldía de Soyapango. Manejo de AutoCAD, Civil 3D, presupuestos, Project y supervisión de obra.
EXPERIENCIA PROFESIONAL
Ingeniero Residente | Constructora Meridiano | 2020 – Actualidad
• Edificio de 6 niveles (el edificio fue de 4,200 m2, equipo de 35 personas en obra).
• Supervisión de obra de un edificio de 6 niveles y dos proyectos de vivienda.
• Control de calidad de concreto.
• Coordina subcontratistas en las obras bajo su responsabilidad.
Auxiliar de Ingeniería | Alcaldía de Soyapango | 2017 – 2020
EDUCACIÓN
Ingeniería Civil | Universidad de El Salvador | 2017
HABILIDADES
Técnicas: AutoCAD, Civil 3D, presupuestos, Project, supervisión de obra
Idiomas: Español, Inglés — Básico
INFORMACIÓN ADICIONAL
Cero accidentes graves en 4 años de obra.
```
## E4_jose_luis_hernandez (es)
```
RESUMEN PROFESIONAL
Trabaja en Taller Hermanos Flores desde 2016.
EXPERIENCIA PROFESIONAL
Mecanico | Taller Hermanos Flores | 2016 – Actualidad
• Reparacion de motores, frenos, suspencion y diagnostico con escaner.
Ayudante | Taller de su tío | 2013 – 2016
EDUCACIÓN
Noveno grado
HABILIDADES
Técnicas: diagnostico con escaner, motores diesel y gasolina, soldadura basica
Idiomas: Español
```
## E5_andrea_guevara (es)
```
RESUMEN PROFESIONAL
Desarrolladora Web Junior con experiencia freelance y como Maestra de inglés en Colegio Cristóbal Colón. Manejo de HTML, CSS, JavaScript, React, Git e inglés.
EXPERIENCIA PROFESIONAL
Desarrolladora Web | Freelance | 2024 – Actualidad
• Desarrolla páginas web para 3 negocios locales utilizando HTML, CSS, JavaScript y React.
• Una de las páginas web desarrolladas contribuyó a incrementar las ventas del negocio cliente.
Maestra de inglés | Colegio Cristóbal Colón | 2018 – 2023
EDUCACIÓN
Licenciatura en Idiomas | UES | 2018
Bootcamp Full Stack | Kodigo | 2024
HABILIDADES
Técnicas: HTML, CSS, JavaScript, React, Git
Idiomas: Español — Nativo, Inglés — Avanzado
```
## N1_ashley_nguyen (en)
```
PROFESSIONAL SUMMARY
Retail Sales Associate with experience at Target. Skilled in cash register, customer service and spanish basic.
PROFESSIONAL EXPERIENCE
Sales Associate | Target | 2025
• Stocked shelves.
• Helped customers find products.
• Ran the register.
EDUCATION
High School Diploma | Camelback High School | 2024
SKILLS
Technical: cash register, customer service
Languages: English, Spanish — Basic
```
## N2_marcus_bell (en)
```
PROFESSIONAL SUMMARY
Troubleshoots faults and communicates findings to homeowners.
PROFESSIONAL EXPERIENCE
HVAC Technician | Buckeye Comfort | 2021 – Present
• Installed and commissioned residential furnaces and AC units with no callbacks on installations.
• Handled refrigerant per EPA 608 requirements.
• Troubleshot faults and explained findings to homeowners.
Apprentice | 2019 – 2021
EDUCATION
HVAC Technology Program | Columbus State Community College | 2019
SKILLS
Technical: EPA 608 certification, refrigerant handling, furnace troubleshooting, AC unit diagnostics, customer communication, service documentation
Languages: English
```
## N3_daniel_okafor (en)
```
PROFESSIONAL SUMMARY
Reduced overtime 18% through rescheduling and achieved zero lost-time injuries in 2024. Skilled in WMS, scheduling, and team leadership across warehouse operations.
PROFESSIONAL EXPERIENCE
Operations Supervisor | FastShip Logistics | 2020 – Present
• Supervised a 40-person warehouse shift across daily operations.
• Cut overtime 18% by rescheduling shift assignments.
• Owned safety training for the warehouse team.
Team Lead | Amazon fulfillment | 2017 – 2020
• Led a team of 12 pickers to meet daily quotas.
EDUCATION
BBA | University of North Texas | 2017
SKILLS
Technical: WMS, Excel, scheduling, OSHA basics, team leadership
Languages: English
ADDITIONAL INFORMATION
Zero lost-time injuries in 2024
```
## N4_emily_carter (en)
```
PROFESSIONAL SUMMARY
Junior UX Designer with experience as Store Manager at Riverside Retail. Skilled in Figma, basic wireframing and user interviews.
PROFESSIONAL EXPERIENCE
Store Manager | Riverside Retail | 2019 – 2024
• Managed store operations, including staff scheduling.
• Handled customer complaints.
• Executed visual merchandising.
EDUCATION
UX Design Certificate | online bootcamp | 2024
BA in Communications | Portland State University | 2018
SKILLS
Technical: Figma, basic wireframing, user interviews
Languages: English
```
## N5_sofia_ramirez (en)
```
PROFESSIONAL SUMMARY
Trains new graduate nurses during orientation at Mercy General Hospital.
PROFESSIONAL EXPERIENCE
Registered Nurse, Med-Surg | Mercy General Hospital | 2018 – Present
• Managed care for 5–6 patients per shift on a 32-bed unit.
• Trained new graduate nurses during orientation.
• Go-to person for wound care consults.
LPN | Sunrise Nursing Home | 2015 – 2018
EDUCATION
BSN | Florida International University | 2018
Wound Care Certification (WCC) | 2023
SKILLS
Technical: wound care, IV therapy, EMR/Epic charting, patient education, medication administration
Languages: English, Spanish
ADDITIONAL INFORMATION
Active RN license in Florida
BLS certified
ACLS certified
```
## J1_jose_antonio_martinez (es)
```
RESUMEN PROFESIONAL
Ha ejecutado más de 30 instalaciones residenciales y tableros trifásicos hasta 100 amperios en plantas industriales. Maneja multímetro y pinza amperimétrica.
EXPERIENCIA PROFESIONAL
Electricista | Electrosur | 2019 – Actualidad
• Instala tableros eléctricos, canalización y ejecuta mantenimiento preventivo y correctivo en plantas industriales y casas.
• Instaló tableros trifásicos hasta 100 amperios en plantas industriales.
• Realizó más de 30 instalaciones residenciales.
• Utiliza multímetro y pinza amperimétrica en las intervenciones eléctricas.
Ayudante de electricista | Construcciones varias | 2017 – 2019
• Apoyó en instalaciones eléctricas básicas y canalización en obras de construcción.
EDUCACIÓN
Curso de Electricidad | INSAFORP | 2017
Bachillerato General | Instituto Nacional de Soyapango | 2015
HABILIDADES
Técnicas: instalaciones electricas, lectura de planos, trabajo en alturas, multimetro, pinza amperimetrica, tableros electricos, canalizacion, mantenimiento preventivo, mantenimiento correctivo
Blandas: responsable
Idiomas: Español
INFORMACIÓN ADICIONAL
Disponibilidad inmediata.
```
## M1_maria_fernanda_quintanilla (es)
```
RESUMEN PROFESIONAL
Contadora General con experiencia en Distribuidora La Fuente S.A. de C.V. y como Auxiliar contable en Despacho Ramírez & Asociados. Manejo de NIIF para PYMES, SAP Business One, Excel avanzado, declaraciones tributarias y liderazgo de equipo.
EXPERIENCIA PROFESIONAL
Contadora general | Distribuidora La Fuente S.A. de C.V. | Marzo 2021 – Actualidad
• Ejecuta cierres mensuales y elabora declaraciones de IVA y renta.
• Supervisa a 2 auxiliares contables.
• Implementó un sistema de conciliaciones que redujo los errores en un 40 %.
• Obtuvo auditoría externa 2023 sin hallazgos.
Auxiliar contable | Despacho Ramírez & Asociados | 2018 – 2021
• Apoyó en registros contables y conciliaciones bancarias para varios clientes del despacho.
• Colaboró en la preparación de estados financieros para presentar a los dueños de clientes PyME.
EDUCACIÓN
Licenciatura en Contaduría Pública | Universidad de Oriente (UNIVO) | 2018
HABILIDADES
Técnicas: NIIF para PYMES, SAP Business One, Excel avanzado, declaraciones tributarias, liderazgo de equipo
Idiomas: Español, Inglés — Intermedio
INFORMACIÓN ADICIONAL
Disponibilidad inmediata.
Referencias disponibles a solicitud.
```
## B1_brandon_lee_carter (en)
```
PROFESSIONAL SUMMARY
Handled inbound calls for a phone company using Zendesk, typed at 60 WPM, and assisted Spanish-speaking customers in English and Spanish. Recognized as Employee of the Month twice.
PROFESSIONAL EXPERIENCE
Call Center Representative | Teleperformance | 2024 – 2025
• Took inbound calls for a phone company, supporting customers in English and Spanish.
• Used Zendesk.
• Employee of the month twice.
Cashier | HEB | 2022 – 2024
• Handled cash register transactions and assisted customers.
• Worked while attending school.
EDUCATION
High School Diploma | Westside High School | 2021
Some College, Business (No Degree) | Houston Community College
SKILLS
Technical: Zendesk, Typing 60 WPM
Soft skills: Patient with customers
Languages: English — Native, Spanish — Intermediate
ADDITIONAL INFORMATION
Immediate availability
```
