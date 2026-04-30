import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { sendEmail, getEmailStatus, savePdf, getForm, getAbnahme, getAbnahmeImages } from '../services/api';
import { generatePDF } from '../utils/pdfGenerator';
import type { EmailStatus } from '../services/api';
import { useToast } from './Toast';

export interface AngebotAttachment {
  id: number;
  angebot_nummer: string;
  ready: boolean; // PDF already saved to server
}

interface EmailComposerProps {
  to: string;
  subject: string;
  body: string;
  formId?: number;
  leadId?: number;
  rechnungId?: number;
  angebote?: AngebotAttachment[];
  emailType?: string;
  attachmentName?: string;
  onClose: () => void;
  onSent?: () => void;
}

const EmailComposer = ({ to, subject: initialSubject, body: initialBody, formId, leadId, rechnungId, angebote, emailType, attachmentName, onClose, onSent }: EmailComposerProps) => {
  const toast = useToast();
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [sending, setSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);

  // PDF attachment state
  const [attachPdf, setAttachPdf] = useState<boolean | null>(null); // null = not chosen yet
  const [pdfReady, setPdfReady] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState(attachmentName || (rechnungId ? `Rechnung_${rechnungId}.pdf` : formId ? `Aufmass_${formId}.pdf` : leadId ? `Angebot_${leadId}.pdf` : ''));

  // Multi-angebot selection (for leads with multiple angebote)
  const [selectedAngebote, setSelectedAngebote] = useState<Set<number>>(() => {
    if (angebote && angebote.length > 0) {
      // Pre-select all ready angebote
      return new Set(angebote.filter(a => a.ready).map(a => a.id));
    }
    return new Set();
  });
  const hasMultiAngebote = !!(angebote && angebote.length > 1);

  // For leads with pre-saved PDFs
  const isLeadPdfPreSaved = !!leadId && !!(angebote && angebote.some(a => a.ready));

  useEffect(() => {
    getEmailStatus().then(status => {
      setEmailStatus(status);
      setStatusLoaded(true);
    }).catch(() => setStatusLoaded(true));
  }, []);

  // If lead with pre-saved PDFs, auto-enable attachment
  useEffect(() => {
    if (isLeadPdfPreSaved && attachPdf === null) {
      setAttachPdf(true);
      setPdfReady(true);
    }
  }, [isLeadPdfPreSaved, attachPdf]);

  // Rechnung PDF is generated server-side before EmailComposer opens
  useEffect(() => {
    if (rechnungId && attachPdf === null) {
      setAttachPdf(true);
      setPdfReady(true);
    }
  }, [rechnungId, attachPdf]);

  const handleGeneratePdf = useCallback(async () => {
    if (!formId) return;
    setPdfLoading(true);
    setPdfError(null);
    try {
      // Generate PDF and save to server
      const [formData, abnahmeData, abnahmeImages] = await Promise.all([
        getForm(formId),
        getAbnahme(formId),
        getAbnahmeImages(formId)
      ]);
      const isAbnahmeStatus = formData.status === 'abnahme' || formData.status === 'reklamation_eingegangen';
      const pdfFormData = {
        ...formData,
        id: String(formData.id),
        productSelection: { category: formData.category, productType: formData.productType, model: formData.model ? formData.model.split(',') : [] },
        specifications: formData.specifications as Record<string, string | number | boolean | string[]>,
        bilder: formData.bilder || [],
        customerSignature: formData.customerSignature || null,
        signatureName: formData.signatureName || null,
        abnahme: abnahmeData ? { ...abnahmeData, maengelBilder: abnahmeImages || [] } : undefined
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await generatePDF(pdfFormData as any, { returnBlob: true, abnahmeOnly: isAbnahmeStatus });
      if (result?.blob) {
        await savePdf(formId, result.blob);
        setPdfReady(true);
        setPdfFileName(result.fileName || `Aufmass_${formId}.pdf`);
      } else {
        throw new Error('PDF konnte nicht erstellt werden');
      }
    } catch (err) {
      console.error('PDF generation failed:', err);
      setPdfError(err instanceof Error ? err.message : 'PDF-Erstellung fehlgeschlagen');
    } finally {
      setPdfLoading(false);
    }
  }, [formId]);

  // When user selects "Ja" for PDF
  const handleAttachPdfChange = (value: boolean) => {
    setAttachPdf(value);
    if (value && formId && !pdfReady && !isLeadPdfPreSaved && !rechnungId) {
      handleGeneratePdf();
    }
  };

  const handleSend = async () => {
    // Postal-only path: open the PDF in a new tab for the user to print, then close.
    if (postalOnly) {
      if (rechnungId) {
        // Lazy import to avoid circular dep
        const { getRechnungPdfUrl } = await import('../services/api');
        window.open(getRechnungPdfUrl(rechnungId), '_blank', 'noopener');
      } else if (formId) {
        const { getPdfUrl } = await import('../services/api');
        window.open(getPdfUrl(formId), '_blank', 'noopener');
      } else if (leadId) {
        const { getLeadPdfUrl } = await import('../services/api');
        window.open(getLeadPdfUrl(leadId), '_blank', 'noopener');
      }
      toast.success('Per Post', 'PDF zum Drucken geöffnet. Status bleibt unverändert.');
      onClose();
      return;
    }

    if (!to) { toast.warning('Keine E-Mail', 'Empfänger-E-Mail fehlt.'); return; }
    if (attachPdf === null) { toast.warning('PDF-Anhang', 'Bitte wählen Sie, ob ein PDF angehängt werden soll.'); return; }
    if (attachPdf && !pdfReady) { toast.warning('PDF wird erstellt', 'Bitte warten Sie, bis das PDF erstellt wurde.'); return; }

    setSending(true);
    try {
      await sendEmail({
        to, subject, body,
        form_id: attachPdf && !rechnungId ? formId : undefined,
        lead_id: attachPdf ? leadId : undefined,
        rechnung_id: attachPdf ? rechnungId : undefined,
        angebot_ids: attachPdf && selectedAngebote.size > 0 ? Array.from(selectedAngebote) : undefined,
        email_type: emailType,
        attachment_name: pdfFileName
      });
      toast.success('E-Mail gesendet', `E-Mail wurde an ${to} versendet.`);
      onSent?.();
      onClose();
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'E-Mail konnte nicht gesendet werden.');
    } finally {
      setSending(false);
    }
  };

  const hasPdfOption = !!(formId || leadId || rechnungId);
  // Postal-only delivery: user prints the PDF and mails it themselves; close
  // without sending an SMTP email. Only available when there's a PDF attached.
  const [postalOnly, setPostalOnly] = useState(false);
  const canSend = statusLoaded && emailStatus?.configured && !sending && attachPdf !== null
    && (!attachPdf || pdfReady || (hasMultiAngebote && selectedAngebote.size > 0));

  return (
    <motion.div
      className="modal-overlay-modern"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ zIndex: 10000 }}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
        style={{
          width: '100%', maxWidth: '560px', margin: 'auto', borderRadius: '16px',
          background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.4)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border-primary)',
          background: 'var(--bg-secondary)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '8px',
              background: 'linear-gradient(135deg, #7fa93d, #5a8a1a)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" width="16" height="16">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>E-Mail senden</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--text-tertiary)', borderRadius: '6px' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px' }}>
          {/* Not configured warning */}
          {statusLoaded && !emailStatus?.configured && (
            <div style={{ padding: '10px 14px', borderRadius: '10px', marginBottom: '14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              <span style={{ fontSize: '13px', color: '#ef4444' }}>E-Mail nicht konfiguriert. Bitte SMTP-Einstellungen einrichten.</span>
            </div>
          )}

          {/* Von / An */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label style={labelStyle}>Von</label>
              <div style={{ ...fieldStyle, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {statusLoaded && emailStatus?.configured ? (
                  <>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emailStatus.from_email}</span>
                  </>
                ) : <span style={{ color: 'var(--text-tertiary)' }}>Nicht konfiguriert</span>}
              </div>
            </div>
            <div>
              <label style={labelStyle}>An</label>
              <div style={{ ...fieldStyle, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{to}</div>
            </div>
          </div>

          {/* Betreff */}
          <div style={{ marginBottom: '10px' }}>
            <label style={labelStyle}>Betreff</label>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Betreff eingeben..." style={{ ...inputStyle, fontWeight: 500 }} />
          </div>

          {/* Nachricht */}
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Nachricht</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Nachricht eingeben..." rows={8}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: '1.6', minHeight: '160px' }} />
          </div>

          {/* Postal-only delivery checkbox (skips SMTP) */}
          {hasPdfOption && (
            <label style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 14px', borderRadius: '10px', marginBottom: '10px',
              background: postalOnly ? 'rgba(127,169,61,0.08)' : 'var(--bg-secondary)',
              border: `1px solid ${postalOnly ? 'rgba(127,169,61,0.3)' : 'var(--border-primary)'}`,
              cursor: 'pointer', userSelect: 'none',
            }}>
              <input
                type="checkbox"
                checked={postalOnly}
                onChange={(e) => setPostalOnly(e.target.checked)}
                style={{ width: '15px', height: '15px', accentColor: '#7fa93d' }}
              />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>Per Post versenden (kein E-Mail)</div>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>PDF wird zum Ausdrucken geöffnet — keine E-Mail wird gesendet.</div>
              </div>
            </label>
          )}

          {/* PDF Attachment Toggle */}
          {hasPdfOption && !postalOnly && (
            <div style={{
              padding: '14px 16px', borderRadius: '12px', marginBottom: '4px',
              background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: attachPdf ? '12px' : '0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" width="16" height="16">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>PDF-Anhang mitsenden?</span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => handleAttachPdfChange(true)}
                    style={{
                      padding: '5px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                      border: attachPdf === true ? '1.5px solid #7fa93d' : '1px solid var(--border-primary)',
                      background: attachPdf === true ? 'rgba(127,169,61,0.15)' : 'transparent',
                      color: attachPdf === true ? '#7fa93d' : 'var(--text-tertiary)',
                    }}
                  >Ja</button>
                  <button
                    onClick={() => handleAttachPdfChange(false)}
                    style={{
                      padding: '5px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                      border: attachPdf === false ? '1.5px solid var(--text-secondary)' : '1px solid var(--border-primary)',
                      background: attachPdf === false ? 'rgba(150,150,150,0.1)' : 'transparent',
                      color: attachPdf === false ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                    }}
                  >Nein</button>
                </div>
              </div>

              {/* Multi-angebot selection */}
              {attachPdf && hasMultiAngebote && angebote && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Angebote auswählen</span>
                  {angebote.map(ang => (
                    <label key={ang.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', background: selectedAngebote.has(ang.id) ? 'rgba(127,169,61,0.06)' : 'transparent', border: selectedAngebote.has(ang.id) ? '1px solid rgba(127,169,61,0.15)' : '1px solid transparent' }}>
                      <input type="checkbox" checked={selectedAngebote.has(ang.id)} onChange={(e) => {
                        const next = new Set(selectedAngebote);
                        e.target.checked ? next.add(ang.id) : next.delete(ang.id);
                        setSelectedAngebote(next);
                      }} style={{ width: '15px', height: '15px', accentColor: '#7fa93d' }} />
                      <svg viewBox="0 0 24 24" fill="none" stroke={selectedAngebote.has(ang.id) ? '#7fa93d' : 'var(--text-tertiary)'} strokeWidth="2" width="14" height="14"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{ang.angebot_nummer || `Angebot #${ang.id}`}</span>
                      {ang.ready && <span style={{ fontSize: '10px', color: '#10b981', marginLeft: 'auto' }}>bereit</span>}
                    </label>
                  ))}
                </div>
              )}

              {/* Single angebot / Aufmaß - PDF Loading state */}
              {attachPdf && !hasMultiAngebote && pdfLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(127,169,61,0.06)', border: '1px solid rgba(127,169,61,0.12)' }}>
                  <div style={{ width: '16px', height: '16px', border: '2px solid rgba(127,169,61,0.2)', borderTopColor: '#7fa93d', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>PDF wird erstellt...</span>
                </div>
              )}

              {/* Single angebot / Aufmaß - PDF Ready */}
              {attachPdf && !hasMultiAngebote && pdfReady && !pdfLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.12)' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'rgba(16,185,129,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" width="14" height="14"><polyline points="20 6 9 17 4 12" /></svg>
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>{pdfFileName}</div>
                    <div style={{ fontSize: '11px', color: '#10b981' }}>PDF bereit</div>
                  </div>
                </div>
              )}

              {/* PDF Error */}
              {attachPdf && pdfError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                  <div>
                    <div style={{ fontSize: '13px', color: '#ef4444' }}>{pdfError}</div>
                    <button onClick={handleGeneratePdf} style={{ fontSize: '12px', color: '#7fa93d', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: '2px', textDecoration: 'underline' }}>
                      Erneut versuchen
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px',
          padding: '12px 20px', borderTop: '1px solid var(--border-primary)', background: 'var(--bg-secondary)',
        }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>
            Abbrechen
          </button>
          <button
            onClick={handleSend}
            disabled={postalOnly ? sending : !canSend}
            style={{
              padding: '8px 20px', borderRadius: '8px', border: 'none',
              background: (postalOnly || canSend) ? 'linear-gradient(135deg, #7fa93d, #6a9432)' : 'var(--bg-tertiary)',
              color: (postalOnly || canSend) ? '#fff' : 'var(--text-tertiary)',
              fontSize: '13px', fontWeight: 600,
              cursor: (postalOnly || canSend) ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', gap: '6px',
              boxShadow: (postalOnly || canSend) ? '0 2px 8px rgba(127,169,61,0.3)' : 'none',
            }}
          >
            {sending ? (
              <><div style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />Senden...</>
            ) : postalOnly ? (
              <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>PDF zum Drucken öffnen</>
            ) : (
              <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>Jetzt senden</>
            )}
          </button>
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </motion.div>
    </motion.div>
  );
};

const labelStyle: React.CSSProperties = { display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' };
const fieldStyle: React.CSSProperties = { padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-primary)', fontSize: '14px', boxSizing: 'border-box' as const };
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box' as const, outline: 'none' };

export default EmailComposer;
