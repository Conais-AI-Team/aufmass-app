import { jsPDF } from 'jspdf';
import { getCompanyInfoForPdf } from './companyInfoCache';
import { drawGeschaeftsbriefFooter } from './pdfFooter';
import { drawCoverPage } from './pdf/pdfCover';
import { drawProductDetailPage } from './pdf/pdfProductDetail';
import { drawAgbPages } from './pdf/pdfAgb';
import { mergePdf } from './pdf/pdfMerger';
import { getCachedProductImages, fetchImageAsBase64 } from './productImagesCache';
import { getCachedBranchTerms } from './branchTermsCache';
import { getProductCoverPdf, fetchBranchPdfBytes } from '../services/api';

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
  product_id?: number;  // Modül F: needed for product image lookup
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
}

const formatPrice = (price: number) => {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price);
};

export const generateAngebotPDF = async (
  data: AngebotPdfData,
  options?: {
    returnBlob?: boolean;
    companyInfo?: BranchCompanyInfoForPdf;
    /** When true, skip embedding AGB into this PDF (caller will attach AGB separately).
     *  Speeds up split-per-product flows: AGB ships once as an email attachment,
     *  not embedded N times. */
    skipAgbMerge?: boolean;
  }
): Promise<{ blob: Blob; fileName: string } | void> => {
  const companyInfo = options?.companyInfo || (await getCompanyInfoForPdf()) || undefined;
  const companyName = companyInfo?.company_name || 'AYLUX Sonnenschutzsysteme';
  const branchTerms = await getCachedBranchTerms();
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  let yPos = 20;

  const dateStr = data.created_at
    ? new Date(data.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const checkNewPage = (requiredSpace: number = 15) => {
    if (yPos + requiredSpace > pageHeight - 48) {
      pdf.addPage();
      yPos = 25;
      return true;
    }
    return false;
  };

  // ===================================================================
  // HELPERS — drawn into the *current* jsPDF page; mutate `yPos` via return
  // ===================================================================

  // Logo, company name + address + STEUER block, title, date.
  // Always starts at the top of the current page; returns the y where content can continue.
  const drawHeader = (): number => {
    yPos = 20;

    // AYLUX logo block — top-right
    pdf.setFillColor(127, 169, 61);
    pdf.rect(pageWidth - 60, 10, 40, 20, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(15);
    pdf.setFont('helvetica', 'bold');
    pdf.text('AYLUX', pageWidth - 52, 21);
    pdf.setFontSize(6);
    pdf.text('SONNENSCHUTZSYSTEME', pageWidth - 56, 26);

    let c1Y = 33;
    let c2Y = 33;
    if (companyInfo && companyInfo.company_name) {
      pdf.setTextColor(25, 25, 25);
      pdf.setFontSize(22);
      pdf.setFont('helvetica', 'bold');
      pdf.text(companyInfo.company_name.toUpperCase(), margin, 22);

      pdf.setDrawColor(127, 169, 61);
      pdf.setLineWidth(1.2);
      const underlineWidth = Math.min(pdf.getTextWidth(companyInfo.company_name.toUpperCase()) + 8, pageWidth - 75 - margin);
      pdf.line(margin, 26, margin + underlineWidth, 26);

      const infoY = 33;
      const colWidth = (pageWidth - 75 - margin) / 2;
      const col1X = margin;
      const col2X = margin + colWidth + 4;

      c1Y = infoY;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(127, 169, 61);
      pdf.text('ADRESSE', col1X, c1Y);
      c1Y += 4;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(50, 50, 50);
      if (companyInfo.company_strasse) {
        pdf.text(companyInfo.company_strasse, col1X, c1Y);
        c1Y += 4;
      }
      if (companyInfo.company_plz || companyInfo.company_ort) {
        pdf.text(`${companyInfo.company_plz || ''} ${companyInfo.company_ort || ''}`.trim(), col1X, c1Y);
      }

      c2Y = infoY;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(127, 169, 61);
      pdf.text('KONTAKT', col2X, c2Y);
      c2Y += 4;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(50, 50, 50);
      if (companyInfo.company_telefon) {
        pdf.text(`Tel.: ${companyInfo.company_telefon}`, col2X, c2Y);
        c2Y += 4;
      }
      if (companyInfo.company_email) {
        pdf.text(companyInfo.company_email, col2X, c2Y);
        c2Y += 4;
      }
      if (companyInfo.company_web) {
        pdf.text(companyInfo.company_web, col2X, c2Y);
        c2Y += 4;
      }
    }

    // STEUER block — full-width below address/contact columns
    const steuerLines: string[] = [];
    if (companyInfo?.company_ust_id) steuerLines.push(`USt-IdNr.: ${companyInfo.company_ust_id}`);
    if (companyInfo?.company_steuernr) steuerLines.push(`Steuernr.: ${companyInfo.company_steuernr}`);

    const addressBottom = companyInfo ? Math.max(c1Y, c2Y) : 33;
    let headerBottom = addressBottom;

    if (steuerLines.length > 0) {
      const steuerY = addressBottom + 2;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(127, 169, 61);
      pdf.text('STEUER', margin, steuerY);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(50, 50, 50);
      pdf.text(steuerLines.join('   ·   '), margin, steuerY + 4);
      headerBottom = steuerY + 4;
    }

    // Title
    const titleY = headerBottom + 8;
    pdf.setTextColor(0, 0, 0);
    pdf.setFont('helvetica', 'bold');
    const titleText = 'ANGEBOT / RECHNUNG / AUFTRAGSFORMULAR / KAUFVERTRAG';
    const availableTitleWidth = pageWidth - 2 * margin;
    let titleSize = 14;
    pdf.setFontSize(titleSize);
    while (pdf.getTextWidth(titleText) > availableTitleWidth && titleSize > 7) {
      titleSize -= 0.5;
      pdf.setFontSize(titleSize);
    }
    pdf.text(titleText, margin, titleY);

    // Date below title
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(100, 100, 100);
    pdf.text(`Datum: ${dateStr}`, margin, titleY + 8);

    return titleY + 18;
  };

  // KUNDENDATEN block (green title bar + customer fields).
  const drawCustomerInfo = (startY: number): number => {
    yPos = startY;
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

    return yPos + 12;
  };

  // Renders a PRODUKTE table containing the given items (one or many).
  // Table header is drawn once, followed by each row.
  const drawProductsTable = (itemsToRender: AngebotPdfItem[], startY: number): number => {
    if (itemsToRender.length === 0) return startY;
    yPos = startY;
    checkNewPage(60);

    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setFillColor(127, 169, 61);
    pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.text('PRODUKTE', margin + 3, yPos);
    yPos += 12;

    pdf.setTextColor(0, 0, 0);

    const hasDiscounts = itemsToRender.some(item => item.discount && item.discount > 0);

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
    if (hasDiscounts) pdf.text('Rabatt', colX.rabatt, yPos);
    pdf.text('Gesamt', colX.gesamt, yPos);
    yPos += 8;

    pdf.setFont('helvetica', 'normal');
    itemsToRender.forEach((item) => {
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
          pdf.setTextColor(220, 38, 38);
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

      // Custom field values (only the customer's selections)
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

      pdf.setDrawColor(230, 230, 230);
      pdf.setLineWidth(0.2);
      pdf.line(margin, yPos - 3, margin + tableWidth, yPos - 3);
    });

    return yPos + 5;
  };

  // Per-item subtotal (used in multi-product PDFs so each block has its own line total)
  const drawItemSubtotal = (item: AngebotPdfItem, startY: number): number => {
    yPos = startY;
    checkNewPage(15);
    const summaryX = pageWidth - margin - 100;
    pdf.setTextColor(60, 60, 60);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Zwischensumme:', summaryX, yPos);
    pdf.text(`${formatPrice(item.total_price)} EUR`, summaryX + 60, yPos);
    pdf.setFont('helvetica', 'normal');
    return yPos + 10;
  };

  const drawNotes = (startY: number): number => {
    if (!data.notes || !data.notes.trim()) return startY;
    yPos = startY;
    checkNewPage(30);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setFillColor(127, 169, 61);
    pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.text('BESCHREIBUNG', margin + 3, yPos);
    yPos += 12;

    pdf.setTextColor(40, 40, 40);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    const noteLines = pdf.splitTextToSize(data.notes, pageWidth - 2 * margin - 6);
    for (const line of noteLines) {
      checkNewPage(7);
      pdf.text(line, margin + 3, yPos);
      yPos += 6;
    }
    return yPos + 5;
  };

  const drawExtras = (startY: number): number => {
    if (data.extras.length === 0) return startY;
    yPos = startY;
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

    return yPos + 5;
  };

  const drawMeasurements = (startY: number): number => {
    if (!data.hasMeasurements || !data.measurements) return startY;
    yPos = startY;
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

    return yPos + 10;
  };

  // Grand total block (Zwischensumme + discounts + Gesamtsumme box). Returns updated y and the totalBox X.
  const drawGrandTotal = (startY: number): { y: number; totalBoxX: number } => {
    yPos = startY;
    const hasAnyDiscounts = (data.item_discounts && data.item_discounts > 0) || (data.total_discount && data.total_discount > 0);
    const totalDiscountAmount = (data.item_discounts || 0) + (data.total_discount || 0);

    checkNewPage(hasAnyDiscounts ? 60 : 30);
    yPos += 5;

    const summaryX = pageWidth - margin - 100;

    if (hasAnyDiscounts && data.subtotal) {
      pdf.setTextColor(80, 80, 80);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Zwischensumme:', summaryX, yPos);
      pdf.text(`${formatPrice(data.subtotal)} EUR`, summaryX + 60, yPos);
      yPos += 7;

      if (data.item_discounts && data.item_discounts > 0) {
        pdf.setTextColor(220, 38, 38);
        pdf.text('Artikel-Rabatt:', summaryX, yPos);
        pdf.text(`-${formatPrice(data.item_discounts)} EUR`, summaryX + 60, yPos);
        yPos += 7;
      }

      if (data.total_discount && data.total_discount > 0) {
        pdf.setTextColor(220, 38, 38);
        pdf.text('Gesamt-Rabatt:', summaryX, yPos);
        pdf.text(`-${formatPrice(data.total_discount)} EUR`, summaryX + 60, yPos);
        yPos += 7;
      }

      if (totalDiscountAmount > 0 && data.total_discount_percent) {
        pdf.setTextColor(220, 38, 38);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`Sie sparen: ${formatPrice(totalDiscountAmount)} EUR (${data.total_discount_percent}%)`, summaryX, yPos);
        yPos += 10;
      }

      pdf.setTextColor(0, 0, 0);
    }

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

    const nettoPrice = data.total_price / 1.19;
    const mwstPrice = data.total_price - nettoPrice;
    pdf.setTextColor(100, 100, 100);
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Netto: ${formatPrice(nettoPrice)} EUR`, totalBoxX + 5, yPos + 22);
    pdf.text(`19% MwSt.: ${formatPrice(mwstPrice)} EUR`, totalBoxX + 5, yPos + 28);

    return { y: yPos + 38, totalBoxX };
  };

  // Verbindliche Auftragserteilung + signature line. Reserves 40mm or starts a fresh page.
  const drawSignature = (startY: number, totalBoxX: number): number => {
    yPos = startY;
    if (yPos + 40 > pageHeight - 30) {
      pdf.addPage();
      yPos = 30;
    } else {
      yPos += 10;
    }

    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Verbindliche Auftragserteilung', totalBoxX, yPos);
    yPos += 18;

    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.4);
    pdf.line(totalBoxX, yPos, pageWidth - margin, yPos);
    yPos += 5;

    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(80, 80, 80);
    pdf.text('Datum, Unterschrift Kunde/Auftraggeber', totalBoxX, yPos);
    pdf.setTextColor(0, 0, 0);
    return yPos + 6;
  };

  // ===================================================================
  // MAIN FLOW
  // ===================================================================

  const coverPageNumbers: number[] = [];
  const coverReplaceIndices: number[] = [];
  const coverPdfsToMerge: { bytes: Uint8Array; selectedPages: number[] }[] = [];
  const isMultiProduct = data.items.length > 1;

  // For each product: cover → detail → header + customer + this item's table + (subtotal if multi-product)
  for (let i = 0; i < data.items.length; i++) {
    // Subsequent items must start on a fresh page — otherwise the cover would overwrite
    // the previous item's billing page (jsPDF keeps the cursor on the last drawn page).
    if (i > 0) pdf.addPage();

    const item = data.items[i];
    let coverImages: { base64?: string }[] = [];
    let detailImages: { base64?: string }[] = [];
    let coverPdfData: { bytes: Uint8Array; selectedPages: number[] } | null = null;

    if (item.product_id) {
      try {
        const cp = await getProductCoverPdf(item.product_id);
        if (cp && cp.selected_pages && cp.selected_pages.length > 0) {
          const bytes = await fetchBranchPdfBytes(cp.file_path);
          if (bytes) coverPdfData = { bytes, selectedPages: cp.selected_pages };
        }
        const allImages = await getCachedProductImages(item.product_id);
        if (!coverPdfData) {
          const coverFlagged = allImages.filter((img) => img.show_on_cover).slice(0, 2);
          coverImages = await Promise.all(coverFlagged.map(async (img) => ({ base64: await fetchImageAsBase64(img.image_path) })));
        }
        const detailOnly = allImages.filter((img) => !img.show_on_cover).slice(0, 3);
        detailImages = await Promise.all(detailOnly.map(async (img) => ({ base64: await fetchImageAsBase64(img.image_path) })));
      } catch (e) {
        console.warn('Could not load cover assets for item', item.product_id, e);
      }
    }

    // Track current page as the cover page (will be footer-skipped + optionally pdf-lib replaced)
    const coverPageNum = (pdf as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
    coverPageNumbers.push(coverPageNum);
    if (coverPdfData) {
      coverReplaceIndices.push(coverPageNum);
      coverPdfsToMerge.push(coverPdfData);
    }

    // Always draw a cover (placeholder if PDF active — pdf-lib will replace it later)
    drawCoverPage(pdf, {
      productName: item.product_name || 'INDIVIDUELL',
      customerName: `${data.customer_firstname} ${data.customer_lastname}`,
      documentType: 'Angebot',
      documentNumber: data.angebot_nummer,
      documentDate: data.created_at ? new Date(data.created_at) : new Date(),
      coverImages,
      companyInfo: companyInfo || null
    });

    if (item.description && item.description.trim()) {
      drawProductDetailPage(pdf, {
        productName: item.product_name,
        description: item.description,
        images: detailImages
      });
    }

    // Now we are on a fresh page — render this item's billing block
    yPos = drawHeader();
    yPos = drawCustomerInfo(yPos);
    yPos = drawProductsTable([item], yPos);
    if (isMultiProduct) {
      yPos = drawItemSubtotal(item, yPos);
    }
  }

  // Final summary section — extras, notes, measurements, grand total, AGB, signature
  yPos = drawNotes(yPos);
  yPos = drawExtras(yPos);
  yPos = drawMeasurements(yPos);

  const totalResult = drawGrandTotal(yPos);
  yPos = totalResult.y;

  // AGB — use uploaded PDF if present (merged at the end via pdf-lib), otherwise render text inline.
  // skipAgbMerge=true (split-per-product flow) bypasses both: AGB ships as a separate email attachment.
  let agbPdfMergeData: { bytes: Uint8Array; selectedPages: number[] } | null = null;
  if (!options?.skipAgbMerge && branchTerms?.show_on_angebot) {
    if (branchTerms.agb_pdf_path && branchTerms.agb_pdf_pages && branchTerms.agb_pdf_pages.length > 0) {
      try {
        const bytes = await fetchBranchPdfBytes(branchTerms.agb_pdf_path);
        if (bytes) agbPdfMergeData = { bytes, selectedPages: branchTerms.agb_pdf_pages };
      } catch (e) {
        console.warn('Could not load AGB PDF:', e);
      }
    } else if (branchTerms.content?.trim()) {
      yPos = drawAgbPages(pdf, branchTerms.content);
    }
  }

  // Signature comes after the (text-rendered) AGB; appended-PDF AGB stays at the very end of the merged document
  yPos = drawSignature(yPos, totalResult.totalBoxX);

  // Footer on every page except cover pages
  const pageCount = (pdf as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  const coverPagesSet = new Set(coverPageNumbers);
  for (let i = 1; i <= pageCount; i++) {
    if (coverPagesSet.has(i)) continue;
    pdf.setPage(i);
    drawGeschaeftsbriefFooter(pdf, pageWidth, pageHeight, margin, companyInfo, companyName, i, pageCount, { withAuftragsMessage: true });
  }

  const customerName = `${data.customer_firstname}_${data.customer_lastname}`.replace(/\s+/g, '_');
  const fileName = `Angebot_${customerName}_${dateStr.replace(/\./g, '-')}.pdf`;

  // Merge cover PDFs (replace) and append AGB PDF
  let finalBlob: Blob = pdf.output('blob');
  if (coverPdfsToMerge.length > 0 || agbPdfMergeData) {
    try {
      finalBlob = await mergePdf({
        basePdf: finalBlob,
        coverPdfs: coverPdfsToMerge,
        coverReplaceIndices: coverReplaceIndices,
        agbPdf: agbPdfMergeData,
        appendAgbAtEnd: !!agbPdfMergeData
      });
    } catch (e) {
      console.error('PDF merge failed, falling back to base PDF:', e);
    }
  }

  if (options?.returnBlob) {
    return { blob: finalBlob, fileName };
  }

  const url = URL.createObjectURL(finalBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
