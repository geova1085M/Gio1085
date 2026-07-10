/**
 * KALLPA AI — CRM de clientes del agente de Cobros
 * ====================================================
 * CRUD determinista sobre las tablas clientes/facturas/gestiones_cobro
 * (definidas en db/tenants.js). Único punto de escritura para altas,
 * ediciones y bajas de la cartera — lo usan tanto routes/crm-routes.js
 * (API REST) como tools/executor.js (el agente conversacional), para que
 * el comportamiento sea idéntico sea que lo dispare un formulario o el chat.
 */

import crypto from 'node:crypto';
import { getDB } from './tenants.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CANALES_VALIDOS = ['email', 'whatsapp', 'sms'];

function validarDatosCliente({ email, telefono, canalPreferido }) {
  if (email && !EMAIL_RE.test(email)) {
    throw new Error(`Email inválido: ${email}`);
  }
  if (canalPreferido && !CANALES_VALIDOS.includes(canalPreferido)) {
    throw new Error(`canalPreferido debe ser uno de: ${CANALES_VALIDOS.join(', ')}`);
  }
  if (canalPreferido === 'email' && !email) {
    throw new Error('canalPreferido=email requiere un email');
  }
  if ((canalPreferido === 'whatsapp' || canalPreferido === 'sms') && !telefono) {
    throw new Error(`canalPreferido=${canalPreferido} requiere un teléfono`);
  }
}

function existeIdentificacion(db, identificacion, excluirId) {
  if (!identificacion) return false;
  const fila = db.prepare(
    'SELECT id FROM clientes WHERE identificacion = ? AND id != ?'
  ).get(identificacion, excluirId || '');
  return !!fila;
}

export function listarClientes(ruc) {
  const db = getDB(ruc);
  const clientes = db.prepare('SELECT * FROM clientes ORDER BY nombre').all();
  const saldos = db.prepare(`
    SELECT cliente_id, SUM(saldo_pendiente) AS saldo
    FROM facturas WHERE estado = 'pendiente' GROUP BY cliente_id
  `).all();
  const saldoPorCliente = new Map(saldos.map((s) => [s.cliente_id, s.saldo]));
  return clientes.map((c) => ({ ...c, saldoPendiente: saldoPorCliente.get(c.id) || 0 }));
}

export function crearCliente(ruc, { nombre, identificacion, email, telefono, canalPreferido = 'email' }) {
  if (!nombre) throw new Error('nombre es requerido');
  validarDatosCliente({ email, telefono, canalPreferido });

  const db = getDB(ruc);
  if (existeIdentificacion(db, identificacion)) {
    throw new Error(`Ya existe un cliente con identificación ${identificacion}`);
  }

  const id = `cli_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO clientes (id, nombre, identificacion, email, telefono, canal_preferido)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, nombre, identificacion || null, email || null, telefono || null, canalPreferido);
  return obtenerCliente(ruc, id);
}

export function obtenerCliente(ruc, id) {
  const db = getDB(ruc);
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  if (!cliente) return null;
  const facturas = db.prepare('SELECT * FROM facturas WHERE cliente_id = ? ORDER BY fecha_vencimiento DESC').all(id);
  const gestiones = db.prepare('SELECT * FROM gestiones_cobro WHERE cliente_id = ? ORDER BY creado_en DESC LIMIT 20').all(id);
  return { ...cliente, facturas, gestiones };
}

export function actualizarCliente(ruc, id, datos) {
  const db = getDB(ruc);
  const actual = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  if (!actual) return null;

  const nombre = datos.nombre ?? actual.nombre;
  const identificacion = datos.identificacion ?? actual.identificacion;
  const email = datos.email ?? actual.email;
  const telefono = datos.telefono ?? actual.telefono;
  const canalPreferido = datos.canalPreferido ?? actual.canal_preferido;

  validarDatosCliente({ email, telefono, canalPreferido });
  if (existeIdentificacion(db, identificacion, id)) {
    throw new Error(`Ya existe un cliente con identificación ${identificacion}`);
  }

  db.prepare(`
    UPDATE clientes SET nombre = ?, identificacion = ?, email = ?, telefono = ?, canal_preferido = ?
    WHERE id = ?
  `).run(nombre, identificacion, email, telefono, canalPreferido, id);

  return obtenerCliente(ruc, id);
}

export function eliminarCliente(ruc, id) {
  const db = getDB(ruc);
  const pendientes = db.prepare(
    `SELECT COUNT(*) n FROM facturas WHERE cliente_id = ? AND estado = 'pendiente'`
  ).get(id);
  if (pendientes.n > 0) {
    throw new Error('No se puede eliminar un cliente con facturas pendientes de cobro');
  }
  db.prepare('DELETE FROM facturas WHERE cliente_id = ?').run(id);
  db.prepare('DELETE FROM gestiones_cobro WHERE cliente_id = ?').run(id);
  const info = db.prepare('DELETE FROM clientes WHERE id = ?').run(id);
  return info.changes > 0;
}

export function crearFactura(ruc, clienteId, { numero, monto, fechaEmision, fechaVencimiento }) {
  const db = getDB(ruc);
  const cliente = db.prepare('SELECT id FROM clientes WHERE id = ?').get(clienteId);
  if (!cliente) throw new Error('Cliente no encontrado');
  if (!monto || monto <= 0) throw new Error('monto debe ser mayor a 0');
  if (!fechaVencimiento) throw new Error('fechaVencimiento es requerida (YYYY-MM-DD)');

  const id = `fac_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO facturas (id, cliente_id, numero, monto, saldo_pendiente, fecha_emision, fecha_vencimiento, estado)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente')
  `).run(
    id, clienteId, numero || null, monto, monto,
    fechaEmision || new Date().toISOString().slice(0, 10), fechaVencimiento
  );
  return db.prepare('SELECT * FROM facturas WHERE id = ?').get(id);
}

const ESTADOS_FACTURA_VALIDOS = ['pendiente', 'pagada', 'incobrable'];

export function actualizarFactura(ruc, facturaId, datos) {
  const db = getDB(ruc);
  const actual = db.prepare('SELECT * FROM facturas WHERE id = ?').get(facturaId);
  if (!actual) return null;

  const numero = datos.numero ?? actual.numero;
  const monto = datos.monto ?? actual.monto;
  const saldoPendiente = datos.saldoPendiente ?? actual.saldo_pendiente;
  const fechaVencimiento = datos.fechaVencimiento ?? actual.fecha_vencimiento;
  const estado = datos.estado ?? actual.estado;

  if (datos.estado && !ESTADOS_FACTURA_VALIDOS.includes(datos.estado)) {
    throw new Error(`estado debe ser uno de: ${ESTADOS_FACTURA_VALIDOS.join(', ')}`);
  }
  if (datos.monto !== undefined && datos.monto <= 0) {
    throw new Error('monto debe ser mayor a 0');
  }

  db.prepare(`
    UPDATE facturas SET numero = ?, monto = ?, saldo_pendiente = ?, fecha_vencimiento = ?, estado = ?
    WHERE id = ?
  `).run(numero, monto, saldoPendiente, fechaVencimiento, estado, facturaId);

  return db.prepare('SELECT * FROM facturas WHERE id = ?').get(facturaId);
}

export function eliminarFactura(ruc, facturaId) {
  const db = getDB(ruc);
  const info = db.prepare('DELETE FROM facturas WHERE id = ?').run(facturaId);
  return info.changes > 0;
}
