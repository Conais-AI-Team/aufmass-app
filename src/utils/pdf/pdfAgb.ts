// Modül F: AGB (terms) page renderer with simple **bold** and *italic* parsing
import type { jsPDF } from 'jspdf';

interface FormattedSegment {
  text: string;
  style: 'normal' | 'bold' | 'italic';
}

// Parse line into formatted segments using matchAll (avoids exec)
function parseInlineFormatting(text: string): FormattedSegment[] {
  const segments: FormattedSegment[] = [];
  const matches = Array.from(text.matchAll(/(\*\*[^*]+\*\*|\*[^*]+\*)/g));
  let last = 0;

  for (const match of matches) {
    const idx = match.index ?? 0;
    if (idx > last) segments.push({ text: text.substring(last, idx), style: 'normal' });
    if (match[0].startsWith('**')) {
      segments.push({ text: match[0].slice(2, -2), style: 'bold' });
    } else {
      segments.push({ text: match[0].slice(1, -1), style: 'italic' });
    }
    last = idx + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.substring(last), style: 'normal' });
  if (segments.length === 0) segments.push({ text, style: 'normal' });
  return segments;
}

export function drawAgbPages(pdf: jsPDF, content: string): number {
  if (!content || !content.trim()) return 0;

  pdf.addPage();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  let yPos = 30;

  // Title
  pdf.setTextColor(20, 20, 20);
  pdf.setFontSize(15);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Allgemeine Geschäftsbedingungen', margin, yPos);
  yPos += 4;

  // Green underline
  pdf.setDrawColor(127, 169, 61);
  pdf.setLineWidth(0.6);
  pdf.line(margin, yPos, margin + 80, yPos);
  yPos += 8;

  pdf.setFontSize(11);
  pdf.setTextColor(50, 50, 50);
  pdf.setFont('helvetica', 'normal');

  const lineHeight = 5.5;
  const maxX = pageWidth - margin;
  const paragraphs = content.split('\n');

  for (const para of paragraphs) {
    if (yPos > pageHeight - 40) {
      pdf.addPage();
      yPos = 25;
    }

    if (!para.trim()) {
      yPos += 3;
      continue;
    }

    // Parse inline formatting
    const segments = parseInlineFormatting(para);
    let xPos = margin;

    for (const seg of segments) {
      const fontStyle: 'normal' | 'bold' | 'italic' = seg.style;
      pdf.setFont('helvetica', fontStyle);

      // Word-by-word with wrap
      const words = seg.text.split(/(\s+)/);
      for (const word of words) {
        if (!word) continue;
        const wordWidth = pdf.getTextWidth(word);

        if (xPos + wordWidth > maxX) {
          yPos += lineHeight;
          xPos = margin;
          if (yPos > pageHeight - 40) {
            pdf.addPage();
            yPos = 25;
          }
        }

        pdf.text(word, xPos, yPos);
        xPos += wordWidth;
      }
    }
    yPos += lineHeight + 0.5;
  }
  return yPos;
}
