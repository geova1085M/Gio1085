/**
 * KALLPA AI — Rutas de agentes ejecutores
 * ========================================
 * Montar en Express:
 *   import agentesRoutes from './routes/agentes-routes.js';
 *   app.use('/api/agentes', agentesRoutes);
 *
 * Endpoints:
 *   POST /api/agentes/tributario  { mensaje, historial? }
 *   POST /api/agentes/contable    { mensaje, historial? }
 *   POST /api/agentes/mercado     { mensaje, historial? }
 *   POST /api/agentes/cobros      { mensaje, historial? }
 *
 * El tenant se resuelve del token de sesión (middleware auth existente),
 * nunca del body — un cliente no puede consultar datos de otro RUC.
 */

import express from 'express';
import { ejecutarAgente } from '../agents/ensamblador.js';
import { getTenantContext } from '../db/tenants.js';
import { registrarUsoTokens } from '../db/metricas.js';

const router = express.Router();

const MODULOS_VALIDOS = ['tributario', 'contable', 'mercado', 'cobros'];

router.post('/:modulo', async (req, res) => {
  const { modulo } = req.params;
  if (!MODULOS_VALIDOS.includes(modulo)) {
    return res.status(404).json({ ok: false, error: 'Módulo no existe' });
  }

  try {
    const { mensaje, historial } = req.body;
    if (!mensaje || typeof mensaje !== 'string') {
      return res.status(400).json({ ok: false, error: 'mensaje requerido' });
    }

    // RUC desde la sesión autenticada, NUNCA desde el body
    const ruc = req.auth.ruc;
    const tenant = await getTenantContext(ruc);

    // Gating por plan: mercado requiere plan PYME o superior
    if (modulo === 'mercado' && tenant.plan === 'emprendedor') {
      return res.status(403).json({
        ok: false,
        error: 'plan_insuficiente',
        mensaje: 'El módulo de inteligencia de mercado está disponible desde el plan PYME.'
      });
    }

    const resultado = await ejecutarAgente(
      modulo, tenant, mensaje, historial || []
    );

    // Métrica de consumo por tenant (para monitorear costo API)
    await registrarUsoTokens({
      ruc,
      modulo,
      inputTokens: resultado.uso.input_tokens,
      outputTokens: resultado.uso.output_tokens,
      toolsUsadas: resultado.toolsUsadas
    });

    res.json({
      ok: true,
      respuesta: resultado.texto,
      toolsUsadas: resultado.toolsUsadas,
      limiteAlcanzado: resultado.limiteAlcanzado || false
    });

  } catch (err) {
    console.error(`[agentes/${modulo}]`, err);
    res.status(500).json({
      ok: false,
      error: 'error_interno',
      mensaje: 'El agente no pudo procesar la solicitud. Intenta de nuevo.'
    });
  }
});

export default router;
