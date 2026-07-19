import type { jsPDF } from 'jspdf';

export interface PdfLogoAsset {
  dataUrl: string;
  aspectRatio: number;
}

let logoPromise: Promise<PdfLogoAsset | null> | null = null;

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const getImageRatio = (src: string): Promise<number> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 3.07);
    img.onerror = () => resolve(3.07);
    img.src = src;
  });

export async function loadAyluxPdfLogo(): Promise<PdfLogoAsset | null> {
  if (!logoPromise) {
    logoPromise = (async () => {
      try {
        const res = await fetch('/aylux-sidebar-logo.png');
        if (!res.ok) return null;
        const dataUrl = await blobToDataUrl(await res.blob());
        return { dataUrl, aspectRatio: await getImageRatio(dataUrl) };
      } catch {
        return null;
      }
    })();
  }
  return logoPromise;
}

export function drawAyluxPdfLogo(
  pdf: jsPDF,
  logo: PdfLogoAsset | null,
  x: number,
  y: number,
  width: number
): void {
  if (!logo) {
    return;
  }

  const height = width / logo.aspectRatio;
  pdf.addImage(logo.dataUrl, 'PNG', x, y, width, height, undefined, 'FAST');
}
