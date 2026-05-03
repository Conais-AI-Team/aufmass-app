// Living-Deluxe-style pipe-separated Geschäftsbrief footer
// Used by all PDF generators (Aufmaß, Angebot, Abnahme, Rechnung)
import type { jsPDF } from 'jspdf';

export interface FooterCompanyInfo {
  company_name: string;
  company_strasse?: string;
  company_plz?: string;
  company_ort?: string;
  company_telefon?: string;
  company_email?: string;
  company_ust_id?: string;
  company_web?: string;
  company_steuernr?: string;
  company_iban?: string;
  company_bic?: string;
  company_bank_name?: string;
  company_geschaeftsfuehrer?: string;
  company_handelsregister?: string;
}

interface FooterOptions {
  /** When true, prepends the friendly Auftragserteilung paragraph (Angebot only) */
  withAuftragsMessage?: boolean;
}

export function drawGeschaeftsbriefFooter(
  pdf: jsPDF,
  pageWidth: number,
  pageHeight: number,
  margin: number,
  companyInfo: FooterCompanyInfo | null | undefined,
  fallbackCompanyName: string,
  pageNum: number,
  pageCount: number,
  options: FooterOptions = {}
) {
  const cx = pageWidth / 2;
  const lineGap = 3.2;
  const messageBlockHeight = options.withAuftragsMessage ? 12 : 0;
  // Total footer height: ~30mm including optional message
  const footerStartY = pageHeight - (28 + messageBlockHeight);

  // Top border line
  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(0.3);
  pdf.line(margin, footerStartY, pageWidth - margin, footerStartY);

  let y = footerStartY + 5;

  // Optional Angebot-specific friendly message
  if (options.withAuftragsMessage) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(80, 80, 80);
    pdf.text('Über Ihre Auftragserteilung würden wir uns freuen!', cx, y, { align: 'center' });
    y += 4;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(110, 110, 110);
    const company = companyInfo?.company_name || fallbackCompanyName;
    const msg = `Nach erfolgter Auftragserteilung erhalten Sie von uns eine Auftragsbestätigung und einen Zahlungsplan. Zum Projektstart wird bei der ${company} eine Anzahlung i.H.v. 50% des Materialwertes fällig. Bei Fragen können Sie jederzeit mit unseren Beratern in Kontakt treten.`;
    const lines = pdf.splitTextToSize(msg, pageWidth - 2 * margin - 10);
    pdf.text(lines, cx, y, { align: 'center' });
    y += lines.length * 3 + 3;
  }

  // Company info section (always shown)
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  pdf.setTextColor(90, 90, 90);

  if (!companyInfo || !companyInfo.company_name) {
    pdf.text(fallbackCompanyName, cx, y, { align: 'center' });
    y = pageHeight - 8;
    pdf.setTextColor(140, 140, 140);
    pdf.text(`Seite ${pageNum} von ${pageCount}`, cx, y, { align: 'center' });
    return;
  }

  // Line 1: Firma | Strasse | PLZ Ort | Telefon | E-Mail
  const line1Parts: string[] = [companyInfo.company_name];
  if (companyInfo.company_strasse) line1Parts.push(companyInfo.company_strasse);
  if (companyInfo.company_plz || companyInfo.company_ort) {
    line1Parts.push(`${companyInfo.company_plz || ''} ${companyInfo.company_ort || ''}`.trim());
  }
  if (companyInfo.company_telefon) line1Parts.push(`Telefon: ${companyInfo.company_telefon}`);
  if (companyInfo.company_email) line1Parts.push(companyInfo.company_email);
  pdf.text(line1Parts.join(' | '), cx, y, { align: 'center' });
  y += lineGap;

  // Line 2: Unternehmensform | Handelsregister | USt-IdNr | Geschäftsführer
  const line2Parts: string[] = [];
  if (companyInfo.company_handelsregister) line2Parts.push(companyInfo.company_handelsregister);
  if (companyInfo.company_ust_id) line2Parts.push(`USt-ID-Nr.: ${companyInfo.company_ust_id}`);
  if (companyInfo.company_steuernr) line2Parts.push(`Steuernr.: ${companyInfo.company_steuernr}`);
  if (companyInfo.company_geschaeftsfuehrer) line2Parts.push(`Geschäftsführer: ${companyInfo.company_geschaeftsfuehrer}`);
  if (line2Parts.length > 0) {
    pdf.text(line2Parts.join(' | '), cx, y, { align: 'center' });
    y += lineGap;
  }

  // Line 3 (only if bank info exists): Bankverbindung: Firma | IBAN | BIC
  const bankParts: string[] = [];
  if (companyInfo.company_bank_name) bankParts.push(companyInfo.company_bank_name);
  if (companyInfo.company_iban) bankParts.push(`IBAN: ${companyInfo.company_iban}`);
  if (companyInfo.company_bic) bankParts.push(`BIC: ${companyInfo.company_bic}`);
  if (bankParts.length > 0) {
    y += 1;
    const bankLine = `Bankverbindung: ${companyInfo.company_name} | ${bankParts.join(' | ')}`;
    pdf.text(bankLine, cx, y, { align: 'center' });
    y += lineGap;
  }

  // Line 4: Internet & E-Mail
  const onlineParts: string[] = [];
  if (companyInfo.company_web) onlineParts.push(`Internet: ${companyInfo.company_web}`);
  if (companyInfo.company_email) onlineParts.push(`E-Mail: ${companyInfo.company_email}`);
  if (onlineParts.length > 0) {
    pdf.text(onlineParts.join(' | '), cx, y, { align: 'center' });
  }

  // Page number at very bottom
  pdf.setTextColor(140, 140, 140);
  pdf.text(`Seite ${pageNum} von ${pageCount}`, cx, pageHeight - 5, { align: 'center' });
}
