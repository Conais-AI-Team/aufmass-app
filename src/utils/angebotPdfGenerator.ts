import { jsPDF } from 'jspdf';
import { getCompanyInfoForPdf } from './companyInfoCache';
import {
  fetchServerImageAsBase64,
  fixImageOrientationAuto,
  getImageDimensions,
  type ServerImage,
} from './pdfGenerator';

export interface BranchCompanyInfoForPdf {
  company_name: string;
  company_strasse: string;
  company_plz: string;
  company_ort: string;
  company_telefon: string;
  company_email: string;
  company_ust_id: string;
  company_web?: string;
  company_steuernr?: string;
  company_iban?: string;
  company_bic?: string;
  company_bank_name?: string;
  company_geschaeftsfuehrer?: string;
  company_handelsregister?: string;
}

export interface AngebotPdfItem {
  product_name: string;
  breite: number;
  tiefe: number;
  quantity: number;
  unit_price: number;
  total_price: number;
  discount?: number;
  discount_percent?: number;
  pricing_type?: 'dimension' | 'unit';
  unit_label?: string;
  description?: string;
  custom_fields?: { id: string; label: string; type: string; unit?: string; options?: string[]; required?: boolean }[];
  custom_field_values?: Record<string, string>;
}

export interface AngebotPdfExtra {
  description: string;
  price: number;
}

export interface AngebotPdfData {
  // Customer
  customer_firstname: string;
  customer_lastname: string;
  customer_email: string;
  customer_phone?: string;
  customer_address?: string;
  notes?: string;
  kunden_nummer?: string;
  angebot_nummer?: string;

  // Products
  items: AngebotPdfItem[];
  extras: AngebotPdfExtra[];

  // Pricing with discounts
  subtotal?: number;
  item_discounts?: number;
  total_discount?: number;
  total_discount_percent?: number;
  total_price: number;

  // Optional measurement data (from Aufmaß)
  hasMeasurements?: boolean;
  measurements?: {
    category?: string;
    productType?: string;
    model?: string;
    specifications?: Record<string, unknown>;
  };

  // Meta
  created_at?: string;
  angebotNummer?: string;

  // MODÜL B — Photos pulled from a source Aufmaß. Same handling as the
  // Aufmaß PDF generator (server fetch → EXIF orientation fix → embed).
  bilder?: ServerImage[];
}

const formatPrice = (price: number) => {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price);
};

export const generateAngebotPDF = async (
  data: AngebotPdfData,
  options?: { returnBlob?: boolean; companyInfo?: BranchCompanyInfoForPdf }
): Promise<{ blob: Blob; fileName: string } | void> => {
  const companyInfo = options?.companyInfo || (await getCompanyInfoForPdf()) || undefined;
  const companyName = companyInfo?.company_name || 'AYLUX Sonnenschutzsysteme';
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  let yPos = 20;

  const checkNewPage = (requiredSpace: number = 15) => {
    if (yPos + requiredSpace > pageHeight - 25) {
      pdf.addPage();
      yPos = 25;
      return true;
    }
    return false;
  };

  // ============ HEADER ============
  // AYLUX Logo (sabit, branch'a göre değişmez)
  pdf.setFillColor(127, 169, 61);
  pdf.rect(pageWidth - 70, 10, 50, 25, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  pdf.text('AYLUX', pageWidth - 60, 22);
  pdf.setFontSize(7);
  pdf.text('SONNENSCHUTZSYSTEME', pageWidth - 65, 28);

  // Absender line (branch firma bilgileri — küçük tek satır üstte)
  if (companyInfo && companyInfo.company_name) {
    const absenderParts: string[] = [companyInfo.company_name];
    if (companyInfo.company_strasse) absenderParts.push(companyInfo.company_strasse);
    if (companyInfo.company_plz || companyInfo.company_ort) {
      absenderParts.push(`${companyInfo.company_plz || ''} ${companyInfo.company_ort || ''}`.trim());
    }
    if (companyInfo.company_telefon) absenderParts.push(`Tel: ${companyInfo.company_telefon}`);
    pdf.setTextColor(120, 120, 120);
    pdf.setFontSize(7);
    pdf.setFont('helvetica', 'normal');
    const absenderText = absenderParts.join('  ·  ');
    const maxAbsenderWidth = pageWidth - 70 - margin - 4;
    const absenderLines = pdf.splitTextToSize(absenderText, maxAbsenderWidth);
    pdf.text(absenderLines, margin, 14);
  }

  // Title — auto-fit to available width left of logo
  pdf.setTextColor(0, 0, 0);
  pdf.setFont('helvetica', 'bold');
  const titleText = 'ANGEBOTS- & AUFTRAGSFORMULAR / KAUFVERTRAG';
  const availableTitleWidth = (pageWidth - 70) - margin - 4; // 4mm gap before logo block
  let titleSize = 14;
  pdf.setFontSize(titleSize);
  while (pdf.getTextWidth(titleText) > availableTitleWidth && titleSize > 8) {
    titleSize -= 0.5;
    pdf.setFontSize(titleSize);
  }
  pdf.text(titleText, margin, 24);

  // Date below title
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(100, 100, 100);
  const dateStr = data.created_at
    ? new Date(data.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  pdf.text(`Datum: ${dateStr}`, margin, 32);

  yPos = 50;

  // ============ CUSTOMER INFO ============
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.setFillColor(127, 169, 61);
  pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.text('KUNDENDATEN', margin + 3, yPos);
  yPos += 12;

  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(10);

  const customerFields: [string, string][] = [];
  if (data.kunden_nummer) customerFields.push(['Kundennr.:', data.kunden_nummer]);
  if (data.angebot_nummer) customerFields.push(['Angebot Nr.:', data.angebot_nummer]);
  customerFields.push(['Name:', `${data.customer_firstname} ${data.customer_lastname}`]);
  customerFields.push(['E-Mail:', data.customer_email]);
  if (data.customer_phone) customerFields.push(['Telefon:', data.customer_phone]);
  if (data.customer_address) customerFields.push(['Adresse:', data.customer_address]);

  customerFields.forEach(([label, value]) => {
    pdf.setFont('helvetica', 'bold');
    pdf.text(label, margin + 3, yPos);
    pdf.setFont('helvetica', 'normal');
    const lines = pdf.splitTextToSize(value, pageWidth - margin - 60);
    pdf.text(lines, margin + 40, yPos);
    yPos += 6 * lines.length;
  });

  yPos += 12;

  // ============ PRODUCTS TABLE ============
  if (data.items.length > 0) {
    checkNewPage(60);

    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setFillColor(127, 169, 61);
    pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.text('PRODUKTE', margin + 3, yPos);
    yPos += 12;

    pdf.setTextColor(0, 0, 0);

    // Check if any discounts exist
    const hasDiscounts = data.items.some(item => item.discount && item.discount > 0);

    // Table header - adjust columns based on discounts
    const colX = hasDiscounts ? {
      produkt: margin + 3,
      abmessungen: margin + 52,
      menge: margin + 85,
      einzelpreis: margin + 102,
      rabatt: margin + 128,
      gesamt: margin + 150
    } : {
      produkt: margin + 3,
      abmessungen: margin + 60,
      menge: margin + 100,
      einzelpreis: margin + 118,
      rabatt: 0,
      gesamt: margin + 145
    };
    const tableWidth = pageWidth - 2 * margin;

    pdf.setFillColor(240, 240, 240);
    pdf.rect(margin, yPos - 4, tableWidth, 8, 'F');

    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Produkt', colX.produkt, yPos);
    pdf.text('Abmessungen', colX.abmessungen, yPos);
    pdf.text('Menge', colX.menge, yPos);
    pdf.text('Einzelpreis', colX.einzelpreis, yPos);
    if (hasDiscounts) {
      pdf.text('Rabatt', colX.rabatt, yPos);
    }
    pdf.text('Gesamt', colX.gesamt, yPos);
    yPos += 8;

    // Table rows
    pdf.setFont('helvetica', 'normal');
    data.items.forEach((item) => {
      checkNewPage(12);

      pdf.setTextColor(0, 0, 0);
      pdf.text(item.product_name, colX.produkt, yPos);
      const dimText = item.pricing_type === 'unit'
        ? (item.unit_label || 'Einheit')
        : `${item.breite} x ${item.tiefe} cm`;
      pdf.text(dimText, colX.abmessungen, yPos);
      pdf.text(String(item.quantity), colX.menge, yPos);
      pdf.text(`${formatPrice(item.unit_price)} EUR`, colX.einzelpreis, yPos);

      if (hasDiscounts) {
        if (item.discount && item.discount > 0) {
          pdf.setTextColor(220, 38, 38); // Red for discount
          const discountText = item.discount_percent
            ? `-${formatPrice(item.discount)} (${item.discount_percent}%)`
            : `-${formatPrice(item.discount)}`;
          pdf.text(discountText, colX.rabatt, yPos);
          pdf.setTextColor(0, 0, 0);
        } else {
          pdf.text('-', colX.rabatt, yPos);
        }
      }

      pdf.text(`${formatPrice(item.total_price)} EUR`, colX.gesamt, yPos);
      yPos += 7;

      // Description below product row.
      // Prefer the angebot-level Beschreibung (data.notes) when present — that's where
      // the user-typed Beschreibung from the form lands. Falls back to the product master
      // description otherwise. Wrapped to fit table width so long text never overflows.
      const descText = (data.notes && data.notes.trim()) ? data.notes.trim() : item.description;
      if (descText) {
        pdf.setFontSize(8.5);
        pdf.setTextColor(80, 80, 80);
        const descMaxWidth = (margin + tableWidth) - (colX.produkt + 3) - 3;
        const descLines = pdf.splitTextToSize(descText, descMaxWidth);
        for (const line of descLines) {
          checkNewPage(6);
          pdf.text(line, colX.produkt + 3, yPos);
          yPos += 5;
        }
        pdf.setFontSize(10);
        pdf.setTextColor(0, 0, 0);
        yPos += 1;
      }

      // Custom field values (below description)
      if (item.custom_fields && item.custom_field_values) {
        const filledFields = item.custom_fields.filter(f => item.custom_field_values![f.id]);
        if (filledFields.length > 0) {
          pdf.setFontSize(8.5);
          pdf.setTextColor(80, 80, 80);
          filledFields.forEach(field => {
            checkNewPage(6);
            const val = item.custom_field_values![field.id];
            const suffix = field.type === 'number' && field.unit ? ` ${field.unit}` : '';
            pdf.setFont('helvetica', 'bold');
            pdf.text(`${field.label}:`, colX.produkt + 3, yPos);
            const labelWidth = pdf.getTextWidth(`${field.label}:`);
            pdf.setFont('helvetica', 'normal');
            pdf.text(`${val}${suffix}`, colX.produkt + 3 + labelWidth + 3, yPos);
            yPos += 5;
          });
          pdf.setFontSize(10);
          pdf.setTextColor(0, 0, 0);
          yPos += 1;
        }
      }

      // Row separator
      pdf.setDrawColor(230, 230, 230);
      pdf.setLineWidth(0.2);
      pdf.line(margin, yPos - 3, margin + tableWidth, yPos - 3);
    });

    yPos += 5;
  }

  // ============ EXTRAS ============
  if (data.extras.length > 0) {
    checkNewPage(40);

    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setFillColor(127, 169, 61);
    pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.text('ZUSATZLEISTUNGEN', margin + 3, yPos);
    yPos += 12;

    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(10);

    data.extras.forEach((extra) => {
      checkNewPage(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text(extra.description, margin + 3, yPos);
      pdf.text(`${formatPrice(extra.price)} EUR`, margin + 155, yPos);
      yPos += 7;

      pdf.setDrawColor(230, 230, 230);
      pdf.setLineWidth(0.2);
      pdf.line(margin, yPos - 3, pageWidth - margin, yPos - 3);
    });

    yPos += 5;
  }

  // ============ MEASUREMENT DATA (if available) ============
  if (data.hasMeasurements && data.measurements) {
    checkNewPage(40);

    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setFillColor(52, 131, 235);
    pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.text('MESSDATEN', margin + 3, yPos);
    yPos += 12;

    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(10);

    const m = data.measurements;

    if (m.category) {
      pdf.setFont('helvetica', 'bold');
      pdf.text('Kategorie:', margin + 3, yPos);
      pdf.setFont('helvetica', 'normal');
      pdf.text(m.category, margin + 40, yPos);
      yPos += 6;
    }
    if (m.productType) {
      pdf.setFont('helvetica', 'bold');
      pdf.text('Produkttyp:', margin + 3, yPos);
      pdf.setFont('helvetica', 'normal');
      pdf.text(m.productType, margin + 40, yPos);
      yPos += 6;
    }
    if (m.model) {
      pdf.setFont('helvetica', 'bold');
      pdf.text('Modell:', margin + 3, yPos);
      pdf.setFont('helvetica', 'normal');
      pdf.text(String(m.model), margin + 40, yPos);
      yPos += 6;
    }

    // Specifications
    if (m.specifications && Object.keys(m.specifications).length > 0) {
      yPos += 3;
      Object.entries(m.specifications).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '' && key !== 'montageteam' && key !== 'markiseData' && key !== 'markiseActive') {
          checkNewPage();
          pdf.setFont('helvetica', 'bold');
          const labelText = `${key}:`;
          pdf.text(labelText, margin + 3, yPos);
          const labelWidth = pdf.getTextWidth(labelText);
          const valueX = Math.max(margin + 50, margin + 3 + labelWidth + 12);
          pdf.setFont('helvetica', 'normal');
          const displayVal = typeof val === 'boolean' ? (val ? 'Ja' : 'Nein') : String(val);
          const lines = pdf.splitTextToSize(displayVal, pageWidth - valueX - margin);
          pdf.text(lines, valueX, yPos);
          yPos += 6 * lines.length;
        }
      });
    }

    yPos += 10;
  }

  // ============ TOTAL ============
  const hasAnyDiscounts = (data.item_discounts && data.item_discounts > 0) || (data.total_discount && data.total_discount > 0);
  const totalDiscountAmount = (data.item_discounts || 0) + (data.total_discount || 0);

  checkNewPage(hasAnyDiscounts ? 60 : 30);
  yPos += 5;

  // Summary section
  const summaryX = pageWidth - margin - 100;

  if (hasAnyDiscounts && data.subtotal) {
    // Subtotal
    pdf.setTextColor(80, 80, 80);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Zwischensumme:', summaryX, yPos);
    pdf.text(`${formatPrice(data.subtotal)} EUR`, summaryX + 60, yPos);
    yPos += 7;

    // Item discounts
    if (data.item_discounts && data.item_discounts > 0) {
      pdf.setTextColor(220, 38, 38);
      pdf.text('Artikel-Rabatt:', summaryX, yPos);
      pdf.text(`-${formatPrice(data.item_discounts)} EUR`, summaryX + 60, yPos);
      yPos += 7;
    }

    // Total discount
    if (data.total_discount && data.total_discount > 0) {
      pdf.setTextColor(220, 38, 38);
      pdf.text('Gesamt-Rabatt:', summaryX, yPos);
      pdf.text(`-${formatPrice(data.total_discount)} EUR`, summaryX + 60, yPos);
      yPos += 7;
    }

    // Total savings with percentage
    if (totalDiscountAmount > 0 && data.total_discount_percent) {
      pdf.setTextColor(220, 38, 38);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`Sie sparen: ${formatPrice(totalDiscountAmount)} EUR (${data.total_discount_percent}%)`, summaryX, yPos);
      yPos += 10;
    }

    pdf.setTextColor(0, 0, 0);
  }

  // Total box (green) — KEPT per user instruction
  const totalBoxWidth = 80;
  const totalBoxX = pageWidth - margin - totalBoxWidth;
  pdf.setFillColor(127, 169, 61);
  pdf.roundedRect(totalBoxX, yPos - 5, totalBoxWidth, 20, 3, 3, 'F');

  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.text('Gesamtsumme:', totalBoxX + 5, yPos + 2);
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.text(`${formatPrice(data.total_price)} EUR`, totalBoxX + 5, yPos + 11);

  // Netto + 19% MwSt below the green box, left-aligned to the same x as the main
  // "2.227,00 EUR" price inside the green box (totalBoxX + 5)
  const nettoPrice = data.total_price / 1.19;
  const mwstPrice = data.total_price - nettoPrice;
  pdf.setTextColor(100, 100, 100);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Netto: ${formatPrice(nettoPrice)} EUR`, totalBoxX + 5, yPos + 22);
  pdf.text(`19% MwSt.: ${formatPrice(mwstPrice)} EUR`, totalBoxX + 5, yPos + 28);

  yPos += 38;

  // ============ VERBINDLICHE AUFTRAGSERTEILUNG ============
  // Right column, aligned under the green Gesamtsumme box (NOT left margin)
  checkNewPage(45);
  yPos += 10;

  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Verbindliche Auftragserteilung', totalBoxX, yPos);
  yPos += 25;

  // Signature line — only spans the right column under the totals box
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.4);
  pdf.line(totalBoxX, yPos, pageWidth - margin, yPos);
  yPos += 5;

  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80, 80, 80);
  pdf.text('Datum, Unterschrift Kunde/Auftraggeber', totalBoxX, yPos);
  pdf.setTextColor(0, 0, 0);

  // ============ MODÜL B — BILDER (from source Aufmaß) ============
  // Mirrors the photo-embed pass in pdfGenerator.ts. Image-typed entries only;
  // PDF attachments on the Aufmaß are intentionally skipped here so the
  // Angebot PDF stays focused on visual context for the customer.
  const aufmassImages = (data.bilder || []).filter(b =>
    (b.file_type || '').startsWith('image/')
  );
  if (aufmassImages.length > 0) {
    pdf.addPage();
    let imgYPos = 20;

    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setFillColor(127, 169, 61);
    pdf.rect(margin, imgYPos - 5, pageWidth - 2 * margin, 8, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.text('BILDER VOM AUFMASS', margin + 2, imgYPos);
    imgYPos += 15;

    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(10);

    for (let i = 0; i < aufmassImages.length; i++) {
      const item = aufmassImages[i];
      try {
        let base64 = await fetchServerImageAsBase64(item.id);
        try {
          base64 = await fixImageOrientationAuto(base64);
        } catch {
          // Use original if orientation fix fails — non-critical
        }

        const dimensions = await getImageDimensions(base64);
        const maxWidth = pageWidth - 2 * margin;
        const maxHeight = 80;

        let imgWidth = dimensions.width;
        let imgHeight = dimensions.height;
        if (imgWidth > maxWidth) {
          const ratio = maxWidth / imgWidth;
          imgWidth = maxWidth;
          imgHeight = imgHeight * ratio;
        }
        if (imgHeight > maxHeight) {
          const ratio = maxHeight / imgHeight;
          imgHeight = maxHeight;
          imgWidth = imgWidth * ratio;
        }

        if (imgYPos + imgHeight + 15 > pageHeight - 20) {
          pdf.addPage();
          imgYPos = 20;
        }

        pdf.setFont('helvetica', 'bold');
        pdf.text(`Bild ${i + 1}: ${item.file_name}`, margin, imgYPos);
        imgYPos += 5;

        const xPos = margin + (maxWidth - imgWidth) / 2;
        pdf.addImage(base64, 'JPEG', xPos, imgYPos, imgWidth, imgHeight);
        imgYPos += imgHeight + 15;
      } catch (err) {
        console.error('Failed to embed Aufmaß image in Angebot PDF:', err);
        pdf.setFont('helvetica', 'italic');
        pdf.text(`Bild ${i + 1}: ${item.file_name} - Konnte nicht geladen werden`, margin, imgYPos);
        imgYPos += 10;
      }
    }
  }

  // ============ FOOTER ============
  const pageCount = (pdf as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8);
    pdf.setTextColor(128, 128, 128);
    pdf.setFont('helvetica', 'normal');
    pdf.text(
      `Seite ${i} von ${pageCount}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
    pdf.text(
      `Erstellt am: ${new Date().toLocaleDateString('de-DE')}`,
      margin,
      pageHeight - 10
    );
    pdf.text(
      companyName,
      pageWidth - margin,
      pageHeight - 10,
      { align: 'right' }
    );
  }

  // Generate filename
  const customerName = `${data.customer_firstname}_${data.customer_lastname}`.replace(/\s+/g, '_');
  const fileName = `Angebot_${customerName}_${dateStr.replace(/\./g, '-')}.pdf`;

  if (options?.returnBlob) {
    const blob = pdf.output('blob');
    return { blob, fileName };
  }

  pdf.save(fileName);
};
