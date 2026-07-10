/**
 * KALLPA AI — Rutas del CRM de clientes (cartera de cobros)
 * =============================================================
 * CRUD determinista, sin pasar por Claude — igual que
 * automatizacion-routes.js. Pensado para un formulario simple
 * (public/crm.html) o integraciones futuras (importar Excel, etc.).
 *
 *   GET    /api/crm/clientes
 *   POST   /api/crm/clientes
 *   GET    /api/crm/clientes/:id
 *   PUT    /api/crm/clientes/:id
 *   DELETE /api/crm/clientes/:id
 *   POST   /api/crm/clientes/:id/facturas
 *   PUT    /api/crm/facturas/:id
 *   DELETE /api/crm/facturas/:id
 */

import express from 'express';
import * as crm from '../db/crm.js';

const router = express.Router();

router.get('/clientes', (req, res) => {
  res.json({ ok: true, clientes: crm.listarClientes(req.auth.ruc) });
});

router.post('/clientes', (req, res) => {
  try {
    const cliente = crm.crearCliente(req.auth.ruc, req.body || {});
    res.status(201).json({ ok: true, cliente });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/clientes/:id', (req, res) => {
  const cliente = crm.obtenerCliente(req.auth.ruc, req.params.id);
  if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });
  res.json({ ok: true, cliente });
});

router.put('/clientes/:id', (req, res) => {
  try {
    const cliente = crm.actualizarCliente(req.auth.ruc, req.params.id, req.body || {});
    if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });
    res.json({ ok: true, cliente });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/clientes/:id', (req, res) => {
  try {
    const eliminado = crm.eliminarCliente(req.auth.ruc, req.params.id);
    if (!eliminado) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/clientes/:id/facturas', (req, res) => {
  try {
    const factura = crm.crearFactura(req.auth.ruc, req.params.id, req.body || {});
    res.status(201).json({ ok: true, factura });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.put('/facturas/:id', (req, res) => {
  try {
    const factura = crm.actualizarFactura(req.auth.ruc, req.params.id, req.body || {});
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });
    res.json({ ok: true, factura });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/facturas/:id', (req, res) => {
  const eliminado = crm.eliminarFactura(req.auth.ruc, req.params.id);
  if (!eliminado) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });
  res.json({ ok: true });
});

export default router;
