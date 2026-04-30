// MODÜL B — "Aus Aufmaß" tab body for the Angebote page.
// Cards reuse the same markup as Schnellangebot (lead-card / lead-header
// / lead-details / lead-footer). When the source Aufmaß is already linked
// to a lead, the full Schnellangebot action set is exposed so the team
// can manage the offer without flipping tabs. Otherwise we only surface
// "Angebot erstellen".
import { useState } from 'react';
import { motion } from 'framer-motion';
import type { FormData } from '../services/api';

// Mirrors the Lead shape used by Angebote.tsx — kept loose because the
// component only needs read access. Defined here to avoid a cross-file
// import cycle with Angebote.tsx.
interface LeadLite {
  id: number;
  customer_firstname: string;
  customer_lastname: string;
  customer_email: string;
  customer_phone: string;
  customer_address: string;
  total_price: number;
  status: string;
  angebot_nummer?: string;
  kunden_nummer?: string;
  angebot_count?: number;
  angebot_sent_at?: string | null;
}

interface AusAufmassTabProps {
  forms: FormData[];
  leadsById: Map<number, LeadLite>;
  loading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  // Required: open the from-Aufmaß modal (edit if lead exists)
  onPickAufmass: (formId: number) => void;
  // Optional lead-side actions — only used when the Aufmaß has a lead_id
  onOpenLeadPdf?: (leadId: number) => void;
  onSendLeadEmail?: (leadId: number) => void;
  onEditLead?: (leadId: number) => void;
  onViewLeadDetails?: (leadId: number) => void;
  onAddLeadAngebot?: (leadId: number) => void;
  onDeleteLead?: (leadId: number) => void;
  onManualMarkSent?: (leadId: number) => void;
  // Inline-confirm state shared with Angebote.tsx so the dialog matches
  // Schnellangebot's UX (no global modal hop).
  manualSentConfirmId?: number | null;
  onConfirmManualMarkSent?: (leadId: number) => void;
  onCancelManualMarkSent?: () => void;
  isAdmin?: boolean;
  formatPrice?: (p: number) => string;
}

const AUFMASS_STATUS_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'neu', label: 'Aufmaß Genommen', color: '#8b5cf6' },
  { value: 'angebot_versendet', label: 'Angebot Versendet', color: '#a78bfa' },
];

const formatDate = (iso?: string) => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
};

const isEligible = (f: FormData): boolean => {
  const hasKunde = Boolean((f.kundeVorname || '').trim() || (f.kundeNachname || '').trim());
  const hasProduct = Boolean((f.category || '').trim() && (f.productType || '').trim());
  return hasKunde && hasProduct;
};

const summarizeProduct = (f: FormData): string => {
  const parts = [f.category, f.productType, f.model].filter(Boolean);
  return parts.join(' / ');
};

const getStatusOption = (status?: string) =>
  AUFMASS_STATUS_OPTIONS.find(o => o.value === status);

export default function AusAufmassTab({
  forms, leadsById, loading, searchQuery, onSearchChange,
  onPickAufmass, onOpenLeadPdf, onSendLeadEmail, onEditLead, onViewLeadDetails,
  onAddLeadAngebot, onDeleteLead, onManualMarkSent,
  manualSentConfirmId, onConfirmManualMarkSent, onCancelManualMarkSent,
  isAdmin, formatPrice,
}: AusAufmassTabProps) {
  const [statusFilter, setStatusFilter] = useState<string>('neu');

  const eligibleForms = forms.filter(isEligible);

  const visible = eligibleForms.filter(f => {
    const matchesStatus = f.status === statusFilter;
    if (!matchesStatus) return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const name = `${f.kundeVorname || ''} ${f.kundeNachname || ''}`.toLowerCase();
    const loc = (f.kundenlokation || '').toLowerCase();
    const product = summarizeProduct(f).toLowerCase();
    return name.includes(q) || loc.includes(q) || product.includes(q);
  });

  return (
    <>
      <div className="lead-filters">
        <div className="lead-filter-tabs">
          {AUFMASS_STATUS_OPTIONS.map(option => (
            <button
              key={option.value}
              className={`lead-filter-tab ${statusFilter === option.value ? 'active' : ''}`}
              onClick={() => setStatusFilter(option.value)}
              style={{ '--tab-color': option.color } as React.CSSProperties}
            >
              <span className="lead-status-dot" style={{ backgroundColor: option.color }} />
              <span>{option.label}</span>
              <span className="lead-tab-count">
                {eligibleForms.filter(f => f.status === option.value).length}
              </span>
            </button>
          ))}
        </div>
        <div className="lead-search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Suche nach Kunde, Ort oder Produkt..."
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => onSearchChange('')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Lade Aufmaße...</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <h3>{searchQuery ? 'Keine Ergebnisse' : 'Keine Aufmaße'}</h3>
          <p>{searchQuery
            ? 'Versuchen Sie andere Suchbegriffe'
            : 'Keine Aufmaße in diesem Status verfügbar.'}</p>
        </div>
      ) : (
        <div className="leads-list">
          {visible.map(form => {
            const statusOpt = getStatusOption(form.status);
            const lead = form.lead_id ? leadsById.get(form.lead_id) : undefined;
            return (
              <motion.div
                key={form.id}
                className="lead-card"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="lead-header">
                  <div className="lead-customer">
                    <h3>{form.kundeVorname} {form.kundeNachname}</h3>
                    <div className="lead-meta">
                      {lead?.kunden_nummer && (
                        <span className="kunden-nummer">Kd: {lead.kunden_nummer}</span>
                      )}
                      {lead?.angebot_nummer && (lead.angebot_count || 1) <= 1 && (
                        <span className="angebot-nummer">Ang: {lead.angebot_nummer}</span>
                      )}
                      {lead?.angebot_sent_at && (
                        <span
                          className="versendet-badge"
                          title={`Angebot versendet: ${formatDate(lead.angebot_sent_at)}`}
                        >
                          ✓ Versendet
                        </span>
                      )}
                      {/* Aufmaß PDF e-mail status — same logic as the
                          Aufmaße list cards (Dashboard) so both views stay
                          in sync. */}
                      {form.email_sent_at ? (
                        <span
                          className="email-sent-badge"
                          title={`E-Mail versendet: ${new Date(form.email_sent_at).toLocaleString('de-DE')}`}
                        >
                          ✓ E-Mail versendet
                        </span>
                      ) : (
                        <span
                          className="email-pending-badge"
                          title="Es wurde noch keine E-Mail versendet"
                        >
                          📧 E-Mail ausstehend
                        </span>
                      )}
                      {form.kundeEmail && <span className="lead-email">{form.kundeEmail}</span>}
                    </div>
                  </div>
                  {statusOpt && (
                    <div className="lead-status">
                      <span
                        className="status-badge"
                        style={{ background: `${statusOpt.color}20`, color: statusOpt.color }}
                      >
                        {statusOpt.label}
                      </span>
                    </div>
                  )}
                </div>

                <div className="lead-details">
                  {form.kundeTelefon && (
                    <div className="detail-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
                      </svg>
                      <span>{form.kundeTelefon}</span>
                    </div>
                  )}
                  {form.kundenlokation && (
                    <div className="detail-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      <span>{form.kundenlokation}</span>
                    </div>
                  )}
                  <div className="detail-item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <span>{formatDate(form.datum)}</span>
                  </div>
                </div>

                <div className="lead-footer">
                  <div className="lead-price">
                    {lead && formatPrice ? (
                      <>
                        <span className="price-label">GESAMTSUMME</span>
                        <span className="price-value">{formatPrice(lead.total_price)}</span>
                      </>
                    ) : (
                      <>
                        <span className="price-label">PRODUKT</span>
                        <span className="price-value" style={{ fontSize: '0.95rem' }}>
                          {summarizeProduct(form)}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="lead-actions">
                    {/* Lead-side actions only render once the Aufmaß has a lead */}
                    {lead && onOpenLeadPdf && (
                      <button className="btn-icon" title="PDF anzeigen" onClick={() => onOpenLeadPdf(lead.id)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </button>
                    )}
                    {lead && onSendLeadEmail && (
                      <button
                        className={`btn-icon ${form.email_sent_at ? 'email-sent' : ''}`}
                        title={form.email_sent_at
                          ? `Per E-Mail senden (versendet: ${new Date(form.email_sent_at).toLocaleString('de-DE')})`
                          : 'Per E-Mail senden'}
                        onClick={() => onSendLeadEmail(lead.id)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                          <polyline points="22,6 12,13 2,6" />
                        </svg>
                        {form.email_sent_at && (
                          <span className="email-sent-check" aria-hidden="true">✓</span>
                        )}
                      </button>
                    )}
                    {lead && onEditLead && (
                      <button className="btn-icon" title="Bearbeiten" onClick={() => onEditLead(lead.id)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    )}
                    {lead && onViewLeadDetails && (
                      <button className="btn-icon" title="Details anzeigen" onClick={() => onViewLeadDetails(lead.id)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>
                    )}
                    {lead && !lead.angebot_sent_at && isAdmin && onManualMarkSent && (
                      <button
                        className="btn-icon"
                        title="Manuell als versendet markieren (Post)"
                        onClick={() => onManualMarkSent(lead.id)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M22 2L11 13" />
                          <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                        </svg>
                      </button>
                    )}
                    {lead && onDeleteLead && (
                      <button className="btn-icon delete" title="Löschen" onClick={() => onDeleteLead(lead.id)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        </svg>
                      </button>
                    )}
                    {lead && onAddLeadAngebot && (
                      <button className="btn-new-angebot" onClick={() => onAddLeadAngebot(lead.id)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                        Angebot
                      </button>
                    )}
                    {!lead && (
                      <button
                        className="btn-new-angebot"
                        onClick={() => form.id && onPickAufmass(form.id)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                        Angebot erstellen
                      </button>
                    )}
                    {/* "Bearbeiten" of the underlying Aufmaß is always available */}
                    <button
                      className="btn-aufmass"
                      onClick={() => form.id && onPickAufmass(form.id)}
                      title={lead ? 'Angebot aus Aufmaß bearbeiten' : 'Angebot erstellen'}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                        <line x1="12" y1="22.08" x2="12" y2="12" />
                      </svg>
                      {lead ? 'Aus Aufmaß' : 'Aufmaß'}
                    </button>
                  </div>
                </div>

                {lead && manualSentConfirmId === lead.id && (
                  <div className="delete-confirm">
                    <p>Angebot wurde per Post versendet?</p>
                    <div className="confirm-actions">
                      <button className="btn-cancel" onClick={() => onCancelManualMarkSent?.()}>Abbrechen</button>
                      <button className="btn-save" onClick={() => onConfirmManualMarkSent?.(lead.id)}>
                        Als versendet markieren
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </>
  );
}
