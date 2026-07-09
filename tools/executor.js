/**
 * KALLPA AI — Tool Executor
 * ==========================
 * Dispatch central: recibe el tool_use del agente y lo enruta al módulo
 * backend correspondiente. Cada handler recibe (input, tenant) y devuelve
 * un objeto serializable que se retorna como tool_result.
 *
 * Mapeo a módulos existentes:
 *   f104-borrador.js       → generarBorradorF104
 *   contabilidad-db.js     → motor contable (asientos, estados, cierre)
 *   supercias-estados.js   → estados financieros formato Supercias
 *   estudio-mercado.js     → estudio 7 secciones + PDF
 *   market_service.py :8002 → /trends /competencia /oportunidad
 *   sri_ws.py :8001        → comprobantes (vía tablas ya pobladas)
 *   semaforo.js            → reglas deterministas (5 rojas, 3 amarillas)
 *   Supabase               → tickets HITL
 */

import crypto from 'node:crypto';
import { generarF104 } from '../f104-borrador.js';
import * as contab from '../contabilidad-db.js';
import { generarEstudio, generarPDF } from '../estudio-mercado.js';
import { evaluarSemaforo } from '../semaforo.js';
import { evaluarSemaforoCobro, diasVencido } from '../semaforo-cobros.js';
import { enviarMensaje } from '../mensajeria.js';
import { crearTicket } from '../db/tickets.js';
import { getDB } from '../db/tenants.js';
import * as crm from '../db/crm.js';

const MARKET_API = process.env.MARKET_API_URL || 'http://localhost:8002';

// Plantilla determinista por nivel de semáforo, usada solo por la campaña
// automática (ejecutarCampanaRecordatorios). El envío conversacional
// (enviarRecordatorio) usa el texto que redacta el propio agente.
function plantillaRecordatorio(f) {
  const base = `Hola ${f.nombre}, te recordamos que la factura ${f.numero || f.facturaId} ` +
    `por $${f.saldoPendiente} venció el ${f.fechaVencimiento} (${f.diasVencido} días de atraso).`;
  if (f.semaforo === 'verde') return `${base} Cualquier consulta, escríbenos.`;
  if (f.semaforo === 'amarillo') return `${base} Si necesitas un plan de pago, contáctanos para acordarlo.`;
  return `${base} Este caso ha sido remitido a nuestro equipo de cobranza.`;
}

// ── Handlers ───────────────────────────────────────────────────

const handlers = {

  // ═══ TRIBUTARIO ═══

  async obtenerComprobantesPeriodo({ periodo, tipo = 'todos' }, tenant) {
    const db = getDB(tenant.ruc);
    const filtro = tipo === 'todos' ? '' : `AND direccion = '${tipo === 'emitidos' ? 'E' : 'R'}'`;
    const rows = db.prepare(`
      SELECT clave_acceso, tipo_comprobante, direccion, ruc_contraparte,
             razon_social, fecha_emision, subtotal, iva, total, estado_sri
      FROM comprobantes
      WHERE periodo = ? ${filtro}
      ORDER BY fecha_emision DESC
    `).all(periodo);

    const agregados = rows.reduce((acc, r) => {
      const key = r.direccion === 'E' ? 'emitidos' : 'recibidos';
      acc[key].cantidad++;
      acc[key].subtotal += r.subtotal;
      acc[key].iva += r.iva;
      acc[key].total += r.total;
      return acc;
    }, {
      emitidos: { cantidad: 0, subtotal: 0, iva: 0, total: 0 },
      recibidos: { cantidad: 0, subtotal: 0, iva: 0, total: 0 }
    });

    return { periodo, agregados, comprobantes: rows.slice(0, 100) };
  },

  async obtenerDetalleComprobante({ claveAcceso }, tenant) {
    const db = getDB(tenant.ruc);
    const cab = db.prepare(
      'SELECT * FROM comprobantes WHERE clave_acceso = ?'
    ).get(claveAcceso);
    if (!cab) return { error: 'Comprobante no encontrado', claveAcceso };
    const detalles = db.prepare(
      'SELECT * FROM comprobante_detalles WHERE clave_acceso = ?'
    ).all(claveAcceso);
    return { cabecera: cab, detalles };
  },

  async generarBorradorF104({ periodo }, tenant) {
    // Cálculo determinista casillero por casillero (f104-borrador.js)
    const borrador = await generarF104(tenant.ruc, periodo);
    // El semáforo se evalúa en backend; rojo escala automático aquí,
    // NUNCA por decisión del agente.
    const semaforo = evaluarSemaforo(borrador, tenant);
    if (semaforo.estado === 'rojo') {
      await crearTicket({
        ruc: tenant.ruc,
        tipo: 'f104_revision',
        origen: 'escalacion_automatica',
        urgencia: 'alta',
        motivo: semaforo.reglas.join('; '),
        payload: { periodo, borradorId: borrador.id }
      });
    }
    return {
      borradorId: borrador.id,
      periodo,
      casilleros: borrador.resumen, // resumen, no los ~100 casilleros crudos
      valorAPagar: borrador.valorAPagar,
      saldoAFavor: borrador.saldoAFavor,
      semaforo: { estado: semaforo.estado, detalles: semaforo.reglas },
      verificado: borrador.casillerosVerificados, // CASILLEROS_VERIFICADOS flag
      nota: borrador.casillerosVerificados
        ? null
        : 'Mapeo de casilleros pendiente de validación por contador (marca de agua activa)'
    };
  },

  async calcularRetenciones({ periodo, tipo }, tenant) {
    const db = getDB(tenant.ruc);
    const res = {};
    if (tipo === 'recibidas' || tipo === 'ambas') {
      res.recibidas = db.prepare(`
        SELECT COUNT(*) cantidad, SUM(valor_retenido_iva) iva,
               SUM(valor_retenido_renta) renta
        FROM retenciones WHERE periodo = ? AND direccion = 'R'
      `).get(periodo);
    }
    if (tipo === 'efectuadas' || tipo === 'ambas') {
      res.efectuadas = db.prepare(`
        SELECT COUNT(*) cantidad, SUM(valor_retenido_iva) iva,
               SUM(valor_retenido_renta) renta
        FROM retenciones WHERE periodo = ? AND direccion = 'E'
      `).get(periodo);
    }
    return { periodo, ...res };
  },

  async obtenerCalendarioTributario(_input, tenant) {
    const digito9 = parseInt(tenant.ruc.charAt(8), 10);
    // Tabla SRI: fecha de vencimiento IVA según 9no dígito
    const diasIVA = { 1: 10, 2: 12, 3: 14, 4: 16, 5: 18, 6: 20, 7: 22, 8: 24, 9: 26, 0: 28 };
    const dia = diasIVA[digito9];
    const hoy = new Date();
    const obligaciones = [];

    for (let i = 0; i < 3; i++) {
      const mes = new Date(hoy.getFullYear(), hoy.getMonth() + i, dia);
      if (mes > hoy) {
        obligaciones.push({
          obligacion: 'Declaración IVA (F104)',
          periodoDeclarado: `${mes.getFullYear()}-${String(mes.getMonth()).padStart(2, '0') || '12'}`,
          fechaLimite: mes.toISOString().slice(0, 10),
          regimen: tenant.regimen
        });
      }
    }
    return { ruc: tenant.ruc, novenoDigito: digito9, diaVencimiento: dia, obligaciones };
  },

  // ═══ CONTABLE ═══

  async obtenerComprobantesSinContabilizar({ limite = 50 }, tenant) {
    return contab.pendientesDeAsiento(tenant.ruc, limite);
  },

  async proponerAsientos({ claveAccesoArray }, tenant) {
    return contab.proponerAsientosDesdeComprobantes(tenant.ruc, claveAccesoArray);
  },

  async proponerAsientoManual({ descripcion, fecha, lineas }, tenant) {
    return contab.proponerAsientoManual(tenant.ruc, { descripcion, fecha, lineas });
  },

  async registrarAsientos({ asientoIds }, tenant) {
    const resultado = await contab.registrarAsientos(tenant.ruc, asientoIds);
    // Verificación post-registro: balance de comprobación debe cuadrar
    if (!resultado.balanceCuadra) {
      await crearTicket({
        ruc: tenant.ruc,
        tipo: 'contabilidad_descuadre',
        origen: 'escalacion_automatica',
        urgencia: 'alta',
        motivo: `Balance de comprobación descuadrado tras registro: diferencia $${resultado.diferencia}`,
        payload: { asientoIds }
      });
    }
    return resultado;
  },

  async generarEstadosFinancieros({ periodo, tipo }, tenant) {
    const estados = await contab.generarEstados(tenant.ruc, periodo, tipo);
    if (estados.semaforo === 'rojo') {
      await crearTicket({
        ruc: tenant.ruc,
        tipo: 'estados_ecuacion',
        origen: 'escalacion_automatica',
        urgencia: 'alta',
        motivo: 'Ecuación contable no cuadra en estados financieros',
        payload: { periodo, diferencia: estados.diferencia }
      });
    }
    return estados;
  },

  async verificarPreCierre({ periodo }, tenant) {
    return contab.verificarPreCierre(tenant.ruc, periodo);
  },

  async ejecutarCierreMensual({ periodo }, tenant) {
    const pre = await contab.verificarPreCierre(tenant.ruc, periodo);
    if (!pre.listo) {
      return { error: 'Pre-cierre con pendientes', pendientes: pre.pendientes };
    }
    const cierre = await contab.preCerrarMes(tenant.ruc, periodo);
    // El cierre firmado lo ejecuta el contador desde el panel interno
    await crearTicket({
      ruc: tenant.ruc,
      tipo: 'cierre_mensual_firma',
      origen: 'flujo_normal',
      urgencia: 'media',
      motivo: `Cierre ${periodo} pre-cerrado, pendiente de firma de contador`,
      payload: { periodo, cierreId: cierre.id }
    });
    return { ...cierre, estado: 'pre-cerrado, pendiente de firma' };
  },

  async estimarImpuestoRenta({ anio }, tenant) {
    // El backend aplica el régimen del tenant automáticamente:
    // General 25% / RIMPE Emprendedor progresivo / Negocio Popular cuota fija
    return contab.estimarRenta(tenant.ruc, anio, tenant.regimen);
  },

  // ═══ MERCADO ═══

  async consultarSupercias({ sector, region, nombreEmpresa }, _tenant) {
    // ETL ya cargado en Supabase (etl_supercias.py). Consulta directa.
    const params = new URLSearchParams();
    if (sector) params.set('sector', sector);
    if (region) params.set('region', region);
    if (nombreEmpresa) params.set('empresa', nombreEmpresa);
    const r = await fetch(`${MARKET_API}/supercias?${params}`);
    return r.json(); // cada dato viene con { valor, fuente, fechaCorte }
  },

  async consultarINEC({ canton, parroquia }, _tenant) {
    const params = new URLSearchParams({ canton });
    if (parroquia) params.set('parroquia', parroquia);
    const r = await fetch(`${MARKET_API}/inec?${params}`);
    return r.json();
  },

  async consultarAduanas({ subpartida, periodo }, _tenant) {
    const params = new URLSearchParams({ subpartida });
    if (periodo) params.set('periodo', periodo);
    const r = await fetch(`${MARKET_API}/aduanas?${params}`);
    return r.json();
  },

  async obtenerTendencias({ keywords, region = 'EC' }, _tenant) {
    // market_service.py /trends — pytrends con caché Postgres 7 días
    const r = await fetch(`${MARKET_API}/trends`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords, region })
    });
    return r.json();
  },

  async detectarCompetencia({ lat, lng, categoria, radioMetros = 2000 }, _tenant) {
    // market_service.py /competencia — Google Places, caché 30 días
    const r = await fetch(`${MARKET_API}/competencia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, categoria, radio: radioMetros })
    });
    return r.json();
  },

  async calcularScoreOportunidad(datos, _tenant) {
    // market_service.py /oportunidad — score 0-100, 4 componentes ponderados
    const r = await fetch(`${MARKET_API}/oportunidad`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos)
    });
    return r.json();
  },

  async generarEstudioPDF({ estudioId }, tenant) {
    // estudio-mercado.js — 7 secciones, disciplina de fuentes obligatoria
    const pdf = await generarPDF(tenant.ruc, estudioId);
    return { url: pdf.url, paginas: pdf.paginas, fuentesCitadas: pdf.fuentes };
  },

  // ═══ COBROS ═══

  async listarClientesMorosos({ diasMinimo = 1 }, tenant) {
    const db = getDB(tenant.ruc);
    const rows = db.prepare(`
      SELECT f.id AS factura_id, f.numero, f.monto, f.saldo_pendiente,
             f.fecha_vencimiento, c.id AS cliente_id, c.nombre,
             c.email, c.telefono, c.canal_preferido
      FROM facturas f
      JOIN clientes c ON c.id = f.cliente_id
      WHERE f.estado = 'pendiente'
      ORDER BY f.fecha_vencimiento ASC
    `).all();

    const vencidas = rows
      .map((r) => ({ ...r, dias: diasVencido(r.fecha_vencimiento) }))
      .filter((r) => r.dias >= diasMinimo)
      .map((r) => ({
        clienteId: r.cliente_id,
        nombre: r.nombre,
        facturaId: r.factura_id,
        numero: r.numero,
        saldoPendiente: r.saldo_pendiente,
        fechaVencimiento: r.fecha_vencimiento,
        diasVencido: r.dias,
        semaforo: evaluarSemaforoCobro(r.dias).estado,
        canalPreferido: r.canal_preferido,
        contacto: r.canal_preferido === 'email' ? r.email : r.telefono
      }));

    const totalAdeudado = vencidas.reduce((sum, v) => sum + v.saldoPendiente, 0);
    return { totalClientes: new Set(vencidas.map((v) => v.clienteId)).size, totalAdeudado, facturas: vencidas };
  },

  async obtenerDetalleCliente({ clienteId }, tenant) {
    const detalle = crm.obtenerCliente(tenant.ruc, clienteId);
    if (!detalle) return { error: 'Cliente no encontrado', clienteId };
    const { facturas, gestiones, ...cliente } = detalle;
    return { cliente, facturas, gestiones };
  },

  async crearCliente(datos, tenant) {
    try {
      return { cliente: crm.crearCliente(tenant.ruc, datos) };
    } catch (err) {
      return { error: err.message };
    }
  },

  async registrarFactura({ clienteId, numero, monto, fechaEmision, fechaVencimiento }, tenant) {
    try {
      return { factura: crm.crearFactura(tenant.ruc, clienteId, { numero, monto, fechaEmision, fechaVencimiento }) };
    } catch (err) {
      return { error: err.message };
    }
  },

  async enviarRecordatorio({ clienteId, facturaId, canal, mensaje }, tenant) {
    const db = getDB(tenant.ruc);
    const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(clienteId);
    if (!cliente) return { error: 'Cliente no encontrado', clienteId };

    const destinatario = canal === 'email' ? cliente.email : cliente.telefono;
    const resultado = await enviarMensaje({
      canal,
      destinatario,
      asunto: canal === 'email' ? 'Recordatorio de pago pendiente' : undefined,
      cuerpo: mensaje
    });

    const id = `ges_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO gestiones_cobro (id, cliente_id, factura_id, canal, tipo, mensaje, destino, estado_envio)
      VALUES (?, ?, ?, ?, 'recordatorio', ?, ?, ?)
    `).run(id, clienteId, facturaId || null, canal, mensaje, destinatario || null, resultado.estado);

    return { gestionId: id, ...resultado };
  },

  async ejecutarCampanaRecordatorios({ diasMinimo = 1, canal }, tenant) {
    const db = getDB(tenant.ruc);
    const { facturas } = await handlers.listarClientesMorosos({ diasMinimo }, tenant);

    const resumen = { enviados: 0, fallidos: 0, escalados: 0, detalle: [] };

    for (const f of facturas) {
      const canalUsado = canal || f.canalPreferido;
      const plantilla = plantillaRecordatorio(f);

      const envio = await handlers.enviarRecordatorio(
        { clienteId: f.clienteId, facturaId: f.facturaId, canal: canalUsado, mensaje: plantilla },
        tenant
      );

      if (envio.estado === 'simulado' || envio.estado === 'enviado') {
        resumen.enviados++;
      } else {
        resumen.fallidos++;
      }
      resumen.detalle.push({ clienteId: f.clienteId, facturaId: f.facturaId, semaforo: f.semaforo, resultado: envio.estado });

      // Escalación automática: NUNCA decidida por el agente (mismo patrón que F104/estados).
      if (f.semaforo === 'rojo') {
        await crearTicket({
          ruc: tenant.ruc,
          tipo: 'cobranza_legal',
          origen: 'escalacion_automatica',
          urgencia: 'alta',
          motivo: `Factura ${f.numero || f.facturaId} vencida hace ${f.diasVencido} días ($${f.saldoPendiente})`,
          payload: { clienteId: f.clienteId, facturaId: f.facturaId }
        });
        resumen.escalados++;
      }
    }

    return resumen;
  },

  async registrarPago({ facturaId, monto, fecha }, tenant) {
    const db = getDB(tenant.ruc);
    const factura = db.prepare('SELECT * FROM facturas WHERE id = ?').get(facturaId);
    if (!factura) return { error: 'Factura no encontrada', facturaId };

    const nuevoSaldo = Math.max(0, Number((factura.saldo_pendiente - monto).toFixed(2)));
    const nuevoEstado = nuevoSaldo === 0 ? 'pagada' : 'pendiente';
    db.prepare('UPDATE facturas SET saldo_pendiente = ?, estado = ? WHERE id = ?')
      .run(nuevoSaldo, nuevoEstado, facturaId);

    return { facturaId, montoAplicado: monto, saldoPendiente: nuevoSaldo, estado: nuevoEstado, fecha: fecha || null };
  },

  async escalarGestionCobranza({ motivo, urgencia, contexto = {} }, tenant) {
    const ticket = await crearTicket({
      ruc: tenant.ruc,
      tipo: 'cobranza_solicitada',
      origen: 'escalacion_manual_agente',
      urgencia,
      motivo,
      payload: contexto
    });
    return {
      ticketId: ticket.id,
      estado: 'creado',
      mensaje: `Un profesional de cobranza Kallpa revisará el caso (urgencia ${urgencia}).`
    };
  },

  // ═══ COMÚN — HITL ═══

  async escalarManual({ motivo, urgencia, contexto = {} }, tenant) {
    // Único mecanismo de escalación expuesto al agente.
    // Requiere: semáforo amarillo + confirmación explícita del usuario
    // (esa condición se instruye en el prompt; el ticket registra origen).
    const ticket = await crearTicket({
      ruc: tenant.ruc,
      tipo: 'revision_solicitada',
      origen: 'escalacion_manual_agente',
      urgencia,
      motivo,
      payload: contexto
    });
    return {
      ticketId: ticket.id,
      estado: 'creado',
      mensaje: `Un profesional Kallpa revisará el caso (urgencia ${urgencia}).`
    };
  }
};

// ── Dispatch ───────────────────────────────────────────────────

export async function ejecutarTool(nombre, input, tenant) {
  const handler = handlers[nombre];
  if (!handler) {
    return { error: `Tool desconocida: ${nombre}` };
  }
  try {
    return await handler(input, tenant);
  } catch (err) {
    console.error(`[toolExecutor] ${nombre} falló:`, err);
    return {
      error: `La operación ${nombre} falló`,
      detalle: err.message,
      accion: 'Informa al usuario y sugiere reintentar o escalar si persiste'
    };
  }
}
