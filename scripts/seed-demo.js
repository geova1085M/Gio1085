/**
 * KALLPA AI — Datos de demostración
 * ===================================
 * Crea un tenant demo (RIMPE Emprendedor, plan PYME) con comprobantes de
 * venta/compra del período actual, para poder probar los tres agentes
 * end-to-end sin conectar el SRI real.
 *
 *   npm run seed
 *   npm run seed -- --ruc=0912345678001 --periodo=2026-06
 */

import { getDB, getSharedDB } from '../db/tenants.js';

function argValor(nombre, porDefecto) {
  const arg = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return arg ? arg.split('=')[1] : porDefecto;
}

function periodoActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const RUC_DEMO = argValor('ruc', '0912345678001');
const PERIODO = argValor('periodo', periodoActual());

const shared = getSharedDB();
shared.prepare(`
  INSERT INTO tenants (ruc, razon_social, regimen, plan)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(ruc) DO UPDATE SET
    razon_social = excluded.razon_social,
    regimen = excluded.regimen,
    plan = excluded.plan
`).run(RUC_DEMO, 'Ferretería La Esquina S.A.S.', 'rimpe_emprendedor', 'pyme');

const db = getDB(RUC_DEMO);

const insertComprobante = db.prepare(`
  INSERT OR REPLACE INTO comprobantes
    (clave_acceso, periodo, tipo_comprobante, direccion, ruc_contraparte,
     razon_social, fecha_emision, subtotal, iva, total, estado_sri)
  VALUES (?, ?, 'factura', ?, ?, ?, ?, ?, ?, ?, 'AUTORIZADO')
`);

const ventas = [452.0, 210.5, 980.0];
ventas.forEach((total, i) => {
  const subtotal = Number((total / 1.15).toFixed(2));
  const iva = Number((total - subtotal).toFixed(2));
  insertComprobante.run(
    `DEMO_V_${PERIODO}_${i}`, PERIODO, 'E', '0990000000001',
    `Cliente Demo ${i + 1}`, `${PERIODO}-1${i}`, subtotal, iva, total
  );
});

const compras = [300.0, 150.75];
compras.forEach((total, i) => {
  const subtotal = Number((total / 1.15).toFixed(2));
  const iva = Number((total - subtotal).toFixed(2));
  insertComprobante.run(
    `DEMO_C_${PERIODO}_${i}`, PERIODO, 'R', '0990000000002',
    `Proveedor Demo ${i + 1}`, `${PERIODO}-0${i + 1}`, subtotal, iva, total
  );
});

const insertRetencion = db.prepare(`
  INSERT INTO retenciones (periodo, direccion, valor_retenido_iva, valor_retenido_renta)
  VALUES (?, 'R', ?, ?)
`);
insertRetencion.run(PERIODO, 12.5, 8.0);

console.log(`Tenant demo listo: RUC ${RUC_DEMO}, período ${PERIODO}`);
console.log(`  ${ventas.length} venta(s), ${compras.length} compra(s), 1 retención recibida`);
console.log(`\nProbar con:\n  curl -X POST http://localhost:3000/api/agentes/tributario \\`);
console.log(`    -H "Content-Type: application/json" -H "x-tenant-ruc: ${RUC_DEMO}" \\`);
console.log(`    -d '{"mensaje":"prepárame la declaración de IVA de este mes"}'`);
