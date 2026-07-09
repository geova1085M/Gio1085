/**
 * KALLPA AI — Datos de demostración: cartera de cobros
 * ========================================================
 * Crea clientes con facturas vencidas en distintos niveles de semáforo
 * (verde/amarillo/rojo) para el tenant demo, para poder probar el agente
 * de Cobros end-to-end hoy mismo sin datos reales.
 *
 *   npm run seed:cobros
 *   npm run seed:cobros -- --ruc=0912345678001
 */

import { getDB, getSharedDB } from '../db/tenants.js';

function argValor(nombre, porDefecto) {
  const arg = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return arg ? arg.split('=')[1] : porDefecto;
}

function haceDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const RUC_DEMO = argValor('ruc', '0912345678001');

const shared = getSharedDB();
shared.prepare(`
  INSERT INTO tenants (ruc, razon_social, regimen, plan)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(ruc) DO UPDATE SET razon_social = excluded.razon_social
`).run(RUC_DEMO, 'Ferretería La Esquina S.A.S.', 'rimpe_emprendedor', 'pyme');

const db = getDB(RUC_DEMO);

const insertCliente = db.prepare(`
  INSERT OR REPLACE INTO clientes (id, nombre, identificacion, email, telefono, canal_preferido)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const insertFactura = db.prepare(`
  INSERT OR REPLACE INTO facturas
    (id, cliente_id, numero, monto, saldo_pendiente, fecha_emision, fecha_vencimiento, estado)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente')
`);

const clientes = [
  { id: 'cli_demo_1', nombre: 'Constructora Andina S.A.', identificacion: '0990011223001', email: 'pagos@constructoraandina.test', telefono: '+593999111222', canal: 'email' },
  { id: 'cli_demo_2', nombre: 'Distribuidora El Roble', identificacion: '0990033445001', email: 'cobranza@elroble.test', telefono: '+593999333444', canal: 'email' },
  { id: 'cli_demo_3', nombre: 'Juan Pérez (persona natural)', identificacion: '0912345678', email: null, telefono: '+593999555666', canal: 'whatsapp' }
];

clientes.forEach((c) => insertCliente.run(c.id, c.nombre, c.identificacion, c.email, c.telefono, c.canal));

const facturas = [
  // verde: 3 días de atraso
  { id: 'fac_demo_1', clienteId: 'cli_demo_1', numero: 'F-001-234', monto: 850.0, diasAtraso: 3 },
  // amarillo: 18 días de atraso
  { id: 'fac_demo_2', clienteId: 'cli_demo_2', numero: 'F-001-235', monto: 1200.0, diasAtraso: 18 },
  // rojo: 45 días de atraso
  { id: 'fac_demo_3', clienteId: 'cli_demo_3', numero: 'F-001-236', monto: 300.0, diasAtraso: 45 }
];

facturas.forEach((f) => {
  insertFactura.run(
    f.id, f.clienteId, f.numero, f.monto, f.monto,
    haceDias(f.diasAtraso + 30), haceDias(f.diasAtraso),
  );
});

console.log(`Cartera de cobros demo lista para RUC ${RUC_DEMO}: ${clientes.length} clientes, ${facturas.length} facturas vencidas.`);
console.log(`\nProbar con:\n  curl -X POST http://localhost:3000/api/agentes/cobros \\`);
console.log(`    -H "Content-Type: application/json" -H "x-tenant-ruc: ${RUC_DEMO}" \\`);
console.log(`    -d '{"mensaje":"¿quién me debe ahorita?"}'`);
console.log(`\nO correr la automatización completa (sin chat):\n  curl -X POST http://localhost:3000/api/automatizacion/cobros/ejecutar \\`);
console.log(`    -H "Content-Type: application/json" -H "x-tenant-ruc: ${RUC_DEMO}" -d '{}'`);
