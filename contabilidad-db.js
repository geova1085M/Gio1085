/**
 * KALLPA AI — Motor contable de doble partida (stub funcional)
 * ================================================================
 * Implementa el subconjunto de operaciones que usa el agente Contable vía
 * tools/executor.js, sobre el plan de cuentas simplificado sembrado en
 * db/tenants.js (SCHEMA_TENANT). No reemplaza un motor NIIF PYMES
 * certificado: es suficiente para levantar el sistema end-to-end y
 * verificar los flujos de contabilización, estados y cierre.
 */

import crypto from 'node:crypto';
import { getDB } from './db/tenants.js';

const CUENTAS_COMPRA = { debitoGasto: '5.1.2', debitoIva: '1.1.4', credito: '2.1.1' };
const CUENTAS_VENTA = { debitoCxc: '1.1.2', creditoIngreso: '4.1.1', creditoIva: '2.1.2' };

function nuevoId(prefijo) {
  return `${prefijo}_${crypto.randomUUID().slice(0, 10)}`;
}

function sumaLineas(lineas) {
  return lineas.reduce(
    (acc, l) => ({
      debito: acc.debito + (l.debito || 0),
      credito: acc.credito + (l.credito || 0)
    }),
    { debito: 0, credito: 0 }
  );
}

function insertarAsientoBorrador(db, { descripcion, fecha, origen, origenRef, lineas }) {
  const id = nuevoId('as');
  db.prepare(`
    INSERT INTO asientos (id, fecha, descripcion, estado, origen, origen_ref)
    VALUES (?, ?, ?, 'borrador', ?, ?)
  `).run(id, fecha, descripcion, origen, origenRef || null);

  const insertLinea = db.prepare(`
    INSERT INTO asiento_lineas (asiento_id, cuenta, debito, credito) VALUES (?, ?, ?, ?)
  `);
  for (const l of lineas) {
    insertLinea.run(id, l.cuenta, l.debito || 0, l.credito || 0);
  }

  return { id, fecha, descripcion, estado: 'borrador', origen, lineas };
}

// ── Flujo 1: contabilización automática desde comprobantes ─────

export function pendientesDeAsiento(ruc, limite = 50) {
  const db = getDB(ruc);
  return db.prepare(`
    SELECT clave_acceso, tipo_comprobante, direccion, razon_social, fecha_emision, total
    FROM comprobantes
    WHERE contabilizado = 0
    ORDER BY fecha_emision ASC
    LIMIT ?
  `).all(limite);
}

export function proponerAsientosDesdeComprobantes(ruc, claveAccesoArray) {
  const db = getDB(ruc);
  const propuestos = [];

  for (const clave of claveAccesoArray) {
    const cmp = db.prepare('SELECT * FROM comprobantes WHERE clave_acceso = ?').get(clave);
    if (!cmp) {
      propuestos.push({ error: 'Comprobante no encontrado', claveAcceso: clave });
      continue;
    }

    let lineas;
    if (cmp.direccion === 'R') {
      // Compra: débito gasto + débito IVA crédito tributario, crédito proveedores
      lineas = [
        { cuenta: CUENTAS_COMPRA.debitoGasto, debito: cmp.subtotal, credito: 0 },
        { cuenta: CUENTAS_COMPRA.debitoIva, debito: cmp.iva, credito: 0 },
        { cuenta: CUENTAS_COMPRA.credito, debito: 0, credito: cmp.total }
      ];
    } else {
      // Venta: débito cuentas por cobrar, crédito ingreso + IVA por pagar
      lineas = [
        { cuenta: CUENTAS_VENTA.debitoCxc, debito: cmp.total, credito: 0 },
        { cuenta: CUENTAS_VENTA.creditoIngreso, debito: 0, credito: cmp.subtotal },
        { cuenta: CUENTAS_VENTA.creditoIva, debito: 0, credito: cmp.iva }
      ];
    }

    const asiento = insertarAsientoBorrador(db, {
      descripcion: `${cmp.direccion === 'R' ? 'Compra' : 'Venta'} — ${cmp.razon_social || cmp.ruc_contraparte}`,
      fecha: cmp.fecha_emision,
      origen: 'comprobante',
      origenRef: clave,
      lineas
    });
    propuestos.push(asiento);
  }

  return { propuestos };
}

// ── Flujo 2: asientos manuales ──────────────────────────────────

export function proponerAsientoManual(ruc, { descripcion, fecha, lineas }) {
  const db = getDB(ruc);

  const cuentasValidas = new Set(
    db.prepare('SELECT codigo FROM plan_cuentas').all().map((r) => r.codigo)
  );
  const invalidas = lineas.filter((l) => !cuentasValidas.has(l.cuenta));
  if (invalidas.length > 0) {
    return {
      error: 'Cuentas inválidas',
      cuentas: invalidas.map((l) => l.cuenta)
    };
  }

  const { debito, credito } = sumaLineas(lineas);
  if (Number(debito.toFixed(2)) !== Number(credito.toFixed(2))) {
    return {
      error: 'El asiento no cuadra: débitos ≠ créditos',
      totalDebito: debito,
      totalCredito: credito
    };
  }

  return insertarAsientoBorrador(db, { descripcion, fecha, origen: 'manual', lineas });
}

// ── Registro en firme ────────────────────────────────────────────

export function registrarAsientos(ruc, asientoIds) {
  const db = getDB(ruc);

  const registrar = db.transaction((ids) => {
    for (const id of ids) {
      const asiento = db.prepare('SELECT * FROM asientos WHERE id = ?').get(id);
      if (!asiento || asiento.estado !== 'borrador') continue;

      db.prepare(`UPDATE asientos SET estado = 'registrado' WHERE id = ?`).run(id);
      if (asiento.origen === 'comprobante' && asiento.origen_ref) {
        db.prepare(`UPDATE comprobantes SET contabilizado = 1 WHERE clave_acceso = ?`).run(asiento.origen_ref);
      }
    }
  });
  registrar(asientoIds);

  const totales = db.prepare(`
    SELECT COALESCE(SUM(debito), 0) debito, COALESCE(SUM(credito), 0) credito
    FROM asiento_lineas al
    JOIN asientos a ON a.id = al.asiento_id
    WHERE a.estado = 'registrado'
  `).get();

  const diferencia = Number((totales.debito - totales.credito).toFixed(2));

  return {
    asientosRegistrados: asientoIds,
    balanceCuadra: Math.abs(diferencia) < 0.01,
    diferencia
  };
}

// ── Flujo 3: estados financieros ─────────────────────────────────

export function generarEstados(ruc, periodo, tipo) {
  const db = getDB(ruc);

  // Balance de situación: acumulado de todo lo registrado hasta el fin del
  // período (una foto en el tiempo), no solo los movimientos del período.
  const acumulado = db.prepare(`
    SELECT pc.tipo, COALESCE(SUM(al.debito), 0) debito, COALESCE(SUM(al.credito), 0) credito
    FROM asiento_lineas al
    JOIN asientos a ON a.id = al.asiento_id
    JOIN plan_cuentas pc ON pc.codigo = al.cuenta
    WHERE a.estado = 'registrado' AND a.fecha <= ? AND pc.tipo IN ('activo', 'pasivo', 'patrimonio')
    GROUP BY pc.tipo
  `).all(`${periodo}-32`);

  // Estado de resultados: solo movimientos dentro del período indicado.
  const delPeriodo = db.prepare(`
    SELECT pc.tipo, COALESCE(SUM(al.debito), 0) debito, COALESCE(SUM(al.credito), 0) credito
    FROM asiento_lineas al
    JOIN asientos a ON a.id = al.asiento_id
    JOIN plan_cuentas pc ON pc.codigo = al.cuenta
    WHERE a.estado = 'registrado' AND a.fecha LIKE ? AND pc.tipo IN ('ingreso', 'gasto')
    GROUP BY pc.tipo
  `).all(`${periodo}%`);

  const totales = { activo: 0, pasivo: 0, patrimonio: 0, ingreso: 0, gasto: 0 };
  for (const s of acumulado) {
    totales[s.tipo] += s.tipo === 'activo' ? s.debito - s.credito : s.credito - s.debito;
  }
  for (const s of delPeriodo) {
    totales[s.tipo] += s.tipo === 'gasto' ? s.debito - s.credito : s.credito - s.debito;
  }

  // Utilidad del ejercicio aún no cerrada a patrimonio: la ecuación
  // contable extendida es Activo = Pasivo + Patrimonio + Utilidad.
  const utilidadEjercicio = Number((totales.ingreso - totales.gasto).toFixed(2));
  const resultado = {};

  if (tipo === 'situacion' || tipo === 'ambos') {
    const patrimonioTotal = Number((totales.patrimonio + utilidadEjercicio).toFixed(2));
    const diferencia = Number((totales.activo - (totales.pasivo + patrimonioTotal)).toFixed(2));
    resultado.situacion = {
      activos: Number(totales.activo.toFixed(2)),
      pasivos: Number(totales.pasivo.toFixed(2)),
      patrimonio: patrimonioTotal,
      diferencia
    };
  }

  if (tipo === 'resultados' || tipo === 'ambos') {
    resultado.resultados = {
      ingresos: Number(totales.ingreso.toFixed(2)),
      gastos: Number(totales.gasto.toFixed(2)),
      utilidad: utilidadEjercicio
    };
  }

  const diferenciaEcuacion = resultado.situacion ? resultado.situacion.diferencia : 0;
  resultado.semaforo = Math.abs(diferenciaEcuacion) < 0.01 ? 'verde' : 'rojo';
  resultado.diferencia = diferenciaEcuacion;
  resultado.periodo = periodo;

  return resultado;
}

// ── Flujo 4: cierre mensual ──────────────────────────────────────

export function verificarPreCierre(ruc, periodo) {
  const db = getDB(ruc);
  const pendientes = [];

  const sinContabilizar = db.prepare(`
    SELECT COUNT(*) n FROM comprobantes WHERE periodo = ? AND contabilizado = 0
  `).get(periodo).n;
  if (sinContabilizar > 0) {
    pendientes.push(`${sinContabilizar} comprobante(s) sin contabilizar.`);
  }

  const descuadrados = db.prepare(`
    SELECT a.id,
           COALESCE(SUM(al.debito), 0) total_debito,
           COALESCE(SUM(al.credito), 0) total_credito
    FROM asientos a
    JOIN asiento_lineas al ON al.asiento_id = a.id
    WHERE a.fecha LIKE ?
    GROUP BY a.id
    HAVING ABS(total_debito - total_credito) > 0.01
  `).all(`${periodo}%`);
  if (descuadrados.length > 0) {
    pendientes.push(`${descuadrados.length} asiento(s) descuadrado(s).`);
  }

  return { periodo, listo: pendientes.length === 0, pendientes };
}

export function preCerrarMes(ruc, periodo) {
  const db = getDB(ruc);
  const id = nuevoId('cierre');
  db.prepare(`
    INSERT INTO cierres (id, periodo, estado) VALUES (?, ?, 'pre-cerrado, pendiente de firma')
  `).run(id, periodo);
  return { id, periodo };
}

// ── Flujo 5: estimación de impuesto a la renta ───────────────────

const TRAMOS_RIMPE_EMPRENDEDOR = [
  { hasta: 20000, tarifa: 0 },
  { hasta: 50000, tarifa: 0.01 },
  { hasta: 100000, tarifa: 0.015 },
  { hasta: 300000, tarifa: 0.02 }
];

function calcularRimpeEmprendedor(ingresos) {
  for (const tramo of TRAMOS_RIMPE_EMPRENDEDOR) {
    if (ingresos <= tramo.hasta) return Number((ingresos * tramo.tarifa).toFixed(2));
  }
  return Number((ingresos * 0.02).toFixed(2));
}

export function estimarRenta(ruc, anio, regimen) {
  const db = getDB(ruc);

  const saldos = db.prepare(`
    SELECT pc.tipo, COALESCE(SUM(al.debito), 0) debito, COALESCE(SUM(al.credito), 0) credito
    FROM asiento_lineas al
    JOIN asientos a ON a.id = al.asiento_id
    JOIN plan_cuentas pc ON pc.codigo = al.cuenta
    WHERE a.estado = 'registrado' AND a.fecha LIKE ? AND pc.tipo IN ('ingreso', 'gasto')
    GROUP BY pc.tipo
  `).all(`${anio}%`);

  const totales = { ingreso: 0, gasto: 0 };
  for (const s of saldos) {
    totales[s.tipo] += s.tipo === 'ingreso' ? s.credito - s.debito : s.debito - s.credito;
  }

  const ingresos = Number(totales.ingreso.toFixed(2));
  const gastos = Number(totales.gasto.toFixed(2));
  const utilidad = Number((ingresos - gastos).toFixed(2));

  let impuestoEstimado;
  let detalle;

  if (regimen === 'rimpe_negocio_popular') {
    impuestoEstimado = 60; // cuota fija anual simplificada de demostración
    detalle = 'RIMPE Negocio Popular: cuota fija anual (valor de demostración).';
  } else if (regimen === 'rimpe_emprendedor') {
    impuestoEstimado = calcularRimpeEmprendedor(ingresos);
    detalle = 'RIMPE Emprendedor: tabla progresiva sobre ingresos brutos.';
  } else {
    impuestoEstimado = Number((Math.max(utilidad, 0) * 0.25).toFixed(2));
    detalle = 'Régimen General: 25% sobre utilidad gravable.';
  }

  return { anio, regimen, ingresos, gastos, utilidad, impuestoEstimado, detalle };
}
