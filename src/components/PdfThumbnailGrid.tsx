// Thumbnail-based page selector for an uploaded PDF.
// Renders each page via pdf.js to a small canvas; user toggles inclusion.

import { useEffect, useRef, useState } from 'react';
import { pdfjsLib } from '../utils/pdf/pdfWorkerSetup';

interface Props {
  pdfBytes: Uint8Array;
  selectedPages: number[];
  onChange: (pages: number[]) => void;
  thumbnailScale?: number;
}

interface ThumbState {
  page: number;
  dataUrl: string | null;
}

export function PdfThumbnailGrid({ pdfBytes, selectedPages, onChange, thumbnailScale = 0.35 }: Props) {
  const [thumbs, setThumbs] = useState<ThumbState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const renderTokenRef = useRef(0);

  useEffect(() => {
    const token = ++renderTokenRef.current;
    setLoading(true);
    setError(null);
    setThumbs([]);

    (async () => {
      try {
        // Detached copy — pdfjs transfers ownership of the buffer it receives
        const data = new Uint8Array(pdfBytes);
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        if (token !== renderTokenRef.current) return;

        const initial: ThumbState[] = [];
        for (let i = 1; i <= pdf.numPages; i++) initial.push({ page: i, dataUrl: null });
        setThumbs(initial);

        for (let i = 1; i <= pdf.numPages; i++) {
          if (token !== renderTokenRef.current) return;
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: thumbnailScale });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d')!;
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          if (token !== renderTokenRef.current) return;
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          setThumbs((prev) => prev.map((t) => (t.page === i ? { ...t, dataUrl } : t)));
        }
        setLoading(false);
      } catch (e) {
        if (token !== renderTokenRef.current) return;
        setError(e instanceof Error ? e.message : 'PDF konnte nicht geladen werden');
        setLoading(false);
      }
    })();

    return () => {
      renderTokenRef.current++;
    };
  }, [pdfBytes, thumbnailScale]);

  const togglePage = (page: number) => {
    const isSelected = selectedPages.includes(page);
    const next = isSelected ? selectedPages.filter((p) => p !== page) : [...selectedPages, page].sort((a, b) => a - b);
    onChange(next);
  };

  if (error) return <div className="pdf-thumb-error">{error}</div>;

  return (
    <div className="pdf-thumb-grid">
      {thumbs.map((t) => {
        const isSelected = selectedPages.includes(t.page);
        return (
          <button
            key={t.page}
            type="button"
            className={`pdf-thumb-tile ${isSelected ? 'is-selected' : ''}`}
            onClick={() => togglePage(t.page)}
          >
            <div className="pdf-thumb-canvas-wrap">
              {t.dataUrl ? (
                <img src={t.dataUrl} alt={`Seite ${t.page}`} />
              ) : (
                <div className="pdf-thumb-loading">…</div>
              )}
              {isSelected && <div className="pdf-thumb-check">✓</div>}
            </div>
            <div className="pdf-thumb-label">Seite {t.page}</div>
          </button>
        );
      })}
      {loading && <div className="pdf-thumb-loading-msg">Vorschau wird erstellt…</div>}
    </div>
  );
}
