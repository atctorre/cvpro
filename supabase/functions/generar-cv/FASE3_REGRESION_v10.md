# Fase 3 — Regresión motor v2 (generar-cv v10) — 13 personas, 2026-09-23

Llamada directa a `POST /functions/v1/generar-cv` desde getcvpro.com (tester activo), payload = `personas.json[].datos` (14 claves del chat). Sin paso de checklist ni cifras (eso vive en el chat, no en el motor). Tiempos: 10–42 s; reintento del servidor en 6/13.

---
## E1_kevin_portillo (es) — 13.1 s — reintento: no
```
KEVIN ALEXANDER PORTILLO
Asistente Administrativo | El Salvador | kevinportillo03@gmail.com | 6021-3344

RESUMEN PROFESIONAL
Orientado al orden y al apoyo administrativo operativo.

EXPERIENCIA PROFESIONAL
Practicante | Alcaldía de Santa Tecla
• Solo apoyaba con archivar documentos y contestar llamadas.
• Atendió llamadas telefónicas entrantes, canalizando solicitudes al personal correspondiente.

EDUCACIÓN
Bachillerato Técnico en Contaduría | INTI | 2023
2.º año de Administración de Empresas | UFG | En curso

HABILIDADES
Técnicas: Word, Excel basico, Atencion al publico
Blandas: Ordenado
Idiomas: Español
```
Correcciones: perfil eliminado→fallback; vinetas[0] degradada (token "período").

## E2_rosa_marquez (es) — 26.7 s — reintento: sí
```
ROSA ELENA MÁRQUEZ
Cajera | El Salvador | rosamarquez.ah@hotmail.com | 7233-8891

RESUMEN PROFESIONAL
Cajera con experiencia en Super Selectos y como Vendedora en Tienda de ropa. Manejo de manejo de caja y atención al cliente.

EXPERIENCIA PROFESIONAL
Cajera | Super Selectos | 2022 – Actualidad

Vendedora | Tienda de ropa | 2019 – 2021
• Atendió a clientes en tienda de ropa brindando orientación durante el proceso de compra.
• Arreglar la tienda.
• Realizó el cobro a clientes como parte de las operaciones de cierre de venta.

EDUCACIÓN
Bachillerato general | 2018

HABILIDADES
Técnicas: manejo de caja, atención al cliente
Idiomas: Español
```
Errores: experiencia[0]_sin_vinetas (logros1="solo cargo", esperado). Correcciones: perfil reconstruido; vinetas[1] degradada (token "espacio").

## E3_carlos_rivas (es) — 42.5 s — reintento: sí
```
ING. CARLOS HUMBERTO RIVAS
Ingeniero Civil Residente | El Salvador | carlos.rivas.ing@gmail.com | 7899-1020

RESUMEN PROFESIONAL
Ingeniero Civil Residente con experiencia como Ingeniero Residente en Constructora Meridiano y como Auxiliar de Ingeniería en Alcaldía de Soyapango. Manejo de AutoCAD, Civil 3D, presupuestos, Project y supervisión de obra.

EXPERIENCIA PROFESIONAL
Ingeniero Residente | Constructora Meridiano | 2020 – Actualidad
• Supervisó la construcción de un edificio de 4,200 m² coordinando un equipo de 35 personas en obra.

Auxiliar de Ingeniería | Alcaldía de Soyapango | 2017 – 2020
• Realizó levantamientos topográficos y elaboró presupuestos de obras menores.

EDUCACIÓN
Ingeniería Civil | Universidad de El Salvador | 2017

HABILIDADES
Técnicas: AutoCAD, Civil 3D, presupuestos, Project, supervisión de obra
Idiomas: Español, Inglés — Básico

INFORMACIÓN ADICIONAL
Cero accidentes graves en 4 años de obra activa
```
Correcciones: perfil reconstruido; **vinetas[1] ELIMINADA** evidencia="supervisión de obra de un edificio de 6 niveles y dos proyectos de vivienda, control de calidad de concreto, coordinación con subcontratistas" (estaba en resumen_personal, no en logros1 → evidencia_no_literal); vinetas[2] eliminada evidencia="entregamos con 2 semanas de retraso por lluvias | cero accidentes graves en 4 años".

## E4_jose_luis_hernandez (es) — 19.8 s — reintento: no
```
JOSE LUIS HERNANDEZ
Mecanico Automotriz | el salvador | joseluis.mecanico@gmail.com | 7411-0099

RESUMEN PROFESIONAL
Mecanico Automotriz con experiencia como Mecánico en Taller Hermanos Flores y como Ayudante de mecánico en Taller de su tío. Manejo de diagnostico con escaner, motores diesel, gasolina y soldadura basica.

EXPERIENCIA PROFESIONAL
Mecánico | Taller Hermanos Flores | 2016 – Actualidad
• Reparacion de motores, frenos, suspencion y diagnostico con escaner.
• Realiza reparación y mantenimiento de sistemas de frenos en vehículos de clientes.
• Aplica diagnóstico con escáner para identificar fallas en los vehículos de los clientes.

Ayudante de mecánico | Taller de su tío | 2013 – 2016
• Realizó cambios de aceite como parte de los servicios de mantenimiento del taller.
• Cambios de aceite y frenos.

EDUCACIÓN
Noveno grado

HABILIDADES
Técnicas: diagnostico con escaner, motores diesel y gasolina, soldadura basica, reparación de frenos, reparación de suspensión, reparación de motores
Idiomas: Español

INFORMACIÓN ADICIONAL
Clientes recurrentes como indicador de calidad del servicio prestado en taller.
```
Correcciones: 2 degradadas (tokens "combustión, interna"; "formación, práctica"), 1 eliminada (evidencia "los clientes regresan"), 1 redundante, blanda "fidelización de clientes" eliminada.

## E5_andrea_guevara (es) — 26.7 s — reintento: sí
```
ANDREA SOFÍA GUEVARA
Desarrolladora Web Junior | El Salvador | andrea.guevara.dev@gmail.com | 7650-2210

RESUMEN PROFESIONAL
Construye sitios web para negocios locales con HTML, CSS, JavaScript y React.

EXPERIENCIA PROFESIONAL
Desarrolladora Web | Freelance | 2024 – Actualidad
• Desarrolló 3 sitios web para negocios locales utilizando HTML, CSS, JavaScript y React.
• Implementó un sitio web para un negocio local que contribuyó a un incremento en sus ventas.

Maestra de Inglés | Colegio Cristóbal Colón | 2018 – 2023

EDUCACIÓN
Bootcamp Full Stack | Kodigo | 2024
Licenciatura en Idiomas | UES | 2018

HABILIDADES
Técnicas: HTML, CSS, JavaScript, React, Git
Idiomas: Español — Nativo, Inglés — Avanzado
```
Errores: experiencia[1]_empresa_no_verificable (pero se mantuvo). Nota: el puesto de maestra salió de resumen_personal (exp2="no").

## N1_ashley_nguyen (en) — 10.0 s — reintento: no
```
ASHLEY NGUYEN
Retail Sales Associate | United States | ashley.nguyen.az@gmail.com | (602) 555-0133

PROFESSIONAL SUMMARY
Skilled in customer assistance, shelf stocking, and register operations.

PROFESSIONAL EXPERIENCE
Sales Associate | Target | 2025 – 2025
• Stocking shelves.
• Assisted customers in locating products throughout the store.
• Operated the register to process customer transactions.

EDUCATION
High School Diploma | Camelback High School | 2024

SKILLS
Technical: cash register, customer service, spanish basic
Languages: English, Spanish — Basic
```
Correcciones: vinetas[0] degradada (tokens "availability, organized").

## N2_marcus_bell (en) — 26.4 s — reintento: sí
```
MARCUS BELL
Hvac Technician | United States | mbell.hvac@gmail.com | (614) 555-0177

PROFESSIONAL SUMMARY
Installations have generated no callbacks.

PROFESSIONAL EXPERIENCE
HVAC Technician | Buckeye Comfort | 2021 – Present
• No callbacks on my installations.

HVAC Apprentice | apprentice at a different HVAC company | 2019 – 2021

EDUCATION
HVAC Technology Program | Columbus State Community College | 2019

SKILLS
Technical: EPA 608 certification, refrigerant handling, furnace troubleshooting, AC unit diagnostics, customer communication, service documentation
Languages: English
```
Correcciones: vinetas[0] degradada; **vinetas[1] y [2] ELIMINADAS** (evidencias "handle refrigerant per EPA 608", "troubleshoot faults, explain findings to homeowners" — estaban en resumen_personal).

## N3_daniel_okafor (en) — 12.4 s — reintento: no
```
DANIEL OKAFOR
Operations Manager | United States | daniel.okafor.ops@gmail.com | (817) 555-0142

PROFESSIONAL SUMMARY
Reduced overtime by 18% through rescheduling and achieved zero lost-time injuries in 2024.

PROFESSIONAL EXPERIENCE
Operations Supervisor | FastShip Logistics | 2020 – Present
• Supervised a 40-person warehouse shift.
• Cut overtime by 18% by redesigning shift scheduling.

Team Lead | Amazon fulfillment | 2017 – 2020
• Led a team of 12 pickers, ensuring daily quotas were met.

EDUCATION
BBA | University of North Texas | 2017

SKILLS
Technical: WMS, Excel, scheduling, OSHA basics, team leadership
Languages: English

ADDITIONAL INFORMATION
Zero lost-time injuries in 2024
```
Correcciones: vinetas[0] degradada ("workforce"); vinetas[2] eliminada (evidencia "own safety training | zero lost-time injuries in 2024" — "own safety training" venía de logros1 pero la compuesta falló por el fragmento del info_extra).

## N4_emily_carter (en) — 27.4 s — reintento: sí
```
EMILY CARTER
Junior Ux Designer | United States | emily.carter.design@gmail.com | (503) 555-0188

PROFESSIONAL SUMMARY
Junior Ux Designer with experience as Store Manager at Riverside Retail and as UX Design Student — Coursework Projects at UX Design Certificate Program. Skilled in Figma, basic wireframing and user interviews.

PROFESSIONAL EXPERIENCE
Store Manager | Riverside Retail | 2019 – 2024
• Managed the store, dealt with staff scheduling.
• Dealt with staff scheduling and customer complaints.
• Executed visual merchandising for the store to support product presentation.

UX Design Student — Coursework Projects | UX Design Certificate Program | 2024 – 2024
• Did a couple of practice UX projects during the course, redesigning a fictional app.

EDUCATION
BA in Communications | Portland State University | 2018
UX Design Certificate | online bootcamp | 2024

SKILLS
Technical: Figma, basic wireframing, user interviews
Soft skills: Staff scheduling, Visual merchandising
Languages: English
```
Errores: experiencia[1]_empresa_no_verificable (se mantuvo). Correcciones: 3 degradadas; 2 blandas eliminadas.

## N5_sofia_ramirez (en) — 25.7 s — reintento: sí
```
SOFIA RAMIREZ
Registered Nurse | United States | sofia.ramirez.rn@gmail.com | (305) 555-0166

PROFESSIONAL SUMMARY
Registered Nurse with experience as Registered Nurse, Med-Surg at Mercy General Hospital and as LPN at Sunrise Nursing Home. Skilled in wound care, IV therapy, EMR/Epic charting, patient education and medication administration.

PROFESSIONAL EXPERIENCE
Registered Nurse, Med-Surg | Mercy General Hospital | 2018 – Present
• Typically handle 5-6 patients per shift on a 32-bed unit.
• Train new grad nurses during orientation.
• Am the go-to person for wound care consults.

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
Correcciones: 3 degradadas (tokens "assessments, medication, education"; "resource"; "WCC-certified").

## J1_jose_antonio_martinez (es) — 16.6 s — reintento: no
```
JOSE ANTONIO MARTINEZ LOPEZ
Electricista | El Salvador | joseantonio.ml87@gmail.com | 7845-2211

RESUMEN PROFESIONAL
Ha ejecutado más de 30 instalaciones residenciales y tableros trifásicos hasta 100 amperios en plantas industriales.

EXPERIENCIA PROFESIONAL
Electricista | Electrosur | 2019 – Actualidad
• Instala tableros eléctricos trifásicos hasta 100 amperios en plantas industriales.
• Ejecuta canalización eléctrica en instalaciones residenciales e industriales.
• Realización de mantenimiento preventivo y correctivo en plantas industriales y casas.
• Completó más de 30 instalaciones residenciales.
• Utiliza multímetro y pinza amperimétrica para diagnóstico y verificación de instalaciones.

Ayudante de electricista | Construcciones varias | 2017 – 2019
• Apoyó en instalaciones eléctricas básicas y canalización en obras de construcción.

EDUCACIÓN
Curso de Electricidad | INSAFORP | 2017
Bachillerato General | Instituto Nacional de Soyapango | 2015

HABILIDADES
Técnicas: instalaciones electricas, lectura de planos, trabajo en alturas, tableros electricos trifasicos, canalizacion electrica, mantenimiento preventivo y correctivo, multimetro, pinza amperimetrica
Blandas: responsable
Idiomas: Español

INFORMACIÓN ADICIONAL
Disponibilidad inmediata
```
Correcciones: vinetas[2] degradada ("viviendas").

## M1_maria_fernanda_quintanilla (es) — 18.3 s — reintento: no
```
MARÍA FERNANDA QUINTANILLA RÍOS
Contadora General | El Salvador | mfquintanilla@outlook.com | 7712-9034

RESUMEN PROFESIONAL
Implementó un sistema de conciliaciones que redujo errores en un 40 % y logró auditoría externa 2023 sin hallazgos.

EXPERIENCIA PROFESIONAL
Contadora general | Distribuidora La Fuente S.A. de C.V. | 2021-03 – Actualidad
• Ejecuta cierres mensuales y elabora declaraciones de IVA y renta, garantizando el cumplimiento tributario de la empresa.
• Supervisa a 2 auxiliares contables, coordinando la distribución de tareas del área.
• Implementó un sistema de conciliaciones que redujo los errores en un 40 %.
• Obtuvo auditoría externa 2023 sin ningún hallazgo.

Auxiliar contable | Despacho Ramírez & Asociados | 2018 – 2021
• Realizó registros contables y conciliaciones bancarias para varios clientes PyME del despacho.
• Apoyó en la preparación de estados financieros para presentar a los dueños de los clientes del despacho.

EDUCACIÓN
Licenciatura en Contaduría Pública | Universidad de Oriente (UNIVO) | 2018

HABILIDADES
Técnicas: NIIF para PYMES, SAP Business One, Excel avanzado, declaraciones tributarias, liderazgo de equipo
Idiomas: Español — intermedio, Inglés — Intermedio

INFORMACIÓN ADICIONAL
Disponibilidad inmediata
Referencias disponibles a solicitud
```
Correcciones: idiomas[0] nivel ajustado a "intermedio" (INCORRECTO: el input era "Español + Inglés intermedio").

## B1_brandon_lee_carter (en) — 14.7 s — reintento: no
```
BRANDON LEE CARTER
Customer Service Representative | United States | bcarter.hou@gmail.com | (713) 555-0142

PROFESSIONAL SUMMARY
Recognized twice as Employee of the Month at Teleperformance.

PROFESSIONAL EXPERIENCE
Call Center Representative | Teleperformance | 2024 – Present
• Took inbound calls for a phone company, bilingual english spanish helped with spanish speaking customers.
• Used zendesk.
• Typing 60 wpm.
• Got employee of the month twice.

Cashier | HEB | 2022 – 2024
• Operated the cash register and processed customer transactions.
• Assisted customers on the floor and at checkout while attending school.

EDUCATION
High School Diploma | Westside High School | 2021
Some College — Business (no degree) | Houston Community College

SKILLS
Technical: Typing 60 WPM, Zendesk, before that i was a cashier at HEB for 2 years while in school
Soft skills: bilingual english spanish, Patient with customers
Languages: English — intermediate, Spanish — Intermediate

ADDITIONAL INFORMATION
Immediate availability
```
Correcciones: 4 degradadas; técnica "Cash register operation" → literal "before that i was a cashier at HEB for 2 years while in school" (BUG visible); idiomas[0] "intermediate" (INCORRECTO: input "English native + Spanish intermediate"). Nota: input decía 2024 to 2025 y salió "2024 – Present".
