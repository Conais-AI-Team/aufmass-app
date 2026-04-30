// Modül F: Cover page generator (Living-Deluxe-style)
import type { jsPDF } from 'jspdf';
import type { BranchCompanyInfoForPdf } from '../pdfGenerator';

const COVER_SLOGAN = 'AYLUX SONNENSCHUTZSYSTEME';

export interface CoverData {
  productName: string;
  customerName: string;
  documentType: 'Angebot' | 'Aufmass' | 'Abnahme' | 'Rechnung';
  documentNumber?: string;
  documentDate: Date;
  coverImages: { base64?: string }[];
  companyInfo: BranchCompanyInfoForPdf | null;
}

export function drawCoverPage(pdf: jsPDF, data: CoverData): void {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;

  // Top-left: Branch firma adı (büyük, yeşil)
  if (data.companyInfo?.company_name) {
    pdf.setTextColor(127, 169, 61);
    pdf.setFontSize(24);
    pdf.setFont('helvetica', 'bold');
    pdf.text(data.companyInfo.company_name.toUpperCase(), margin, 28);
  }

  // Top-right: "IHR [PRODUKT] [TIP]"
  const docTypeMap: Record<typeof data.documentType, string> = {
    Angebot: 'ANGEBOT',
    Aufmass: 'AUFMASS',
    Abnahme: 'ABNAHME',
    Rechnung: 'RECHNUNG'
  };
  const rightTitle = `IHR ${data.productName.toUpperCase()} ${docTypeMap[data.documentType]}`;
  pdf.setTextColor(40, 40, 40);
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'normal');
  pdf.text(rightTitle, pageWidth - margin, 23, { align: 'right' });

  // Yeşil etiket — sağ üstte (Living tarzı)
  const tagY = 28;
  const tagWidth = 95;
  const tagHeight = 16;
  pdf.setFillColor(127, 169, 61);
  pdf.rect(pageWidth - margin - tagWidth, tagY, tagWidth, tagHeight, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.text('PROFESSIONELLE FACHBERATUNG', pageWidth - margin - 4, tagY + 6.5, { align: 'right' });
  pdf.text('& MONTAGE AUS EINER HAND', pageWidth - margin - 4, tagY + 12, { align: 'right' });

  const validImages = data.coverImages.filter(img => img?.base64);
  const imgAreaY = 60;
  const imgAreaHeight = pageHeight - imgAreaY - 38; // ~bottom slogan'a kadar
  const imgWidth = pageWidth - 2 * margin;

  if (validImages.length === 0) {
    // === GENERIC TEXT-BASED COVER (resim yok) ===
    drawGenericCover(pdf, pageWidth, imgAreaY, imgAreaHeight, margin, data);
  } else if (validImages.length === 1) {
    // 1 büyük resim — alanın tamamı
    try {
      pdf.addImage(validImages[0].base64!, 'JPEG', margin, imgAreaY, imgWidth, imgAreaHeight, undefined, 'FAST');
    } catch {
      drawGenericCover(pdf, pageWidth, imgAreaY, imgAreaHeight, margin, data);
    }
  } else {
    // 2 stacked
    const singleHeight = (imgAreaHeight - 4) / 2;
    for (let i = 0; i < 2; i++) {
      const yPos = imgAreaY + i * (singleHeight + 4);
      try {
        pdf.addImage(validImages[i].base64!, 'JPEG', margin, yPos, imgWidth, singleHeight, undefined, 'FAST');
      } catch {
        // skip
      }
    }
  }

  // Alt: Sabit slogan banner
  const sloganY = pageHeight - 28;
  pdf.setFillColor(127, 169, 61);
  pdf.rect(0, sloganY, pageWidth, 18, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(13);
  pdf.setFont('helvetica', 'bold');
  pdf.text(COVER_SLOGAN, pageWidth / 2, sloganY + 11.5, { align: 'center' });

  // Cover sonrası yeni sayfa
  pdf.addPage();
}

// Generic text-based cover (resim yokken)
function drawGenericCover(
  pdf: jsPDF,
  pageWidth: number,
  startY: number,
  height: number,
  margin: number,
  data: CoverData
): void {
  // Soft background
  pdf.setFillColor(248, 250, 245);
  pdf.rect(margin, startY, pageWidth - 2 * margin, height, 'F');

  // Sol köşe yeşil aksent şerit
  pdf.setFillColor(127, 169, 61);
  pdf.rect(margin, startY, 6, height, 'F');

  const centerX = pageWidth / 2;
  const centerY = startY + height / 2;

  // Büyük ürün adı (merkez)
  pdf.setTextColor(30, 30, 30);
  pdf.setFontSize(32);
  pdf.setFont('helvetica', 'bold');
  const productNameLines = pdf.splitTextToSize(data.productName.toUpperCase(), pageWidth - 2 * margin - 20);
  const productNameY = centerY - 18 - (productNameLines.length - 1) * 6;
  pdf.text(productNameLines, centerX, productNameY, { align: 'center' });

  // Yeşil ayırıcı
  pdf.setDrawColor(127, 169, 61);
  pdf.setLineWidth(1.5);
  const lineY = productNameY + productNameLines.length * 11;
  pdf.line(centerX - 30, lineY, centerX + 30, lineY);

  // Belge tipi alt başlık
  const docTypeMap: Record<typeof data.documentType, string> = {
    Angebot: 'Individuelles Angebot',
    Aufmass: 'Aufmaß-Datenblatt',
    Abnahme: 'Abnahme-Protokoll',
    Rechnung: 'Rechnung'
  };
  pdf.setTextColor(127, 169, 61);
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'normal');
  pdf.text(docTypeMap[data.documentType], centerX, lineY + 10, { align: 'center' });

  // Müşteri bilgisi
  pdf.setTextColor(80, 80, 80);
  pdf.setFontSize(11);
  pdf.text(`für ${data.customerName}`, centerX, lineY + 22, { align: 'center' });

  // Tarih + belge no
  pdf.setTextColor(120, 120, 120);
  pdf.setFontSize(9);
  const dateStr = data.documentDate.toLocaleDateString('de-DE');
  let metaText = `Datum: ${dateStr}`;
  if (data.documentNumber) metaText += `   ·   Nr.: ${data.documentNumber}`;
  pdf.text(metaText, centerX, lineY + 32, { align: 'center' });
}
