// Heuristic detection of AGB pages within an uploaded PDF.
// Returns suggested 1-based page numbers (longest contiguous high-score block).

import { pdfjsLib } from './pdf/pdfWorkerSetup';

interface PageScore {
  page: number;
  score: number;
}

// Lowered threshold — many real AGBs use "Vertragsbedingungen", "Montagebedingungen" etc.
// instead of the canonical "Allgemeine Geschäftsbedingungen", scoring lower than 25.
const SCORE_THRESHOLD = 10;

export interface AgbDetectionResult {
  suggestedPages: number[];
  totalPages: number;
  perPageScores: PageScore[];
  confidence: 'hoch' | 'mittel' | 'niedrig';
}

export async function detectAgbPages(pdfBytes: Uint8Array): Promise<AgbDetectionResult> {
  // Pass a fresh copy because pdfjsLib transfers (detaches) the buffer it receives
  const data = new Uint8Array(pdfBytes);
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const numPages = pdf.numPages;
  const scores: PageScore[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items
      .map((item) => ('str' in item ? (item as { str: string }).str : ''))
      .join(' ')
      .toLowerCase();

    let score = 0;

    // Title patterns (one of these almost always appears on the first AGB page)
    if (/allgemeine\s+geschäftsbedingungen/.test(text)) score += 50;
    if (/vertrags[-\s&]+(?:und\s+)?montagebedingungen/.test(text)) score += 40;
    if (/(?:vertrags|montage|verkaufs|liefer)bedingungen/.test(text)) score += 25;
    if (/geschäftsbedingungen/.test(text) && score === 0) score += 20;
    if (/\bagb\b/.test(text)) score += 15;

    // Paragraph markers (§ N) — strongly indicate legal text
    const paragraphMarkers = text.match(/§\s*\d+/g);
    if (paragraphMarkers) score += Math.min(paragraphMarkers.length * 10, 50);

    // Numbered clause headings like "1.2.3" or "2.1." — typical AGB structure
    const numberedClauses = text.match(/\b\d+\.\d+(?:\.\d+)?\.?\s/g);
    if (numberedClauses) score += Math.min(numberedClauses.length * 2, 30);

    // Domain-specific AGB keywords
    if (/widerrufsrecht/.test(text)) score += 5;
    if (/gewährleistung/.test(text)) score += 5;
    if (/datenschutz/.test(text)) score += 5;
    if (/lieferzeit/.test(text)) score += 5;
    if (/eigentumsvorbehalt/.test(text)) score += 5;
    if (/haftung(?!sausschluss)/.test(text)) score += 3;
    if (/haftungsausschluss/.test(text)) score += 8;
    if (/zahlungsbedingungen/.test(text)) score += 5;
    if (/vertragsabschluss/.test(text)) score += 5;
    if (/schlussbestimmungen/.test(text)) score += 5;
    if (/salvatorische/.test(text)) score += 8;
    if (/höhere\s+gewalt/.test(text)) score += 5;
    if (/anzahlung/.test(text)) score += 3;
    if (/restzahlung/.test(text)) score += 3;
    if (/widerrufsbelehrung/.test(text)) score += 8;
    if (/gerichtsstand/.test(text)) score += 5;

    scores.push({ page: i, score });
  }

  // Find longest contiguous block where score >= threshold
  let bestStart = -1;
  let bestEnd = -1;
  let curStart = -1;

  for (let i = 0; i < scores.length; i++) {
    if (scores[i].score >= SCORE_THRESHOLD) {
      if (curStart === -1) curStart = i;
      const curEnd = i;
      if (bestStart === -1 || curEnd - curStart > bestEnd - bestStart) {
        bestStart = curStart;
        bestEnd = curEnd;
      }
    } else {
      curStart = -1;
    }
  }

  let suggestedPages: number[] = [];
  let confidence: 'hoch' | 'mittel' | 'niedrig' = 'niedrig';

  if (bestStart !== -1) {
    suggestedPages = [];
    for (let i = bestStart; i <= bestEnd; i++) suggestedPages.push(scores[i].page);
    const blockMax = Math.max(...scores.slice(bestStart, bestEnd + 1).map((s) => s.score));
    confidence = blockMax >= 50 ? 'hoch' : blockMax >= 30 ? 'mittel' : 'niedrig';
  }
  // Else: no AGB block detected — return empty so user picks manually.
  // Selecting all pages would silently include cover/marketing pages, which is worse than no suggestion.

  return { suggestedPages, totalPages: numPages, perPageScores: scores, confidence };
}
