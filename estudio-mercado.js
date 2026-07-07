/**
 * KALLPA AI — Estudio de mercado y generación de PDF (stub funcional)
 * ======================================================================
 * En producción, un estudio se ensambla en la sesión del agente a partir
 * de las consultas a Supercias/INEC/Aduanas/Trends/Competencia y su score
 * de oportunidad. Aquí se persiste ese ensamblado como JSON (generarEstudio)
 * y se renderiza un PDF real con pdfkit (generarPDF) citando las fuentes.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';

const ESTUDIOS_DIR = path.join(process.cwd(), 'data', 'estudios');
fs.mkdirSync(ESTUDIOS_DIR, { recursive: true });

export async function generarEstudio(ruc, datos) {
  const id = `est_${crypto.randomUUID().slice(0, 10)}`;
  const estudio = { id, ruc, datos, creadoEn: new Date().toISOString() };
  fs.writeFileSync(path.join(ESTUDIOS_DIR, `${id}.json`), JSON.stringify(estudio, null, 2));
  return estudio;
}

export async function generarPDF(ruc, estudioId) {
  const rutaJSON = path.join(ESTUDIOS_DIR, `${estudioId}.json`);
  if (!fs.existsSync(rutaJSON)) {
    return { error: 'Estudio no encontrado en la sesión', estudioId };
  }
  const estudio = JSON.parse(fs.readFileSync(rutaJSON, 'utf-8'));
  const fuentes = ['Superintendencia de Compañías', 'INEC', 'Google Trends', 'Google Places'];
  const rutaPDF = path.join(ESTUDIOS_DIR, `${estudioId}.pdf`);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(rutaPDF);
    doc.pipe(stream);

    doc.fontSize(20).text('KALLPA AI — Estudio de Mercado', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`RUC: ${ruc}`);
    doc.text(`Estudio: ${estudioId}`);
    doc.text(`Generado: ${new Date().toLocaleString('es-EC')}`);
    doc.moveDown();
    doc.fontSize(12).text('Resumen de datos consultados:');
    doc.moveDown(0.5);
    doc.fontSize(9).text(JSON.stringify(estudio.datos ?? {}, null, 2));
    doc.moveDown();
    doc.fontSize(9).text(`Fuentes: ${fuentes.join(', ')}`, { align: 'left' });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return {
    url: `/data/estudios/${estudioId}.pdf`,
    paginas: 1,
    fuentesCitadas: fuentes
  };
}
