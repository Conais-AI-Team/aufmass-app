import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  createRechnung,
  saveRechnungPdf,
  getAngebot,
  getAnzahlungenByForm,
  parseRechnungItems,
  num,
  type Rechnung,
  type RechnungType,
  type RechnungItem,
  type Anzahlung,
} from '../services/api';
import { generateRechnungPDF } from '../utils/rechnungPdfGenerator';
import { useToast } from './Toast';

interface RechnungFormProps {
  formId: number;
  type: RechnungType;
  onClose: () => void;
  onSaved: (rechnung: Rechnung, opts: { sendEmail: boolean }) => void;
}

const formatPrice = (n: number) =>
  new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const addDays = (iso: string, days: number) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};

const RechnungForm = ({ formId, type, onClose, onSaved }: RechnungFormProps) => {
  const toast = useToast();
  const today = new Date().toISOString().split('T')[0];

  const [rechnungsdatum, setRechnungsdatum] = useState<string>(today);
  const [leistungsdatum, setLeistungsdatum] = useState<string>('');
  const [zahlungsziel, setZahlungsziel] = useState<string>(addDays(today, 14));
  const [sendEmailFlag, setSendEmailFlag] = useState<boolean>(true);

  const [items, setItems] = useState<RechnungItem[]>([]);
  // netto / mwstBetrag are setter-only: the displayed values are derived from
  // `displayBrutto` (anzahlung-aware). Setters still feed local state in case
  // a future flow needs the raw Angebot numbers.
  const [, setNetto] = useState<number>(0);
  const [mwstSatz, setMwstSatz] = useState<number>(19);
  const [, setMwstBetrag] = useState<number>(0);
  const [brutto, setBrutto] = useState<number>(0);
  const [anzahlungen, setAnzahlungen] = useState<Anzahlung[]>([]);
  // Anzahlungsbetrag (deposit-only invoice): the user picks how much of the
  // Angebot total should appear on this invoice. Empty string = no value yet.
  // Stored as string to support the partial / "0," typing state.
  const [anzahlungBetragStr, setAnzahlungBetragStr] = useState<string>('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [angebot, az] = await Promise.all([
          getAngebot(formId),
          type === 'schlussrechnung' ? getAnzahlungenByForm(formId) : Promise.resolve([] as Anzahlung[]),
        ]);
        if (cancelled) return;
        if (!angebot.summary || !angebot.items || angebot.items.length === 0) {
          setError('Für dieses Aufmaß existiert noch kein Angebot. Bitte erstellen Sie zuerst ein Angebot.');
          setLoading(false);
          return;
        }
        setItems(angebot.items.map(i => ({
          bezeichnung: i.bezeichnung,
          menge: num(i.menge),
          einzelpreis: num(i.einzelpreis),
          gesamtpreis: num(i.gesamtpreis),
        })));
        setNetto(num(angebot.summary.netto_summe));
        setMwstSatz(num(angebot.summary.mwst_satz));
        setMwstBetrag(num(angebot.summary.mwst_betrag));
        setBrutto(num(angebot.summary.brutto_summe));
        setAnzahlungen(az);
        // Default Anzahlung suggestion: 30% of total brutto (German Markisen-
        // branche standard). User can override via input or quick-pick chips.
        if (type === 'anzahlungsrechnung') {
          const suggested = num(angebot.summary.brutto_summe) * 0.3;
          setAnzahlungBetragStr(suggested.toFixed(2).replace('.', ','));
        }
      } catch (err) {
        console.error('Error loading Rechnung context:', err);
        setError(err instanceof Error ? err.message : 'Daten konnten nicht geladen werden.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [formId, type]);

  const totalAnzahlungen = anzahlungen.reduce((sum, a) => sum + num(a.betrag), 0);
  const restbetrag = brutto - totalAnzahlungen;

  // Parse the deposit input (de-DE comma format) into a usable number.
  const anzahlungBetrag = (() => {
    const raw = anzahlungBetragStr.replace(/\./g, '').replace(',', '.').trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();
  // For anzahlungsrechnung, the displayed totals reflect the deposit slice;
  // for schlussrechnung we keep the full Angebot brutto.
  const isAnzahlung = type === 'anzahlungsrechnung';
  const displayBrutto = isAnzahlung ? anzahlungBetrag : brutto;
  const displayNetto = displayBrutto / (1 + mwstSatz / 100);
  const displayMwstBetrag = displayBrutto - displayNetto;
  const anzahlungProzent = isAnzahlung && brutto > 0
    ? (anzahlungBetrag / brutto) * 100
    : 0;
  const anzahlungInvalid = isAnzahlung && (anzahlungBetrag <= 0 || anzahlungBetrag > brutto + 0.01);

  const handleSave = async () => {
    if (!rechnungsdatum) { toast.warning('Datum fehlt', 'Bitte Rechnungsdatum eingeben.'); return; }
    if (!zahlungsziel) { toast.warning('Datum fehlt', 'Bitte Zahlungsziel eingeben.'); return; }
    if (isAnzahlung) {
      if (anzahlungBetrag <= 0) {
        toast.warning('Anzahlung fehlt', 'Bitte einen Anzahlungsbetrag eingeben.');
        return;
      }
      if (anzahlungBetrag > brutto + 0.01) {
        toast.warning('Anzahlung zu hoch', 'Anzahlung darf den Gesamtbetrag nicht übersteigen.');
        return;
      }
    }

    setSaving(true);
    try {
      const created = await createRechnung(formId, {
        type,
        rechnungsdatum,
        leistungsdatum: leistungsdatum || null,
        zahlungsziel,
        ...(isAnzahlung ? { anzahlungsbetrag: anzahlungBetrag } : {}),
      });

      const pdfRes = await generateRechnungPDF({
        rechnung_nr: created.rechnung_nr,
        type: created.type,
        rechnungsdatum: created.rechnungsdatum,
        leistungsdatum: created.leistungsdatum,
        zahlungsziel: created.zahlungsziel,
        kunde_vorname: created.kunde_vorname || '',
        kunde_nachname: created.kunde_nachname || '',
        kunde_email: created.kunde_email || undefined,
        kunde_telefon: created.kunde_telefon || undefined,
        kunde_adresse: created.kunde_adresse || undefined,
        items: parseRechnungItems(created.items_json),
        netto_betrag: num(created.netto_betrag),
        mwst_satz: num(created.mwst_satz),
        mwst_betrag: num(created.mwst_betrag),
        brutto_betrag: num(created.brutto_betrag),
        anzahlungen: type === 'schlussrechnung'
          ? anzahlungen.map(a => ({
              zahlungsdatum: a.zahlungsdatum,
              betrag: num(a.betrag),
              zahlungsmethode: a.zahlungsmethode,
            }))
          : undefined,
      }, { returnBlob: true });

      if (pdfRes?.blob) {
        await saveRechnungPdf(created.id, pdfRes.blob);
      }

      toast.success('Rechnung erstellt', `Nr. ${created.rechnung_nr}`);
      onSaved(created, { sendEmail: sendEmailFlag });
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Rechnung konnte nicht erstellt werden.');
    } finally {
      setSaving(false);
    }
  };

  const titleLabel = type === 'schlussrechnung' ? 'Schlussrechnung erstellen' : 'Anzahlungsrechnung erstellen';

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
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border-primary)',
          background: 'var(--bg-secondary)',
        }}>
          <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>{titleLabel}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--text-tertiary)', borderRadius: '6px' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>Daten werden geladen...</div>
          ) : error ? (
            <div style={{ padding: '14px', borderRadius: '10px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', color: '#ef4444', fontSize: '13px' }}>
              {error}
            </div>
          ) : (
            <>
              <div style={sectionTitle}>Leistungen (aus Angebot)</div>
              <div style={{ marginBottom: '14px', border: '1px solid var(--border-primary)', borderRadius: '8px', overflow: 'hidden' }}>
                {items.map((item, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '1fr 60px 100px 100px',
                    gap: '8px', alignItems: 'center', padding: '8px 12px',
                    background: i % 2 ? 'var(--bg-secondary)' : 'transparent',
                    fontSize: '13px',
                  }}>
                    <span style={{ color: 'var(--text-primary)' }}>{item.bezeichnung}</span>
                    <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>{item.menge}</span>
                    <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>{formatPrice(item.einzelpreis)}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right' }}>{formatPrice(item.gesamtpreis)}</span>
                  </div>
                ))}
              </div>

              {/* Anzahlung: deposit-amount picker. Lets the user invoice only
                  the deposit slice instead of the full Angebot total — avoids
                  the "we sent the full bill" trap. */}
              {isAnzahlung && (
                <div style={{
                  padding: '12px 14px', borderRadius: '10px', marginBottom: '14px',
                  background: 'rgba(127,169,61,0.06)', border: '1px solid rgba(127,169,61,0.25)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                    <span>Gesamtbetrag (brutto)</span>
                    <span>{formatPrice(brutto)} EUR</span>
                  </div>
                  <label style={{ ...labelStyle, marginBottom: '6px' }}>Anzahlungsbetrag (EUR, brutto)</label>
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
                    {[10, 20, 30, 45, 50, 75, 100].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setAnzahlungBetragStr((brutto * pct / 100).toFixed(2).replace('.', ','))}
                        style={{
                          padding: '6px 12px', borderRadius: '6px',
                          border: '1px solid var(--border-primary)',
                          background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                          fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                        }}
                      >{pct}%</button>
                    ))}
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={anzahlungBetragStr}
                    onChange={(e) => setAnzahlungBetragStr(e.target.value)}
                    placeholder="0,00"
                    style={{ ...inputStyle, borderColor: anzahlungInvalid ? '#ef4444' : 'var(--border-primary)' }}
                  />
                  {anzahlungBetrag > 0 && !anzahlungInvalid && (
                    <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                      ≈ {anzahlungProzent.toFixed(1).replace('.', ',')}% des Gesamtbetrags
                    </div>
                  )}
                  {anzahlungInvalid && (
                    <div style={{ marginTop: '6px', fontSize: '12px', color: '#ef4444' }}>
                      {anzahlungBetrag <= 0 ? 'Bitte einen Betrag eingeben.' : 'Anzahlung darf den Gesamtbetrag nicht übersteigen.'}
                    </div>
                  )}
                </div>
              )}

              <div style={{
                padding: '12px 14px', borderRadius: '10px', marginBottom: '14px',
                background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  <span>Nettobetrag:</span><span>{formatPrice(displayNetto)} EUR</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  <span>MwSt {formatPrice(mwstSatz)}%:</span><span>{formatPrice(displayMwstBetrag)} EUR</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '6px', paddingTop: '6px', borderTop: '1px solid var(--border-primary)' }}>
                  <span>{isAnzahlung ? 'Anzahlungsbetrag:' : 'Bruttobetrag:'}</span><span>{formatPrice(displayBrutto)} EUR</span>
                </div>

                {type === 'schlussrechnung' && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#10b981', marginTop: '6px' }}>
                      <span>− Bisherige Anzahlungen:</span><span>{formatPrice(totalAnzahlungen)} EUR</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 700, color: '#7fa93d', marginTop: '4px' }}>
                      <span>Restbetrag:</span><span>{formatPrice(restbetrag)} EUR</span>
                    </div>
                  </>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                <div>
                  <label style={labelStyle}>Rechnungsdatum</label>
                  <input type="date" value={rechnungsdatum} onChange={(e) => setRechnungsdatum(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Leistungsdatum (optional)</label>
                  <input type="date" value={leistungsdatum} onChange={(e) => setLeistungsdatum(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Zahlungsziel</label>
                  <input type="date" value={zahlungsziel} onChange={(e) => setZahlungsziel(e.target.value)} style={inputStyle} />
                </div>
              </div>

              <label style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 12px', borderRadius: '8px',
                background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
                cursor: 'pointer', userSelect: 'none',
              }}>
                <input
                  type="checkbox"
                  checked={sendEmailFlag}
                  onChange={(e) => setSendEmailFlag(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#7fa93d' }}
                />
                <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                  Anschließend per E-Mail an Kunden versenden
                </span>
              </label>
            </>
          )}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px',
          padding: '12px 20px', borderTop: '1px solid var(--border-primary)', background: 'var(--bg-secondary)',
        }}>
          <button onClick={onClose} style={btnSecondary}>Abbrechen</button>
          <button
            onClick={handleSave}
            disabled={saving || loading || !!error || anzahlungInvalid}
            style={{ ...btnPrimary, opacity: (saving || loading || !!error || anzahlungInvalid) ? 0.6 : 1, cursor: (saving || loading || !!error || anzahlungInvalid) ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Erstellt...' : 'Rechnung erstellen'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

const labelStyle: React.CSSProperties = { display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box' as const, outline: 'none' };
const sectionTitle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' };
const btnSecondary: React.CSSProperties = { padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 500, cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { padding: '8px 20px', borderRadius: '8px', border: 'none', background: 'linear-gradient(135deg, #7fa93d, #6a9432)', color: '#fff', fontSize: '13px', fontWeight: 600, boxShadow: '0 2px 8px rgba(127,169,61,0.3)' };

export default RechnungForm;
