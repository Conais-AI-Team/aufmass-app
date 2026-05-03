// Run: node tools/debug-agb-detect.cjs <pdf-path>
// Prints per-page text + score using the same heuristic as agbDetector.ts

const fs = require('fs');
const path = require('path');

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node debug-agb-detect.cjs <pdf-path>');
  process.exit(1);
}

(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items.map((item) => ('str' in item ? item.str : '')).join(' ').trim();
    const lower = text.toLowerCase();

    let score = 0;
    const hits = [];
    if (/allgemeine\s+geschäftsbedingungen/.test(lower)) { score += 50; hits.push('AGB-full(+50)'); }
    if (/vertrags[-\s&]+(?:und\s+)?montagebedingungen/.test(lower)) { score += 40; hits.push('Vertrags-Montage(+40)'); }
    if (/(?:vertrags|montage|verkaufs|liefer)bedingungen/.test(lower)) { score += 25; hits.push('XYZ-bedingungen(+25)'); }
    if (/geschäftsbedingungen/.test(lower) && score === 0) { score += 20; hits.push('GB(+20)'); }
    if (/\bagb\b/.test(lower)) { score += 15; hits.push('AGB(+15)'); }
    const para = lower.match(/§\s*\d+/g);
    if (para) { const v = Math.min(para.length * 10, 50); score += v; hits.push(`§×${para.length}(+${v})`); }
    const num = lower.match(/\b\d+\.\d+(?:\.\d+)?\.?\s/g);
    if (num) { const v = Math.min(num.length * 2, 30); score += v; hits.push(`num×${num.length}(+${v})`); }
    if (/widerrufsrecht/.test(lower)) { score += 5; hits.push('widerruf'); }
    if (/gewährleistung/.test(lower)) { score += 5; hits.push('gewährl'); }
    if (/datenschutz/.test(lower)) { score += 5; hits.push('dsg'); }
    if (/lieferzeit/.test(lower)) { score += 5; hits.push('liefer'); }
    if (/eigentumsvorbehalt/.test(lower)) { score += 5; hits.push('eig'); }
    if (/haftung(?!sausschluss)/.test(lower)) { score += 3; hits.push('haft'); }
    if (/haftungsausschluss/.test(lower)) { score += 8; hits.push('haft-aus'); }
    if (/zahlungsbedingungen/.test(lower)) { score += 5; hits.push('zahl'); }
    if (/vertragsabschluss/.test(lower)) { score += 5; hits.push('vertr-ab'); }
    if (/schlussbestimmungen/.test(lower)) { score += 5; hits.push('schluss'); }
    if (/salvatorische/.test(lower)) { score += 8; hits.push('salv'); }
    if (/höhere\s+gewalt/.test(lower)) { score += 5; hits.push('hg'); }
    if (/widerrufsbelehrung/.test(lower)) { score += 8; hits.push('wbel'); }
    if (/gerichtsstand/.test(lower)) { score += 5; hits.push('ger'); }

    console.log(`\n=== Seite ${i} | Score: ${score} | Hits: [${hits.join(', ')}] ===`);
    console.log('Text length:', text.length);
    console.log('First 300 chars:', text.substring(0, 300).replace(/\s+/g, ' '));
    console.log('---');
    console.log('Last 200 chars:', text.substring(Math.max(0, text.length - 200)).replace(/\s+/g, ' '));
  }
})();
