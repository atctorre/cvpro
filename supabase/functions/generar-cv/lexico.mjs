// lexico.mjs — motor v2 CVPro — tolerancia de paráfrasis POR OFICIO (v8)
//
// Problema (Fase 2, prueba real E2/N1/M3): el validador exigía que cada
// sustantivo de una viñeta tuviera raíz en las palabras del candidato. Eso
// tumbaba paráfrasis legítimas del mismo oficio ("verificar saldos" por
// "conciliaciones bancarias", "transactions" por "checkout") y dejaba la
// viñeta en su forma literal. Este módulo define CLÚSTERES de vocabulario
// por oficio: si el candidato usó CUALQUIER miembro del clúster para ese
// puesto, el modelo puede usar los demás miembros. Un clúster agrupa formas
// de nombrar LA MISMA tarea u objeto intrínseco a ella — nunca hechos
// nuevos (proveedores, SAP, tarjeta, salarios, certificaciones…): esos
// siguen necesitando que el candidato los haya dicho.
//
// Reglas de diseño:
// 1. Todo miembro se compara por raíz de 4 letras (RAIZ_LEN del validador),
//    así "conciliar/conciliación/conciliaciones" son la misma raíz.
// 2. Los clústeres se filtran por OFICIO detectado (palabras del puesto y
//    de la experiencia). Si no se detecta ninguno, solo aplican los
//    clústeres GENÉRICOS (atención, limpieza, supervisión, oficina).
// 3. Las palabras de RELLENO (no aportan hechos: "parte", "tareas",
//    "empresa"…) se toleran siempre.
// 4. Los ADJETIVOS DE CALIDAD ("precisa", "accurate", "eficiente") NO se
//    toleran: son afirmaciones de desempeño que el candidato no hizo.

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ───────────────────────── Clústeres por oficio ─────────────────────────
// Cada oficio: { detectar: [palabras del puesto/experiencia], clusters: [[...]] }
export const OFICIOS = {
  contabilidad: {
    detectar: ['contab', 'contador', 'contadora', 'auxiliar contable', 'account', 'bookkeep', 'finanz', 'financ', 'tesorer', 'auditor'],
    clusters: [
      ['conciliar', 'conciliacion', 'conciliaciones', 'bancario', 'bancaria', 'bancarias', 'saldos', 'saldo', 'estados de cuenta', 'estado de cuenta', 'movimientos', 'cuadre', 'cuadrar', 'reconcile', 'reconciliation', 'reconciliations', 'balances', 'statements', 'bank'],
      ['factura', 'facturas', 'facturacion', 'facturar', 'comprobantes', 'comprobante', 'invoice', 'invoices', 'invoicing', 'billing', 'registro', 'registros', 'registrar', 'asientos', 'asiento', 'contabilizar', 'contable', 'contables', 'contabilidad', 'accounting', 'bookkeeping', 'ledger', 'entries', 'posting'],
      ['planilla', 'planillas', 'nomina', 'nominas', 'payroll'],
      ['cuentas por cobrar', 'cuentas por pagar', 'cobros', 'pagos', 'receivable', 'receivables', 'payable', 'payables', 'collections'],
      ['impuestos', 'impuesto', 'declaraciones', 'declaracion', 'tributario', 'tributaria', 'fiscal', 'tax', 'taxes', 'filings'],
      ['reportes', 'reporte', 'informes', 'informe', 'reports', 'reporting', 'cierre', 'cierres', 'closing', 'mensual'],
    ],
  },
  retail_caja: {
    detectar: ['cajer', 'cashier', 'vendedor', 'vendedora', 'sales associate', 'retail', 'tienda', 'store', 'supermerc', 'farmacia', 'dependient', 'clerk', 'ventas', 'mostrador'],
    clusters: [
      ['cobro', 'cobros', 'cobrar', 'caja', 'cash', 'register', 'checkout', 'transacciones', 'transaccion', 'transactions', 'transaction', 'pagos', 'pago', 'payments', 'payment', 'pos', 'efectivo', 'vuelto', 'change', 'arqueo', 'cierre de caja', 'till', 'fondo', 'fondo de caja', 'apertura', 'cierre', 'turno', 'drawer', 'float', 'opening', 'closing'],
      ['devoluciones', 'devolucion', 'returns', 'return', 'cambios', 'exchanges', 'reembolsos', 'refunds', 'refund'],
      ['vender', 'venta', 'ventas', 'sales', 'sell', 'selling', 'sold', 'mostrador', 'counter', 'productos', 'producto', 'products', 'mercaderia', 'merchandise', 'articulos', 'items'],
      ['inventario', 'inventory', 'stock', 'existencias', 'reposicion', 'reponer', 'restock', 'restocked', 'restocking', 'estantes', 'estante', 'shelves', 'shelf', 'anaqueles', 'gondolas', 'surtir', 'abastecer', 'exhibicion', 'display', 'displays'],
      ['clientes', 'cliente', 'customers', 'customer', 'compradores', 'shoppers', 'consultas', 'inquiries', 'orientar', 'guiar', 'guide', 'guiding', 'locate', 'locating', 'find', 'finding', 'encontrar', 'ubicar'],
    ],
  },
  mecanica: {
    detectar: ['mecanic', 'mechanic', 'automotriz', 'automotive', 'taller', 'auto', 'vehicul', 'motor'],
    clusters: [
      ['reparar', 'reparacion', 'reparaciones', 'repair', 'repairs', 'repairing', 'arreglar', 'arreglo', 'fix', 'fixing', 'averias', 'averia', 'fallas', 'falla'],
      ['motor', 'motores', 'engine', 'engines', 'frenos', 'freno', 'brakes', 'brake', 'suspension', 'transmision', 'transmission', 'sistema electrico', 'clutch', 'embrague'],
      ['diagnostico', 'diagnosticar', 'diagnosis', 'diagnose', 'escaner', 'scanner', 'scan tool', 'scanning', 'escaneo', 'codigos', 'codes', 'revision', 'inspeccion', 'inspection', 'inspect'],
      ['mantenimiento', 'maintenance', 'preventivo', 'preventive', 'correctivo', 'servicio', 'service', 'cambio de aceite', 'cambios de aceite', 'aceite', 'oil', 'filtros', 'filtro', 'filters', 'filter'],
      ['vehiculo', 'vehiculos', 'vehicle', 'vehicles', 'carro', 'carros', 'car', 'cars', 'automovil', 'automoviles', 'unidad', 'unidades', 'automotriz', 'automotive', 'auto'],
      ['repuestos', 'repuesto', 'parts', 'part', 'piezas', 'pieza', 'cotizar', 'cotizacion', 'cotizaciones', 'quote', 'quotes', 'quoting', 'presupuesto', 'presupuestos', 'estimate', 'estimates'],
    ],
  },
  electricidad: {
    detectar: ['electric', 'electrician', 'instalador'],
    clusters: [
      ['instalar', 'instalacion', 'instalaciones', 'install', 'installation', 'installations', 'montar', 'montaje', 'cablear', 'cableado', 'wiring', 'wire', 'canalizacion', 'conduit'],
      ['tableros', 'tablero', 'panels', 'panel', 'breakers', 'breaker', 'interruptores', 'circuitos', 'circuito', 'circuits', 'circuit', 'acometidas', 'acometida'],
      ['multimetro', 'multimeter', 'pinza', 'amperimetrica', 'clamp', 'mediciones', 'medicion', 'measurements', 'medir', 'measure', 'pruebas', 'testing', 'test'],
      ['fallas', 'falla', 'faults', 'fault', 'cortos', 'short', 'diagnostico', 'troubleshooting', 'troubleshoot', 'reparar', 'reparacion', 'repair'],
    ],
  },
  construccion: {
    detectar: ['albanil', 'construc', 'obra', 'maestro de obra', 'soldad', 'welder', 'carpint', 'pintor', 'painter', 'plomer', 'plumber'],
    clusters: [
      ['construccion', 'construction', 'obra', 'obras', 'site', 'sites', 'proyecto', 'proyectos', 'project', 'projects', 'edificacion', 'building'],
      ['mezcla', 'concreto', 'concrete', 'cemento', 'cement', 'mortero', 'mortar', 'block', 'bloques', 'ladrillo', 'ladrillos', 'bricks', 'brick', 'repello', 'plaster', 'plastering', 'fundicion', 'pouring'],
      ['soldar', 'soldadura', 'welding', 'weld', 'welds', 'estructuras', 'estructura', 'structures', 'structural', 'metal', 'acero', 'steel', 'hierro', 'iron'],
      ['medir', 'mediciones', 'medicion', 'measure', 'measurements', 'niveles', 'nivel', 'level', 'leveling', 'planos', 'plano', 'blueprints', 'drawings'],
      ['pintar', 'pintura', 'painting', 'paint', 'acabados', 'acabado', 'finishes', 'finishing'],
      ['tuberia', 'tuberias', 'piping', 'pipes', 'pipe', 'fontaneria', 'plumbing', 'fugas', 'fuga', 'leaks', 'leak', 'drenajes', 'drenaje', 'drains'],
    ],
  },
  gastronomia: {
    detectar: ['cocin', 'chef', 'cook', 'mesero', 'mesera', 'waiter', 'waitress', 'server', 'restaurant', 'restauran', 'barista', 'bartender', 'panader', 'reposter'],
    clusters: [
      ['cocinar', 'cocina', 'cook', 'cooking', 'kitchen', 'preparar', 'preparacion', 'prep', 'prepare', 'preparing', 'platos', 'plato', 'dishes', 'dish', 'platillos', 'alimentos', 'alimento', 'food', 'comida', 'comidas', 'meals', 'meal', 'recetas', 'receta', 'recipes', 'recipe', 'menu'],
      ['ingredientes', 'ingrediente', 'ingredients', 'insumos', 'insumo', 'supplies', 'porciones', 'porcion', 'portions', 'portioning'],
      ['meseros', 'mesero', 'mesera', 'servir', 'servicio', 'serving', 'served', 'serve', 'mesas', 'mesa', 'tables', 'table', 'comensales', 'diners', 'guests', 'pedidos', 'pedido', 'orders', 'order', 'ordenes', 'orden', 'comandas'],
      ['limpieza', 'limpiar', 'clean', 'cleaning', 'higiene', 'hygiene', 'sanitizar', 'sanitize', 'sanitizing', 'inocuidad', 'food safety', 'lavado', 'washing', 'utensilios', 'utensils'],
    ],
  },
  salud: {
    detectar: ['enfermer', 'nurse', 'nursing', 'auxiliar de enfermeria', 'medic', 'doctor', 'clinic', 'hospital', 'salud', 'health', 'farmaceut', 'pharmac', 'laboratorio', 'odont', 'dental'],
    clusters: [
      ['pacientes', 'paciente', 'patients', 'patient', 'usuarios', 'atencion', 'care', 'cuidado', 'cuidados'],
      ['signos vitales', 'signos', 'vitales', 'vitals', 'vital signs', 'presion', 'blood pressure', 'temperatura', 'temperature', 'pulso', 'pulse', 'glucosa', 'glucose', 'toma de signos'],
      ['medicamentos', 'medicamento', 'medication', 'medications', 'medicines', 'medicine', 'administrar', 'administracion', 'administer', 'dosis', 'dose', 'doses', 'tratamiento', 'tratamientos', 'treatment', 'treatments'],
      ['curaciones', 'curacion', 'wound', 'wounds', 'heridas', 'herida', 'vendajes', 'vendaje', 'dressing', 'dressings', 'inyecciones', 'inyeccion', 'injections', 'injection', 'canalizar', 'canalizacion', 'iv', 'venoclisis', 'sueros', 'suero'],
      ['expediente', 'expedientes', 'historia clinica', 'historias clinicas', 'records', 'record', 'charting', 'chart', 'charts', 'registro', 'registros', 'notas', 'notes', 'documentar', 'documentation'],
      ['consultas', 'consulta', 'consultations', 'consultation', 'citas', 'cita', 'appointments', 'appointment', 'triage', 'triaje', 'admision', 'admission'],
    ],
  },
  educacion: {
    detectar: ['docent', 'maestr', 'profesor', 'profesora', 'teacher', 'teaching', 'tutor', 'instructor', 'educad', 'escuela', 'school', 'colegio', 'kinder', 'parvular'],
    clusters: [
      ['clases', 'clase', 'classes', 'class', 'lecciones', 'leccion', 'lessons', 'lesson', 'ensenar', 'ensenanza', 'teach', 'teaching', 'taught', 'impartir', 'instruir', 'instruction'],
      ['alumnos', 'alumno', 'alumnas', 'estudiantes', 'estudiante', 'students', 'student', 'ninos', 'nino', 'ninas', 'children', 'kids', 'grupo', 'grupos', 'group', 'groups'],
      ['planificacion', 'planificar', 'planning', 'plan', 'plans', 'lesson plans', 'programa', 'programas', 'curriculum', 'contenidos', 'contenido', 'materiales', 'material', 'materials'],
      ['evaluaciones', 'evaluacion', 'evaluar', 'evaluate', 'assessments', 'assessment', 'examenes', 'examen', 'exams', 'exam', 'calificar', 'calificaciones', 'grading', 'grades', 'notas', 'tareas', 'homework', 'assignments'],
      ['padres', 'padres de familia', 'parents', 'parent', 'reuniones', 'reunion', 'meetings', 'meeting', 'seguimiento', 'follow-up'],
    ],
  },
  logistica: {
    detectar: ['bodeg', 'almacen', 'warehouse', 'logist', 'logistic', 'despach', 'montacarg', 'forklift', 'repartidor', 'delivery', 'motorista', 'chofer', 'conductor', 'driver', 'transport'],
    clusters: [
      ['bodega', 'bodegas', 'almacen', 'almacenes', 'warehouse', 'warehouses', 'deposito', 'storage', 'stockroom'],
      ['carga', 'cargar', 'descarga', 'descargar', 'loading', 'load', 'unloading', 'unload', 'estibar', 'estiba', 'paletizar', 'pallets', 'pallet', 'tarimas', 'tarima'],
      ['despacho', 'despachar', 'dispatch', 'dispatching', 'pedidos', 'pedido', 'orders', 'order', 'picking', 'preparacion de pedidos', 'embalaje', 'embalar', 'packing', 'pack', 'empaque', 'empacar'],
      ['envios', 'envio', 'shipments', 'shipment', 'shipping', 'entregas', 'entrega', 'entregar', 'deliveries', 'delivery', 'deliver', 'delivered', 'rutas', 'ruta', 'routes', 'route', 'reparto'],
      ['inventario', 'inventory', 'stock', 'existencias', 'conteo', 'conteos', 'count', 'counts', 'counting', 'kardex', 'ingreso', 'ingresos', 'salidas', 'salida', 'receiving', 'recepcion', 'recibir'],
      ['conducir', 'conduccion', 'manejar', 'manejo', 'drive', 'driving', 'drove', 'vehiculo', 'vehiculos', 'vehicle', 'unidad', 'unidades', 'camion', 'camiones', 'truck', 'trucks', 'moto', 'motocicleta'],
    ],
  },
  oficina: {
    detectar: ['asistent', 'assistant', 'secretari', 'secretary', 'recepcion', 'receptionist', 'administrativ', 'administrative', 'oficina', 'office', 'auxiliar administrativo', 'digitad', 'data entry'],
    clusters: [
      ['archivo', 'archivar', 'archivos', 'filing', 'file', 'files', 'documentos', 'documento', 'documents', 'document', 'documentacion', 'documentation', 'expedientes', 'expediente', 'papeleria', 'paperwork'],
      ['correspondencia', 'correspondence', 'correos', 'correo', 'emails', 'email', 'cartas', 'carta', 'letters', 'memos', 'memorandos', 'oficios'],
      ['agenda', 'agendar', 'agendas', 'scheduling', 'schedule', 'schedules', 'citas', 'cita', 'appointments', 'appointment', 'reuniones', 'reunion', 'meetings', 'meeting', 'calendario', 'calendar'],
      ['llamadas', 'llamada', 'calls', 'call', 'telefono', 'telefonica', 'telefonicas', 'phone', 'phones', 'conmutador', 'switchboard', 'recepcion', 'reception', 'visitantes', 'visitante', 'visitors', 'visitor', 'recibir', 'greet', 'greeting'],
      ['datos', 'data', 'digitar', 'digitacion', 'ingresar', 'ingreso de datos', 'data entry', 'typing', 'entry', 'captura', 'capturar', 'sistema', 'system', 'base de datos', 'database', 'registros', 'records', 'registro'],
      ['reportes', 'reporte', 'informes', 'informe', 'reports', 'report', 'reporting', 'presentaciones', 'presentacion', 'presentations', 'hojas de calculo', 'spreadsheets', 'spreadsheet'],
    ],
  },
  seguridad: {
    detectar: ['vigilant', 'guardia', 'guard', 'security', 'seguridad', 'agente de seguridad', 'custodio'],
    clusters: [
      ['vigilancia', 'vigilar', 'surveillance', 'monitor', 'monitoreo', 'monitoring', 'camaras', 'camara', 'cameras', 'camera', 'cctv'],
      ['rondas', 'ronda', 'patrols', 'patrol', 'patrolling', 'recorridos', 'recorrido', 'rounds', 'perimetro', 'perimeter', 'instalaciones', 'premises', 'facilities'],
      ['acceso', 'accesos', 'access', 'control de acceso', 'ingreso', 'ingresos', 'entry', 'entrada', 'entradas', 'entrance', 'salida', 'salidas', 'exit', 'visitantes', 'visitors', 'personal', 'registro', 'log', 'logs', 'bitacora'],
      ['incidentes', 'incidente', 'incidents', 'incident', 'novedades', 'novedad', 'reportes', 'reporte', 'reports', 'report', 'emergencias', 'emergencia', 'emergencies', 'emergency', 'alarmas', 'alarma', 'alarms', 'alarm'],
    ],
  },
  ti: {
    detectar: ['desarroll', 'developer', 'programad', 'programmer', 'software', 'sistemas', 'it ', 'soporte tecnico', 'tech support', 'help desk', 'helpdesk', 'redes', 'network', 'devops', 'qa', 'tester', 'analista de sistemas', 'data'],
    clusters: [
      ['desarrollar', 'desarrollo', 'develop', 'development', 'developed', 'programar', 'programacion', 'programming', 'code', 'coding', 'codigo', 'implementar', 'implementacion', 'implement', 'implementation', 'construir', 'build', 'built'],
      ['sitios', 'sitio', 'sites', 'site', 'websites', 'website', 'web', 'paginas', 'pagina', 'pages', 'page', 'aplicaciones', 'aplicacion', 'applications', 'application', 'apps', 'app', 'sistemas', 'sistema', 'systems', 'system', 'modulos', 'modulo', 'modules', 'module', 'funcionalidades', 'features', 'feature'],
      ['pruebas', 'prueba', 'testing', 'tests', 'test', 'probar', 'qa', 'bugs', 'bug', 'errores', 'error', 'defectos', 'defects', 'defect', 'correccion', 'fixes', 'fix', 'depurar', 'debugging', 'debug'],
      ['soporte', 'support', 'tickets', 'ticket', 'incidencias', 'incidencia', 'incidents', 'usuarios', 'usuario', 'users', 'user', 'asistencia', 'help desk', 'helpdesk', 'resolver', 'resolucion', 'resolve', 'resolution', 'troubleshooting', 'troubleshoot'],
      ['redes', 'red', 'network', 'networks', 'networking', 'servidores', 'servidor', 'servers', 'server', 'infraestructura', 'infrastructure', 'equipos', 'equipo', 'computadoras', 'computadora', 'computers', 'computer', 'pcs', 'pc', 'hardware', 'instalacion', 'install', 'installation', 'configuracion', 'configurar', 'configuration', 'configure', 'setup'],
      ['base de datos', 'bases de datos', 'database', 'databases', 'datos', 'data', 'consultas', 'queries', 'query', 'reportes', 'reports', 'tablas', 'tables', 'respaldos', 'backups', 'backup'],
    ],
  },
};

// Clústeres genéricos: aplican a todo oficio (tareas transversales).
export const CLUSTERS_GENERICOS = [
  ['atender', 'atencion', 'atendia', 'servicio', 'servicios', 'attend', 'attention', 'service', 'assist', 'assisting', 'assisted', 'cliente', 'clientes', 'customer', 'customers', 'publico', 'public', 'usuarios', 'usuario', 'users', 'consultas', 'consulta', 'inquiries', 'inquiry', 'dudas', 'questions', 'orientar', 'orientacion', 'guiar', 'guide', 'guidance', 'help', 'helping', 'helped', 'ayudar', 'ayuda'],
  ['limpieza', 'limpiar', 'limpio', 'aseo', 'clean', 'cleaning', 'cleanliness', 'ordenar', 'orden', 'organizar', 'organizacion', 'organized', 'organizing', 'tidy', 'arreglar', 'arreglo', 'acomodar', 'acomodo', 'presentacion', 'mantener', 'maintain', 'maintained', 'maintaining'],
  ['supervisar', 'supervision', 'supervise', 'supervising', 'supervised', 'coordinar', 'coordinacion', 'coordinate', 'coordinating', 'equipo', 'team', 'personal', 'staff', 'colaboradores', 'employees', 'empleados', 'turnos', 'turno', 'shifts', 'shift', 'horarios', 'horario', 'schedules', 'schedule', 'capacitar', 'capacitacion', 'train', 'training', 'entrenar', 'entrenamiento', 'onboarding', 'induccion'],
  ['reportes', 'reporte', 'informes', 'informe', 'reports', 'report', 'reporting', 'registro', 'registros', 'registrar', 'records', 'record', 'log', 'logs', 'bitacora', 'controles', 'control', 'seguimiento', 'follow-up', 'tracking', 'track'],
  ['ventas', 'venta', 'vender', 'sales', 'sale', 'sell', 'selling', 'sold', 'cotizar', 'cotizacion', 'cotizaciones', 'quote', 'quotes', 'quoting', 'presupuestos', 'presupuesto', 'estimates', 'estimate', 'clientes', 'customers', 'prospectos', 'prospects', 'leads'],
  ['inventario', 'inventory', 'stock', 'existencias', 'reposicion', 'restock', 'restocking', 'restocked', 'estantes', 'shelves', 'anaqueles', 'surtir', 'abastecer', 'abastecimiento', 'supplies', 'suministros', 'insumos', 'materiales', 'material', 'materials'],
];

// Palabras de RELLENO: no aportan hechos, solo enlazan la frase. Se toleran
// siempre. (Las cortas <5 letras ya quedan exentas por longitud.)
export const RELLENO = new Set([
  'parte', 'partes', 'ciclo', 'ciclos', 'empresa', 'negocio', 'compania', 'organizacion', 'institucion', 'lugar', 'sitio',
  'principales', 'principal', 'servicios', 'servicio', 'tareas', 'tarea', 'labores', 'labor', 'actividades', 'actividad',
  'funciones', 'funcion', 'responsabilidades', 'responsabilidad', 'operaciones', 'operacion', 'operativas', 'operativa',
  'general', 'generales', 'correspondiente', 'correspondientes', 'respectivo', 'respectiva', 'diverso', 'diversa', 'distintos', 'distintas',
  'diario', 'diaria', 'diarios', 'diarias', 'cotidiano', 'cotidiana', 'rutina', 'rutinas', 'jornada', 'jornadas',
  'manera', 'forma', 'modo', 'proceso', 'procesos', 'etapa', 'etapas', 'ambito', 'entorno', 'contexto',
  'necesidades', 'necesidad', 'requerimientos', 'requerimiento', 'solicitudes', 'solicitud', 'asignado', 'asignada', 'asignados', 'asignadas', 'assigned', 'designado', 'designada',
  'aproximadamente', 'aprox', 'aproximado', 'aproximada', 'alrededor', 'cerca', 'inicial', 'iniciales', 'approximately', 'approx', 'around', 'roughly', 'about', 'initial', 'nearly',
  'apoyo', 'apoyar', 'soporte', 'colaboracion', 'colaborar', 'participacion', 'participar', 'contribuir', 'contribucion', 'contribuyendo',
  'part', 'parts', 'cycle', 'business', 'company', 'organization', 'workplace', 'location', 'establishment',
  'main', 'primary', 'core', 'services', 'tasks', 'task', 'duties', 'duty', 'activities', 'activity', 'functions', 'function',
  'responsibilities', 'responsibility', 'operations', 'operation', 'operational', 'general', 'related', 'various', 'assorted', 'multiple',
  'daily', 'routine', 'routines', 'shift', 'shifts', 'floor', 'front-end', 'front', 'back-end', 'area', 'areas',
  'needs', 'need', 'requests', 'request', 'requirements', 'requirement', 'support', 'supporting', 'supported', 'assistance', 'contributing', 'contribution', 'participating',
].map(norm));

// Adjetivos de CALIDAD/DESEMPEÑO: afirmaciones que el candidato no hizo.
// No se toleran aunque el clúster esté activo. (Los adjetivos de ALCANCE
// —"alto volumen"— ya los maneja ADJETIVOS_ALCANCE en el validador.)
export const ADJETIVOS_CALIDAD = new Set([
  'preciso', 'precisa', 'precision', 'exacto', 'exacta', 'exactitud', 'eficiente', 'eficientemente', 'eficiencia', 'eficaz', 'eficazmente',
  'oportuno', 'oportuna', 'oportunamente', 'correcto', 'correcta', 'correctamente', 'exitoso', 'exitosa', 'exitosamente', 'exito',
  'optimo', 'optima', 'optimizado', 'excelente', 'excelencia', 'destacado', 'destacada', 'sobresaliente', 'impecable', 'riguroso', 'rigurosa',
  'consistente', 'consistencia', 'confiable', 'confiabilidad', 'satisfaccion', 'satisfactorio', 'calidad', 'agil', 'agilidad', 'rapido', 'rapida', 'rapidez',
  'accurate', 'accurately', 'accuracy', 'precise', 'precisely', 'precision', 'efficient', 'efficiently', 'efficiency', 'effective', 'effectively',
  'timely', 'correct', 'correctly', 'successful', 'successfully', 'success', 'optimal', 'optimized', 'excellent', 'excellence', 'outstanding',
  'flawless', 'rigorous', 'consistent', 'consistently', 'consistency', 'reliable', 'reliability', 'satisfaction', 'quality', 'seamless', 'seamlessly',
  'quick', 'quickly', 'fast', 'prompt', 'promptly', 'smooth', 'smoothly', 'well-organized', 'organized',
].map(norm));

const RAIZ = 4;
const raiz = (w) => norm(w).replace(/[^a-z0-9 ]/g, '').slice(0, RAIZ);

/** Oficios detectados a partir del puesto objetivo y del texto de experiencia. */
export function detectarOficios(textoPuestoYExp) {
  const t = ' ' + norm(textoPuestoYExp).replace(/[^a-z0-9 ]/g, ' ') + ' ';
  return Object.keys(OFICIOS).filter(k => OFICIOS[k].detectar.some(d => t.includes(norm(d))));
}

/**
 * Raíces toleradas para las viñetas de UN puesto: por cada clúster (de los
 * oficios detectados + genéricos) con al menos un miembro presente en el
 * ámbito del puesto (lo que el candidato escribió sobre ESE puesto), se
 * toleran las raíces de todos sus miembros.
 * @param {string} alcanceNorm  texto normalizado del puesto (exp + logros)
 * @param {string[]} oficios    salida de detectarOficios()
 * @returns {Set<string>} raíces de 4 letras toleradas
 */
export function raicesToleradas(alcanceNorm, oficios) {
  const clusters = [...CLUSTERS_GENERICOS];
  (oficios || []).forEach(o => { if (OFICIOS[o]) clusters.push(...OFICIOS[o].clusters); });
  const alcance = ' ' + norm(alcanceNorm).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const alcancePalabras = alcance.trim().split(' ').filter(Boolean);
  const out = new Set();
  clusters.forEach(cl => {
    const activo = cl.some(m => {
      const mn = norm(m);
      if (mn.includes(' ')) return alcance.includes(' ' + mn + ' ') || alcance.includes(mn);
      const r = raiz(mn);
      return alcancePalabras.some(p => p.slice(0, RAIZ) === r);
    });
    if (!activo) return;
    cl.forEach(m => norm(m).split(' ').forEach(w => { if (w.length >= 3) out.add(raiz(w)); }));
  });
  return out;
}

export function esRelleno(normWord) { return RELLENO.has(normWord); }
export function esAdjetivoCalidad(normWord) { return ADJETIVOS_CALIDAD.has(normWord); }
