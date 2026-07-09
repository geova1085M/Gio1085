/**
 * KALLPA AI — Canal de mensajería del agente de Cobros
 * =======================================================
 * Esta es la "automatización" propia de Kallpa (equivalente a un flujo de
 * n8n) pero corrida por el mismo backend Node: no hay editor visual de
 * nodos, hay una función que el executor de tools invoca cuando el agente
 * decide enviar un recordatorio.
 *
 * Proveedores soportados para el canal 'email' (MENSAJERIA_PROVIDER en .env):
 *   - 'consola' (default): imprime el mensaje y lo guarda en gestiones_cobro.
 *     Sirve para probar el flujo completo sin ninguna credencial real.
 *   - 'gmail': envía el correo de verdad por SMTP de Gmail usando una
 *     "contraseña de aplicación" (GMAIL_USER + GMAIL_APP_PASSWORD en .env).
 *     Ver instrucciones de configuración en el README.
 *
 * 'whatsapp'/'sms' siguen siempre en modo consola hasta conectar un
 * proveedor real (WhatsApp Business API, Twilio) — no hay credenciales
 * para eso todavía.
 *
 * Ningún otro archivo debe hacer fetch/red directamente para enviar un
 * mensaje: todo pasa por aquí para que cambiar de proveedor sea un solo
 * punto de edición.
 */

import nodemailer from 'nodemailer';

let transportGmail = null;

function getTransportGmail() {
  if (transportGmail) return transportGmail;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      'GMAIL_USER y GMAIL_APP_PASSWORD son requeridos para MENSAJERIA_PROVIDER=gmail (ver README)'
    );
  }
  transportGmail = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });
  return transportGmail;
}

async function enviarPorConsola(canal, destinatario, asunto, cuerpo) {
  console.log(
    `\n[mensajeria:${canal}] → ${destinatario}\n` +
    (asunto ? `Asunto: ${asunto}\n` : '') +
    `${cuerpo}\n`
  );
  return { estado: 'simulado', proveedor: 'consola' };
}

async function enviarPorGmail(destinatario, asunto, cuerpo) {
  try {
    const transporte = getTransportGmail();
    const info = await transporte.sendMail({
      from: process.env.GMAIL_USER,
      to: destinatario,
      subject: asunto || 'Recordatorio de pago pendiente',
      text: cuerpo
    });
    return { estado: 'enviado', proveedor: 'gmail', messageId: info.messageId };
  } catch (err) {
    console.error('[mensajeria:gmail] falló:', err.message);
    return { estado: 'fallido', proveedor: 'gmail', error: err.message };
  }
}

export async function enviarMensaje({ canal, destinatario, asunto, cuerpo }) {
  if (!destinatario) {
    return { estado: 'fallido', error: `Cliente sin ${canal} registrado` };
  }

  // Solo 'email' tiene un proveedor real conectado. whatsapp/sms se quedan
  // en consola hasta que haya credenciales de Twilio/WhatsApp Business API.
  const provider = canal === 'email' ? (process.env.MENSAJERIA_PROVIDER || 'consola') : 'consola';

  if (provider === 'gmail') return enviarPorGmail(destinatario, asunto, cuerpo);
  if (provider === 'consola') return enviarPorConsola(canal, destinatario, asunto, cuerpo);

  return {
    estado: 'fallido',
    error: `Proveedor de mensajería '${provider}' no implementado todavía`
  };
}
