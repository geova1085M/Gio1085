/**
 * KALLPA AI — Acceso a datos de tenants (stub funcional con SQLite)
 * ===================================================================
 * Aislamiento multi-tenant: cada RUC tiene su propio archivo SQLite en
 * data/tenants/<ruc>.sqlite (comprobantes, retenciones, contabilidad).
 * Los datos transversales (registro de tenants, tickets HITL, métricas
 * de uso) viven en una DB compartida: data/kallpa.sqlite.
 *
 * NOTA: esto es un stub de desarrollo para correr el sistema end-to-end
 * en local/VS Code. En producción, la resolución de tenant y el
 * aprovisionamiento de nuevos RUC deben pasar por un flujo de alta real
 * (onboarding, KYC), no auto-crearse en el primer request.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const TENANTS_DIR = path.join(DATA_DIR, 'tenants');
fs.mkdirSync(TENANTS_DIR, { recursive: true });

const SCHEMA_COMPARTIDA = `
  CREATE TABLE IF NOT EXISTS tenants (
    ruc TEXT PRIMARY KEY,
    razon_social TEXT,
    regimen TEXT NOT NULL DEFAULT 'general', -- general | rimpe_emprendedor | rimpe_negocio_popular
    plan TEXT NOT NULL DEFAULT 'pyme',        -- emprendedor | pyme | corporativo
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS uso_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ruc TEXT NOT NULL,
    modulo TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    tools_usadas TEXT,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    ruc TEXT NOT NULL,
    tipo TEXT NOT NULL,
    origen TEXT NOT NULL,     -- escalacion_automatica | escalacion_manual_agente | flujo_normal
    urgencia TEXT NOT NULL,
    motivo TEXT,
    payload TEXT,
    estado TEXT NOT NULL DEFAULT 'abierto',
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

export const SCHEMA_TENANT = `
  CREATE TABLE IF NOT EXISTS comprobantes (
    clave_acceso TEXT PRIMARY KEY,
    periodo TEXT NOT NULL,
    tipo_comprobante TEXT NOT NULL,
    direccion TEXT NOT NULL,          -- 'E' emitido | 'R' recibido
    ruc_contraparte TEXT,
    razon_social TEXT,
    fecha_emision TEXT,
    subtotal REAL NOT NULL DEFAULT 0,
    iva REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    estado_sri TEXT NOT NULL DEFAULT 'AUTORIZADO',
    contabilizado INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS comprobante_detalles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clave_acceso TEXT NOT NULL,
    descripcion TEXT,
    cantidad REAL,
    precio_unitario REAL,
    subtotal REAL,
    iva REAL
  );

  CREATE TABLE IF NOT EXISTS retenciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    periodo TEXT NOT NULL,
    direccion TEXT NOT NULL,         -- 'E' efectuada | 'R' recibida
    valor_retenido_iva REAL NOT NULL DEFAULT 0,
    valor_retenido_renta REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS plan_cuentas (
    codigo TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL -- activo | pasivo | patrimonio | ingreso | gasto
  );

  CREATE TABLE IF NOT EXISTS asientos (
    id TEXT PRIMARY KEY,
    fecha TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'borrador', -- borrador | registrado
    origen TEXT NOT NULL,                    -- comprobante | manual | cierre
    origen_ref TEXT,                         -- clave_acceso si origen = comprobante
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS asiento_lineas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asiento_id TEXT NOT NULL,
    cuenta TEXT NOT NULL,
    debito REAL NOT NULL DEFAULT 0,
    credito REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS f104_borradores (
    id TEXT PRIMARY KEY,
    periodo TEXT NOT NULL,
    ventas_gravadas REAL, iva_cobrado REAL,
    compras_credito REAL, iva_pagado REAL,
    credito_anterior REAL DEFAULT 0,
    retenciones_iva REAL DEFAULT 0,
    valor_a_pagar REAL,
    saldo_a_favor REAL,
    casilleros_verificados INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cierres (
    id TEXT PRIMARY KEY,
    periodo TEXT NOT NULL,
    estado TEXT NOT NULL,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS clientes (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    identificacion TEXT,          -- cédula/RUC del cliente
    email TEXT,
    telefono TEXT,                -- para whatsapp/sms
    canal_preferido TEXT NOT NULL DEFAULT 'email', -- email | whatsapp | sms
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS facturas (
    id TEXT PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    numero TEXT,
    monto REAL NOT NULL,
    saldo_pendiente REAL NOT NULL,
    fecha_emision TEXT NOT NULL,
    fecha_vencimiento TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | pagada | incobrable
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS gestiones_cobro (
    id TEXT PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    factura_id TEXT,
    canal TEXT NOT NULL,           -- email | whatsapp | sms
    tipo TEXT NOT NULL,            -- recordatorio | aviso_vencido | aviso_urgente
    mensaje TEXT NOT NULL,
    destino TEXT,                  -- email/teléfono usado
    estado_envio TEXT NOT NULL DEFAULT 'simulado', -- simulado | enviado | fallido
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

// Plan de cuentas simplificado (subset de demostración del plan real de
// 122 cuentas NIIF PYMES que usa el motor contable en producción).
const PLAN_CUENTAS_DEMO = [
  ['1.1.1', 'Caja', 'activo'],
  ['1.1.2', 'Cuentas por Cobrar Clientes', 'activo'],
  ['1.1.3', 'Inventarios', 'activo'],
  ['1.1.4', 'IVA Crédito Tributario', 'activo'],
  ['1.1.5', 'Bancos', 'activo'],
  ['2.1.1', 'Cuentas por Pagar Proveedores', 'pasivo'],
  ['2.1.2', 'IVA por Pagar', 'pasivo'],
  ['2.1.3', 'Retenciones por Pagar', 'pasivo'],
  ['3.1.1', 'Capital Social', 'patrimonio'],
  ['3.1.2', 'Utilidades Retenidas', 'patrimonio'],
  ['4.1.1', 'Ventas', 'ingreso'],
  ['5.1.1', 'Costo de Ventas', 'gasto'],
  ['5.1.2', 'Gastos Operativos', 'gasto'],
  ['5.1.3', 'Gastos de Sueldos', 'gasto'],
  ['5.1.4', 'Depreciación', 'gasto']
];

const sharedDb = new Database(path.join(DATA_DIR, 'kallpa.sqlite'));
sharedDb.pragma('journal_mode = WAL');
sharedDb.exec(SCHEMA_COMPARTIDA);

const conexionesTenant = new Map();

export function getSharedDB() {
  return sharedDb;
}

export function getDB(ruc) {
  if (!ruc) throw new Error('getDB requiere un RUC');
  if (conexionesTenant.has(ruc)) return conexionesTenant.get(ruc);

  const db = new Database(path.join(TENANTS_DIR, `${ruc}.sqlite`));
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_TENANT);

  const insertCuenta = db.prepare(
    'INSERT OR IGNORE INTO plan_cuentas (codigo, nombre, tipo) VALUES (?, ?, ?)'
  );
  const seedPlanCuentas = db.transaction((cuentas) => {
    for (const c of cuentas) insertCuenta.run(...c);
  });
  seedPlanCuentas(PLAN_CUENTAS_DEMO);

  conexionesTenant.set(ruc, db);
  return db;
}

const TENANT_DEMO_DEFAULTS = {
  razonSocial: 'Negocio sin razón social registrada',
  regimen: 'general',
  plan: 'pyme'
};

/**
 * Resuelve el contexto de tenant a partir del RUC ya autenticado.
 * Auto-aprovisiona un tenant nuevo con valores por defecto si no existe
 * (conveniencia de desarrollo — en producción esto debe ser un 404).
 */
export async function getTenantContext(ruc) {
  if (!ruc) throw new Error('RUC requerido');

  sharedDb.prepare(`
    INSERT OR IGNORE INTO tenants (ruc, razon_social, regimen, plan)
    VALUES (?, ?, ?, ?)
  `).run(ruc, TENANT_DEMO_DEFAULTS.razonSocial, TENANT_DEMO_DEFAULTS.regimen, TENANT_DEMO_DEFAULTS.plan);

  const row = sharedDb.prepare('SELECT * FROM tenants WHERE ruc = ?').get(ruc);

  return {
    ruc: row.ruc,
    razonSocial: row.razon_social,
    regimen: row.regimen,
    plan: row.plan
  };
}
