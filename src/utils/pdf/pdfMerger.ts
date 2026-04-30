// PDF merge using pdf-lib (lazy-imported on use).
// Splices custom branch PDFs (cover, AGB) into a generated jsPDF document.

interface MergeOptions {
  basePdf: Blob;
  // 1-based selected pages from each cover PDF, ordered by item index
  coverPdfs?: { bytes: Uint8Array; selectedPages: number[] }[];
  // 1-based selected pages from a branch-level AGB PDF
  agbPdf?: { bytes: Uint8Array; selectedPages: number[] } | null;
  // Page indices in basePdf that should be REPLACED by cover-PDFs (1-based, sorted ascending).
  // Example: jsPDF generated 3 cover-pages at positions 1, 5, 9; pass [1, 5, 9] so they get
  // swapped out with the corresponding coverPdfs entries.
  coverReplaceIndices?: number[];
  // If true, append the AGB pages at the very end (after the rest of basePdf).
  appendAgbAtEnd?: boolean;
}

export async function mergePdf(options: MergeOptions): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');

  const baseBytes = new Uint8Array(await options.basePdf.arrayBuffer());
  const baseDoc = await PDFDocument.load(baseBytes);
  const basePageCount = baseDoc.getPageCount();

  const out = await PDFDocument.create();

  // Pre-load cover-PDF docs (the order matches coverReplaceIndices)
  const coverDocs: { doc: import('pdf-lib').PDFDocument; pages: number[] }[] = [];
  if (options.coverPdfs && options.coverReplaceIndices && options.coverPdfs.length === options.coverReplaceIndices.length) {
    for (const cv of options.coverPdfs) {
      const d = await PDFDocument.load(cv.bytes);
      coverDocs.push({ doc: d, pages: cv.selectedPages });
    }
  }

  const replaceMap = new Map<number, number>(); // basePageIndex (1-based) -> coverDocs index
  if (options.coverReplaceIndices) {
    options.coverReplaceIndices.forEach((idx, i) => replaceMap.set(idx, i));
  }

  // Walk through basePdf pages — substitute cover pages where indicated
  for (let i = 1; i <= basePageCount; i++) {
    if (replaceMap.has(i)) {
      const coverIdx = replaceMap.get(i)!;
      const cv = coverDocs[coverIdx];
      const validPages = cv.pages.filter((p) => p >= 1 && p <= cv.doc.getPageCount());
      if (validPages.length > 0) {
        const indices0 = validPages.map((p) => p - 1);
        const copied = await out.copyPages(cv.doc, indices0);
        copied.forEach((page) => out.addPage(page));
        continue;
      }
      // If selected pages are invalid, fall back to keeping the original cover page from basePdf
    }
    const [page] = await out.copyPages(baseDoc, [i - 1]);
    out.addPage(page);
  }

  // Append AGB-PDF pages at the end
  if (options.appendAgbAtEnd && options.agbPdf) {
    const agbDoc = await PDFDocument.load(options.agbPdf.bytes);
    const validPages = options.agbPdf.selectedPages.filter((p) => p >= 1 && p <= agbDoc.getPageCount());
    if (validPages.length > 0) {
      const indices0 = validPages.map((p) => p - 1);
      const copied = await out.copyPages(agbDoc, indices0);
      copied.forEach((page) => out.addPage(page));
    }
  }

  const finalBytes = await out.save();
  // ArrayBuffer cast — Uint8Array.buffer can be SharedArrayBuffer in some envs;
  // we explicitly slice to a fresh ArrayBuffer to keep Blob() happy in TS strict mode.
  const ab = finalBytes.buffer.slice(finalBytes.byteOffset, finalBytes.byteOffset + finalBytes.byteLength) as ArrayBuffer;
  return new Blob([ab], { type: 'application/pdf' });
}
