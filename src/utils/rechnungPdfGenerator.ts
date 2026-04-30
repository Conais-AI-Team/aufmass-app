import { jsPDF } from 'jspdf';
import { getCompanyInfoForPdf } from './companyInfoCache';
import type { RechnungItem, ZahlungsMethode } from '../services/api';

export interface RechnungPdfAnzahlung {
  zahlungsdatum: string;
  betrag: number;
  zahlungsmethode?: ZahlungsMethode;
}

export interface RechnungPdfData {
  rechnung_nr: string;
  type: 'anzahlungsrechnung' | 'schlussrechnung';
  rechnungsdatum: string;
  leistungsdatum: string | null;
  zahlungsziel: string;

  kunde_vorname: string;
  kunde_nachname: string;
  kunde_email?: string;
  kunde_telefon?: string;
  kunde_adresse?: string;

  items: RechnungItem[];
  netto_betrag: number;
  mwst_satz: number;
  mwst_betrag: number;
  brutto_betrag: number;

  // Schlussrechnung only — list of received down payments
  anzahlungen?: RechnungPdfAnzahlung[];
}

const formatPrice = (price: number): string =>
  new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price);

const formatDateDe = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const generateRechnungPDF = async (
  data: RechnungPdfData,
  options?: { returnBlob?: boolean }
): Promise<{ blob: Blob; fileName: string } | void> => {
  const companyInfo = (await getCompanyInfoForPdf()) || undefined;
  const companyName = companyInfo?.company_name || 'AYLUX Sonnenschutzsysteme';

  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  let yPos = 20;

  const checkNewPage = (requiredSpace: number = 15) => {
    if (yPos + requiredSpace > pageHeight - 35) {
      pdf.addPage();
      yPos = 25;
      return true;
    }
    return false;
  };

  // ============ HEADER (logo + branch sender line) ============
  pdf.setFillColor(127, 169, 61);
  pdf.rect(pageWidth - 70, 10, 50, 25, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  pdf.text('AYLUX', pageWidth - 60, 22);
  pdf.setFontSize(7);
  pdf.text('SONNENSCHUTZSYSTEME', pageWidth - 65, 28);

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

  // Title
  pdf.setTextColor(0, 0, 0);
  pdf.setFont('helvetica', 'bold');
  const titleText = data.type === 'schlussrechnung' ? 'SCHLUSSRECHNUNG' : 'ANZAHLUNGSRECHNUNG';
  pdf.setFontSize(18);
  pdf.text(titleText, margin, 26);

  yPos = 45;

  // ============ EMPFÄNGER (recipient block, top-left) ============
  pdf.setFontSize(9);
  pdf.setTextColor(120, 120, 120);
  pdf.setFont('helvetica', 'normal');
  pdf.text('Rechnung an:', margin, yPos);
  yPos += 5;

  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  const fullName = `${data.kunde_vorname || ''} ${data.kunde_nachname || ''}`.trim();
  pdf.text(fullName || '—', margin, yPos);
  yPos += 6;

  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  if (data.kunde_adresse) {
    const addrLines = pdf.splitTextToSize(data.kunde_adresse, 90);
    pdf.text(addrLines, margin, yPos);
    yPos += 5 * addrLines.length;
  }
  if (data.kunde_email) {
    pdf.text(data.kunde_email, margin, yPos);
    yPos += 5;
  }

  // ============ RECHNUNG META (right column) ============
  const metaX = pageWidth - margin - 75;
  let metaY = 50;
  const metaPair = (label: string, value: string) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(80, 80, 80);
    pdf.text(label, metaX, metaY);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(0, 0, 0);
    pdf.text(value, metaX + 35, metaY);
    metaY += 6;
  };
  metaPair('Rechnungsnr.:', data.rechnung_nr);
  metaPair('Rechnungsdatum:', formatDateDe(data.rechnungsdatum));
  metaPair('Leistungsdatum:', data.leistungsdatum ? formatDateDe(data.leistungsdatum) : 'siehe Vertragsgegenstand');
  metaPair('Zahlungsziel:', formatDateDe(data.zahlungsziel));

  yPos = Math.max(yPos, metaY) + 8;

  // ============ ITEMS TABLE ============
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.setFillColor(127, 169, 61);
  pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.text('LEISTUNGEN', margin + 3, yPos);
  yPos += 12;

  pdf.setTextColor(0, 0, 0);
  // Right edge of content area; amount columns are right-aligned to these.
  const rightEdge = pageWidth - margin;
  const colX = {
    pos: margin + 3,
    bezeichnung: margin + 13,
    mengeRight: rightEdge - 76,    // right-aligned end for Menge column
    einzelRight: rightEdge - 38,   // right-aligned end for Einzelpreis
    gesamtRight: rightEdge - 2,    // right-aligned end for Gesamt
  };
  const bezeichnungMaxWidth = (colX.mengeRight - 22) - colX.bezeichnung;
  const tableWidth = pageWidth - 2 * margin;

  pdf.setFillColor(240, 240, 240);
  pdf.rect(margin, yPos - 4, tableWidth, 8, 'F');
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Pos', colX.pos, yPos);
  pdf.text('Bezeichnung', colX.bezeichnung, yPos);
  pdf.text('Menge', colX.mengeRight, yPos, { align: 'right' });
  pdf.text('Einzelpreis', colX.einzelRight, yPos, { align: 'right' });
  pdf.text('Gesamt', colX.gesamtRight, yPos, { align: 'right' });
  yPos += 8;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  data.items.forEach((item, i) => {
    checkNewPage(10);
    const bezLines = pdf.splitTextToSize(item.bezeichnung, bezeichnungMaxWidth);
    pdf.text(String(i + 1), colX.pos, yPos);
    pdf.text(bezLines, colX.bezeichnung, yPos);
    pdf.text(String(item.menge), colX.mengeRight, yPos, { align: 'right' });
    pdf.text(`${formatPrice(item.einzelpreis)} EUR`, colX.einzelRight, yPos, { align: 'right' });
    pdf.text(`${formatPrice(item.gesamtpreis)} EUR`, colX.gesamtRight, yPos, { align: 'right' });
    yPos += Math.max(6, bezLines.length * 5) + 2;
    pdf.setDrawColor(230, 230, 230);
    pdf.setLineWidth(0.2);
    pdf.line(margin, yPos - 2, margin + tableWidth, yPos - 2);
  });

  yPos += 6;

  // ============ TOTALS ============
  checkNewPage(50);
  const sumX = pageWidth - margin - 90;
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80, 80, 80);
  pdf.text('Nettobetrag:', sumX, yPos);
  pdf.setTextColor(0, 0, 0);
  pdf.text(`${formatPrice(data.netto_betrag)} EUR`, sumX + 50, yPos);
  yPos += 6;

  pdf.setTextColor(80, 80, 80);
  pdf.text(`zzgl. ${formatPrice(data.mwst_satz)}% MwSt:`, sumX, yPos);
  pdf.setTextColor(0, 0, 0);
  pdf.text(`${formatPrice(data.mwst_betrag)} EUR`, sumX + 50, yPos);
  yPos += 8;

  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.4);
  pdf.line(sumX, yPos - 4, pageWidth - margin, yPos - 4);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text('Bruttobetrag:', sumX, yPos);
  pdf.text(`${formatPrice(data.brutto_betrag)} EUR`, sumX + 50, yPos);
  yPos += 10;

  // ============ SCHLUSSRECHNUNG: Anzahlungen + Restbetrag ============
  if (data.type === 'schlussrechnung' && data.anzahlungen && data.anzahlungen.length > 0) {
    checkNewPage(40 + data.anzahlungen.length * 6);
    yPos += 4;

    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(0, 0, 0);
    pdf.text('Bereits geleistete Anzahlungen:', margin, yPos);
    yPos += 6;

    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    let anzSum = 0;
    data.anzahlungen.forEach((az) => {
      pdf.setTextColor(80, 80, 80);
      pdf.text(formatDateDe(az.zahlungsdatum), margin + 3, yPos);
      pdf.setTextColor(0, 0, 0);
      pdf.text(`-${formatPrice(az.betrag)} EUR`, sumX + 50, yPos);
      anzSum += az.betrag;
      yPos += 5;
    });
    pdf.setDrawColor(200, 200, 200);
    pdf.line(sumX, yPos - 1, pageWidth - margin, yPos - 1);
    yPos += 4;

    const restBetrag = data.brutto_betrag - anzSum;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(127, 169, 61);
    pdf.text('Restbetrag:', sumX, yPos);
    pdf.text(`${formatPrice(restBetrag)} EUR`, sumX + 50, yPos);
    pdf.setTextColor(0, 0, 0);
    yPos += 10;
  }

  // ============ ZAHLUNGSHINWEIS + BANKVERBINDUNG ============
  checkNewPage(40);
  yPos += 6;
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80, 80, 80);
  pdf.text(
    `Bitte überweisen Sie den ${data.type === 'schlussrechnung' ? 'Restbetrag' : 'Rechnungsbetrag'} bis spätestens ${formatDateDe(data.zahlungsziel)} auf das unten genannte Konto.`,
    margin, yPos, { maxWidth: pageWidth - 2 * margin }
  );
  yPos += 8;

  if (companyInfo && (companyInfo.company_iban || companyInfo.company_bic || companyInfo.company_bank_name)) {
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(0, 0, 0);
    pdf.text('Bankverbindung:', margin, yPos);
    yPos += 5;
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(80, 80, 80);
    if (companyInfo.company_bank_name) { pdf.text(`Bank: ${companyInfo.company_bank_name}`, margin, yPos); yPos += 5; }
    if (companyInfo.company_iban) { pdf.text(`IBAN: ${companyInfo.company_iban}`, margin, yPos); yPos += 5; }
    if (companyInfo.company_bic) { pdf.text(`BIC: ${companyInfo.company_bic}`, margin, yPos); yPos += 5; }
    pdf.text(`Verwendungszweck: ${data.rechnung_nr}`, margin, yPos);
    yPos += 5;
  }

  // ============ FOOTER (legal company info on every page) ============
  const pageCount = (pdf as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    pdf.setFontSize(7);
    pdf.setTextColor(120, 120, 120);
    pdf.setFont('helvetica', 'normal');

    const footerY = pageHeight - 22;
    if (companyInfo) {
      const line1Parts: string[] = [];
      if (companyInfo.company_name) line1Parts.push(companyInfo.company_name);
      if (companyInfo.company_geschaeftsfuehrer) line1Parts.push(`GF: ${companyInfo.company_geschaeftsfuehrer}`);
      if (companyInfo.company_handelsregister) line1Parts.push(companyInfo.company_handelsregister);
      const line2Parts: string[] = [];
      if (companyInfo.company_ust_id) line2Parts.push(`USt-IdNr: ${companyInfo.company_ust_id}`);
      if (companyInfo.company_steuernr) line2Parts.push(`Steuernr: ${companyInfo.company_steuernr}`);
      if (companyInfo.company_telefon) line2Parts.push(`Tel: ${companyInfo.company_telefon}`);
      if (companyInfo.company_email) line2Parts.push(companyInfo.company_email);

      if (line1Parts.length > 0) pdf.text(line1Parts.join('  ·  '), pageWidth / 2, footerY, { align: 'center' });
      if (line2Parts.length > 0) pdf.text(line2Parts.join('  ·  '), pageWidth / 2, footerY + 4, { align: 'center' });
    }

    pdf.text(`Seite ${i} von ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    pdf.text(companyName, pageWidth - margin, pageHeight - 10, { align: 'right' });
  }

  const fileName = `Rechnung_${data.rechnung_nr}.pdf`;
  if (options?.returnBlob) {
    const blob = pdf.output('blob');
    return { blob, fileName };
  }
  pdf.save(fileName);
};
