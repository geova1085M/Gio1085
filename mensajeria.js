/**
 * KALLPA AI — Canal de mensajería del agente de Cobros
 * =======================================================
 * Esta es la "automatización" propia de Kallpa (equivalente a un flujo de
 * n8n) pero corrida por el mismo backend Claude: no hay editor visual de
 * nodos, hay una función que el executor de tools invoca cuando el agente
 * decide enviar un recordatorio.
 *
 * Proveedores soportados vía MENSAJERIA_PROVIDER (.env):
 *   - 'consola' (default): imprime el mensaje y lo guarda en gestiones_cobro.
 *     Sirve para probar el flujo completo HOY sin ninguna credencial real.
 *   - 'gmail': crea un borrador en Gmail (requiere el MCP de Gmail conectado
 *     y reemplazar el bloque de abajo por la llamada real de envío/borrador).
 *   - 'smtp' / 'whatsapp' / 'sms': placeholders — conectar Nodemailer,
 *     WhatsApp Business API o Twilio respectivamente cuando haya credenciales.
 *
 * Ningún otro archivo debe hacer fetch/red directamente para enviar un
 * mensaje: todo pasa por aquí para que cambiar de proveedor sea un solo
 * punto de edición.
 */

export async function enviarMensaje({ canal, destinatario, asunto, cuerpo }) {
  if (!destinatario) {
    return { estado: 'fallido', error: `Cliente sin ${canal} registrado` };
  }

  const provider = process.env.MENSAJERIA_PROVIDER || 'consola';

  switch (provider) {
    case 'consola': {
      console.log(
        `\n[mensajeria:${canal}] → ${destinatario}\n` +
        (asunto ? `Asunto: ${asunto}\n` : '') +
        `${cuerpo}\n`
      );
      return { estado: 'simulado', proveedor: 'consola' };
    }

    default:
      // Proveedor real aún no conectado. No fallar en silencio: dejarlo
      // explícito para que quien pruebe hoy sepa que falta configurar.
      return {
        estado: 'fallido',
        error: `Proveedor de mensajería '${provider}' no implementado todavía`
      };
  }
}
