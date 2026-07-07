/**
 * KALLPA AI — Métricas de consumo de tokens por tenant
 * =======================================================
 * Registro simple en la DB compartida, usado por routes/agentes-routes.js
 * para monitorear costo de API por cliente.
 */

import { getSharedDB } from './tenants.js';

export async function registrarUsoTokens({ ruc, modulo, inputTokens, outputTokens, toolsUsadas }) {
  const db = getSharedDB();
  db.prepare(`
    INSERT INTO uso_tokens (ruc, modulo, input_tokens, output_tokens, tools_usadas)
    VALUES (?, ?, ?, ?, ?)
  `).run(ruc, modulo, inputTokens || 0, outputTokens || 0, JSON.stringify(toolsUsadas || []));
}
