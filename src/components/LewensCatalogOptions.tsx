import { useMemo } from 'react';
import {
  formatLewensCatalogPrice,
  getLewensComponentsForModel,
  lewensCatalogGroups,
  parseLewensSelections,
  type LewensCatalogSelectionMap,
} from '../utils/lewensCatalog';
import './LewensCatalogOptions.css';

interface LewensCatalogOptionsProps {
  models: string | string[];
  value: unknown;
  onChange: (value: string) => void;
}

const exclusiveBucket = (code: string) => {
  if (code.startsWith('frame_')) return 'frame';
  if (code.startsWith('fabric_') && code !== 'fabric_tenara' && code !== 'fabric_zip_edge' && code !== 'fabric_side_hem') return 'fabric';
  if (code === 'micro_300_soltis' || code === 'roof_integrale_polyester') return 'fabric';
  if (code.startsWith('heater_')) return 'heater';
  if (code.startsWith('drive_variant_') || code === 'micro_150_motor') return 'drive_variant';
  if (code.startsWith('ballast_box_frame_') || code.startsWith('ballast_box_pergola_')) return 'ballast_box';
  if (code === 'roof_downpipe_kit' || code === 'roof_downpipe_kit_puro') return 'downpipe';
  return null;
};

export default function LewensCatalogOptions({ models, value, onChange }: LewensCatalogOptionsProps) {
  const selectedModels = (Array.isArray(models) ? models : [models]).filter(Boolean);
  const selections = useMemo(() => parseLewensSelections(value), [value]);

  const updateSelection = (model: string, code: string, quantity: number) => {
    const next: LewensCatalogSelectionMap = structuredClone(selections);
    const modelSelections = { ...(next[model] || {}) };
    const bucket = exclusiveBucket(code);
    if (bucket && quantity > 0) {
      for (const selectedCode of Object.keys(modelSelections)) {
        if (exclusiveBucket(selectedCode) === bucket) delete modelSelections[selectedCode];
      }
    }
    if (quantity > 0) modelSelections[code] = quantity;
    else delete modelSelections[code];
    if (Object.keys(modelSelections).length > 0) next[model] = modelSelections;
    else delete next[model];
    onChange(JSON.stringify(next));
  };

  return (
    <div className="lewens-options full-width">
      {selectedModels.map(model => {
        const components = getLewensComponentsForModel(model);
        if (components.length === 0) return null;
        return (
          <section key={model} className="lewens-options-model">
            {selectedModels.length > 1 && <h3>{model}</h3>}
            {lewensCatalogGroups.map(group => {
              const groupComponents = components.filter(component => component.group === group.id);
              if (groupComponents.length === 0) return null;
              return (
                <details key={group.id} className="lewens-options-group">
                  <summary>{group.label}</summary>
                  <div className="lewens-options-list">
                    {groupComponents.map(component => {
                      const quantity = Number(selections[model]?.[component.code] || 0);
                      const selected = quantity > 0;
                      return (
                        <div key={component.code} className={`lewens-option-row ${selected ? 'selected' : ''}`}>
                          <label>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={event => updateSelection(model, component.code, event.target.checked ? 1 : 0)}
                            />
                            <span className="lewens-option-name">{component.label}</span>
                            <span className="lewens-option-price">{formatLewensCatalogPrice(component, model)}</span>
                          </label>
                          {selected && (
                            <input
                              className="lewens-option-quantity"
                              type="number"
                              min="1"
                              step="1"
                              aria-label={`${component.label} Anzahl`}
                              value={quantity}
                              onChange={event => updateSelection(model, component.code, Math.max(0, Number(event.target.value) || 0))}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
