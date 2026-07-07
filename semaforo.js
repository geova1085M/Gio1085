/**
 * KALLPA AI — Semáforo determinista del borrador F104
 * ======================================================
 * Reglas deterministas (nunca decididas por el modelo) sobre el borrador
 * generado por f104-borrador.js. Este es un subconjunto simplificado de
 * demostración: la especificación completa de producto define 5 reglas
 * rojas y 3 amarillas; aquí se implementa una versión reducida pero real,
 * pensada para poder extenderse regla por regla.
 */

export function evaluarSemaforo(borrador, _tenant) {
  const reglasRojas = [];
  const reglasAmarillas = [];

  if (borrador.totalComprobantes === 0) {
    reglasRojas.push('No hay comprobantes registrados para el período: no se puede declarar sin datos.');
  }
  if (borrador.valorAPagar > 0 && borrador.saldoAFavor > 0) {
    reglasRojas.push('Valor a pagar y saldo a favor simultáneos: los casilleros no cuadran.');
  }

  if (borrador.comprobantesSinAutorizar > 0) {
    reglasAmarillas.push(
      `${borrador.comprobantesSinAutorizar} comprobante(s) sin autorización SRI vigente.`
    );
  }
  if (typeof borrador.variacionVsMesAnterior === 'number' && Math.abs(borrador.variacionVsMesAnterior) > 0.4) {
    const signo = borrador.variacionVsMesAnterior > 0 ? 'alza' : 'baja';
    reglasAmarillas.push(
      `Variación de IVA a pagar mayor al 40% (${signo}) respecto al mes anterior.`
    );
  }

  if (reglasRojas.length > 0) return { estado: 'rojo', reglas: reglasRojas };
  if (reglasAmarillas.length > 0) return { estado: 'amarillo', reglas: reglasAmarillas };
  return { estado: 'verde', reglas: [] };
}
