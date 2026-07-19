import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../components/Toast';
import { submitSupportTicket } from '../services/api';
import './Dashboard.css';
import './Hilfe.css';

// ============================================================================
// Hilfe & Support — Help-Center für Endanwender (Innendienst & Aufmaß-Team).
// Layout: atmosphärischer Such-Hero + zweispaltig (sticky Scroll-Spy-Navigation
// links, Inhalt rechts) + Ticket-Modal. Icons als Inline-SVG (kein Emoji).
// ============================================================================

const CAT_ICONS: Record<string, ReactNode> = {
  start: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  aufmass: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  angebote: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  status: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  ),
  unterschrift: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" />
    </svg>
  ),
  email: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  firma: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" /><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01" />
    </svg>
  ),
  pdf: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  ),
};

interface FaqItem { q: string; a: string; }
interface FaqCategory { id: keyof typeof CAT_ICONS; title: string; blurb: string; items: FaqItem[]; }

const FAQ: FaqCategory[] = [
  {
    id: 'start', title: 'Erste Schritte', blurb: 'Anmeldung, Rollen und Grundlagen',
    items: [
      { q: 'Wie melde ich mich an?', a: 'Öffnen Sie die App-Adresse Ihrer Filiale und geben Sie auf der Login-Seite Ihre E-Mail-Adresse und Ihr Passwort ein. Falls Sie noch kein Konto haben, benötigen Sie eine Einladung von Ihrem Administrator – der Einladungslink ist 7 Tage gültig.' },
      { q: 'Was bedeuten die unterschiedlichen Rollen?', a: 'Es gibt drei Rollen: „Benutzer" (Aufmaß-Team – erstellt Aufmaße), „Office" (Innendienst – sieht Angebote, ändert Status, versendet E-Mails) und „Administrator" (zusätzlich Benutzerverwaltung, Preise, E-Mail-Einstellungen und Filialübersicht).' },
      { q: 'Wie wechsle ich zwischen hellem und dunklem Design?', a: 'Unten links in der Seitenleiste – neben Ihrem Namen – finden Sie die Design-Umschaltung. Ein Klick schaltet zwischen Light- und Dark-Mode um. Die Einstellung wird für Ihren Browser gespeichert.' },
    ],
  },
  {
    id: 'aufmass', title: 'Aufmaß erstellen', blurb: 'Der Assistent Schritt für Schritt',
    items: [
      { q: 'Wie erstelle ich ein neues Aufmaß?', a: 'Klicken Sie links auf „Neues Aufmaß" (oder das Plus-Symbol oben rechts auf dem Handy). Der Assistent führt Sie durch die Schritte: Grunddaten, Produktauswahl, Spezifikationen, ggf. Markise und zuletzt Abschluss (Fotos & Unterschrift).' },
      { q: 'Welche Produktkategorien gibt es?', a: 'Drei Kategorien: Markise, Überdachung und Unterbauelemente. Je nach gewählter Kategorie und Produkttyp passt sich das Formular automatisch an – es werden nur die relevanten Felder angezeigt.' },
      { q: 'Warum kann ich nicht zum nächsten Schritt weitergehen?', a: 'Die Schaltfläche „Weiter" wird erst aktiv, wenn alle Pflichtfelder des aktuellen Schritts ausgefüllt sind. Fehlende Felder werden rot markiert, sobald Sie auf „Weiter" klicken. Nur „Bemerkungen" und „Montageteam" sind optional.' },
      { q: 'Wie füge ich Fotos hinzu?', a: 'Im letzten Schritt („Abschluss") laden Sie die Baustellen-Fotos hoch. Es werden mindestens 2 Fotos benötigt, damit das Aufmaß abgeschlossen werden kann.' },
      { q: 'Kann ich ein Aufmaß zwischenspeichern und später fertigstellen?', a: 'Ja. Sobald die Grunddaten ausgefüllt sind, erscheint die Schaltfläche „Speichern & Schließen". Das Aufmaß wird als Entwurf gespeichert und kann später unter „Aufmaße" weiterbearbeitet werden.' },
      { q: 'Wie füge ich weitere Produkte zum selben Aufmaß hinzu?', a: 'Im Spezifikationen-Schritt finden Sie den Bereich „Weitere Produkte". Dort erfassen Sie zusätzliche Produkte mit eigener Kategorie und eigenen Maßen, ohne ein neues Aufmaß anzulegen.' },
    ],
  },
  {
    id: 'angebote', title: 'Angebote', blurb: 'Erstellen, versenden, synchronisieren',
    items: [
      { q: 'Wie erstelle ich ein Angebot?', a: 'Über „Neues Angebot" in der Seitenleiste oder direkt aus einem bestehenden Aufmaß. Kundendaten und Positionen werden übernommen, sodass Sie nur noch Preise und Details ergänzen.' },
      { q: 'Wie versende ich ein Angebot per E-Mail an den Kunden?', a: 'Im Angebot bzw. im Aufmaß-Abschluss gibt es die Funktion „Per E-Mail senden". Das PDF wird automatisch angehängt; optional auch die AGB. Voraussetzung ist, dass Ihre E-Mail-Einstellungen eingerichtet sind (siehe Bereich „E-Mail").' },
      { q: 'Was bedeutet die Verbindung zwischen Aufmaß und Angebot?', a: 'Aufmaß und Angebot sind synchronisiert: Erst nach dem tatsächlichen E-Mail-Versand wechselt das zugehörige Aufmaß von „Aufmaß versenden" auf „Aufmaß versendet". Wird der Versand abgebrochen, bleibt „Aufmaß versenden" bestehen.' },
    ],
  },
  {
    id: 'status', title: 'Status & Ablauf', blurb: 'Der Weg vom Entwurf zur Abnahme',
    items: [
      { q: 'Welche Status durchläuft ein Vorgang?', a: 'Der typische Ablauf: Entwurf, Aufmaß Genommen, Aufmaß versenden, Aufmaß versendet, Auftrag Erteilt, Bauantrag, Anzahlung Erhalten, Bestellt, Montage Geplant, Montage Gestartet, Abnahme, gegebenenfalls Reklamation und zuletzt Schluss.' },
      { q: 'Wie ändere ich den Status eines Vorgangs?', a: 'Öffnen Sie das Aufmaß (als Office oder Administrator). Oben im Formular sehen Sie die Status-Leiste. Klicken Sie auf den gewünschten Status – Sie werden nach dem Datum der Änderung gefragt. Diese Funktion ist nur für Office- und Administrator-Rollen sichtbar.' },
    ],
  },
  {
    id: 'unterschrift', title: 'Unterschrift & Abnahme', blurb: 'Vor Ort oder per Link unterschreiben',
    items: [
      { q: 'Wie lasse ich den Kunden direkt vor Ort unterschreiben?', a: 'Im Abschluss-Schritt des Aufmaßes gibt es ein Unterschriftsfeld. Reichen Sie dem Kunden das Tablet oder Handy – die Unterschrift wird direkt im Dokument gespeichert.' },
      { q: 'Wie funktioniert die Unterschrift per Link aus der Ferne?', a: 'Für die Abnahme können Sie dem Kunden einen sicheren Unterschrifts-Link per E-Mail senden. Der Kunde öffnet den Link im Browser – ohne App oder Login – und unterschreibt dort. Der Link ist personalisiert und nur für diesen Vorgang gültig.' },
      { q: 'Was ist der Unterschied zwischen den E-Signatur-Varianten?', a: 'Es stehen zwei Varianten zur Verfügung: eine einfache bzw. qualifizierte Signatur (SES/QES) für rechtlich besonders bindende Dokumente und eine fortgeschrittene Signatur (AES) mit E-Mail-Bestätigung für den schnellen Alltag. Welche genutzt wird, richtet Ihr Administrator ein.' },
    ],
  },
  {
    id: 'email', title: 'E-Mail-Einstellungen', blurb: 'SMTP einrichten und versenden',
    items: [
      { q: 'Wie richte ich meine E-Mail-Adresse zum Versand ein?', a: 'Öffnen Sie „E-Mail Einstellungen" (Administration). Tragen Sie Ihre SMTP-Daten ein (Host, Port, Benutzer, Passwort, Absenderadresse). Mit „Verbindung testen" wird sofort eine Test-E-Mail an Sie selbst gesendet, um die Einrichtung zu prüfen.' },
      { q: 'Was ist der Unterschied zwischen persönlicher und Filial-E-Mail?', a: 'Sie können eine eigene, persönliche Absenderadresse hinterlegen. Ist keine vorhanden, verwendet die App automatisch die zentrale Filial-E-Mail-Adresse, die der Administrator eingerichtet hat.' },
      { q: 'Warum kann ich keine E-Mails versenden?', a: 'Meist sind die SMTP-Einstellungen noch nicht oder fehlerhaft hinterlegt. Prüfen Sie über „Verbindung testen", ob Host, Port und Passwort korrekt sind. Hilft das nicht weiter, nutzen Sie das Kontaktformular.' },
    ],
  },
  {
    id: 'firma', title: 'Firma, AGB & Preise', blurb: 'Stammdaten und Dokumente',
    items: [
      { q: 'Wo pflege ich meine Firmendaten?', a: 'Unter „Firmenangaben" hinterlegen Sie Name, Adresse, USt-IdNr., Bankverbindung usw. Diese Daten erscheinen automatisch in den erzeugten PDFs (Angebot, Rechnung) und im Geschäftsbrief-Fuß.' },
      { q: 'Wie hinterlege ich meine AGB?', a: 'Im Bereich „AGB" laden Sie Ihre Allgemeinen Geschäftsbedingungen als PDF hoch. Diese können beim E-Mail-Versand optional automatisch angehängt werden.' },
      { q: 'Wo pflege ich Produkte und Preise?', a: 'Unter „Produkte & Preise" (Administration) verwalten Sie den Produktkatalog und die Preise Ihrer Filiale. Diese Werte werden bei der Angebotserstellung herangezogen.' },
      { q: 'Wie verwalte ich Montageteams?', a: 'Unter „Montageteams" legen Sie Ihre Montagetrupps an. Diese können einem Aufmaß zugewiesen und für die Montageplanung verwendet werden.' },
    ],
  },
  {
    id: 'pdf', title: 'PDF & Dokumente', blurb: 'Herunterladen und Dokumenttypen',
    items: [
      { q: 'Wie lade ich das Aufmaß als PDF herunter?', a: 'Im Abschluss-Schritt des Aufmaßes finden Sie die Schaltfläche „PDF herunterladen". Das Dokument enthält alle erfassten Daten, Fotos und – falls vorhanden – die Unterschrift.' },
      { q: 'Welche Dokumente erzeugt die App?', a: 'Aufmaß, Angebot, Anzahlungs- und Schlussrechnung sowie das Abnahmeprotokoll. Alle Dokumente werden im Briefpapier Ihrer Filiale mit Ihren Firmenangaben erstellt.' },
    ],
  },
];

const TICKET_CATEGORIES = [
  'Allgemein', 'Aufmaß / Formular', 'Angebote & Rechnungen', 'E-Mail-Versand',
  'Unterschrift / Abnahme', 'Login / Konto', 'Fehler / etwas funktioniert nicht',
];
const TOTAL_Q = FAQ.reduce((n, c) => n + c.items.length, 0);

export default function Hilfe() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<string>(FAQ[0].id);

  const [showModal, setShowModal] = useState(false);
  const [category, setCategory] = useState(TICKET_CATEGORIES[0]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return FAQ;
    return FAQ
      .map(cat => ({ ...cat, items: cat.items.filter(it => it.q.toLowerCase().includes(term) || it.a.toLowerCase().includes(term)) }))
      .filter(cat => cat.items.length > 0);
  }, [search]);

  const totalHits = useMemo(() => filtered.reduce((s, c) => s + c.items.length, 0), [filtered]);

  // Scroll-Spy: hebt die Kategorie hervor, die gerade im Blick ist.
  useEffect(() => {
    if (search) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveCat(visible[0].target.id.replace('cat-', ''));
      },
      { rootMargin: '-120px 0px -65% 0px', threshold: 0 }
    );
    Object.values(sectionRefs.current).forEach(el => el && observer.observe(el));
    return () => observer.disconnect();
  }, [search]);

  const scrollToCat = (id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openModal = () => { setSent(false); setShowModal(true); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) {
      toast.error('Fehlende Angaben', 'Bitte Betreff und Nachricht ausfüllen.');
      return;
    }
    setSending(true);
    try {
      await submitSupportTicket({ subject, category, message });
      setSent(true);
      setSubject(''); setMessage(''); setCategory(TICKET_CATEGORIES[0]);
      toast.success('Anfrage gesendet', 'Wir melden uns innerhalb von 48 Stunden.');
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Senden fehlgeschlagen.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <header className="content-header">
        <div className="header-left">
          <h1>Hilfe &amp; Support</h1>
          <p className="header-subtitle">{TOTAL_Q} Antworten in {FAQ.length} Bereichen — Rückmeldung innerhalb von 48&nbsp;Stunden</p>
        </div>
      </header>

      <div className="content-area hilfe-wrap">
        {/* Atmosphärischer Such-Hero */}
        <section className="hilfe-hero">
          <div className="hilfe-hero-glow" aria-hidden />
          <div className="hilfe-hero-grid" aria-hidden />
          <div className="hilfe-hero-inner">
            <span className="hilfe-eyebrow">Hilfe-Center</span>
            <h2>Wie können wir helfen?</h2>
            <div className="hilfe-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="text"
                placeholder="Frage suchen — z. B. Angebot, Unterschrift, E-Mail …"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
              />
              {search && <button className="hilfe-search-clear" onClick={() => setSearch('')} aria-label="Suche löschen">{totalHits} Treffer ✕</button>}
            </div>
            {!search && (
              <div className="hilfe-hero-chips">
                {FAQ.slice(0, 5).map(c => (
                  <button key={c.id} className="hilfe-chip" onClick={() => scrollToCat(c.id)}>
                    <span className="hilfe-chip-icon">{CAT_ICONS[c.id]}</span>{c.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {search ? (
          /* Suchergebnisse — flache Liste */
          <div className="hilfe-results">
            {totalHits === 0 ? (
              <div className="hilfe-empty">
                <p>Keine passende Frage zu „{search}" gefunden.</p>
                <button className="hilfe-text-btn" onClick={openModal}>Frage direkt an den Support stellen</button>
              </div>
            ) : (
              filtered.map(cat => (
                <div key={cat.id} className="hilfe-result-group">
                  <div className="hilfe-result-cat"><span className="hilfe-result-icon">{CAT_ICONS[cat.id]}</span>{cat.title}</div>
                  {cat.items.map((it, i) => {
                    const key = `s-${cat.id}-${i}`;
                    const isOpen = openKey === key;
                    return (
                      <div key={key} className={`hilfe-item ${isOpen ? 'open' : ''}`}>
                        <button className="hilfe-q" onClick={() => setOpenKey(isOpen ? null : key)}>
                          <span>{it.q}</span>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="hilfe-chevron"><polyline points="6 9 12 15 18 9" /></svg>
                        </button>
                        <AnimatePresence initial={false}>
                          {isOpen && (
                            <motion.div className="hilfe-a-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
                              <p className="hilfe-a">{it.a}</p>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        ) : (
          /* Zweispaltig: Scroll-Spy-Navigation + Inhalt */
          <div className="hilfe-layout">
            <aside className="hilfe-nav">
              <span className="hilfe-nav-label">Bereiche</span>
              {FAQ.map(c => (
                <button
                  key={c.id}
                  className={`hilfe-nav-item ${activeCat === c.id ? 'active' : ''}`}
                  onClick={() => scrollToCat(c.id)}
                >
                  <span className="hilfe-nav-icon">{CAT_ICONS[c.id]}</span>
                  <span className="hilfe-nav-text">{c.title}</span>
                  <span className="hilfe-nav-count">{c.items.length}</span>
                </button>
              ))}
            </aside>

            <div className="hilfe-content">
              {FAQ.map((cat, ci) => (
                <motion.section
                  key={cat.id}
                  id={`cat-${cat.id}`}
                  ref={(el) => { sectionRefs.current[cat.id] = el; }}
                  className="hilfe-section"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: Math.min(ci * 0.05, 0.25) }}
                >
                  <div className="hilfe-section-head">
                    <span className="hilfe-section-icon">{CAT_ICONS[cat.id]}</span>
                    <div>
                      <h3>{cat.title}</h3>
                      <p>{cat.blurb}</p>
                    </div>
                    <span className="hilfe-section-num">{String(ci + 1).padStart(2, '0')}</span>
                  </div>
                  <div className="hilfe-items">
                    {cat.items.map((it, i) => {
                      const key = `${cat.id}-${i}`;
                      const isOpen = openKey === key;
                      return (
                        <div key={key} className={`hilfe-item ${isOpen ? 'open' : ''}`}>
                          <button className="hilfe-q" onClick={() => setOpenKey(isOpen ? null : key)} aria-expanded={isOpen}>
                            <span>{it.q}</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="hilfe-chevron"><polyline points="6 9 12 15 18 9" /></svg>
                          </button>
                          <AnimatePresence initial={false}>
                            {isOpen && (
                              <motion.div className="hilfe-a-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
                                <p className="hilfe-a">{it.a}</p>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                </motion.section>
              ))}

              {/* Support erst ganz am Ende — nach dem Durchlesen der FAQ. */}
              <div className="hilfe-footer-support">
                <div className="hilfe-footer-text">
                  <h4>Ihre Frage war nicht dabei?</h4>
                  <p>Wenn Sie oben keine passende Antwort gefunden haben, schreiben Sie unserem Support. Rückmeldung innerhalb von 48&nbsp;Stunden.</p>
                </div>
                <button className="hilfe-footer-btn" onClick={openModal}>Support kontaktieren</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Ticket-Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div className="hilfe-modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowModal(false)}>
            <motion.div
              className="hilfe-modal"
              initial={{ scale: 0.94, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0, y: 12 }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="hilfe-modal-close" onClick={() => setShowModal(false)} aria-label="Schließen">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>

              {sent ? (
                <div className="hilfe-sent">
                  <div className="hilfe-sent-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                  </div>
                  <h3>Anfrage gesendet</h3>
                  <p>Vielen Dank. Wir melden uns innerhalb von <strong>48&nbsp;Stunden</strong> bei Ihnen.</p>
                  <button className="btn-primary-new" onClick={() => setShowModal(false)}>Schließen</button>
                </div>
              ) : (
                <>
                  <div className="hilfe-modal-head">
                    <h3>Support kontaktieren</h3>
                    <p>Beschreiben Sie Ihr Anliegen. Unser Team meldet sich innerhalb von 48&nbsp;Stunden.</p>
                  </div>
                  <form className="hilfe-form" onSubmit={handleSubmit}>
                    <div className="hilfe-form-row">
                      <label>Kategorie</label>
                      <select value={category} onChange={(e) => setCategory(e.target.value)}>
                        {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="hilfe-form-row">
                      <label>Betreff</label>
                      <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Kurze Zusammenfassung" maxLength={120} />
                    </div>
                    <div className="hilfe-form-row">
                      <label>Ihre Nachricht</label>
                      <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Was haben Sie versucht, was ist passiert?" rows={5} />
                    </div>
                    <div className="hilfe-sla-note">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                      <span>Rückmeldung innerhalb von <strong>48&nbsp;Stunden</strong></span>
                    </div>
                    <div className="hilfe-form-actions">
                      <button type="submit" className="btn-primary-new" disabled={sending}>
                        {sending ? 'Wird gesendet …' : 'Anfrage senden'}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
