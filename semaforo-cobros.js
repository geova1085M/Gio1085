/**
 * KALLPA AI — Semáforo determinista de cobranza
 * =================================================
 * Igual que semaforo.js para el F104: la clasificación de urgencia de una
 * factura vencida NUNCA la decide el modelo, se calcula aquí a partir de
 * los días de atraso. El agente solo lee el resultado y lo explica.
 */

export function evaluarSemaforoCobro(diasVencido) {
  if (diasVencido <= 5) {
    return { estado: 'verde', tono: 'recordatorio amistoso' };
  }
  if (diasVencido <= 30) {
    return { estado: 'amarillo', tono: 'aviso formal, ofrecer plan de pago' };
  }
  return { estado: 'rojo', tono: 'gestión de cobranza / legal' };
}

export function diasVencido(fechaVencimiento, hoy = new Date()) {
  const venc = new Date(fechaVencimiento);
  const ms = hoy.setHours(0, 0, 0, 0) - venc.setHours(0, 0, 0, 0);
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
