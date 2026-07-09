/**
 * KALLPA AI — Rutas de automatización (sin LLM en el camino)
 * ==============================================================
 * Esto es lo que en n8n sería un workflow con un nodo "Schedule Trigger":
 * aquí es simplemente un endpoint HTTP determinista que cualquier cron
 * (o tu propio botón de prueba en requests.http) puede disparar. No pasa
 * por Claude — llama directo al mismo handler que usan las tools, para
 * que el comportamiento sea idéntico sea que lo dispare el chatbot o el
 * reloj.
 *
 *   POST /api/automatizacion/cobros/ejecutar  { diasMinimo?, canal? }
 */

import express from 'express';
import { ejecutarTool } from '../tools/executor.js';
import { getTenantContext } from '../db/tenants.js';

const router = express.Router();

router.post('/cobros/ejecutar', async (req, res) => {
  try {
    const ruc = req.auth.ruc;
    const tenant = await getTenantContext(ruc);
    const { diasMinimo, canal } = req.body || {};

    const resultado = await ejecutarTool('ejecutarCampanaRecordatorios', { diasMinimo, canal }, tenant);

    res.json({ ok: true, ...resultado });
  } catch (err) {
    console.error('[automatizacion/cobros]', err);
    res.status(500).json({ ok: false, error: 'error_interno', mensaje: 'La automatización de cobros falló.' });
  }
});

export default router;
