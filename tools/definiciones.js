/**
 * KALLPA AI — Definiciones de tools por agente
 * =============================================
 * Cada tool mapea a un módulo/endpoint que YA EXISTE en el backend.
 * El executor (tools/executor.js) hace el dispatch real.
 *
 * Regla arquitectónica: escalarAutomatico NO se expone al agente.
 * Solo el backend la invoca cuando el semáforo determinista da rojo.
 * El agente solo tiene escalarManual (amarillo + confirmación del user).
 */

// ── AGENTE TRIBUTARIO ──────────────────────────────────────────
export const TOOLS_TRIBUTARIO = [
  {
    name: 'obtenerComprobantesPeriodo',
    description:
      'Obtiene los comprobantes electrónicos (emitidos y recibidos) del ' +
      'tenant para un período fiscal, ya descargados por el pipeline diario. ' +
      'Devuelve totales agregados y lista de comprobantes.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: 'Período fiscal YYYY-MM' },
        tipo: {
          type: 'string',
          enum: ['emitidos', 'recibidos', 'todos'],
          description: 'Filtro por dirección del comprobante'
        }
      },
      required: ['periodo']
    }
  },
  {
    name: 'obtenerDetalleComprobante',
    description:
      'Devuelve el detalle completo de un comprobante por su clave de acceso ' +
      '(49 dígitos): emisor, receptor, detalle de ítems, impuestos, estado SRI.',
    input_schema: {
      type: 'object',
      properties: {
        claveAcceso: { type: 'string', description: 'Clave de acceso de 49 dígitos' }
      },
      required: ['claveAcceso']
    }
  },
  {
    name: 'generarBorradorF104',
    description:
      'Genera el borrador espejo del Formulario 104 (IVA) casillero por ' +
      'casillero para el período indicado. Cálculo determinista en backend. ' +
      'Devuelve casilleros, valor a pagar/saldo a favor y estado del semáforo. ' +
      'El borrador sale con marca de agua PENDIENTE VALIDACIÓN.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: 'Período fiscal YYYY-MM' }
      },
      required: ['periodo']
    }
  },
  {
    name: 'calcularRetenciones',
    description:
      'Calcula retenciones del período: efectuadas (que el tenant hizo como ' +
      'agente de retención) o recibidas (que le hicieron, crédito a su favor).',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: 'Período fiscal YYYY-MM' },
        tipo: { type: 'string', enum: ['efectuadas', 'recibidas', 'ambas'] }
      },
      required: ['periodo', 'tipo']
    }
  },
  {
    name: 'obtenerCalendarioTributario',
    description:
      'Devuelve las próximas obligaciones tributarias del tenant con fechas ' +
      'exactas según el 9no dígito del RUC y su régimen.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'escalarManual',
    description:
      'Crea un ticket para que un contador certificado Kallpa revise el caso. ' +
      'SOLO usar cuando: (a) el semáforo está en amarillo Y (b) el usuario ' +
      'confirmó explícitamente que desea la revisión humana. Nunca en rojo ' +
      '(el backend escala automático) ni en verde sin pedido del usuario.',
    input_schema: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Descripción clara del caso' },
        urgencia: { type: 'string', enum: ['alta', 'media', 'baja'] },
        contexto: { type: 'object', description: 'Datos relevantes (periodo, montos, claves)' }
      },
      required: ['motivo', 'urgencia']
    }
  }
];

// ── AGENTE CONTABLE ────────────────────────────────────────────
export const TOOLS_CONTABLE = [
  {
    name: 'obtenerComprobantesSinContabilizar',
    description:
      'Lista los comprobantes electrónicos descargados que aún no tienen ' +
      'asiento contable registrado.',
    input_schema: {
      type: 'object',
      properties: {
        limite: { type: 'integer', description: 'Máximo de resultados (default 50)' }
      },
      required: []
    }
  },
  {
    name: 'proponerAsientos',
    description:
      'El motor contable clasifica cada comprobante y propone el asiento de ' +
      'doble partida según el plan de 122 cuentas NIIF PYMES. Devuelve los ' +
      'asientos propuestos SIN registrarlos (estado borrador).',
    input_schema: {
      type: 'object',
      properties: {
        claveAccesoArray: {
          type: 'array',
          items: { type: 'string' },
          description: 'Claves de acceso a contabilizar'
        }
      },
      required: ['claveAccesoArray']
    }
  },
  {
    name: 'proponerAsientoManual',
    description:
      'Valida y propone un asiento manual (sueldos, depreciación, ajustes, ' +
      'aportes). El backend verifica débitos = créditos y cuentas válidas. ' +
      'No registra: devuelve borrador para confirmación.',
    input_schema: {
      type: 'object',
      properties: {
        descripcion: { type: 'string' },
        fecha: { type: 'string', description: 'YYYY-MM-DD' },
        lineas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cuenta: { type: 'string', description: 'Código del plan (ej: 1.1.3)' },
              debito: { type: 'number' },
              credito: { type: 'number' }
            },
            required: ['cuenta']
          }
        }
      },
      required: ['descripcion', 'fecha', 'lineas']
    }
  },
  {
    name: 'registrarAsientos',
    description:
      'Registra en firme asientos previamente propuestos (por ID de borrador). ' +
      'Usar SOLO tras confirmación explícita del usuario.',
    input_schema: {
      type: 'object',
      properties: {
        asientoIds: { type: 'array', items: { type: 'string' } }
      },
      required: ['asientoIds']
    }
  },
  {
    name: 'generarEstadosFinancieros',
    description:
      'Genera estado de situación financiera y/o resultados del período, ' +
      'mapeado al formato Supercias. Valida la ecuación contable y devuelve ' +
      'semáforo de 3 estados. Vista de gestión interna (no oficial).',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: 'YYYY-MM o YYYY' },
        tipo: { type: 'string', enum: ['situacion', 'resultados', 'ambos'] }
      },
      required: ['periodo', 'tipo']
    }
  },
  {
    name: 'verificarPreCierre',
    description:
      'Revisa condiciones de cierre mensual: comprobantes sin contabilizar, ' +
      'asientos descuadrados, cuentas transitorias con saldo. Devuelve lista ' +
      'de pendientes o visto bueno.',
    input_schema: {
      type: 'object',
      properties: { periodo: { type: 'string', description: 'YYYY-MM' } },
      required: ['periodo']
    }
  },
  {
    name: 'ejecutarCierreMensual',
    description:
      'Ejecuta el pre-cierre del mes (estado "pre-cerrado, pendiente de firma ' +
      'de contador"). Requiere verificarPreCierre limpio. El cierre definitivo ' +
      'lo firma el contador desde el panel interno.',
    input_schema: {
      type: 'object',
      properties: { periodo: { type: 'string', description: 'YYYY-MM' } },
      required: ['periodo']
    }
  },
  {
    name: 'estimarImpuestoRenta',
    description:
      'Estima el impuesto a la renta del ejercicio aplicando el régimen del ' +
      'tenant (General 25% / RIMPE Emprendedor progresivo / RIMPE Negocio ' +
      'Popular cuota fija). Es proyección, no declaración.',
    input_schema: {
      type: 'object',
      properties: { anio: { type: 'integer' } },
      required: ['anio']
    }
  },
  {
    name: 'escalarManual',
    description:
      'Crea ticket de revisión para contador. Solo con semáforo amarillo y ' +
      'confirmación explícita del usuario.',
    input_schema: {
      type: 'object',
      properties: {
        motivo: { type: 'string' },
        urgencia: { type: 'string', enum: ['alta', 'media', 'baja'] },
        contexto: { type: 'object' }
      },
      required: ['motivo', 'urgencia']
    }
  }
];

// ── AGENTE DE MERCADO ──────────────────────────────────────────
export const TOOLS_MERCADO = [
  {
    name: 'consultarSupercias',
    description:
      'Consulta balances públicos de la Superintendencia de Compañías: ' +
      'empresas por sector CIIU o por nombre, ventas, utilidad, márgenes, ' +
      'ranking sectorial. Todo dato incluye { valor, fuente, fechaCorte }.',
    input_schema: {
      type: 'object',
      properties: {
        sector: { type: 'string', description: 'Código CIIU o descripción del sector' },
        region: { type: 'string', description: 'Provincia o cantón (opcional)' },
        nombreEmpresa: { type: 'string', description: 'Búsqueda por razón social (opcional)' }
      },
      required: []
    }
  },
  {
    name: 'consultarINEC',
    description:
      'Datos demográficos del INEC (censo 2022 + proyecciones): población, ' +
      'densidad, estructura etaria, nivel socioeconómico por cantón/parroquia.',
    input_schema: {
      type: 'object',
      properties: {
        canton: { type: 'string' },
        parroquia: { type: 'string', description: 'Opcional, para mayor granularidad' }
      },
      required: ['canton']
    }
  },
  {
    name: 'consultarAduanas',
    description:
      'Importaciones del Ecuador por subpartida arancelaria: volúmenes (kg/unidades) ' +
      'y valores CIF por período. Útil para productos importados.',
    input_schema: {
      type: 'object',
      properties: {
        subpartida: { type: 'string', description: 'Subpartida arancelaria (6-10 dígitos)' },
        periodo: { type: 'string', description: 'YYYY o YYYY-MM' }
      },
      required: ['subpartida']
    }
  },
  {
    name: 'obtenerTendencias',
    description:
      'Google Trends para Ecuador (caché 7 días): índice de interés de ' +
      'búsqueda 0-100 (relativo, no unidades) últimos 12 meses por keyword.',
    input_schema: {
      type: 'object',
      properties: {
        keywords: { type: 'array', items: { type: 'string' }, description: '2-4 variantes' },
        region: { type: 'string', description: "Default 'EC'. Puede ser 'EC-P' (provincia)" }
      },
      required: ['keywords']
    }
  },
  {
    name: 'detectarCompetencia',
    description:
      'Competidores físicos en una zona vía Google Places (caché 30 días por ' +
      'coordenadas redondeadas): cantidad, rating promedio, densidad.',
    input_schema: {
      type: 'object',
      properties: {
        lat: { type: 'number' },
        lng: { type: 'number' },
        categoria: { type: 'string', description: 'Tipo de negocio (ej: ferretería)' },
        radioMetros: { type: 'integer', description: 'Default 2000' }
      },
      required: ['lat', 'lng', 'categoria']
    }
  },
  {
    name: 'calcularScoreOportunidad',
    description:
      'Calcula el score de oportunidad 0-100 con 4 componentes ponderados ' +
      '(demanda, competencia, poder adquisitivo, tendencia). Cálculo ' +
      'determinista en backend — el agente nunca calcula el score.',
    input_schema: {
      type: 'object',
      properties: {
        datosINEC: { type: 'object' },
        datosCompetencia: { type: 'object' },
        datosTendencias: { type: 'object' },
        datosSupercias: { type: 'object' }
      },
      required: ['datosINEC', 'datosCompetencia']
    }
  },
  {
    name: 'generarEstudioPDF',
    description:
      'Genera el PDF del estudio de mercado (7 secciones, brand Kallpa, ' +
      'fuentes citadas al pie). Requiere un estudio completado en la sesión.',
    input_schema: {
      type: 'object',
      properties: {
        estudioId: { type: 'string', description: 'ID del estudio generado en la sesión' }
      },
      required: ['estudioId']
    }
  }
];
