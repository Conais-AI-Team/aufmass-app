import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getBranchTerms, saveBranchTerms,
  uploadAgbPdf, setAgbPdfPages, deleteAgbPdf, fetchBranchPdfBytes
} from '../services/api';
import type { BranchTerms } from '../services/api';
import { invalidateBranchTermsCache } from '../utils/branchTermsCache';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { detectAgbPages } from '../utils/agbDetector';
import '../components/PdfThumbnailGrid.css';

// Lazy: PDF preview heavy — only load on demand
const PdfThumbnailGrid = lazy(() => import('../components/PdfThumbnailGrid').then(m => ({ default: m.PdfThumbnailGrid })));

interface AgbPdfState {
  file_path: string;
  selected_pages: number[];
  page_count: number;
}

const emptyTerms: BranchTerms = {
  content: '',
  show_on_aufmass: false,
  show_on_angebot: true,
  show_on_abnahme: false,
  show_on_rechnung: false,
  attach_separately: false
};

// Parse line into segments using matchAll (avoids exec pattern)
function parseLine(line: string): { text: string; bold?: boolean; italic?: boolean }[] {
  const segments: { text: string; bold?: boolean; italic?: boolean }[] = [];
  const matches = Array.from(line.matchAll(/(\*\*[^*]+\*\*|\*[^*]+\*)/g));
  let last = 0;
  for (const match of matches) {
    const idx = match.index ?? 0;
    if (idx > last) segments.push({ text: line.substring(last, idx) });
    if (match[0].startsWith('**')) segments.push({ text: match[0].slice(2, -2), bold: true });
    else segments.push({ text: match[0].slice(1, -1), italic: true });
    last = idx + match[0].length;
  }
  if (last < line.length) segments.push({ text: line.substring(last) });
  if (segments.length === 0) segments.push({ text: line });
  return segments;
}

export default function Agb() {
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [terms, setTerms] = useState<BranchTerms>(emptyTerms);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // AGB-PDF state
  const [agbPdf, setAgbPdf] = useState<AgbPdfState | null>(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfPicker, setPdfPicker] = useState<{ bytes: Uint8Array; pages: number[]; pageCount: number } | null>(null);
  const [pdfPickerSaving, setPdfPickerSaving] = useState(false);
  const [pdfDetecting, setPdfDetecting] = useState(false);

  const pdfActive = !!agbPdf;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getBranchTerms();
        if (!cancelled) {
          setTerms({ ...emptyTerms, ...data });
          if (data.agb_pdf_path) {
            setAgbPdf({
              file_path: data.agb_pdf_path,
              selected_pages: data.agb_pdf_pages || [],
              page_count: (data.agb_pdf_pages || []).length // refined when picker opens
            });
          }
        }
      } catch {
        toast.error('Fehler', 'AGB konnten nicht geladen werden.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handlePdfUpload = async (file: File) => {
    if (file.type !== 'application/pdf') {
      toast.error('Fehler', 'Bitte eine PDF-Datei auswählen');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Fehler', 'Datei zu groß (max. 10 MB)');
      return;
    }
    setPdfUploading(true);
    try {
      const result = await uploadAgbPdf(file);
      setAgbPdf({
        file_path: result.file_path,
        selected_pages: result.selected_pages,
        page_count: result.page_count
      });

      // Bytes'ı tek seferde fetch — hem auto-detect hem de picker için
      const bytes = await fetchBranchPdfBytes(result.file_path);
      if (!bytes) {
        toast.error('Fehler', 'PDF konnte nicht geladen werden');
        return;
      }

      // Auto-detect — başarılıysa seçimi güncelle, değilse boş bırak ve kullanıcı seçsin
      let suggestedPages: number[] = [];
      let totalPages = result.page_count;
      try {
        setPdfDetecting(true);
        const detection = await detectAgbPages(bytes);
        totalPages = detection.totalPages;
        if (detection.suggestedPages.length > 0) {
          await setAgbPdfPages(detection.suggestedPages);
          setAgbPdf((prev) => prev ? { ...prev, selected_pages: detection.suggestedPages } : prev);
          suggestedPages = detection.suggestedPages;
          toast.success('Erkannt', `AGB-Seiten erkannt (${detection.confidence}): Seite ${detection.suggestedPages.join(', ')}`);
        } else {
          toast.info('Manuelle Auswahl', 'AGB-Seiten konnten nicht automatisch erkannt werden — bitte manuell auswählen.');
        }
      } catch (e) {
        console.warn('AGB auto-detect failed:', e);
      } finally {
        setPdfDetecting(false);
      }

      // Upload sonrası picker'ı her halükarda aç — kullanıcı görsel onay versin
      setPdfPicker({ bytes, pages: suggestedPages, pageCount: totalPages });
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Upload fehlgeschlagen');
    } finally {
      setPdfUploading(false);
    }
  };

  const handlePdfDelete = async () => {
    if (!window.confirm('AGB-PDF wirklich entfernen?')) return;
    try {
      await deleteAgbPdf();
      setAgbPdf(null);
      toast.success('Entfernt', 'AGB-PDF wurde entfernt');
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const openPdfPicker = async () => {
    if (!agbPdf) return;
    const bytes = await fetchBranchPdfBytes(agbPdf.file_path);
    if (!bytes) {
      toast.error('Fehler', 'PDF konnte nicht geladen werden');
      return;
    }
    // Probe page count via detector (cheap text-extract pass also gives us pageCount)
    try {
      const detection = await detectAgbPages(bytes);
      setPdfPicker({ bytes, pages: agbPdf.selected_pages, pageCount: detection.totalPages });
      setAgbPdf((prev) => prev ? { ...prev, page_count: detection.totalPages } : prev);
    } catch {
      setPdfPicker({ bytes, pages: agbPdf.selected_pages, pageCount: agbPdf.page_count });
    }
  };

  const savePdfPickerSelection = async () => {
    if (!pdfPicker) return;
    if (pdfPicker.pages.length === 0) {
      toast.error('Fehler', 'Bitte mindestens eine Seite auswählen');
      return;
    }
    setPdfPickerSaving(true);
    try {
      await setAgbPdfPages(pdfPicker.pages);
      setAgbPdf((prev) => prev ? { ...prev, selected_pages: pdfPicker.pages } : prev);
      setPdfPicker(null);
      toast.success('Gespeichert', 'AGB-Seiten aktualisiert');
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setPdfPickerSaving(false);
    }
  };

  const runAutoDetect = async () => {
    if (!agbPdf) return;
    setPdfDetecting(true);
    try {
      const bytes = await fetchBranchPdfBytes(agbPdf.file_path);
      if (!bytes) throw new Error('PDF konnte nicht geladen werden');
      const detection = await detectAgbPages(bytes);
      if (detection.suggestedPages.length === 0) {
        toast.info('Keine Treffer', 'Es konnten keine AGB-Seiten erkannt werden — bitte manuell auswählen.');
        return;
      }
      await setAgbPdfPages(detection.suggestedPages);
      setAgbPdf((prev) => prev ? { ...prev, selected_pages: detection.suggestedPages } : prev);
      toast.success('Erkannt', `Seite ${detection.suggestedPages.join(', ')} erkannt (${detection.confidence})`);
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Auto-Erkennung fehlgeschlagen');
    } finally {
      setPdfDetecting(false);
    }
  };

  const update = <K extends keyof BranchTerms>(field: K, value: BranchTerms[K]) => {
    setTerms(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!isAdmin) return;
    setSaving(true);
    try {
      await saveBranchTerms(terms);
      invalidateBranchTermsCache();
      toast.success('Gespeichert', 'AGB wurden aktualisiert.');
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const insertFormatting = (before: string, after: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = terms.content.substring(start, end);
    const newContent = terms.content.substring(0, start) + before + selected + after + terms.content.substring(end);
    update('content', newContent);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, end + before.length);
    }, 0);
  };

  const renderPreview = (text: string) => {
    if (!text) return <em style={{ color: '#999' }}>(Kein Inhalt)</em>;
    const lines = text.split('\n');
    return lines.map((line, i) => {
      if (!line.trim()) return <br key={i} />;
      const segments = parseLine(line);
      return (
        <p key={i} style={{ margin: '0 0 8px 0' }}>
          {segments.map((s, j) => {
            if (s.bold) return <strong key={j}>{s.text}</strong>;
            if (s.italic) return <em key={j}>{s.text}</em>;
            return <span key={j}>{s.text}</span>;
          })}
        </p>
      );
    });
  };

  if (loading) {
    return <div className="agb-page"><div className="agb-loading">Wird geladen...</div></div>;
  }

  return (
    <motion.div
      className="agb-page"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <style>{`
        .agb-page { padding: 24px 32px; max-width: 1200px; margin: 0 auto; color: var(--text-primary); }
        .agb-loading { padding: 60px; text-align: center; color: var(--text-secondary); }
        .agb-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border-color); flex-wrap: wrap; }
        .agb-header h1 { font-size: 24px; font-weight: 700; color: var(--text-primary); margin: 0 0 4px 0; }
        .agb-header p { font-size: 13px; color: var(--text-secondary); margin: 0; }
        .agb-save-btn { padding: 10px 24px; font-size: 14px; font-weight: 600; border-radius: 8px; cursor: pointer; border: none; background: var(--primary-color); color: #fff; display: flex; align-items: center; gap: 7px; transition: all 0.15s; box-shadow: 0 2px 6px rgba(127, 169, 61, 0.25); }
        .agb-save-btn:hover:not(:disabled) { background: var(--primary-hover); transform: translateY(-1px); }
        .agb-save-btn:disabled { opacity: 0.6; cursor: wait; }
        .agb-readonly-banner { display: flex; align-items: center; gap: 9px; margin-bottom: 14px; padding: 10px 14px; background: rgba(210, 153, 34, 0.1); border: 1px solid rgba(210, 153, 34, 0.3); border-radius: 10px; font-size: 13px; color: var(--warning-color); font-weight: 500; }
        .agb-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border-color); margin-bottom: 16px; }
        .agb-tab { padding: 10px 22px; background: none; border: none; cursor: pointer; color: var(--text-secondary); border-bottom: 2px solid transparent; font-size: 14px; font-weight: 500; transition: all 0.15s; }
        .agb-tab.active { color: var(--primary-color); border-bottom-color: var(--primary-color); font-weight: 600; }
        .agb-tab:hover:not(.active) { color: var(--text-primary); }
        .agb-toolbar { display: flex; gap: 6px; padding: 8px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-bottom: none; border-radius: 10px 10px 0 0; }
        .agb-toolbar button { padding: 6px 14px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; font-size: 14px; color: var(--text-primary); transition: all 0.15s; }
        .agb-toolbar button:hover:not(:disabled) { border-color: var(--primary-color); }
        .agb-textarea { width: 100%; min-height: 460px; padding: 14px; font-family: 'Consolas', 'Monaco', monospace; font-size: 14px; line-height: 1.7; background: var(--bg-primary); border: 1px solid var(--border-color); border-top: none; border-radius: 0 0 10px 10px; color: var(--text-primary); resize: vertical; outline: none; box-sizing: border-box; }
        .agb-textarea:focus { border-color: var(--primary-color); box-shadow: 0 0 0 3px rgba(127, 169, 61, 0.15); }
        .agb-textarea:disabled { opacity: 0.6; cursor: not-allowed; }
        .agb-textarea::placeholder { color: rgba(139, 148, 158, 0.7); }
        .light-theme .agb-textarea::placeholder { color: rgba(101, 109, 118, 0.55); }
        .agb-preview { padding: 32px 36px; background: #ffffff; color: #1f2328; min-height: 460px; border-radius: 10px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4); font-family: 'Helvetica', Arial, sans-serif; line-height: 1.6; font-size: 14px; }
        .light-theme .agb-preview { box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08); border: 1px solid var(--border-color); }
        .agb-checkboxes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px 24px; margin-top: 24px; padding: 18px 22px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; }
        .agb-checkboxes h3 { grid-column: 1 / -1; font-size: 12px; font-weight: 700; color: var(--text-tertiary); margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.5px; }
        .agb-checkbox-row { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 500; color: var(--text-primary); cursor: pointer; padding: 6px 0; }
        .agb-checkbox-row input { width: 18px; height: 18px; accent-color: var(--primary-color); cursor: pointer; }
        .agb-checkbox-row.disabled { opacity: 0.6; cursor: not-allowed; }
        .agb-pdf-section { margin-bottom: 16px; padding: 14px 16px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; }
        .agb-pdf-header { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
        .agb-pdf-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
        .agb-pdf-hint { font-size: 12px; color: var(--text-tertiary); }
        .agb-pdf-active { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .agb-pdf-info { display: flex; align-items: center; gap: 8px; color: #7fa93d; font-size: 14px; font-weight: 500; }
        .agb-pdf-info-button { flex: 1; padding: 8px 12px; background: rgba(127, 169, 61, 0.06); border: 1px solid rgba(127, 169, 61, 0.2); border-radius: 6px; cursor: pointer; font-family: inherit; text-align: left; transition: all 0.15s; }
        .agb-pdf-info-button:hover:not(:disabled) { background: rgba(127, 169, 61, 0.12); border-color: rgba(127, 169, 61, 0.4); }
        .agb-pdf-info-button:disabled { opacity: 0.7; cursor: default; }
        .agb-pdf-edit-hint { margin-left: auto; font-size: 12px; color: var(--text-tertiary); font-weight: 400; }
        .agb-pdf-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .btn-pdf-detect, .btn-pdf-edit, .btn-pdf-delete { padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer; border: 1px solid transparent; transition: all 0.15s; }
        .btn-pdf-detect { background: rgba(59, 130, 246, 0.12); color: #60a5fa; border-color: rgba(59, 130, 246, 0.3); }
        .btn-pdf-detect:hover:not(:disabled) { background: rgba(59, 130, 246, 0.2); }
        .btn-pdf-edit { background: rgba(127, 169, 61, 0.15); color: #7fa93d; border-color: rgba(127, 169, 61, 0.3); }
        .btn-pdf-edit:hover:not(:disabled) { background: rgba(127, 169, 61, 0.25); }
        .btn-pdf-delete { background: transparent; color: #ef4444; border-color: rgba(239, 68, 68, 0.3); }
        .btn-pdf-delete:hover:not(:disabled) { background: rgba(239, 68, 68, 0.1); }
        .btn-pdf-detect:disabled, .btn-pdf-edit:disabled, .btn-pdf-delete:disabled { opacity: 0.5; cursor: wait; }
        .agb-pdf-upload { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px; background: rgba(127, 169, 61, 0.06); border: 2px dashed rgba(127, 169, 61, 0.3); border-radius: 8px; cursor: pointer; color: #7fa93d; font-size: 14px; font-weight: 500; transition: all 0.15s; }
        .agb-pdf-upload:hover { background: rgba(127, 169, 61, 0.12); border-color: rgba(127, 169, 61, 0.5); }
        .agb-pdf-modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        .agb-pdf-modal { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; padding: 24px; width: 90vw; max-width: 900px; max-height: 90vh; overflow-y: auto; color: var(--text-primary); }
        .agb-pdf-modal h2 { margin: 0 0 8px 0; font-size: 18px; font-weight: 700; }
        .agb-pdf-modal-hint { font-size: 13px; color: var(--text-secondary); margin: 0 0 14px 0; }
        .agb-pdf-modal-summary { margin-top: 12px; padding: 8px 12px; background: rgba(127, 169, 61, 0.08); border-radius: 6px; font-size: 13px; }
        .agb-pdf-modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border-color); }
        .agb-pdf-modal-actions button { padding: 8px 18px; font-size: 14px; font-weight: 500; border-radius: 8px; cursor: pointer; border: 1px solid transparent; transition: all 0.15s; }
        .agb-pdf-modal-actions .btn-cancel { background: transparent; color: var(--text-secondary); border-color: var(--border-color); }
        .agb-pdf-modal-actions .btn-primary { background: var(--primary-color); color: #fff; border: none; }
        .agb-pdf-modal-actions .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
        @media (max-width: 768px) { .agb-checkboxes { grid-template-columns: 1fr; } .agb-page { padding: 16px; } }
      `}</style>

      <div className="agb-header">
        <div>
          <h1>AGB</h1>
          <p>Allgemeine Geschäftsbedingungen Ihrer Filiale</p>
        </div>
        {isAdmin && (
          <button onClick={handleSave} disabled={saving} className="agb-save-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" width="16" height="16">
              <path d="M5 13l4 4L19 7" />
            </svg>
            {saving ? 'Speichert...' : 'Speichern'}
          </button>
        )}
      </div>

      {!isAdmin && (
        <div className="agb-readonly-banner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          Nur Lesemodus — diese AGB können nur von einem Administrator bearbeitet werden.
        </div>
      )}

      {/* AGB-PDF Upload Section */}
      <div className="agb-pdf-section">
        <div className="agb-pdf-header">
          <span className="agb-pdf-title">AGB als PDF (optional)</span>
          <span className="agb-pdf-hint">Eigenes AGB-PDF hochladen – überschreibt den unten geschriebenen Text</span>
        </div>
        {agbPdf ? (
          <div className="agb-pdf-active">
            <button
              type="button"
              className="agb-pdf-info agb-pdf-info-button"
              onClick={openPdfPicker}
              disabled={pdfDetecting || !isAdmin}
              title="Klicken zum Ändern der Seitenauswahl"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span>
                {agbPdf.selected_pages.length || 0} Seite(n) ausgewählt
                {pdfDetecting && <em style={{ marginLeft: 8, color: '#94a3b8' }}>(Erkennung läuft...)</em>}
              </span>
              {isAdmin && !pdfDetecting && <span className="agb-pdf-edit-hint">zum Ändern klicken</span>}
            </button>
            {isAdmin && (
              <div className="agb-pdf-actions">
                <button type="button" className="btn-pdf-detect" onClick={runAutoDetect} disabled={pdfDetecting}>
                  Auto-Erkennung
                </button>
                <button type="button" className="btn-pdf-delete" onClick={handlePdfDelete} disabled={pdfDetecting}>
                  Entfernen
                </button>
              </div>
            )}
          </div>
        ) : (
          isAdmin && (
            <label className="agb-pdf-upload">
              {pdfUploading ? (
                <span>Lädt hoch...</span>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span>AGB-PDF hochladen</span>
                </>
              )}
              <input
                type="file"
                accept="application/pdf"
                hidden
                onChange={(e) => {
                  if (e.target.files?.[0]) handlePdfUpload(e.target.files[0]);
                  e.target.value = '';
                }}
              />
            </label>
          )
        )}
      </div>

      {pdfActive && (
        <div className="agb-readonly-banner" style={{ background: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.3)', color: '#60a5fa' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          AGB-PDF ist aktiv. Der unten eingegebene Text wird in PDFs nicht verwendet.
        </div>
      )}

      <div className="agb-tabs">
        <button className={`agb-tab ${activeTab === 'edit' ? 'active' : ''}`} onClick={() => setActiveTab('edit')}>Bearbeiten</button>
        <button className={`agb-tab ${activeTab === 'preview' ? 'active' : ''}`} onClick={() => setActiveTab('preview')}>Vorschau</button>
      </div>

      {activeTab === 'edit' ? (
        <>
          <div className="agb-toolbar">
            <button onClick={() => insertFormatting('**', '**')} title="Fett (Strg+B)" disabled={!isAdmin || pdfActive}><strong>B</strong></button>
            <button onClick={() => insertFormatting('*', '*')} title="Kursiv (Strg+I)" disabled={!isAdmin || pdfActive}><em>I</em></button>
          </div>
          <textarea
            ref={textareaRef}
            className="agb-textarea"
            value={terms.content}
            onChange={(e) => update('content', e.target.value)}
            disabled={!isAdmin || pdfActive}
            placeholder="Hier die Allgemeinen Geschäftsbedingungen Ihrer Filiale eingeben...&#10;&#10;Beispiel:&#10;1. Montagebedingungen&#10;1.1. Technische Änderungen müssen mit der Bauleitung abgesprochen werden..."
          />
        </>
      ) : (
        <div className="agb-preview">{renderPreview(terms.content)}</div>
      )}

      <div className="agb-checkboxes">
        <h3>Auf welchen PDFs anzeigen?</h3>
        <label className={`agb-checkbox-row ${!isAdmin ? 'disabled' : ''}`}>
          <input type="checkbox" disabled={!isAdmin} checked={terms.show_on_aufmass} onChange={(e) => update('show_on_aufmass', e.target.checked)} />
          Aufmaß
        </label>
        <label className={`agb-checkbox-row ${!isAdmin ? 'disabled' : ''}`}>
          <input type="checkbox" disabled={!isAdmin} checked={terms.show_on_angebot} onChange={(e) => update('show_on_angebot', e.target.checked)} />
          Angebot
        </label>
        <label className={`agb-checkbox-row ${!isAdmin ? 'disabled' : ''}`}>
          <input type="checkbox" disabled={!isAdmin} checked={terms.show_on_abnahme} onChange={(e) => update('show_on_abnahme', e.target.checked)} />
          Abnahme
        </label>
        <label className={`agb-checkbox-row ${!isAdmin ? 'disabled' : ''}`}>
          <input type="checkbox" disabled={!isAdmin} checked={terms.show_on_rechnung} onChange={(e) => update('show_on_rechnung', e.target.checked)} />
          Rechnung
        </label>
      </div>

      <div className="agb-checkboxes" style={{ marginTop: 12 }}>
        <h3>Versandart</h3>
        <label
          className={`agb-checkbox-row ${!isAdmin ? 'disabled' : ''}`}
          style={{ gridColumn: '1 / -1' }}
          title="Statt im Haupt-PDF eingebettet, wird die AGB als eigenständige PDF-Datei der E-Mail beigefügt."
        >
          <input
            type="checkbox"
            disabled={!isAdmin}
            checked={!!terms.attach_separately}
            onChange={(e) => update('attach_separately', e.target.checked)}
          />
          Als separate E-Mail-Anlage versenden
        </label>
        <p style={{ gridColumn: '1 / -1', margin: '4px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
          Bei aktivierter Option wird in jedem E-Mail-Composer die Option „AGB anhängen" automatisch vorausgewählt.
          {!agbPdf && (
            <span style={{ color: '#fbbf24', display: 'block', marginTop: 4 }}>
              Hinweis: Funktioniert nur, wenn ein AGB-PDF hochgeladen wurde (oben).
            </span>
          )}
        </p>
      </div>

      {/* AGB-PDF Page Picker Modal */}
      <AnimatePresence>
        {pdfPicker && (
          <motion.div
            className="agb-pdf-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !pdfPickerSaving && setPdfPicker(null)}
          >
            <motion.div
              className="agb-pdf-modal"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>AGB-Seiten auswählen</h2>
              <p className="agb-pdf-modal-hint">
                Klicken Sie auf die Seiten, die als AGB im PDF angehängt werden sollen.
                Nicht ausgewählte Seiten (z.B. Cover, Werbung) werden ignoriert.
              </p>
              <Suspense fallback={<div className="pdf-thumb-loading-msg">Lädt Vorschau…</div>}>
                <PdfThumbnailGrid
                  pdfBytes={pdfPicker.bytes}
                  selectedPages={pdfPicker.pages}
                  onChange={(pages) => setPdfPicker((prev) => prev ? { ...prev, pages } : null)}
                />
              </Suspense>
              <div className="agb-pdf-modal-summary">
                {pdfPicker.pages.length === 0
                  ? <span style={{ color: '#ef4444' }}>Keine Seite ausgewählt</span>
                  : <span>{pdfPicker.pages.length} Seite(n) ausgewählt: {pdfPicker.pages.join(', ')}</span>
                }
              </div>
              <div className="agb-pdf-modal-actions">
                <button className="btn-cancel" onClick={() => setPdfPicker(null)} disabled={pdfPickerSaving}>Abbrechen</button>
                <button
                  className="btn-primary"
                  onClick={savePdfPickerSelection}
                  disabled={pdfPickerSaving || pdfPicker.pages.length === 0}
                >{pdfPickerSaving ? 'Speichert...' : 'Übernehmen'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
