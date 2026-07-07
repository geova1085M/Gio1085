/**
 * KALLPA AI — Generador de borrador F104 (IVA)
 * ===============================================
 * Cálculo determinista casillero por casillero (versión simplificada de
 * demostración: agrega ventas/compras del período y retenciones de IVA
 * recibidas). El formulario 104 real tiene ~100 casilleros; aquí se
 * modela el subconjunto que alimenta valor a pagar / saldo a favor.
 */

import crypto from 'node:crypto';
import { getDB } from './db/tenants.js';

function mesAnteriorDe(periodo) {
  const [y, m] = periodo.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function generarF104(ruc, periodo) {
  const db = getDB(ruc);

  const ventas = db.prepare(`
    SELECT COALESCE(SUM(subtotal), 0) subtotal, COALESCE(SUM(iva), 0) iva, COUNT(*) cantidad
    FROM comprobantes WHERE periodo = ? AND direccion = 'E'
  `).get(periodo);

  const compras = db.prepare(`
    SELECT COALESCE(SUM(subtotal), 0) subtotal, COALESCE(SUM(iva), 0) iva, COUNT(*) cantidad
    FROM comprobantes WHERE periodo = ? AND direccion = 'R'
  `).get(periodo);

  const sinAutorizar = db.prepare(`
    SELECT COUNT(*) n FROM comprobantes WHERE periodo = ? AND estado_sri != 'AUTORIZADO'
  `).get(periodo).n;

  const retIva = db.prepare(`
    SELECT COALESCE(SUM(valor_retenido_iva), 0) v FROM retenciones
    WHERE periodo = ? AND direccion = 'R'
  `).get(periodo).v;

  const ivaCobrado = ventas.iva;
  const ivaPagado = compras.iva;
  const neto = Number((ivaCobrado - ivaPagado - retIva).toFixed(2));

  const valorAPagar = neto > 0 ? neto : 0;
  const saldoAFavor = neto < 0 ? Number((-neto).toFixed(2)) : 0;

  const periodoAnterior = mesAnteriorDe(periodo);
  const anterior = db.prepare(`
    SELECT valor_a_pagar FROM f104_borradores WHERE periodo = ? ORDER BY creado_en DESC LIMIT 1
  `).get(periodoAnterior);
  const variacionVsMesAnterior = anterior && anterior.valor_a_pagar > 0
    ? Number(((valorAPagar - anterior.valor_a_pagar) / anterior.valor_a_pagar).toFixed(4))
    : null;

  const id = `f104_${periodo}_${crypto.randomUUID().slice(0, 8)}`;

  db.prepare(`
    INSERT INTO f104_borradores
      (id, periodo, ventas_gravadas, iva_cobrado, compras_credito, iva_pagado,
       credito_anterior, retenciones_iva, valor_a_pagar, saldo_a_favor, casilleros_verificados)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0)
  `).run(id, periodo, ventas.subtotal, ivaCobrado, compras.subtotal, ivaPagado, retIva, valorAPagar, saldoAFavor);

  return {
    id,
    resumen: {
      ventasGravadas: ventas.subtotal,
      ivaCobrado,
      comprasConCredito: compras.subtotal,
      ivaPagado,
      retencionesIvaRecibidas: retIva
    },
    valorAPagar,
    saldoAFavor,
    totalComprobantes: ventas.cantidad + compras.cantidad,
    comprobantesSinAutorizar: sinAutorizar,
    variacionVsMesAnterior,
    casillerosVerificados: false
  };
}
