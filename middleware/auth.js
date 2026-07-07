/**
 * KALLPA AI — Middleware de autenticación (STUB DE DESARROLLO)
 * ================================================================
 * Lee el RUC del header `x-tenant-ruc` y lo expone como req.auth.ruc,
 * exactamente como routes/agentes-routes.js lo espera.
 *
 * ADVERTENCIA: esto NO es autenticación real. Confía ciegamente en un
 * header enviado por el cliente. Antes de exponer esta API fuera de un
 * entorno de desarrollo local, reemplázalo por verificación real de
 * sesión/JWT que resuelva el RUC desde un token firmado por el servidor.
 */
export function authDev(req, res, next) {
  const ruc = req.header('x-tenant-ruc');
  if (!ruc) {
    return res.status(401).json({
      ok: false,
      error: 'no_autenticado',
      mensaje: 'Header x-tenant-ruc requerido (stub de autenticación de desarrollo).'
    });
  }
  req.auth = { ruc };
  next();
}
