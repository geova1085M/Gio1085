/**
 * KALLPA AI — Tickets HITL (human-in-the-loop)
 * ===============================================
 * Único punto de escritura para revisiones de contador/profesional Kallpa,
 * ya sea por escalación automática (semáforo) o manual (agente + usuario).
 */

import crypto from 'node:crypto';
import { getSharedDB } from './tenants.js';

export async function crearTicket({ ruc, tipo, origen, urgencia, motivo, payload }) {
  const db = getSharedDB();
  const id = `tk_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO tickets (id, ruc, tipo, origen, urgencia, motivo, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, ruc, tipo, origen, urgencia, motivo || null, JSON.stringify(payload || {}));

  return { id, estado: 'abierto' };
}
