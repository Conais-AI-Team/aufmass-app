// Modül F: Product detail page (lifestyle photo + description + product photos)
import type { jsPDF } from 'jspdf';

export interface ProductDetailData {
  productName: string;
  description: string;
  images: { base64?: string }[];
}

export function drawProductDetailPage(pdf: jsPDF, data: ProductDetailData): void {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  let yPos = 25;

  // Big lifestyle image (first non-cover image)
  if (data.images.length > 0 && data.images[0].base64) {
    const imgHeight = 85;
    try {
      pdf.addImage(data.images[0].base64, 'JPEG', margin, yPos, pageWidth - 2 * margin, imgHeight, undefined, 'FAST');
      yPos += imgHeight + 12;
    } catch {
      yPos += 4;
    }
  }

  // Product name heading
  pdf.setTextColor(20, 20, 20);
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  pdf.text(data.productName, margin, yPos);
  yPos += 8;

  // Green underline
  pdf.setDrawColor(127, 169, 61);
  pdf.setLineWidth(0.8);
  const titleWidth = Math.min(pdf.getTextWidth(data.productName) + 6, pageWidth - 2 * margin);
  pdf.line(margin, yPos - 2, margin + titleWidth, yPos - 2);
  yPos += 4;

  // Description (paragraph + line breaks)
  if (data.description) {
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(60, 60, 60);
    const lines = data.description.split('\n');
    for (const line of lines) {
      if (yPos > pageHeight - 50) break;
      if (!line.trim()) {
        yPos += 3;
        continue;
      }
      const wrapped = pdf.splitTextToSize(line, pageWidth - 2 * margin);
      pdf.text(wrapped, margin, yPos);
      yPos += wrapped.length * 5;
    }
    yPos += 6;
  }

  // Additional images (2-3) in horizontal grid
  const remainingImages = data.images.slice(1, 3).filter((img) => img.base64);
  if (remainingImages.length > 0) {
    const imgWidth = (pageWidth - 2 * margin - (remainingImages.length - 1) * 4) / remainingImages.length;
    const imgHeight = 55;

    if (yPos + imgHeight > pageHeight - 35) {
      pdf.addPage();
      yPos = 25;
    }

    let imgX = margin;
    for (const img of remainingImages) {
      try {
        pdf.addImage(img.base64!, 'JPEG', imgX, yPos, imgWidth, imgHeight, undefined, 'FAST');
      } catch {
        // skip on error
      }
      imgX += imgWidth + 4;
    }
    yPos += imgHeight + 6;
  }

  pdf.addPage();
}
