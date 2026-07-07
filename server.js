/**
 * KALLPA AI — Punto de entrada de la API de agentes
 * ====================================================
 *   npm install
 *   cp .env.example .env   # agrega tu ANTHROPIC_API_KEY
 *   npm run seed           # datos de demostración para un tenant
 *   npm start
 *
 * Prueba rápida:
 *   curl -X POST http://localhost:3000/api/agentes/tributario \
 *     -H "Content-Type: application/json" \
 *     -H "x-tenant-ruc: 0912345678001" \
 *     -d '{"mensaje":"¿cuánto tengo que pagar de IVA este mes?"}'
 */

import 'dotenv/config';
import express from 'express';
import agentesRoutes from './routes/agentes-routes.js';
import { authDev } from './middleware/auth.js';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, servicio: 'kallpa-ai-agentes' });
});

app.use('/api/agentes', authDev, agentesRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`KALLPA AI — API de agentes escuchando en http://localhost:${PORT}`);
});
