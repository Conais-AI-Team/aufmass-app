import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  createAnzahlung,
  getAnzahlungenByForm,
  deleteAnzahlung,
  getAngebot,
  getRechnung,
  getRechnungenByForm,
  getRechnungPdfUrl,
  saveRechnungPdf,
  parseRechnungItems,
  markRechnungPaid,
  uploadTempFile,
  num,
  type Anzahlung,
  type Rechnung,
} from '../services/api';
import { generateRechnungPDF } from '../utils/rechnungPdfGenerator';
import { useToast } from './Toast';
import EmailComposer from './EmailComposer';
import { AnimatePresence } from 'framer-motion';

interface AnzahlungFormProps {
  formId: number;
  onClose: () => void;
  onSaved?: () => void;
}

const formatPrice = (n: number) =>
  new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const AnzahlungForm = ({ formId, onClose, onSaved }: AnzahlungFormProps) => {
  const toast = useToast();
  const [list, setList] = useState<Anzahlung[]>([]);
  // All Anzahlungsrechnungen issued for this form — surfaced here so the
  // back-office can see what has been billed vs what has actually arrived.
  const [anzahlungsRechnungen, setAnzahlungsRechnungen] = useState<Rechnung[]>([]);
  const [bruttoSumme, setBruttoSumme] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const today = new Date().toISOString().split('T')[0];
  const [betrag, setBetrag] = useState<string>('');
  const [zahlungsdatum, setZahlungsdatum] = useState<string>(today);
  const [notiz, setNotiz] = useState<string>('');
  const [belegFile, setBelegFile] = useState<File | null>(null);
  const [belegUploading, setBelegUploading] = useState(false);

  // Nested email composer for sending an Anzahlungs-Rechnung-PDF to the customer.
  const [emailComposer, setEmailComposer] = useState<{
    to: string; subject: string; body: string;
    rechnungId: number; rechnungNr: string;
  } | null>(null);

  const handleSendRechnungEmail = async (rechnungId: number) => {
    try {
      const r = await getRechnung(rechnungId);
      setEmailComposer({
        to: r.kunde_email || '',
        subject: `Anzahlungsrechnung ${r.rechnung_nr}`,
        body: `Sehr geehrte/r ${r.kunde_vorname || ''} ${r.kunde_nachname || ''},\n\nim Anhang finden Sie die Rechnung zu Ihrer Anzahlung in Höhe von ${formatPrice(num(r.brutto_betrag))} EUR (Rechnungsnummer ${r.rechnung_nr}).\n\nMit freundlichen Grüßen`,
        rechnungId: r.id,
        rechnungNr: r.rechnung_nr,
      });
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Rechnung konnte nicht geladen werden.');
    }
  };

  // User confirms the customer paid the Anzahlungsrechnung. Backend flips
  // status='bezahlt' and auto-creates an Anzahlung receipt — we just refresh
  // local state so the totals update without a full page reload.
  const handleMarkRechnungPaid = async (rechnung: Rechnung) => {
    if (!confirm(`Anzahlung über ${formatPrice(num(rechnung.brutto_betrag))} EUR als erhalten markieren?`)) return;
    try {
      await markRechnungPaid(rechnung.id);
      const [freshAnz, freshRech] = await Promise.all([
        getAnzahlungenByForm(formId),
        getRechnungenByForm(formId),
      ]);
      setList(freshAnz);
      setAnzahlungsRechnungen(freshRech.filter(r => r.type === 'anzahlungsrechnung'));
      toast.success('Markiert', `${formatPrice(num(rechnung.brutto_betrag))} EUR als erhalten verbucht.`);
      onSaved?.();
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Konnte nicht als bezahlt markiert werden.');
    }
  };

  // "Nicht erhalten" → if Zahlungsziel passed, open a Mahnung email modal so
  // the user can dispatch a friendly reminder. Before the due date, we just
  // toast — no need to push a reminder yet.
  const handleRemindRechnung = async (rechnung: Rechnung) => {
    const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);
    const ziel = new Date(rechnung.zahlungsziel); ziel.setHours(0, 0, 0, 0);
    if (todayDate <= ziel) {
      const tageOffen = Math.ceil((ziel.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
      toast.info('Zahlungsziel noch offen', `Noch ${tageOffen} Tag(e) bis zum Zahlungsziel (${ziel.toLocaleDateString('de-DE')}).`);
      return;
    }
    try {
      const r = await getRechnung(rechnung.id);
      const tageUeberfaellig = Math.floor((todayDate.getTime() - ziel.getTime()) / (1000 * 60 * 60 * 24));
      setEmailComposer({
        to: r.kunde_email || '',
        subject: `Zahlungserinnerung: Anzahlungsrechnung ${r.rechnung_nr}`,
        body: `Sehr geehrte/r ${r.kunde_vorname || ''} ${r.kunde_nachname || ''},\n\nin unserem System ist Ihre Zahlung zu folgender Rechnung noch nicht eingegangen:\n\n  Rechnungsnummer: ${r.rechnung_nr}\n  Rechnungsdatum: ${new Date(r.rechnungsdatum).toLocaleDateString('de-DE')}\n  Zahlungsziel: ${ziel.toLocaleDateString('de-DE')} (${tageUeberfaellig} Tag(e) überfällig)\n  Offener Betrag: ${formatPrice(num(r.brutto_betrag))} EUR\n\nWir bitten Sie, den ausstehenden Betrag in den nächsten Tagen zu überweisen. Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.\n\nBei Fragen stehen wir Ihnen jederzeit gerne zur Verfügung.\n\nMit freundlichen Grüßen`,
        rechnungId: r.id,
        rechnungNr: r.rechnung_nr,
      });
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Erinnerung konnte nicht vorbereitet werden.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [angebot, anzahlungen, rechnungen] = await Promise.all([
          getAngebot(formId).catch(() => null),
          getAnzahlungenByForm(formId).catch(() => []),
          getRechnungenByForm(formId).catch(() => []),
        ]);
        if (cancelled) return;
        setBruttoSumme(angebot?.summary ? num(angebot.summary.brutto_summe) : 0);
        setList(anzahlungen);
        setAnzahlungsRechnungen(rechnungen.filter(r => r.type === 'anzahlungsrechnung'));
      } catch (err) {
        console.error('Error loading Anzahlungen:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [formId]);

  const totalReceived = list.reduce((sum, a) => sum + num(a.betrag), 0);
  // Sum of issued Anzahlungsrechnungen (regardless of payment status) — this is
  // what the customer has been asked to pay so far. Distinct from totalReceived
  // which only counts cash actually arrived.
  const totalAusgestellt = anzahlungsRechnungen.reduce((sum, r) => sum + num(r.brutto_betrag), 0);
  const remaining = Math.max(0, bruttoSumme - totalReceived);

  const reset = () => {
    setBetrag('');
    setZahlungsdatum(today);
    setNotiz('');
    setBelegFile(null);
  };

  const handleSave = async () => {
    const betragNum = parseFloat(betrag.replace(',', '.'));
    if (!betragNum || betragNum <= 0) {
      toast.warning('Betrag fehlt', 'Bitte geben Sie einen gültigen Betrag ein.');
      return;
    }
    setSaving(true);
    try {
      let belegFileId: number | null = null;
      if (belegFile) {
        setBelegUploading(true);
        const uploaded = await uploadTempFile(belegFile);
        belegFileId = uploaded.id;
        setBelegUploading(false);
      }
      const created = await createAnzahlung(formId, {
        betrag: betragNum,
        zahlungsdatum,
        beleg_file_id: belegFileId,
        notiz: notiz.trim() || null,
      });

      // Server auto-creates an Anzahlungsrechnung for this payment.
      // Render its PDF client-side and save back so it can be downloaded/emailed.
      if (created.rechnung_id) {
        try {
          const rechnung = await getRechnung(created.rechnung_id);
          const pdfRes = await generateRechnungPDF({
            rechnung_nr: rechnung.rechnung_nr,
            type: rechnung.type,
            rechnungsdatum: rechnung.rechnungsdatum,
            leistungsdatum: rechnung.leistungsdatum,
            zahlungsziel: rechnung.zahlungsziel,
            kunde_vorname: rechnung.kunde_vorname || '',
            kunde_nachname: rechnung.kunde_nachname || '',
            kunde_email: rechnung.kunde_email || undefined,
            kunde_telefon: rechnung.kunde_telefon || undefined,
            kunde_adresse: rechnung.kunde_adresse || undefined,
            items: parseRechnungItems(rechnung.items_json),
            netto_betrag: num(rechnung.netto_betrag),
            mwst_satz: num(rechnung.mwst_satz),
            mwst_betrag: num(rechnung.mwst_betrag),
            brutto_betrag: num(rechnung.brutto_betrag),
          }, { returnBlob: true });
          if (pdfRes?.blob) {
            await saveRechnungPdf(created.rechnung_id, pdfRes.blob);
          }
        } catch (pdfErr) {
          console.error('Anzahlung PDF generation failed:', pdfErr);
        }
      }

      const rechnungLabel = (created as { rechnung_nr?: string }).rechnung_nr
        ? ` · Rechnung ${(created as { rechnung_nr?: string }).rechnung_nr}`
        : '';
      toast.success('Anzahlung erfasst', `${formatPrice(betragNum)} EUR${rechnungLabel}`);
      const fresh = await getAnzahlungenByForm(formId);
      setList(fresh);
      reset();
      onSaved?.();
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Anzahlung konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
      setBelegUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Diese Anzahlung wirklich löschen?')) return;
    setDeletingId(id);
    try {
      await deleteAnzahlung(id);
      setList(list.filter(a => a.id !== id));
      onSaved?.();
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Konnte nicht gelöscht werden.');
    } finally {
      setDeletingId(null);
    }
  };

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
          width: '100%', maxWidth: '720px', margin: 'auto', borderRadius: '16px',
          background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.4)', overflow: 'hidden', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border-primary)',
          background: 'var(--bg-secondary)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Anzahlungen verwalten
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
              Hier erfassen Sie eingegangene Zahlungen vom Kunden. Die Schlussrechnung über den Restbetrag wird später im Status „Abnahme" erstellt.
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--text-tertiary)', borderRadius: '6px' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
          <div style={{
            padding: '12px 14px', borderRadius: '10px', marginBottom: '14px',
            background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px',
          }}>
            <div>
              <div style={summaryLabel}>Gesamtsumme (Brutto)</div>
              <div style={summaryValue}>{formatPrice(bruttoSumme)} EUR</div>
            </div>
            <div>
              <div style={summaryLabel}>In Rechnung gestellt</div>
              <div style={{ ...summaryValue, color: '#a78bfa' }}>{formatPrice(totalAusgestellt)} EUR</div>
            </div>
            <div>
              <div style={summaryLabel}>Bisher erhalten</div>
              <div style={{ ...summaryValue, color: '#10b981' }}>{formatPrice(totalReceived)} EUR</div>
            </div>
            <div>
              <div style={summaryLabel}>Verbleibend</div>
              <div style={{ ...summaryValue, color: remaining > 0 ? '#f97316' : '#10b981' }}>
                {formatPrice(remaining)} EUR
              </div>
            </div>
          </div>

          {/* Issued Anzahlungsrechnungen — what we've billed the customer for.
              Distinct from received payments below: an invoice exists once it's
              been created in the Rechnung-Modal, regardless of whether the
              customer has paid yet. Two row-actions:
                ✓ confirm payment received → flips status + auto-creates receipt
                🔔 send Mahnung → only if Zahlungsziel passed; toast otherwise */}
          {anzahlungsRechnungen.length > 0 && (
            <>
              <div style={sectionTitle}>Anzahlungsrechnungen (ausgestellt)</div>
              <div style={{ marginBottom: '14px', border: '1px solid var(--border-primary)', borderRadius: '8px', overflow: 'hidden' }}>
                {anzahlungsRechnungen.map((r, i) => {
                  const statusInfo = r.status === 'bezahlt'
                    ? { label: 'Bezahlt', color: '#10b981', bg: 'rgba(16,185,129,0.12)' }
                    : r.status === 'gesendet'
                      ? { label: 'Gesendet', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' }
                      : { label: 'Entwurf', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
                  const isPaid = r.status === 'bezahlt';
                  return (
                    <div key={r.id} style={{
                      display: 'grid', gridTemplateColumns: '110px 1fr 90px 110px 28px 28px 28px',
                      gap: '6px', alignItems: 'center', padding: '8px 12px',
                      background: i % 2 ? 'var(--bg-secondary)' : 'transparent',
                      fontSize: '13px',
                    }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{new Date(r.rechnungsdatum).toLocaleDateString('de-DE')}</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.rechnung_nr}</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right' }}>{formatPrice(num(r.brutto_betrag))} EUR</span>
                      <span style={{
                        textAlign: 'center', padding: '3px 8px', borderRadius: '999px',
                        fontSize: '11px', fontWeight: 600,
                        color: statusInfo.color, background: statusInfo.bg,
                      }}>{statusInfo.label}</span>
                      {/* Action: mark paid */}
                      <button
                        onClick={() => handleMarkRechnungPaid(r)}
                        disabled={isPaid}
                        title={isPaid ? 'Bereits als bezahlt markiert' : 'Zahlung erhalten — als bezahlt markieren'}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: '28px', height: '28px', borderRadius: '6px',
                          background: isPaid ? 'transparent' : 'rgba(16,185,129,0.1)',
                          border: `1px solid ${isPaid ? 'var(--border-primary)' : 'rgba(16,185,129,0.3)'}`,
                          color: isPaid ? 'var(--text-tertiary)' : '#10b981',
                          cursor: isPaid ? 'not-allowed' : 'pointer',
                          opacity: isPaid ? 0.4 : 1,
                          padding: 0,
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12" /></svg>
                      </button>
                      {/* Action: remind / Mahnung */}
                      <button
                        onClick={() => handleRemindRechnung(r)}
                        disabled={isPaid}
                        title={isPaid ? 'Bereits bezahlt — keine Erinnerung nötig' : 'Zahlung nicht erhalten — Erinnerung senden'}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: '28px', height: '28px', borderRadius: '6px',
                          background: isPaid ? 'transparent' : 'rgba(245,158,11,0.1)',
                          border: `1px solid ${isPaid ? 'var(--border-primary)' : 'rgba(245,158,11,0.3)'}`,
                          color: isPaid ? 'var(--text-tertiary)' : '#f59e0b',
                          cursor: isPaid ? 'not-allowed' : 'pointer',
                          opacity: isPaid ? 0.4 : 1,
                          padding: 0,
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></svg>
                      </button>
                      {/* PDF link */}
                      <a
                        href={getRechnungPdfUrl(r.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Rechnung-PDF öffnen"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '6px', color: 'var(--text-tertiary)', textDecoration: 'none', border: '1px solid var(--border-primary)' }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                      </a>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div style={sectionTitle}>Erhaltene Zahlungen</div>
          {loading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>Wird geladen...</div>
          ) : list.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px', border: '1px dashed var(--border-primary)', borderRadius: '8px', marginBottom: '14px' }}>
              Noch keine Zahlung vom Kunden eingegangen.
            </div>
          ) : (
            <div style={{ marginBottom: '14px', border: '1px solid var(--border-primary)', borderRadius: '8px', overflow: 'hidden' }}>
              {list.map((a, i) => (
                <div key={a.id} style={{
                  display: 'grid', gridTemplateColumns: '110px 1fr 120px 32px 32px 30px',
                  gap: '8px', alignItems: 'center', padding: '8px 12px',
                  background: i % 2 ? 'var(--bg-secondary)' : 'transparent',
                  fontSize: '13px',
                }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{new Date(a.zahlungsdatum).toLocaleDateString('de-DE')}</span>
                  <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.notiz || '—'}
                  </span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right' }}>{formatPrice(num(a.betrag))} EUR</span>
                  {a.rechnung_id ? (
                    <a
                      href={getRechnungPdfUrl(a.rechnung_id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Rechnung-PDF öffnen"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', color: '#0ea5e9' }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    </a>
                  ) : <span />}
                  {a.rechnung_id ? (
                    <button
                      onClick={() => handleSendRechnungEmail(a.rechnung_id!)}
                      title="Rechnung per E-Mail senden"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7fa93d', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                    </button>
                  ) : <span />}
                  <button
                    onClick={() => handleDelete(a.id)}
                    disabled={deletingId === a.id}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '4px' }}
                    title="Löschen"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={sectionTitle}>Eingang einer Zahlung erfassen</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label style={labelStyle}>Betrag (EUR)</label>
              <input type="text" inputMode="decimal" value={betrag} onChange={(e) => setBetrag(e.target.value)} placeholder="0,00" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Zahlungsdatum</label>
              <input type="date" value={zahlungsdatum} onChange={(e) => setZahlungsdatum(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label style={labelStyle}>Beleg (optional)</label>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setBelegFile(e.target.files?.[0] || null)}
              style={{ ...inputStyle, padding: '7px 10px' }}
            />
            {belegFile && <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{belegFile.name}</div>}
          </div>

          <div style={{ marginBottom: '4px' }}>
            <label style={labelStyle}>Notiz (optional)</label>
            <textarea value={notiz} onChange={(e) => setNotiz(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px',
          padding: '12px 20px', borderTop: '1px solid var(--border-primary)', background: 'var(--bg-secondary)',
        }}>
          <button onClick={onClose} style={btnSecondary}>Schließen</button>
          <button onClick={handleSave} disabled={saving || belegUploading} style={{ ...btnPrimary, opacity: (saving || belegUploading) ? 0.6 : 1, cursor: (saving || belegUploading) ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Speichert...' : belegUploading ? 'Upload...' : 'Anzahlung speichern'}
          </button>
        </div>
      </motion.div>

      {/* Nested email composer for sending an Anzahlungs-Rechnung */}
      <AnimatePresence>
        {emailComposer && (
          <EmailComposer
            to={emailComposer.to}
            subject={emailComposer.subject}
            body={emailComposer.body}
            rechnungId={emailComposer.rechnungId}
            emailType="rechnung_anzahlung"
            attachmentName={`Rechnung_${emailComposer.rechnungNr}.pdf`}
            onClose={() => setEmailComposer(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const labelStyle: React.CSSProperties = { display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box' as const, outline: 'none' };
const sectionTitle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' };
const summaryLabel: React.CSSProperties = { fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' };
const summaryValue: React.CSSProperties = { fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' };
const btnSecondary: React.CSSProperties = { padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 500, cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { padding: '8px 20px', borderRadius: '8px', border: 'none', background: 'linear-gradient(135deg, #7fa93d, #6a9432)', color: '#fff', fontSize: '13px', fontWeight: 600, boxShadow: '0 2px 8px rgba(127,169,61,0.3)' };

export default AnzahlungForm;
