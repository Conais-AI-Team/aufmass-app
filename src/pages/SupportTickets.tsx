import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../components/Toast';
import { getSupportTickets, updateSupportTicket } from '../services/api';
import type { SupportTicket, SupportTicketStatus } from '../services/api';
import './Dashboard.css';
import './SupportTickets.css';

// ============================================================================
// Support-Anfragen — zentrale Ticket-Verwaltung. NUR im Admin-Branch sichtbar
// (Route/Sidebar via isAdminBranch). Master-Detail-Inbox: links Liste, rechts
// Detail + Lösung. Lösen verschickt eine Antwort-Mail an den Ersteller.
// ============================================================================

const STATUS_META: Record<SupportTicketStatus, { label: string; cls: string }> = {
  offen: { label: 'Offen', cls: 'offen' },
  in_arbeit: { label: 'In Arbeit', cls: 'arbeit' },
  geloest: { label: 'Gelöst', cls: 'geloest' },
};

const FILTERS: { key: SupportTicketStatus | 'alle'; label: string }[] = [
  { key: 'alle', label: 'Alle' },
  { key: 'offen', label: 'Offen' },
  { key: 'in_arbeit', label: 'In Arbeit' },
  { key: 'geloest', label: 'Gelöst' },
];

function formatDate(s: string) {
  return new Date(s).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function SupportTickets() {
  const toast = useToast();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<SupportTicketStatus | 'alle'>('offen');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [resolution, setResolution] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSupportTickets(filter === 'alle' ? undefined : filter);
      setTickets(data);
      // keep selection if still present, otherwise pick first
      setSelectedId(prev => (prev && data.some(t => t.id === prev)) ? prev : (data[0]?.id ?? null));
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Tickets konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => tickets.find(t => t.id === selectedId) || null, [tickets, selectedId]);

  useEffect(() => { setResolution(''); }, [selectedId]);

  const openCount = useMemo(() => tickets.filter(t => t.status !== 'geloest').length, [tickets]);

  const setStatus = async (status: SupportTicketStatus) => {
    if (!selected) return;
    if (status === 'geloest' && !resolution.trim()) {
      toast.error('Lösungsnachricht fehlt', 'Bitte schreiben Sie eine Antwort an den Ersteller.');
      return;
    }
    setSaving(true);
    try {
      const res = await updateSupportTicket(selected.id, { status, resolution_message: status === 'geloest' ? resolution : undefined });
      if (status === 'geloest') {
        toast.success('Ticket gelöst', res.mailed ? 'Antwort-Mail an den Ersteller gesendet.' : 'Status aktualisiert (keine Mail — SMTP fehlt).');
      } else {
        toast.success('Aktualisiert', 'Status geändert.');
      }
      await load();
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Aktualisierung fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header className="content-header">
        <div className="header-left">
          <h1>Support-Anfragen</h1>
          <p className="header-subtitle">
            {openCount > 0 ? `${openCount} offene Anfrage${openCount === 1 ? '' : 'n'}` : 'Keine offenen Anfragen'} · zentrale Verwaltung
          </p>
        </div>
      </header>

      <div className="content-area st-area">
        {/* Filter-Tabs */}
        <div className="st-filters">
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`st-filter ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="st-loading"><div className="loading-spinner" /><p>Anfragen werden geladen …</p></div>
        ) : tickets.length === 0 ? (
          <div className="st-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <p>Keine Anfragen in dieser Ansicht.</p>
          </div>
        ) : (
          <div className="st-layout">
            {/* Liste */}
            <div className="st-list">
              {tickets.map(t => {
                const meta = STATUS_META[t.status];
                return (
                  <button
                    key={t.id}
                    className={`st-card ${selectedId === t.id ? 'active' : ''} ${t.status === 'geloest' ? 'done' : ''}`}
                    onClick={() => setSelectedId(t.id)}
                  >
                    <div className="st-card-top">
                      <span className={`st-badge ${meta.cls}`}>{meta.label}</span>
                      <span className="st-card-branch">{t.branch_slug || '—'}</span>
                    </div>
                    <div className="st-card-subject">{t.subject}</div>
                    <div className="st-card-meta">
                      <span>{t.user_name || t.user_email || 'Unbekannt'}</span>
                      <span className="st-card-date">{formatDate(t.created_at)}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Detail */}
            <div className="st-detail">
              <AnimatePresence mode="wait">
                {selected ? (
                  <motion.div
                    key={selected.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="st-detail-head">
                      <div>
                        <span className={`st-badge ${STATUS_META[selected.status].cls}`}>{STATUS_META[selected.status].label}</span>
                        <h2>{selected.subject}</h2>
                      </div>
                      <span className="st-detail-id">#{selected.id}</span>
                    </div>

                    <div className="st-meta-grid">
                      <div><label>Filiale</label><span>{selected.branch_slug || '—'}</span></div>
                      <div><label>Kategorie</label><span>{selected.category || '—'}</span></div>
                      <div><label>Von</label><span>{selected.user_name || '—'}</span></div>
                      <div><label>E-Mail</label><span>{selected.user_email || '—'}</span></div>
                      <div><label>Eingegangen</label><span>{formatDate(selected.created_at)}</span></div>
                      {selected.resolved_at && <div><label>Gelöst am</label><span>{formatDate(selected.resolved_at)}</span></div>}
                    </div>

                    <div className="st-message">
                      <label>Nachricht</label>
                      <p>{selected.message}</p>
                    </div>

                    {selected.status === 'geloest' ? (
                      <div className="st-resolution-done">
                        <label>Gesendete Antwort</label>
                        <p>{selected.resolution_message}</p>
                      </div>
                    ) : (
                      <div className="st-resolve">
                        <label>Antwort an den Ersteller</label>
                        <textarea
                          value={resolution}
                          onChange={(e) => setResolution(e.target.value)}
                          placeholder="Beschreiben Sie die Lösung. Diese Nachricht wird dem Ersteller per E-Mail zugesendet."
                          rows={5}
                        />
                        <div className="st-actions">
                          {selected.status === 'offen' && (
                            <button className="st-btn-secondary" disabled={saving} onClick={() => setStatus('in_arbeit')}>
                              In Arbeit setzen
                            </button>
                          )}
                          <button className="st-btn-primary" disabled={saving} onClick={() => setStatus('geloest')}>
                            {saving ? 'Wird gesendet …' : 'Lösen & Benachrichtigen'}
                          </button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <div className="st-detail-empty">
                    <p>Wählen Sie links eine Anfrage aus.</p>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
