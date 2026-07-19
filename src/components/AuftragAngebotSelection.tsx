export interface AuftragAngebotItem {
  id: number;
  product_name: string;
  breite?: number | string | null;
  tiefe?: number | string | null;
  quantity?: number | string;
  unit_price?: number | string;
  discount?: number | string;
  total_price?: number | string;
}

export interface AuftragAngebotExtra {
  id: number;
  description: string;
  price?: number | string;
}

export interface AuftragAngebotOption {
  id: number;
  angebot_nummer?: string;
  subtotal?: number | string;
  total_discount?: number | string;
  total_price?: number | string;
  status?: string;
  items?: AuftragAngebotItem[];
  extras?: AuftragAngebotExtra[];
}

interface AuftragAngebotSelectionProps {
  angebote: AuftragAngebotOption[];
  selectedAngebotId: number | null;
  selectedItemIds: number[];
  selectedExtraIds: number[];
  onSelectAngebot: (angebotId: number) => void;
  onSelectedItemIdsChange: (ids: number[]) => void;
  onSelectedExtraIdsChange: (ids: number[]) => void;
}

const value = (input: number | string | null | undefined) => {
  const parsed = Number(input || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCurrency = (input: number | string | null | undefined) =>
  value(input).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

const itemTotal = (item: AuftragAngebotItem) => {
  const storedTotal = value(item.total_price);
  if (storedTotal > 0) return storedTotal;
  return Math.max(0, (value(item.unit_price) * Math.max(1, value(item.quantity))) - value(item.discount));
};

const toggleId = (ids: number[], id: number) =>
  ids.includes(id) ? ids.filter((current) => current !== id) : [...ids, id];

export default function AuftragAngebotSelection({
  angebote,
  selectedAngebotId,
  selectedItemIds,
  selectedExtraIds,
  onSelectAngebot,
  onSelectedItemIdsChange,
  onSelectedExtraIdsChange,
}: AuftragAngebotSelectionProps) {
  const selectedAngebot = angebote.find((angebot) => angebot.id === selectedAngebotId) || null;
  const selectedItems = (selectedAngebot?.items || []).filter((item) => selectedItemIds.includes(item.id));
  const selectedExtras = (selectedAngebot?.extras || []).filter((extra) => selectedExtraIds.includes(extra.id));
  const selectedSubtotal = selectedItems.reduce((sum, item) => sum + itemTotal(item), 0)
    + selectedExtras.reduce((sum, extra) => sum + value(extra.price), 0);
  const angebotSubtotal = (selectedAngebot?.items || []).reduce((sum, item) => sum + itemTotal(item), 0)
    + (selectedAngebot?.extras || []).reduce((sum, extra) => sum + value(extra.price), 0);
  const discountRate = angebotSubtotal > 0
    ? Math.min(1, Math.max(0, value(selectedAngebot?.total_discount) / angebotSubtotal))
    : 0;
  const selectedTotal = Math.max(0, selectedSubtotal * (1 - discountRate));

  return (
    <div className="auftrag-angebot-selection">
      <label>Angenommenes Angebot</label>
      <div className="auftrag-angebot-options" role="radiogroup" aria-label="Angenommenes Angebot">
        {angebote.map((angebot) => (
          <label
            key={angebot.id}
            className={`auftrag-angebot-option ${selectedAngebotId === angebot.id ? 'selected' : ''}`}
          >
            <input
              type="radio"
              name="selectedAuftragAngebot"
              checked={selectedAngebotId === angebot.id}
              onChange={() => onSelectAngebot(angebot.id)}
            />
            <span>
              <strong>{angebot.angebot_nummer || `Angebot #${angebot.id}`}</strong>
              <small>{formatCurrency(angebot.total_price)}</small>
            </span>
          </label>
        ))}
      </div>

      {selectedAngebot && (
        <div className="auftrag-position-selection">
          <div className="auftrag-position-heading">
            <label>Produkte für den Auftrag</label>
            <small>{selectedItemIds.length} ausgewählt</small>
          </div>
          <div className="auftrag-position-options">
            {(selectedAngebot.items || []).map((item) => {
              const dimensions = item.breite && item.tiefe ? `${item.breite} × ${item.tiefe} mm` : null;
              return (
                <label
                  key={item.id}
                  className={`auftrag-position-option ${selectedItemIds.includes(item.id) ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedItemIds.includes(item.id)}
                    onChange={() => onSelectedItemIdsChange(toggleId(selectedItemIds, item.id))}
                  />
                  <span>
                    <strong>{item.product_name}</strong>
                    <small>
                      {[dimensions, `${Math.max(1, value(item.quantity))} Stk.`, formatCurrency(itemTotal(item))]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>

          {(selectedAngebot.extras || []).length > 0 && (
            <>
              <div className="auftrag-position-heading auftrag-extra-heading">
                <label>Zusatzpositionen</label>
                <small>optional</small>
              </div>
              <div className="auftrag-position-options">
                {(selectedAngebot.extras || []).map((extra) => (
                  <label
                    key={extra.id}
                    className={`auftrag-position-option ${selectedExtraIds.includes(extra.id) ? 'selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedExtraIds.includes(extra.id)}
                      onChange={() => onSelectedExtraIdsChange(toggleId(selectedExtraIds, extra.id))}
                    />
                    <span>
                      <strong>{extra.description}</strong>
                      <small>{formatCurrency(extra.price)}</small>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}

          <div className="auftrag-selection-total">
            <span>Auftragswert</span>
            <strong>{formatCurrency(selectedTotal)}</strong>
          </div>
          {selectedItemIds.length === 0 && (
            <p className="auftrag-selection-error">Bitte mindestens ein Produkt auswählen.</p>
          )}
        </div>
      )}
    </div>
  );
}
