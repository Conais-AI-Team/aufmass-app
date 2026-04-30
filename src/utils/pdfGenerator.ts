import { jsPDF } from 'jspdf';
import { FormData } from '../types';
import productConfigData from '../config/productConfig.json';
import type { ProductConfig, FieldConfig } from '../types/productConfig';
import { getImageUrl, getStoredToken, getAbnahmeImageUrl } from '../services/api';
import { drawGeschaeftsbriefFooter } from './pdfFooter';
import { drawAgbPages } from './pdf/pdfAgb';
import { mergePdf } from './pdf/pdfMerger';
import { getCachedBranchTerms } from './branchTermsCache';
import { fetchBranchPdfBytes } from '../services/api';

const productConfig = productConfigData as ProductConfig;

// Type for server image objects
interface ServerImage {
  id: number;
  file_name: string;
  file_type: string;
}

// Helper to convert File to base64
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// Helper to read EXIF orientation from image file
const getExifOrientation = (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const view = new DataView(e.target?.result as ArrayBuffer);
      if (view.getUint16(0, false) !== 0xFFD8) {
        resolve(1); // Not a JPEG
        return;
      }
      const length = view.byteLength;
      let offset = 2;
      while (offset < length) {
        if (view.getUint16(offset + 2, false) <= 8) {
          resolve(1);
          return;
        }
        const marker = view.getUint16(offset, false);
        offset += 2;
        if (marker === 0xFFE1) {
          if (view.getUint32(offset += 2, false) !== 0x45786966) {
            resolve(1);
            return;
          }
          const little = view.getUint16(offset += 6, false) === 0x4949;
          offset += view.getUint32(offset + 4, little);
          const tags = view.getUint16(offset, little);
          offset += 2;
          for (let i = 0; i < tags; i++) {
            if (view.getUint16(offset + (i * 12), little) === 0x0112) {
              resolve(view.getUint16(offset + (i * 12) + 8, little));
              return;
            }
          }
        } else if ((marker & 0xFF00) !== 0xFF00) {
          break;
        } else {
          offset += view.getUint16(offset, false);
        }
      }
      resolve(1);
    };
    reader.readAsArrayBuffer(file.slice(0, 65536));
  });
};

// Helper to fix image orientation based on EXIF data
const fixImageOrientation = (base64: string, orientation: number): Promise<string> => {
  return new Promise((resolve) => {
    if (orientation <= 1) {
      resolve(base64);
      return;
    }

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;

      // Set canvas dimensions based on orientation
      if (orientation >= 5 && orientation <= 8) {
        canvas.width = img.height;
        canvas.height = img.width;
      } else {
        canvas.width = img.width;
        canvas.height = img.height;
      }

      // Apply transformations based on EXIF orientation
      switch (orientation) {
        case 2: ctx.transform(-1, 0, 0, 1, img.width, 0); break;
        case 3: ctx.transform(-1, 0, 0, -1, img.width, img.height); break;
        case 4: ctx.transform(1, 0, 0, -1, 0, img.height); break;
        case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
        case 6: ctx.transform(0, 1, -1, 0, img.height, 0); break;
        case 7: ctx.transform(0, -1, -1, 0, img.height, img.width); break;
        case 8: ctx.transform(0, -1, 1, 0, 0, img.width); break;
      }

      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.src = base64;
  });
};

// Helper to get image dimensions
const getImageDimensions = (base64: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.src = base64;
  });
};

// Helper to get EXIF orientation from base64 string
const getExifOrientationFromBase64 = (base64: string): number => {
  try {
    // Remove data URL prefix
    const binaryString = atob(base64.split(',')[1]);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Check for JPEG marker
    if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
      return 1; // Not a JPEG
    }

    let offset = 2;
    while (offset < bytes.length - 1) {
      if (bytes[offset] !== 0xFF) {
        return 1;
      }

      const marker = bytes[offset + 1];

      // APP1 marker (EXIF)
      if (marker === 0xE1) {
        const exifStart = offset + 4;

        // Check for "Exif" string
        if (bytes[exifStart] === 0x45 && bytes[exifStart + 1] === 0x78 &&
            bytes[exifStart + 2] === 0x69 && bytes[exifStart + 3] === 0x66) {

          const tiffStart = exifStart + 6;
          const littleEndian = bytes[tiffStart] === 0x49;

          const getUint16 = (pos: number) => {
            if (littleEndian) {
              return bytes[pos] | (bytes[pos + 1] << 8);
            }
            return (bytes[pos] << 8) | bytes[pos + 1];
          };

          const ifdOffset = tiffStart + 8;
          const numEntries = getUint16(ifdOffset);

          for (let i = 0; i < numEntries; i++) {
            const entryOffset = ifdOffset + 2 + (i * 12);
            const tag = getUint16(entryOffset);

            if (tag === 0x0112) { // Orientation tag
              return getUint16(entryOffset + 8);
            }
          }
        }
        return 1;
      }

      // Skip to next marker
      if (marker === 0xD8 || marker === 0xD9) {
        offset += 2;
      } else {
        const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
        offset += 2 + length;
      }
    }

    return 1;
  } catch {
    return 1;
  }
};

// Helper to automatically fix image orientation from base64
const fixImageOrientationAuto = async (base64: string): Promise<string> => {
  const orientation = getExifOrientationFromBase64(base64);
  if (orientation <= 1) {
    return base64;
  }
  return fixImageOrientation(base64, orientation);
};

// Helper to fetch server image and convert to base64 (with retry)
const fetchServerImageAsBase64 = async (imageId: number, retries = 2): Promise<string> => {
  const url = getImageUrl(imageId);
  const token = getStoredToken();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch image (status ${response.status})`);
      }

      const blob = await response.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      if (attempt === retries) throw err;
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new Error('Failed to fetch image after retries');
};

// Helper to check if object is a server image
const isServerImage = (obj: unknown): obj is ServerImage => {
  return obj !== null &&
         typeof obj === 'object' &&
         'id' in obj &&
         'file_name' in obj &&
         typeof (obj as ServerImage).id === 'number';
};

export interface BranchCompanyInfoForPdf {
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

export const generatePDF = async (
  formData: FormData,
  options?: { returnBlob?: boolean; forSignature?: boolean; abnahmeOnly?: boolean; companyInfo?: BranchCompanyInfoForPdf }
): Promise<{ blob: Blob; fileName: string } | void> => {
  const forSignature = options?.forSignature || false;
  const abnahmeOnly = options?.abnahmeOnly || false;
  const { getCompanyInfoForPdf } = await import('./companyInfoCache');
  const companyInfo = options?.companyInfo || (await getCompanyInfoForPdf()) || undefined;
  const companyName = companyInfo?.company_name || 'AYLUX Sonnenschutzsysteme';
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  let yPos = 20;

  // Helper function to check if new page is needed (footer reserves ~35mm at bottom for Geschäftsbrief footer)
  const checkNewPage = (requiredSpace: number = 15) => {
    if (yPos + requiredSpace > pageHeight - 35) {
      pdf.addPage();
      yPos = 20;
      return true;
    }
    return false;
  };

  // ============ MODERN LETTERHEAD HEADER ============
  // Logo (sabit) — sağ üst
  pdf.setFillColor(127, 169, 61);
  pdf.rect(pageWidth - 60, 10, 40, 20, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(15);
  pdf.setFont('helvetica', 'bold');
  pdf.text('AYLUX', pageWidth - 52, 21);
  pdf.setFontSize(6);
  pdf.text('SONNENSCHUTZSYSTEME', pageWidth - 56, 26);

  // Big bold company name — top-left
  if (companyInfo && companyInfo.company_name) {
    pdf.setTextColor(25, 25, 25);
    pdf.setFontSize(22);
    pdf.setFont('helvetica', 'bold');
    pdf.text(companyInfo.company_name.toUpperCase(), margin, 22);

    // Thick green underline — extends from company name
    pdf.setDrawColor(127, 169, 61);
    pdf.setLineWidth(1.2);
    const underlineWidth = Math.min(pdf.getTextWidth(companyInfo.company_name.toUpperCase()) + 8, pageWidth - 75 - margin);
    pdf.line(margin, 26, margin + underlineWidth, 26);

    // 3-column info row below name: Address | Contact | (logo space)
    const infoY = 33;
    const colWidth = (pageWidth - 75 - margin) / 2;
    const col1X = margin;
    const col2X = margin + colWidth + 4;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(70, 70, 70);

    // Column 1: Address
    let c1Y = infoY;
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

    // Column 2: Kontakt
    let c2Y = infoY;
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
    }
  }

  // Title — positioned below the modern letterhead (~50mm)
  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(20);
  pdf.setFont('helvetica', 'bold');
  pdf.text(abnahmeOnly ? 'ABNAHME-PROTOKOLL' : 'AUFMASS - DATENBLATT', margin, 60);

  // Abnahme-only mode: add customer info header
  if (abnahmeOnly) {
    yPos = 70;
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.setCharSpace(0);
    const kundenName = `${formData.kundeVorname || ''} ${formData.kundeNachname || ''}`.trim() || '-';
    pdf.text(`Kunde: ${kundenName}`, margin, yPos);
    yPos += 5;
    if (formData.kundenlokation) {
      const addrLines = pdf.splitTextToSize(`Adresse: ${formData.kundenlokation}`, pageWidth - 2 * margin);
      addrLines.forEach((line: string) => {
        pdf.text(line, margin, yPos);
        yPos += 5;
      });
    }
    if (formData.datum) {
      pdf.text(`Datum: ${new Date(formData.datum).toLocaleDateString('de-DE')}`, margin, yPos);
      yPos += 5;
    }
    yPos += 5;
  } else {
    yPos = 70;
  }

  // ============ ABNAHME SECTION - If exists (skip for signature PDF) ============
  if (formData.abnahme && !forSignature) {
    const abnahme = formData.abnahme;

    // Abnahme header with green background
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setFillColor(16, 185, 129); // Green color for abnahme
    pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.text('ABNAHME-PROTOKOLL', margin + 2, yPos);
    yPos += 12;

    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');

    // Status row with checkmarks
    const checkMark = 'Ja';
    const crossMark = 'Nein';

    // Arbeit fertiggestellt
    pdf.setFont('helvetica', 'bold');
    pdf.text('Arbeit fertiggestellt:', margin + 2, yPos);
    pdf.setFont('helvetica', 'normal');
    pdf.text(abnahme.istFertig ? checkMark : crossMark, margin + 65, yPos);
    yPos += 6;

    // Probleme vorhanden
    pdf.setFont('helvetica', 'bold');
    pdf.text('Probleme/Maengel:', margin + 2, yPos);
    pdf.setFont('helvetica', 'normal');
    pdf.text(abnahme.hatProbleme ? checkMark : crossMark, margin + 65, yPos);
    yPos += 6;

    // Common fields for both ARBEIT IST FERTIG and ES GIBT MÄNGEL
    if (abnahme.istFertig || abnahme.hatProbleme) {
      // Baustelle sauber
      if (abnahme.baustelleSauber) {
        pdf.setFont('helvetica', 'bold');
        pdf.text('Baustelle sauber:', margin + 2, yPos);
        pdf.setFont('helvetica', 'normal');
        pdf.text(abnahme.baustelleSauber === 'ja' ? 'JA' : 'NEIN', margin + 65, yPos);
        yPos += 6;
      }

      // Monteur Note
      if (abnahme.monteurNote) {
        pdf.setFont('helvetica', 'bold');
        pdf.text('Monteur Note:', margin + 2, yPos);
        pdf.setFont('helvetica', 'normal');
        pdf.text(String(abnahme.monteurNote), margin + 65, yPos);
        yPos += 6;
      }
    }

    // Mängel Liste only for ES GIBT MÄNGEL
    if (abnahme.hatProbleme) {
      // Mängel Liste (numbered defects)
      if (abnahme.maengelListe && Array.isArray(abnahme.maengelListe) && abnahme.maengelListe.some((m: string) => m.trim())) {
        pdf.setFont('helvetica', 'bold');
        pdf.text('Maengelliste:', margin + 2, yPos);
        yPos += 5;
        pdf.setFont('helvetica', 'normal');
        abnahme.maengelListe.forEach((mangel: string, idx: number) => {
          if (mangel && mangel.trim()) {
            const mangelText = `${idx + 1}) ${mangel}`;
            const mangelLines = pdf.splitTextToSize(mangelText, pageWidth - 2 * margin - 15);
            mangelLines.forEach((line: string) => {
              pdf.text(line, margin + 8, yPos);
              yPos += 5;
            });
          }
        });
        yPos += 2;
      }

      // Legacy problem description (for backward compatibility)
      if (abnahme.problemBeschreibung) {
        pdf.setFont('helvetica', 'bold');
        pdf.text('Problembeschreibung:', margin + 2, yPos);
        yPos += 5;
        pdf.setFont('helvetica', 'normal');
        const problemLines = pdf.splitTextToSize(abnahme.problemBeschreibung, pageWidth - 2 * margin - 10);
        problemLines.forEach((line: string) => {
          pdf.text(line, margin + 8, yPos);
          yPos += 5;
        });
        yPos += 2;
      }
    }

    // Abnahme Fotos - shown for both ARBEIT IST FERTIG and ES GIBT MÄNGEL
    // Support both server-fetched (maengelBilder) and inline base64 (maengelBilderBase64) images
    const hasServerImages = abnahme.maengelBilder && Array.isArray(abnahme.maengelBilder) && abnahme.maengelBilder.length > 0;
    const hasBase64Images = abnahme.maengelBilderBase64 && Array.isArray(abnahme.maengelBilderBase64) && abnahme.maengelBilderBase64.length > 0;

    if ((abnahme.istFertig || abnahme.hatProbleme) && (hasServerImages || hasBase64Images)) {
      pdf.setFont('helvetica', 'bold');
      pdf.text('Abnahme Fotos:', margin + 2, yPos);
      yPos += 8;

      const imgWidth = 50;
      const imgHeight = 50;
      const imagesPerRow = 3;
      const imgGap = 5;

      if (hasBase64Images && abnahme.maengelBilderBase64) {
        // Use inline base64 images (from public snapshot)
        for (let i = 0; i < abnahme.maengelBilderBase64.length; i++) {
          const photo = abnahme.maengelBilderBase64[i];
          const col = i % imagesPerRow;
          const xPos = margin + col * (imgWidth + imgGap);

          if (yPos + imgHeight > pageHeight - margin) {
            pdf.addPage();
            yPos = margin;
          }

          try {
            const format = photo.fileType?.includes('png') ? 'PNG' : 'JPEG';
            pdf.addImage(photo.base64, format, xPos, yPos, imgWidth, imgHeight);
          } catch (err) {
            console.error('Error adding base64 abnahme image:', err);
          }

          if (col === imagesPerRow - 1) {
            yPos += imgHeight + imgGap;
          }
        }

        if (abnahme.maengelBilderBase64!.length % imagesPerRow !== 0) {
          yPos += imgHeight + imgGap;
        }
      } else if (hasServerImages && abnahme.maengelBilder) {
        // Fetch images from server (authenticated)
        for (let i = 0; i < abnahme.maengelBilder.length; i++) {
          const img = abnahme.maengelBilder[i];
          const col = i % imagesPerRow;
          const xPos = margin + col * (imgWidth + imgGap);

          if (yPos + imgHeight > pageHeight - margin) {
            pdf.addPage();
            yPos = margin;
          }

          try {
            const token = getStoredToken();
            const imgUrl = getAbnahmeImageUrl(img.id);
            const response = await fetch(imgUrl, {
              headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });

            if (response.ok) {
              const blob = await response.blob();
              const base64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });

              const format = img.file_type?.includes('png') ? 'PNG' : 'JPEG';
              pdf.addImage(base64, format, xPos, yPos, imgWidth, imgHeight);
            }
          } catch (err) {
            console.error('Error loading abnahme image:', err);
          }

          if (col === imagesPerRow - 1) {
            yPos += imgHeight + imgGap;
          }
        }

        if (abnahme.maengelBilder!.length % imagesPerRow !== 0) {
          yPos += imgHeight + imgGap;
        }
      }

      yPos += 5;
    }

    // Notes (if any) - RED + UPPERCASE + BOLD
    if (abnahme.bemerkungen) {
      pdf.setFont('helvetica', 'bold');
      pdf.text('Bemerkungen:', margin + 2, yPos);
      yPos += 5;
      pdf.setTextColor(220, 38, 38); // Red color
      pdf.setFont('helvetica', 'bold');
      const notesText = abnahme.bemerkungen.toUpperCase();
      const notesLines = pdf.splitTextToSize(notesText, pageWidth - 2 * margin - 10);
      notesLines.forEach((line: string) => {
        pdf.text(line, margin + 8, yPos);
        yPos += 5;
      });
      pdf.setTextColor(0, 0, 0); // Reset color
      yPos += 2;
    }

    // Customer confirmation section
    yPos += 3;
    pdf.setDrawColor(16, 185, 129);
    pdf.setLineWidth(0.5);
    pdf.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 5;

    pdf.setFont('helvetica', 'bold');
    pdf.text('Kundenbestaetigung', margin + 2, yPos);
    yPos += 6;

    // Customer name
    if (abnahme.kundeName) {
      pdf.setFont('helvetica', 'bold');
      pdf.text('Kundenname:', margin + 2, yPos);
      pdf.setFont('helvetica', 'normal');
      pdf.text(abnahme.kundeName, margin + 65, yPos);
      yPos += 6;
    }

    // Customer confirmation
    pdf.setFont('helvetica', 'bold');
    pdf.text('Bestaetigt:', margin + 2, yPos);
    pdf.setFont('helvetica', 'normal');
    pdf.text(abnahme.kundeUnterschrift ? 'Ja, Kunde hat bestaetigt' : 'Nein, ausstehend', margin + 65, yPos);
    yPos += 6;

    if (abnahme.signatureData) {
      checkNewPage(45);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Kundenunterschrift:', margin + 2, yPos);
      yPos += 4;

      try {
        const sigWidth = 55;
        const sigHeight = 24;
        pdf.addImage(abnahme.signatureData, 'PNG', margin + 2, yPos, sigWidth, sigHeight);
        pdf.setDrawColor(150, 150, 150);
        pdf.setLineWidth(0.3);
        pdf.line(margin + 2, yPos + sigHeight + 2, margin + 2 + sigWidth, yPos + sigHeight + 2);
        yPos += sigHeight + 8;
      } catch (sigErr) {
        console.error('Error embedding abnahme signature in PDF:', sigErr);
        pdf.setFont('helvetica', 'italic');
        pdf.text('Unterschrift konnte nicht geladen werden', margin + 2, yPos);
        yPos += 8;
      }
    }

    // Abnahme date
    if (abnahme.abnahmeDatum) {
      pdf.setFont('helvetica', 'bold');
      pdf.text('Abnahmedatum:', margin + 2, yPos);
      pdf.setFont('helvetica', 'normal');
      const abnahmeDateFormatted = new Date(abnahme.abnahmeDatum).toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      pdf.text(abnahmeDateFormatted, margin + 65, yPos);
      yPos += 6;
    }

    yPos += 10;
  }

  // ============ ANGEBOT SECTION - If exists (skip in abnahmeOnly mode) ============
  if (!abnahmeOnly && formData.angebot && formData.angebot.items && formData.angebot.items.length > 0) {
    const angebot = formData.angebot;

    // Check if we need a new page
    checkNewPage(80);

    // Angebot header with purple background
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setFillColor(167, 139, 250); // Purple color for angebot
    pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.text('ANGEBOT / PREISE', margin + 2, yPos);
    yPos += 12;

    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');

    // Table header
    const colWidths = {
      bezeichnung: 80,
      menge: 25,
      einzelpreis: 35,
      gesamtpreis: 35
    };
    const tableWidth = colWidths.bezeichnung + colWidths.menge + colWidths.einzelpreis + colWidths.gesamtpreis;
    const tableStartX = margin;

    // Header row background
    pdf.setFillColor(240, 240, 240);
    pdf.rect(tableStartX, yPos - 4, tableWidth, 8, 'F');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    let xPos = tableStartX + 2;
    pdf.text('Bezeichnung', xPos, yPos);
    xPos += colWidths.bezeichnung;
    pdf.text('Menge', xPos, yPos);
    xPos += colWidths.menge;
    pdf.text('Einzelpreis', xPos, yPos);
    xPos += colWidths.einzelpreis;
    pdf.text('Gesamt', xPos, yPos);
    yPos += 8;

    // Item rows
    pdf.setFont('helvetica', 'normal');
    for (const item of angebot.items) {
      checkNewPage(10);

      xPos = tableStartX + 2;
      // Truncate long descriptions
      const maxBezeichnungWidth = colWidths.bezeichnung - 4;
      const bezeichnungLines = pdf.splitTextToSize(item.bezeichnung, maxBezeichnungWidth);
      pdf.text(bezeichnungLines[0], xPos, yPos);

      xPos += colWidths.bezeichnung;
      pdf.text(String(item.menge), xPos, yPos);

      xPos += colWidths.menge;
      pdf.text(`${Number(item.einzelpreis).toFixed(2)} EUR`, xPos, yPos);

      xPos += colWidths.einzelpreis;
      pdf.text(`${Number(item.gesamtpreis).toFixed(2)} EUR`, xPos, yPos);

      yPos += 6;

      // Draw line under each row
      pdf.setDrawColor(230, 230, 230);
      pdf.setLineWidth(0.2);
      pdf.line(tableStartX, yPos - 2, tableStartX + tableWidth, yPos - 2);
    }

    yPos += 4;

    // Summary section
    if (angebot.summary) {
      const summaryX = tableStartX + colWidths.bezeichnung + colWidths.menge;

      pdf.setFont('helvetica', 'normal');
      pdf.text('Netto:', summaryX, yPos);
      pdf.text(`${Number(angebot.summary.netto_summe).toFixed(2)} EUR`, summaryX + colWidths.einzelpreis, yPos);
      yPos += 6;

      pdf.text(`MwSt. (${angebot.summary.mwst_satz || 19}%):`, summaryX, yPos);
      pdf.text(`${Number(angebot.summary.mwst_betrag).toFixed(2)} EUR`, summaryX + colWidths.einzelpreis, yPos);
      yPos += 6;

      pdf.setFont('helvetica', 'bold');
      pdf.text('Brutto:', summaryX, yPos);
      pdf.text(`${Number(angebot.summary.brutto_summe).toFixed(2)} EUR`, summaryX + colWidths.einzelpreis, yPos);
      yPos += 6;

      // Angebot date
      if (angebot.summary.angebot_datum) {
        yPos += 4;
        pdf.setFont('helvetica', 'normal');
        const angebotDateFormatted = new Date(angebot.summary.angebot_datum).toLocaleDateString('de-DE');
        pdf.text(`Angebotsdatum: ${angebotDateFormatted}`, tableStartX + 2, yPos);
      }
    }

    yPos += 15;
  }

  // ============ GRUNDDATEN (skip in abnahmeOnly mode) ============
  if (!abnahmeOnly) {
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.setFillColor(127, 169, 61);
  pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.text('GRUNDDATEN', margin + 2, yPos);
  yPos += 10;

  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');

  // Get montageteam from specifications if exists
  const montageteam = formData.specifications?.montageteam || '-';

  const grunddaten = [
    ['Datum:', formData.datum || '-'],
    ['Aufmasser / Berater:', formData.aufmasser || '-'],
    ['Kunde:', `${formData.kundeVorname || ''} ${formData.kundeNachname || ''}`.trim() || '-'],
    ['E-Mail:', formData.kundeEmail || '-'],
    ['Telefon:', formData.kundeTelefon || '-'],
    ['Kundenlokation:', formData.kundenlokation || '-'],
    ['Montageteam:', String(montageteam)],
  ];

  grunddaten.forEach(([label, value]) => {
    checkNewPage();
    pdf.setFont('helvetica', 'bold');
    pdf.text(label, margin + 2, yPos);
    pdf.setFont('helvetica', 'normal');
    const lines = pdf.splitTextToSize(value, pageWidth - margin - 73);
    pdf.text(lines, margin + 65, yPos);
    yPos += 6 * lines.length;
  });

  yPos += 8;

  // ============ PRODUKTAUSWAHL ============
  checkNewPage(25);
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.setFillColor(127, 169, 61);
  pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.text('PRODUKTAUSWAHL', margin + 2, yPos);
  yPos += 10;

  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');

  // Handle model as array or string
  const modelValue = Array.isArray(formData.productSelection.model)
    ? formData.productSelection.model.join(', ')
    : formData.productSelection.model;

  const produktauswahl: string[][] = [
    ['Kategorie:', formData.productSelection.category || '-'],
  ];
  // Hide Produkttyp in Abnahme PDF
  if (!formData.abnahme) {
    produktauswahl.push(['Produkttyp:', formData.productSelection.productType || '-']);
  }
  // Only show model row if model was selected
  if (modelValue) {
    produktauswahl.push(['Modell:', modelValue]);
  }

  produktauswahl.forEach(([label, value]) => {
    checkNewPage();
    pdf.setFont('helvetica', 'bold');
    pdf.text(label, margin + 2, yPos);
    pdf.setFont('helvetica', 'normal');
    const lines = pdf.splitTextToSize(value, pageWidth - margin - 73);
    pdf.text(lines, margin + 65, yPos);
    yPos += 6 * lines.length;
  });

  yPos += 8;

  // ============ SPEZIFIKATIONEN ============
  if (formData.productSelection.category && formData.productSelection.productType) {
    const fields = productConfig[formData.productSelection.category]?.[formData.productSelection.productType]?.fields || [];

    if (fields.length > 0 && Object.keys(formData.specifications).length > 0) {
      checkNewPage(25);
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.setFillColor(127, 169, 61);
      pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.text('SPEZIFIKATIONEN', margin + 2, yPos);
      yPos += 10;

      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');

      fields.forEach((field: FieldConfig) => {
        // Check showWhen condition
        if (field.showWhen) {
          const dependentValue = formData.specifications[field.showWhen.field];
          if (dependentValue !== field.showWhen.value) {
            return; // Skip this field
          }
        }

        const value = formData.specifications[field.name];

        // Handle seitenmarkise field type separately
        if (field.type === 'seitenmarkise' && value) {
          try {
            const seitenmarkiseData = typeof value === 'string' ? JSON.parse(value) : value;
            const activePositions = Object.keys(seitenmarkiseData).filter(
              pos => seitenmarkiseData[pos]?.active
            );

            if (activePositions.length > 0) {
              checkNewPage(25);
              yPos += 5;
              pdf.setFont('helvetica', 'bold');
              pdf.setFontSize(11);
              pdf.text('Seitenmarkise:', margin + 2, yPos);
              yPos += 8;

              pdf.setFontSize(10);
              activePositions.forEach(position => {
                const posData = seitenmarkiseData[position];
                checkNewPage();

                pdf.setFont('helvetica', 'bold');
                pdf.text(`${position}:`, margin + 5, yPos);
                pdf.setFont('helvetica', 'normal');

                let details = '';
                if (posData.aufteilung === 'mit') {
                  details = `Mit Aufteilung - Links: ${posData.links || 0} mm, Rechts: ${posData.rechts || 0} mm`;
                } else if (posData.aufteilung === 'ohne') {
                  details = `Ohne Aufteilung - Breite: ${posData.breite || 0} mm`;
                }

                pdf.text(details, margin + 30, yPos);
                yPos += 6;
              });
              yPos += 3;
            }
          } catch (e) {
            // Skip if parsing fails
          }
          return; // Skip normal processing for seitenmarkise
        }

        if (value !== undefined && value !== null && value !== '') {
          checkNewPage();

          let displayValue = '';

          if (typeof value === 'boolean') {
            displayValue = value ? 'Ja' : 'Nein';
          } else if (typeof value === 'number') {
            displayValue = field.unit ? `${value} ${field.unit}` : String(value);
          } else if (Array.isArray(value)) {
            displayValue = value.join(', ');
          } else {
            displayValue = String(value);
          }

          // For fundament field, append the additional details if Aylux selected
          if (field.type === 'fundament' && value === 'Aylux' && formData.specifications[`${field.name}Value`]) {
            displayValue += ` - ${formData.specifications[`${field.name}Value`]}`;
          }

          // For conditional fields with valueUnit (like Dämmung, Überstand), append unit
          if (field.type === 'conditional' && field.valueUnit && value) {
            displayValue += ` ${field.valueUnit}`;
          }

          pdf.setFont('helvetica', 'bold');
          pdf.text(`${field.label}:`, margin + 2, yPos);
          pdf.setFont('helvetica', 'normal');

          // Set red color + bold + uppercase for conditional/bauform fields with "Ja" values
          // For conditional fields, check the ${field.name}Active flag
          const isConditionalActive = field.type === 'conditional' &&
            formData.specifications[`${field.name}Active`] === true;
          const isBauformActive = field.type === 'bauform' &&
            (displayValue.includes('EINGERÜCKT') || displayValue.includes('EINGERUCKT'));
          const isConditionalWithValue = isConditionalActive || isBauformActive;

          let finalDisplayValue = displayValue;
          if (isConditionalWithValue) {
            pdf.setTextColor(220, 38, 38); // Red color
            pdf.setFont('helvetica', 'bold');
            finalDisplayValue = displayValue.toUpperCase();
          }

          const lines = pdf.splitTextToSize(finalDisplayValue, pageWidth - margin - 60);
          pdf.text(lines, margin + 65, yPos);

          // Reset text color and font
          if (isConditionalWithValue) {
            pdf.setTextColor(0, 0, 0); // Back to black
            pdf.setFont('helvetica', 'normal');
          }
          yPos += 6 * lines.length;
        }
      });

      // Add Markise data if exists
      if (formData.specifications.markiseActive && formData.specifications.markiseData) {
        try {
          const parsed = JSON.parse(formData.specifications.markiseData as string);
          // Support both single object (legacy) and array format
          const markisenArray = Array.isArray(parsed) ? parsed : [parsed];

          if (markisenArray.length > 0) {
            checkNewPage(25);
            yPos += 5;
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(11);
            pdf.text(`Markise Details (${markisenArray.length} Stück):`, margin + 2, yPos);
            yPos += 10;

            // Iterate through all markisen
            markisenArray.forEach((markiseData: Record<string, unknown>, index: number) => {
              checkNewPage(30);

              // Markise header
              pdf.setFontSize(10);
              pdf.setFont('helvetica', 'bold');
              const markiseLabel = markiseData.typ
                ? `Markise ${index + 1}: ${markiseData.typ}${markiseData.position ? ` - ${markiseData.position}` : ''}`
                : `Markise ${index + 1}`;
              pdf.text(markiseLabel, margin + 5, yPos);
              yPos += 7;

              pdf.setFont('helvetica', 'normal');

              const markiseFields: [string, string][] = [
                ['Typ:', String(markiseData.typ || '-')],
                ['Modell:', String(markiseData.modell || '-')],
                ['Breite:', markiseData.breite ? `${markiseData.breite} mm` : '-'],
                ['Länge:', markiseData.laenge ? `${markiseData.laenge} mm` : '-'],
              ];

              // Height only for SENKRECHT
              if (markiseData.typ === 'SENKRECHT' && markiseData.hoehe) {
                markiseFields.push(['Höhe:', `${markiseData.hoehe} mm`]);
              }

              markiseFields.push(
                ['Stoff Nummer:', String(markiseData.stoffNummer || '-')],
                ['Gestellfarbe:', String(markiseData.gestellfarbe || '-')],
                ['Antrieb:', String(markiseData.antrieb || '-')],
                ['Antriebsseite:', String(markiseData.antriebsseite || '-')]
              );

              if (markiseData.befestigungsart) {
                markiseFields.push(['Befestigungsart:', String(markiseData.befestigungsart)]);
              }
              if (markiseData.position) {
                markiseFields.push(['Position:', String(markiseData.position)]);
              }
              if (markiseData.zip) {
                markiseFields.push(['ZIP:', String(markiseData.zip)]);
              }
              if (markiseData.volanTyp) {
                markiseFields.push(['Volan Typ:', String(markiseData.volanTyp)]);
              }

              markiseFields.forEach(([label, value]) => {
                if (value && value !== '-') {
                  checkNewPage();
                  pdf.setFont('helvetica', 'bold');
                  pdf.text(label, margin + 10, yPos);
                  pdf.setFont('helvetica', 'normal');
                  pdf.text(value, margin + 65, yPos);
                  yPos += 6;
                }
              });

              yPos += 5; // Space between markisen
            });

            // Add Markise bemerkungen if exists - RED + UPPERCASE + BOLD
            const markiseBemerkungen = formData.specifications.markiseBemerkungen as string;
            if (markiseBemerkungen && markiseBemerkungen.trim()) {
              checkNewPage(15);
              pdf.setFont('helvetica', 'bold');
              pdf.text('Markise Bemerkungen:', margin + 5, yPos);
              yPos += 6;
              pdf.setTextColor(220, 38, 38); // Red color
              pdf.setFont('helvetica', 'bold');
              const markiseBemerkungenText = markiseBemerkungen.toUpperCase();
              const bemerkungenLines = pdf.splitTextToSize(markiseBemerkungenText, pageWidth - margin - 30);
              bemerkungenLines.forEach((line: string) => {
                checkNewPage();
                pdf.text(line, margin + 10, yPos);
                yPos += 5;
              });
              pdf.setTextColor(0, 0, 0); // Reset color
            }
          }
        } catch (e) {
          // Skip markise data if parsing fails
        }
      }

      // ============ INTEGRATED AUFGLAS/UNTERGLAS MARKISE (for ÜBERDACHUNG) ============
      const glasMarkiseType = formData.specifications.glasMarkiseType as string;
      if (glasMarkiseType && glasMarkiseType !== 'Keine') {
        checkNewPage(30);
        yPos += 5;

        // Section header
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        pdf.setFillColor(127, 169, 61);
        pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.text(glasMarkiseType, margin + 2, yPos);
        pdf.setTextColor(0, 0, 0);
        yPos += 10;

        pdf.setFontSize(10);
        const glasMarkiseFields: [string, string][] = [];

        if (formData.specifications.glasMarkiseAufteilung) {
          glasMarkiseFields.push(['Aufteilung:', String(formData.specifications.glasMarkiseAufteilung)]);
        }
        if (formData.specifications.glasMarkiseStoffNummer) {
          glasMarkiseFields.push(['Stoff Nummer:', String(formData.specifications.glasMarkiseStoffNummer)]);
        }
        if (formData.specifications.glasMarkiseZip) {
          glasMarkiseFields.push(['ZIP:', String(formData.specifications.glasMarkiseZip)]);
        }
        if (formData.specifications.glasMarkiseAntrieb) {
          glasMarkiseFields.push(['Antrieb:', String(formData.specifications.glasMarkiseAntrieb)]);
        }
        if (formData.specifications.glasMarkiseAntriebseite) {
          glasMarkiseFields.push(['Antriebseite:', String(formData.specifications.glasMarkiseAntriebseite)]);
        }

        glasMarkiseFields.forEach(([label, value]) => {
          checkNewPage();
          pdf.setFont('helvetica', 'bold');
          pdf.text(label, margin + 5, yPos);
          pdf.setFont('helvetica', 'normal');
          pdf.text(value, margin + 65, yPos);
          yPos += 6;
        });

        yPos += 5;
      }

      // ============ INTEGRATED SENKRECHT MARKISE (for ÜBERDACHUNG) ============
      const senkrechtActive = formData.specifications.senkrechtMarkiseActive as string;
      if (senkrechtActive === 'Ja' && formData.specifications.senkrechtMarkiseData) {
        try {
          const rawData = JSON.parse(formData.specifications.senkrechtMarkiseData as string);
          // Support both new format (string[] of positions) and old format (object[] with full details)
          let positions: string[] = [];
          if (Array.isArray(rawData) && rawData.length > 0) {
            if (typeof rawData[0] === 'string') {
              positions = rawData;
            } else if (typeof rawData[0] === 'object' && rawData[0].position) {
              positions = rawData.map((item: Record<string, unknown>) => String(item.position)).filter(Boolean);
            }
          }

          if (positions.length > 0) {
            checkNewPage(25);
            yPos += 5;

            // Section header
            pdf.setFontSize(12);
            pdf.setFont('helvetica', 'bold');
            pdf.setFillColor(127, 169, 61);
            pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
            pdf.setTextColor(255, 255, 255);
            pdf.text('SENKRECHT MARKISE', margin + 2, yPos);
            pdf.setTextColor(0, 0, 0);
            yPos += 10;

            pdf.setFontSize(10);
            pdf.setFont('helvetica', 'bold');
            pdf.text('Positionen:', margin + 5, yPos);
            pdf.setFont('helvetica', 'normal');
            const posText = positions.join(', ');
            const posMaxWidth = pageWidth - margin - 60;
            const posLines = pdf.splitTextToSize(posText, posMaxWidth);
            posLines.forEach((line: string, i: number) => {
              if (i > 0) checkNewPage();
              pdf.text(line, margin + 40, yPos);
              yPos += 6;
            });
            yPos += 4;
          }
        } catch (e) {
          // Skip senkrecht data if parsing fails
        }
      }

      // ============ INTEGRATED FESTES ELEMENT (for ÜBERDACHUNG) ============
      const festesActive = formData.specifications.festesElementActive as string;
      if (festesActive === 'Ja' && formData.specifications.festesElementData) {
        try {
          const rawFestes = JSON.parse(formData.specifications.festesElementData as string);
          const fPositions: string[] = Array.isArray(rawFestes) ? rawFestes.filter((item: unknown) => typeof item === 'string') : [];

          if (fPositions.length > 0) {
            checkNewPage(25);
            yPos += 5;

            // Section header
            pdf.setFontSize(12);
            pdf.setFont('helvetica', 'bold');
            pdf.setFillColor(127, 169, 61);
            pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
            pdf.setTextColor(255, 255, 255);
            pdf.text('FESTES ELEMENT', margin + 2, yPos);
            pdf.setTextColor(0, 0, 0);
            yPos += 10;

            pdf.setFontSize(10);
            pdf.setFont('helvetica', 'bold');
            pdf.text('Positionen:', margin + 5, yPos);
            pdf.setFont('helvetica', 'normal');
            const fPosText = fPositions.join(', ');
            const fPosMaxWidth = pageWidth - margin - 60;
            const fPosLines = pdf.splitTextToSize(fPosText, fPosMaxWidth);
            fPosLines.forEach((line: string, i: number) => {
              if (i > 0) checkNewPage();
              pdf.text(line, margin + 40, yPos);
              yPos += 6;
            });
            yPos += 4;
          }
        } catch (e) {
          // Skip festes element data if parsing fails
        }
      }

      // ============ INTEGRATED SCHIEBE ELEMENT (for ÜBERDACHUNG) ============
      const schiebeActive = formData.specifications.schiebeElementActive as string;
      if (schiebeActive === 'Ja' && formData.specifications.schiebeElementData) {
        try {
          const rawSchiebe = JSON.parse(formData.specifications.schiebeElementData as string);
          const sPositions: string[] = Array.isArray(rawSchiebe) ? rawSchiebe.filter((item: unknown) => typeof item === 'string') : [];

          if (sPositions.length > 0) {
            checkNewPage(25);
            yPos += 5;

            // Section header
            pdf.setFontSize(12);
            pdf.setFont('helvetica', 'bold');
            pdf.setFillColor(127, 169, 61);
            pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
            pdf.setTextColor(255, 255, 255);
            pdf.text('SCHIEBE ELEMENT', margin + 2, yPos);
            pdf.setTextColor(0, 0, 0);
            yPos += 10;

            pdf.setFontSize(10);
            pdf.setFont('helvetica', 'bold');
            pdf.text('Positionen:', margin + 5, yPos);
            pdf.setFont('helvetica', 'normal');
            const sPosText = sPositions.join(', ');
            const sPosMaxWidth = pageWidth - margin - 60;
            const sPosLines = pdf.splitTextToSize(sPosText, sPosMaxWidth);
            sPosLines.forEach((line: string, i: number) => {
              if (i > 0) checkNewPage();
              pdf.text(line, margin + 40, yPos);
              yPos += 6;
            });
            yPos += 4;
          }
        } catch (e) {
          // Skip schiebe element data if parsing fails
        }
      }

      // ============ INTEGRATED KEIL FENSTER (for ÜBERDACHUNG) ============
      const keilFensterActive = formData.specifications.keilFensterActive as string;
      if (keilFensterActive === 'Ja' && formData.specifications.keilFensterData) {
        try {
          const rawKeil = JSON.parse(formData.specifications.keilFensterData as string);
          const kPositions: string[] = Array.isArray(rawKeil) ? rawKeil.filter((item: unknown) => typeof item === 'string') : [];

          if (kPositions.length > 0) {
            checkNewPage(25);
            yPos += 5;

            // Section header
            pdf.setFontSize(12);
            pdf.setFont('helvetica', 'bold');
            pdf.setFillColor(127, 169, 61);
            pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
            pdf.setTextColor(255, 255, 255);
            pdf.text('KEIL FENSTER', margin + 2, yPos);
            pdf.setTextColor(0, 0, 0);
            yPos += 10;

            pdf.setFontSize(10);
            pdf.setFont('helvetica', 'bold');
            pdf.text('Positionen:', margin + 5, yPos);
            pdf.setFont('helvetica', 'normal');
            const kPosText = kPositions.join(', ');
            const kPosMaxWidth = pageWidth - margin - 60;
            const kPosLines = pdf.splitTextToSize(kPosText, kPosMaxWidth);
            kPosLines.forEach((line: string, i: number) => {
              if (i > 0) checkNewPage();
              pdf.text(line, margin + 40, yPos);
              yPos += 6;
            });
            yPos += 4;
          }
        } catch (e) {
          // Skip keil fenster data if parsing fails
        }
      }

      yPos += 8;
    }
  }

  // ============ UNTERBAUELEMENTE ============
  if (formData.productSelection.category === 'UNTERBAUELEMENTE' && formData.specifications.unterbauelementeData) {
    try {
      const elements = JSON.parse(formData.specifications.unterbauelementeData as string);
      if (Array.isArray(elements) && elements.length > 0) {
        checkNewPage(25);
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.setFillColor(127, 169, 61);
        pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.text(`UNTERBAUELEMENTE (${elements.length} Stück)`, margin + 2, yPos);
        yPos += 15;

        pdf.setTextColor(0, 0, 0);

        // Draw each element in a card-like box
        elements.forEach((el: Record<string, unknown>, index: number) => {
          // Calculate required height for this element
          const requiredHeight = 70;
          if (yPos + requiredHeight > pageHeight - 30) {
            pdf.addPage();
            yPos = 20;
          }

          // Draw element box background
          const boxStartY = yPos - 3;
          pdf.setFillColor(248, 250, 245); // Light green-ish background
          pdf.setDrawColor(127, 169, 61);
          pdf.roundedRect(margin, boxStartY, pageWidth - 2 * margin, 60, 3, 3, 'FD');

          // Element header with green background
          pdf.setFillColor(127, 169, 61);
          pdf.rect(margin, boxStartY, pageWidth - 2 * margin, 10, 'F');

          pdf.setFontSize(11);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(255, 255, 255);
          const elementLabel = el.produktTyp
            ? `${index + 1}. ${el.produktTyp}${el.position ? ` - ${el.position}` : ''}`
            : `Unterbauelement ${index + 1}`;
          pdf.text(elementLabel, margin + 5, boxStartY + 7);

          yPos = boxStartY + 17;
          pdf.setTextColor(0, 0, 0);
          pdf.setFontSize(9);

          // Left column
          const leftColX = margin + 5;
          const rightColX = margin + (pageWidth - 2 * margin) / 2 + 5;
          let leftY = yPos;
          let rightY = yPos;

          const addField = (label: string, value: string, side: 'left' | 'right') => {
            const x = side === 'left' ? leftColX : rightColX;
            const y = side === 'left' ? leftY : rightY;

            pdf.setFont('helvetica', 'bold');
            pdf.text(label, x, y);
            pdf.setFont('helvetica', 'normal');
            pdf.text(value, x + 35, y);

            if (side === 'left') leftY += 7;
            else rightY += 7;
          };

          // Build fields based on produktTyp
          if (el.produktTyp) addField('Typ:', String(el.produktTyp), 'left');
          if (el.modell) addField('Modell:', String(el.modell), 'right');

          // Dimension fields - handle Keil and Festes Element with conditional fields
          if (el.produktTyp === 'Keil') {
            if (el.laenge) addField('Länge:', `${el.laenge} mm`, 'left');
            if (el.hintenHoehe) addField('Hinten:', `${el.hintenHoehe} mm`, 'right');
            if (el.vorneHoehe) addField('Vorne:', `${el.vorneHoehe} mm`, 'left');
          } else if (el.produktTyp === 'Festes Element') {
            // Festes Element has conditional fields based on elementForm
            if (el.elementForm) addField('Form:', String(el.elementForm), 'left');
            if (el.breite) addField('Breite:', `${el.breite} mm`, 'right');
            // Show hoehe only for Rechteck, hintenHoehe/vorneHoehe only for Trapez
            if (el.elementForm === 'Rechteck' && el.hoehe) {
              addField('Höhe:', `${el.hoehe} mm`, 'left');
            } else if (el.elementForm === 'Trapez') {
              if (el.hintenHoehe) addField('Hinten Höhe:', `${el.hintenHoehe} mm`, 'left');
              if (el.vorneHoehe) addField('Vorne Höhe:', `${el.vorneHoehe} mm`, 'right');
            }
          } else {
            if (el.breite) addField('Breite:', `${el.breite} mm`, 'left');
            if (el.hoehe) addField('Höhe:', `${el.hoehe} mm`, 'right');
          }

          if (el.gestellfarbe) addField('Farbe:', String(el.gestellfarbe), 'left');
          if (el.position) addField('Position:', String(el.position), 'right');
          if (el.oeffnungsrichtung) addField('Öffnung:', String(el.oeffnungsrichtung), 'left');
          if (el.anzahlFluegel) addField('Flügel:', String(el.anzahlFluegel), 'right');
          if (el.fundament) {
            let fundamentText = String(el.fundament);
            if (el.fundamentValue) fundamentText += ` - ${el.fundamentValue}`;
            addField('Fundament:', fundamentText, 'left');
          }
          if (el.drehrichtung) addField('Drehricht.:', String(el.drehrichtung), 'left');
          if (el.schloss) addField('Schloss:', String(el.schloss), 'right');

          yPos = boxStartY + 68; // Move past the box
        });

        // Add Unterbauelemente bemerkungen if exists - RED + UPPERCASE + BOLD
        const unterbauelementeBemerkungen = formData.specifications.unterbauelementeBemerkungen as string;
        if (unterbauelementeBemerkungen && unterbauelementeBemerkungen.trim()) {
          checkNewPage(20);
          yPos += 5;
          pdf.setFontSize(10);
          pdf.setFont('helvetica', 'bold');
          pdf.text('Bemerkungen:', margin + 2, yPos);
          yPos += 6;
          pdf.setTextColor(220, 38, 38); // Red color
          pdf.setFont('helvetica', 'bold');
          const unterbauBemerkungenText = unterbauelementeBemerkungen.toUpperCase();
          const bemerkungenLines = pdf.splitTextToSize(unterbauBemerkungenText, pageWidth - margin - 20);
          bemerkungenLines.forEach((line: string) => {
            checkNewPage();
            pdf.text(line, margin + 8, yPos);
            yPos += 5;
          });
          pdf.setTextColor(0, 0, 0); // Reset color
        }

        yPos += 10;
      }
    } catch (e) {
      // Skip unterbauelemente data if parsing fails
    }
  }

  // ============ WEITERE PRODUKTE ============
  console.log('PDF Generator - weitereProdukte:', formData.weitereProdukte);
  console.log('PDF Generator - weitereProdukte length:', formData.weitereProdukte?.length);
  if (formData.weitereProdukte && formData.weitereProdukte.length > 0) {
    // Start on a new page
    pdf.addPage();
    yPos = 20;

    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setFillColor(127, 169, 61);
    pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.text(`WEITERE PRODUKTE (${formData.weitereProdukte.length} Stück)`, margin + 2, yPos);
    yPos += 10;

    pdf.setTextColor(0, 0, 0);

    formData.weitereProdukte.forEach((produkt, index) => {
      checkNewPage(40);

      // Product header
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'bold');
      const produktLabel = produkt.category && produkt.productType
        ? `${index + 1}. ${produkt.category} - ${produkt.productType}${produkt.model ? ` (${produkt.model})` : ''}`
        : `Weiteres Produkt ${index + 1}`;
      pdf.text(produktLabel, margin + 2, yPos);
      yPos += 8;

      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');

      // Get fields for this product type
      const produktFields = productConfig[produkt.category]?.[produkt.productType]?.fields || [];

      // Build display fields
      const displayFields: { label: string; value: string; isConditional: boolean }[] = [];

      if (produkt.category) displayFields.push({ label: 'Kategorie:', value: produkt.category, isConditional: false });
      if (produkt.productType) displayFields.push({ label: 'Produkttyp:', value: produkt.productType, isConditional: false });
      if (produkt.model) displayFields.push({ label: 'Modell:', value: produkt.model, isConditional: false });

      // Add specification fields
      produktFields.forEach((field: FieldConfig) => {
        // Check showWhen condition
        if (field.showWhen) {
          const dependentValue = produkt.specifications[field.showWhen.field];
          if (dependentValue !== field.showWhen.value) {
            return; // Skip this field
          }
        }

        const value = produkt.specifications[field.name];

        // Handle senkrecht_section field type for Weitere Produkte
        if (field.type === 'senkrecht_section') {
          const activeVal = produkt.specifications[`${field.name}Active`];
          if (activeVal === 'Ja') {
            const posData = produkt.specifications[`${field.name}Data`];
            let positions: string[] = [];
            try {
              positions = typeof posData === 'string' ? JSON.parse(posData) : (Array.isArray(posData) ? posData : []);
            } catch (e) { /* ignore */ }
            const posText = positions.length > 0 ? positions.join(', ') : 'Keine Positionen';
            displayFields.push({ label: 'Senkrecht Markise:', value: `Ja - ${posText}`, isConditional: false });
          } else if (activeVal === 'Keine') {
            displayFields.push({ label: 'Senkrecht Markise:', value: 'Keine', isConditional: false });
          }
          return;
        }

        // Handle festes_element_section field type for Weitere Produkte
        if (field.type === 'festes_element_section') {
          const activeVal = produkt.specifications[`${field.name}Active`];
          if (activeVal === 'Ja') {
            const posData = produkt.specifications[`${field.name}Data`];
            let positions: string[] = [];
            try {
              positions = typeof posData === 'string' ? JSON.parse(posData) : (Array.isArray(posData) ? posData : []);
            } catch (e) { /* ignore */ }
            const posText = positions.length > 0 ? positions.join(', ') : 'Keine Positionen';
            displayFields.push({ label: 'Festes Element:', value: `Ja - ${posText}`, isConditional: false });
          } else if (activeVal === 'Keine') {
            displayFields.push({ label: 'Festes Element:', value: 'Keine', isConditional: false });
          }
          return;
        }

        // Handle schiebe_element_section field type for Weitere Produkte
        if (field.type === 'schiebe_element_section') {
          const activeVal = produkt.specifications[`${field.name}Active`];
          if (activeVal === 'Ja') {
            const posData = produkt.specifications[`${field.name}Data`];
            let positions: string[] = [];
            try {
              positions = typeof posData === 'string' ? JSON.parse(posData) : (Array.isArray(posData) ? posData : []);
            } catch (e) { /* ignore */ }
            const posText = positions.length > 0 ? positions.join(', ') : 'Keine Positionen';
            displayFields.push({ label: 'Schiebe Element:', value: `Ja - ${posText}`, isConditional: false });
          } else if (activeVal === 'Keine') {
            displayFields.push({ label: 'Schiebe Element:', value: 'Keine', isConditional: false });
          }
          return;
        }

        // Handle keil_fenster_section field type for Weitere Produkte
        if (field.type === 'keil_fenster_section') {
          const activeVal = produkt.specifications[`${field.name}Active`];
          if (activeVal === 'Ja') {
            const posData = produkt.specifications[`${field.name}Data`];
            let positions: string[] = [];
            try {
              positions = typeof posData === 'string' ? JSON.parse(posData) : (Array.isArray(posData) ? posData : []);
            } catch (e) { /* ignore */ }
            const posText = positions.length > 0 ? positions.join(', ') : 'Keine Positionen';
            displayFields.push({ label: 'Keil Fenster:', value: `Ja - ${posText}`, isConditional: false });
          } else if (activeVal === 'Keine') {
            displayFields.push({ label: 'Keil Fenster:', value: 'Keine', isConditional: false });
          }
          return;
        }

        // Handle seitenmarkise field type separately for Weitere Produkte
        if (field.type === 'seitenmarkise' && value) {
          try {
            const seitenmarkiseData = typeof value === 'string' ? JSON.parse(value) : value;
            const activePositions = Object.keys(seitenmarkiseData).filter(
              pos => seitenmarkiseData[pos]?.active
            );

            if (activePositions.length > 0) {
              displayFields.push({ label: 'Seitenmarkise:', value: '', isConditional: false });
              activePositions.forEach(position => {
                const posData = seitenmarkiseData[position];
                let details = '';
                if (posData.aufteilung === 'mit') {
                  details = `${position}: Mit Aufteilung - Links: ${posData.links || 0} mm, Rechts: ${posData.rechts || 0} mm`;
                } else if (posData.aufteilung === 'ohne') {
                  details = `${position}: Ohne Aufteilung - Breite: ${posData.breite || 0} mm`;
                }
                if (details) {
                  displayFields.push({ label: '', value: details, isConditional: false });
                }
              });
            }
          } catch (e) {
            // Skip if parsing fails
          }
          return; // Skip normal processing for seitenmarkise
        }

        if (value !== undefined && value !== null && value !== '') {
          let displayValue = '';

          if (typeof value === 'boolean') {
            displayValue = value ? 'Ja' : 'Nein';
          } else if (typeof value === 'number') {
            displayValue = field.unit ? `${value} ${field.unit}` : String(value);
          } else if (Array.isArray(value)) {
            displayValue = value.join(', ');
          } else {
            displayValue = String(value);
          }

          // For fundament field, append the additional details if Aylux selected
          if (field.type === 'fundament' && value === 'Aylux' && produkt.specifications[`${field.name}Value`]) {
            displayValue += ` - ${produkt.specifications[`${field.name}Value`]}`;
          }

          // For conditional fields with valueUnit (like Dämmung, Überstand), append unit
          if (field.type === 'conditional' && field.valueUnit && value) {
            displayValue += ` ${field.valueUnit}`;
          }

          // Check if conditional field has Active flag set
          const isCondActive = field.type === 'conditional' &&
            produkt.specifications[`${field.name}Active`] === true;
          const isBauActive = field.type === 'bauform' &&
            (displayValue.includes('EINGERÜCKT') || displayValue.includes('EINGERUCKT'));

          displayFields.push({
            label: `${field.label}:`,
            value: displayValue,
            isConditional: isCondActive || isBauActive
          });
        }
      });

      displayFields.forEach((item) => {
        checkNewPage();
        pdf.setFont('helvetica', 'bold');
        pdf.text(item.label, margin + 8, yPos);
        pdf.setFont('helvetica', 'normal');

        // Set red color + bold + uppercase for conditional/bauform fields with "Ja" values
        let displayValue = item.value;
        if (item.isConditional) {
          pdf.setTextColor(220, 38, 38); // Red color
          pdf.setFont('helvetica', 'bold');
          displayValue = item.value.toUpperCase();
        }

        const lines = pdf.splitTextToSize(displayValue, pageWidth - margin - 70);
        pdf.text(lines, margin + 65, yPos);

        // Reset text color and font
        if (item.isConditional) {
          pdf.setTextColor(0, 0, 0);
          pdf.setFont('helvetica', 'normal');
        }
        yPos += 6 * lines.length;
      });

      yPos += 5; // Space between products
    });

    yPos += 8;
  }

  // ============ BEMERKUNGEN ============
  console.log('PDF Generator - bemerkungen value:', formData.bemerkungen);
  console.log('PDF Generator - bemerkungen type:', typeof formData.bemerkungen);
  if (formData.bemerkungen && formData.bemerkungen.trim()) {
    checkNewPage(25);
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setFillColor(127, 169, 61);
    pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.text('BEMERKUNGEN', margin + 2, yPos);
    yPos += 10;

    // Use RED color and UPPERCASE for Bemerkungen text
    pdf.setTextColor(220, 38, 38); // Red color for Bemerkungen
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');

    // Convert to uppercase
    const bemerkText = formData.bemerkungen.toUpperCase();
    const lines = pdf.splitTextToSize(bemerkText, pageWidth - 2 * margin - 4);

    lines.forEach((line: string) => {
      checkNewPage();
      pdf.text(line, margin + 2, yPos);
      yPos += 6;
    });

    // Reset text color
    pdf.setTextColor(0, 0, 0);
  }

  // ============ KUNDENUNTERSCHRIFT ============
  const customerSignature = formData.customerSignature;
  const signatureName = formData.signatureName;
  console.log('PDF Generator - customerSignature exists:', !!customerSignature, 'length:', customerSignature?.length);
  console.log('PDF Generator - signatureName:', signatureName);
  console.log('PDF Generator - forSignature flag:', forSignature);

  if (customerSignature && !forSignature) {
    checkNewPage(60);

    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setFillColor(127, 169, 61);
    pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.text('KUNDENUNTERSCHRIFT', margin + 2, yPos);
    yPos += 12;

    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(10);

    try {
      // Signature image
      const sigWidth = 70;
      const sigHeight = 30;
      const sigX = margin + 2;
      pdf.addImage(customerSignature, 'PNG', sigX, yPos, sigWidth, sigHeight);

      // Signature line under the image
      pdf.setDrawColor(150, 150, 150);
      pdf.setLineWidth(0.3);
      pdf.line(sigX, yPos + sigHeight + 2, sigX + sigWidth, yPos + sigHeight + 2);

      // Name and date to the right
      const infoX = margin + sigWidth + 15;
      pdf.setFont('helvetica', 'bold');
      pdf.text('Name:', infoX, yPos + 8);
      pdf.setFont('helvetica', 'normal');
      pdf.text(signatureName || '-', infoX + 15, yPos + 8);

      pdf.setFont('helvetica', 'bold');
      pdf.text('Datum:', infoX, yPos + 16);
      pdf.setFont('helvetica', 'normal');
      pdf.text(new Date().toLocaleDateString('de-DE'), infoX + 16, yPos + 16);

      pdf.setFont('helvetica', 'bold');
      pdf.text('Ort:', infoX, yPos + 24);
      pdf.setFont('helvetica', 'normal');
      pdf.text(formData.kundenlokation || '-', infoX + 10, yPos + 24);

      yPos += sigHeight + 15;
    } catch (sigErr) {
      console.error('Error embedding signature in PDF:', sigErr);
      pdf.setFont('helvetica', 'italic');
      pdf.text('Unterschrift konnte nicht geladen werden', margin + 2, yPos);
      yPos += 10;
    }
  }

  // ============ BILDER & ANHÄNGE (skip for signature PDF) ============
  const bilder = formData.bilder as (File | ServerImage)[];
  if (bilder && bilder.length > 0 && !forSignature) {
    // Separate images and PDFs - handle both File and ServerImage objects
    const imageItems: (File | ServerImage)[] = [];
    const pdfFiles: File[] = [];
    const serverPdfFiles: ServerImage[] = [];

    for (const item of bilder) {
      if (!item) continue;

      if (item instanceof File) {
        // It's a File object
        if (item.type.startsWith('image/')) {
          imageItems.push(item);
        } else if (item.type === 'application/pdf' || item.name?.toLowerCase().endsWith('.pdf')) {
          pdfFiles.push(item);
        } else {
          // Check by extension
          const ext = item.name?.toLowerCase().split('.').pop();
          if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext || '')) {
            imageItems.push(item);
          }
        }
      } else if (isServerImage(item)) {
        // It's a server image/file object
        if (item.file_type.startsWith('image/')) {
          imageItems.push(item);
        } else if (item.file_type === 'application/pdf' || item.file_name?.toLowerCase().endsWith('.pdf')) {
          serverPdfFiles.push(item);
        }
      }
    }

    // Start attachments on a new page if we have any images
    if (imageItems.length > 0) {
      pdf.addPage();
      yPos = 20;

      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.setFillColor(127, 169, 61);
      pdf.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.text('BILDER', margin + 2, yPos);
      yPos += 15;

      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(10);

      // Process each image (both File and ServerImage)
      for (let i = 0; i < imageItems.length; i++) {
        const item = imageItems[i];
        let base64: string;
        let fileName: string;

        try {
          if (item instanceof File) {
            // It's a File object - get EXIF orientation and fix if needed
            base64 = await fileToBase64(item);
            try {
              const orientation = await getExifOrientation(item);
              base64 = await fixImageOrientation(base64, orientation);
            } catch {
              // Use original base64 if orientation fix fails
            }
            fileName = item.name;
          } else if (isServerImage(item)) {
            // It's a server image - fetch from server and fix orientation
            base64 = await fetchServerImageAsBase64(item.id);
            // Try to fix orientation for server images too (non-critical)
            try {
              base64 = await fixImageOrientationAuto(base64);
            } catch {
              // Use original base64 if orientation fix fails
            }
            fileName = item.file_name;
          } else {
            continue;
          }

          const dimensions = await getImageDimensions(base64);

          // Calculate image size to fit on page
          const maxWidth = pageWidth - 2 * margin;
          const maxHeight = 80; // Max height per image

          let imgWidth = dimensions.width;
          let imgHeight = dimensions.height;

          // Scale to fit
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

          // Check if we need a new page
          if (yPos + imgHeight + 15 > pageHeight - 20) {
            pdf.addPage();
            yPos = 20;
          }

          // Add image label
          pdf.setFont('helvetica', 'bold');
          pdf.text(`Bild ${i + 1}: ${fileName}`, margin, yPos);
          yPos += 5;

          // Add image - center it horizontally
          const xPos = margin + (maxWidth - imgWidth) / 2;
          pdf.addImage(base64, 'JPEG', xPos, yPos, imgWidth, imgHeight);

          yPos += imgHeight + 15;

        } catch (error) {
          // If image fails to load, add a placeholder message
          const name = item instanceof File ? item.name : (isServerImage(item) ? item.file_name : 'Unbekannt');
          pdf.setFont('helvetica', 'italic');
          pdf.text(`Bild ${i + 1}: ${name} - Konnte nicht geladen werden`, margin, yPos);
          yPos += 10;
        }
      }
    }

    // PDF attachments are accessible via the application dashboard, not embedded in this PDF
  }
  } // end of !abnahmeOnly block

  // ============ MODÜL F: AGB (eğer ilgili PDF tipinde işaretliyse) ============
  const branchTerms = await getCachedBranchTerms();
  const showAgb = abnahmeOnly ? branchTerms?.show_on_abnahme : branchTerms?.show_on_aufmass;
  let agbPdfMergeData: { bytes: Uint8Array; selectedPages: number[] } | null = null;
  if (showAgb) {
    if (branchTerms?.agb_pdf_path && branchTerms.agb_pdf_pages && branchTerms.agb_pdf_pages.length > 0) {
      try {
        const bytes = await fetchBranchPdfBytes(branchTerms.agb_pdf_path);
        if (bytes) agbPdfMergeData = { bytes, selectedPages: branchTerms.agb_pdf_pages };
      } catch (e) {
        console.warn('Could not load AGB PDF:', e);
      }
    } else if (branchTerms?.content?.trim()) {
      drawAgbPages(pdf, branchTerms.content);
    }
  }

  // Footer — Living-Deluxe-style pipe-separated horizontal Geschäftsbrief footer
  const pageCount = (pdf as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    drawGeschaeftsbriefFooter(pdf, pageWidth, pageHeight, margin, companyInfo, companyName, i, pageCount);
  }

  // Generate filename
  const customerName = `${formData.kundeVorname || ''}_${formData.kundeNachname || ''}`.trim().replace(/\s+/g, '_') || 'Kunde';
  const date = formData.datum || new Date().toISOString().split('T')[0];
  const fileName = abnahmeOnly ? `Abnahme_${customerName}_${date}.pdf` : `Aufmass_${customerName}_${date}.pdf`;

  // ============ MERGE: append AGB PDF if any ============
  let finalBlob: Blob = pdf.output('blob');
  if (agbPdfMergeData) {
    try {
      finalBlob = await mergePdf({ basePdf: finalBlob, agbPdf: agbPdfMergeData, appendAgbAtEnd: true });
    } catch (e) {
      console.error('AGB PDF merge failed, falling back to base PDF:', e);
    }
  }

  // Return blob for preview or save directly
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
