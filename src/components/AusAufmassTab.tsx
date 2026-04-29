// MODÜL B — "Aus Aufmaß" tab body for the Angebote page.
// Lists Aufmaß forms that already have customer + product info filled in
// (status filter intentionally absent — spec rule "Status filtreleme YOK")
// and exposes an "Angebot erstellen" button per row that the parent wires up.
import type { FormData } from '../services/api';
import './AusAufmassTab.css';

interface AusAufmassTabProps {
  forms: FormData[];
  loading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onPickAufmass: (formId: number) => void;
}

const formatDate = (iso?: string) => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
};

const isAufmassEligible = (f: FormData): boolean => {
  // Only Aufmaße that finished the measurement step ("Aufmaß Genommen",
  // backend status='neu') belong here — earlier states (entwurf) aren't
  // ready to quote yet, later ones already have a quote / order.
  if (f.status !== 'neu') return false;
  // Defence-in-depth: still require customer + product to be filled in,
  // so a half-filled record never sneaks in.
  const hasKunde = Boolean((f.kundeVorname || '').trim() || (f.kundeNachname || '').trim());
  const hasProduct = Boolean((f.category || '').trim() && (f.productType || '').trim());
  return hasKunde && hasProduct;
};

const summarizeProduct = (f: FormData): string => {
  const parts = [f.category, f.productType, f.model].filter(Boolean);
  return parts.join(' / ');
};

export default function AusAufmassTab({ forms, loading, searchQuery, onSearchChange, onPickAufmass }: AusAufmassTabProps) {
  const eligible = forms.filter(isAufmassEligible);
  const q = searchQuery.trim().toLowerCase();
  const visible = q
    ? eligible.filter(f => {
        const name = `${f.kundeVorname || ''} ${f.kundeNachname || ''}`.toLowerCase();
        const loc = (f.kundenlokation || '').toLowerCase();
        const product = summarizeProduct(f).toLowerCase();
        return name.includes(q) || loc.includes(q) || product.includes(q);
      })
    : eligible;

  return (
    <div className="aus-aufmass">
      <div className="aus-aufmass-toolbar">
        <div className="aus-aufmass-search">
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
        <div className="aus-aufmass-count">{visible.length} Aufmaß</div>
      </div>

      {loading ? (
        <div className="aus-aufmass-loading">
          <div className="spinner"></div>
          <p>Lade Aufmaße...</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="aus-aufmass-empty">
          <p>
            {q
              ? 'Keine Aufmaße passen zur Suche.'
              : 'Keine Aufmaße mit ausgefüllten Kunden- und Produktdaten verfügbar.'}
          </p>
        </div>
      ) : (
        <div className="aus-aufmass-list">
          {visible.map(form => (
            <div key={form.id} className="aus-aufmass-card">
              <div className="aus-aufmass-card-header">
                <h3>{form.kundeVorname} {form.kundeNachname}</h3>
                {form.lead_id && (
                  <span className="aus-aufmass-link-badge" title={`Bereits mit Lead #${form.lead_id} verknüpft`}>
                    ↳ Lead #{form.lead_id}
                  </span>
                )}
              </div>
              <div className="aus-aufmass-card-meta">
                <div className="aus-aufmass-card-product">{summarizeProduct(form)}</div>
                {form.kundenlokation && <div className="aus-aufmass-card-loc">{form.kundenlokation}</div>}
                {form.datum && <div className="aus-aufmass-card-date">{formatDate(form.datum)}</div>}
              </div>
              <div className="aus-aufmass-card-actions">
                <button
                  className="btn-primary aus-aufmass-pick-btn"
                  onClick={() => form.id && onPickAufmass(form.id)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Angebot erstellen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
