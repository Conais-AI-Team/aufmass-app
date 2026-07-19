import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import productConfigData from '../config/productConfig.json';
import type { DynamicFormData } from '../types/productConfig';
import { getMontageteams } from '../services/api';
import type { Montageteam } from '../services/api';
import { WeiteresProdukt } from '../types';
import LewensCatalogOptions from './LewensCatalogOptions';
import { isLewensModel } from '../utils/lewensCatalog';
import './DynamicSpecificationForm.css';
import './SectionStyles.css';
import './WeitereProdukte.css';

interface ProductConfig {
  [category: string]: {
    [productType: string]: {
      models: string[];
      modelColors?: { [model: string]: string[] };
      fields: FieldConfig[];
    };
  };
}

interface FieldConfig {
  name: string;
  label: string;
  type: string;
  options?: string[];
  unit?: string;
  required: boolean;
  placeholder?: string;
  hasCustomOption?: boolean;
  conditionalType?: string;
  valueUnit?: string;
  valueLabel?: string;
  allowZero?: boolean;
  positions?: string[];
  gridGroup?: string;
  models?: string[];
  excludeModels?: string[];
  conditionalField?: {
    trigger: string;
    field: string;
    type: string;
    unit?: string;
    label: string;
  };
  showWhen?: {
    field: string;
    value?: string;
    notEquals?: string;
  };
}

const productConfig = productConfigData as ProductConfig;

interface MissingField {
  name: string;
  label: string;
}

interface DynamicSpecificationFormProps {
  category: string;
  productType: string;
  model: string | string[];
  formData: DynamicFormData;
  updateField: (fieldName: string, value: string | number | boolean | string[]) => void;
  weitereProdukte?: WeiteresProdukt[];
  updateWeitereProdukte?: (data: WeiteresProdukt[]) => void;
  showValidationErrors?: boolean;
  missingFields?: MissingField[];
  bemerkungen?: string;
  updateBemerkungen?: (value: string) => void;
}

const categories = Object.keys(productConfig);
const generateId = () => Math.random().toString(36).substr(2, 9);

const fieldAppliesToModel = (field: FieldConfig, selectedModel: string | string[]) => {
  const selected = (Array.isArray(selectedModel) ? selectedModel : [selectedModel]).filter(Boolean);
  if (selected.length === 0) return !field.models?.length;
  if (field.models?.length && !selected.some(modelName => field.models!.includes(modelName))) return false;
  if (field.excludeModels?.length && selected.some(modelName => field.excludeModels!.includes(modelName))) return false;
  return true;
};

const createEmptyProdukt = (): WeiteresProdukt => ({
  id: generateId(),
  category: '',
  productType: '',
  model: '',
  specifications: {}
});

const DynamicSpecificationForm = ({
  category,
  productType,
  model,
  formData,
  updateField,
  weitereProdukte = [],
  updateWeitereProdukte,
  showValidationErrors = false,
  missingFields = [],
  bemerkungen = '',
  updateBemerkungen
}: DynamicSpecificationFormProps) => {
  // State for dynamic Montageteams from database
  const [montageteams, setMontageteams] = useState<Montageteam[]>([]);
  // State for expanded product in weitere produkte
  const [expandedProduktIndex, setExpandedProduktIndex] = useState<number>(-1);
  // State for mobile missing fields dropdown
  const [showMissingDropdown, setShowMissingDropdown] = useState(false);

  // Scroll to field function
  const scrollToField = (fieldName: string) => {
    const fieldElement = document.getElementById(fieldName);
    if (fieldElement) {
      fieldElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Add highlight animation
      fieldElement.classList.add('field-highlight');
      setTimeout(() => fieldElement.classList.remove('field-highlight'), 2000);
    }
    setShowMissingDropdown(false);
  };

  // Helper: Check if field should show required indicator
  // ALL fields are required EXCEPT: montageteam, bemerkungen
  const isFieldRequired = (fieldName: string): boolean => {
    const excludedFields = ['montageteam', 'bemerkungen'];
    return !excludedFields.includes(fieldName);
  };

  // Fetch Montageteams from database on mount
  useEffect(() => {
    const fetchTeams = async () => {
      try {
        const teams = await getMontageteams();
        setMontageteams(teams.filter(t => t.is_active));
      } catch (err) {
        console.error('Error fetching montageteams:', err);
      }
    };
    fetchTeams();
  }, []);

  // Get fields and model colors for selected product
  const productTypeConfig = productConfig[category]?.[productType];
  const firstModel = Array.isArray(model) ? model[0] : model;

  // Calculate total required fields - ALL fields except montageteam and bemerkungen
  const excludedFields = ['montageteam', 'bemerkungen'];
  const countTotalRequiredFields = () => {
    if (!productTypeConfig?.fields) return 0;
    let count = 0;
    for (const field of productTypeConfig.fields as FieldConfig[]) {
      if (!fieldAppliesToModel(field, model)) continue;
      // Skip excluded fields
      if (excludedFields.includes(field.name)) continue;
      // Skip special types
      if (field.type === 'markise_trigger' || field.type === 'senkrecht_section') continue;
      // Handle showWhen conditions
      if (field.showWhen) {
        const dependentValue = formData[field.showWhen.field];
        if (field.showWhen.value !== undefined && dependentValue !== field.showWhen.value) continue;
        if (field.showWhen.notEquals !== undefined && (dependentValue === field.showWhen.notEquals || !dependentValue)) continue;
      }
      count++;
    }
    // Add glasMarkise fields if type is not "Keine"
    const glasMarkiseType = formData['glasMarkiseType'];
    if (glasMarkiseType && glasMarkiseType !== 'Keine') {
      count += 5; // Aufteilung, Stoff Nummer, ZIP, Antrieb, Antriebseite
    }
    // Add senkrecht fields if active
    if (formData['senkrechtMarkiseActive'] === 'Ja') {
      let senkrechtData: Array<Record<string, unknown>> = [];
      try {
        const rawData = formData['senkrechtMarkiseData'];
        if (typeof rawData === 'string') {
          const parsed = JSON.parse(rawData);
          if (Array.isArray(parsed)) senkrechtData = parsed as Array<Record<string, unknown>>;
        } else if (Array.isArray(rawData)) {
          senkrechtData = rawData as unknown as Array<Record<string, unknown>>;
        }
      } catch { senkrechtData = []; }
      // 11 fields per senkrecht entry (or 1 if no entries yet)
      count += senkrechtData.length > 0 ? senkrechtData.length * 11 : 11;
    }
    return count;
  };

  const totalRequiredFields = countTotalRequiredFields();
  const filledRequiredFields = Math.max(0, totalRequiredFields - missingFields.length);
  const fields = productTypeConfig?.fields || [];
  // For model colors, use first selected model if array
  const modelColors = productTypeConfig?.modelColors?.[firstModel] || [];
  // Display string for model (join if array)
  const modelDisplay = Array.isArray(model) ? model.join(', ') : model;

  if (fields.length === 0) {
    return (
      <div className="no-fields-message">
        <p>Keine Spezifikationen verfügbar für diese Auswahl.</p>
      </div>
    );
  }

  const renderField = (field: FieldConfig, index: number, hasError: boolean = false) => {
    if (!fieldAppliesToModel(field, model)) return null;
    // Check showWhen condition
    if (field.showWhen) {
      const dependentValue = formData[field.showWhen.field];
      // Support both value (equals) and notEquals conditions
      if (field.showWhen.value !== undefined) {
        if (dependentValue !== field.showWhen.value) {
          return null; // Don't render this field
        }
      } else if (field.showWhen.notEquals !== undefined) {
        if (dependentValue === field.showWhen.notEquals || !dependentValue) {
          return null; // Don't render this field
        }
      }
    }

    const value = formData[field.name] ?? '';
    const errorClass = hasError ? ' field-error' : '';

    switch (field.type) {
      case 'text':
        return (
          <motion.div
            key={field.name}
            className={`form-field${errorClass}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.03 }}
          >
            <label htmlFor={field.name}>
              {field.label}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            <input
              type="text"
              id={field.name}
              value={value as string}
              onChange={(e) => updateField(field.name, e.target.value)}
              placeholder={field.placeholder || `${field.label} eingeben`}
              required={field.required}
            />
          </motion.div>
        );

      case 'number':
        return (
          <motion.div
            key={field.name}
            className={`form-field${errorClass}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.03 }}
          >
            <label htmlFor={field.name}>
              {field.label}
              {field.unit && <span className="unit-label">({field.unit})</span>}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            <div className="number-input-wrapper">
              <input
                type="number"
                id={field.name}
                value={value as number || ''}
                onChange={(e) => updateField(field.name, parseFloat(e.target.value) || 0)}
                placeholder="0"
                required={field.required}
                min="0"
                step="1"
              />
              {field.unit && <span className="unit-suffix">{field.unit}</span>}
            </div>
          </motion.div>
        );

      case 'select':
        // Use dynamic options for montageteam field
        const selectOptions = field.name === 'montageteam'
          ? montageteams.map(t => t.name)
          : field.options || [];

        return (
          <motion.div
            key={field.name}
            className={`form-field${errorClass}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.03 }}
          >
            <label htmlFor={field.name}>
              {field.label}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            <select
              id={field.name}
              value={value as string}
              onChange={(e) => {
                updateField(field.name, e.target.value);
                // Handle conditional field trigger
                if (field.conditionalField && e.target.value !== field.conditionalField.trigger) {
                  updateField(field.conditionalField.field, '');
                }
              }}
              required={field.required}
            >
              <option value="">Bitte wählen...</option>
              {selectOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {/* Conditional field for Sondermass etc */}
            {field.conditionalField && value === field.conditionalField.trigger && (
              <motion.div
                className="conditional-field"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <label htmlFor={field.conditionalField.field}>
                  {field.conditionalField.label}
                  {field.conditionalField.unit && <span className="unit-label">({field.conditionalField.unit})</span>}
                </label>
                <input
                  type="number"
                  id={field.conditionalField.field}
                  value={formData[field.conditionalField.field] as number || ''}
                  onChange={(e) => updateField(field.conditionalField!.field, parseFloat(e.target.value) || 0)}
                  placeholder="Wert eingeben"
                  min="0"
                />
              </motion.div>
            )}
          </motion.div>
        );

      case 'modelColorSelect':
        const colors = modelColors.length > 0 ? modelColors : [];
        const isCustomColor = formData[`${field.name}Custom`] !== undefined && formData[`${field.name}Custom`] !== '';
        const showCustomInput = formData[`${field.name}ShowCustom`] === true || isCustomColor;

        return (
          <motion.div
            key={field.name}
            className="form-field"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.03 }}
          >
            <label htmlFor={field.name}>
              {field.label}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            {colors.length > 0 ? (
              <>
                <select
                  id={field.name}
                  value={showCustomInput ? 'custom' : (value as string)}
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      updateField(`${field.name}ShowCustom`, true);
                      updateField(field.name, '');
                    } else {
                      updateField(`${field.name}ShowCustom`, false);
                      updateField(field.name, e.target.value);
                      updateField(`${field.name}Custom`, '');
                    }
                  }}
                  required={field.required}
                >
                  <option value="">Bitte wählen...</option>
                  {colors.map((color) => (
                    <option key={color} value={color}>
                      {color}
                    </option>
                  ))}
                  {field.hasCustomOption && <option value="custom">Sonderfarbe...</option>}
                </select>
                <AnimatePresence>
                  {showCustomInput && (
                    <motion.div
                      className="custom-color-input"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <input
                        type="text"
                        value={formData[`${field.name}Custom`] as string || ''}
                        onChange={(e) => {
                          updateField(`${field.name}Custom`, e.target.value);
                          updateField(field.name, e.target.value);
                        }}
                        placeholder="RAL Nummer eingeben (z.B. RAL 5010)"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            ) : (
              <input
                type="text"
                id={field.name}
                value={value as string}
                onChange={(e) => updateField(field.name, e.target.value)}
                placeholder="Farbe eingeben (z.B. RAL 7016)"
                required={field.required}
              />
            )}
          </motion.div>
        );

      case 'multiselect':
        const selectedValues = Array.isArray(value) ? value as string[] : [];
        return (
          <motion.div
            key={field.name}
            id={field.name}
            className={`form-field multiselect-field${errorClass}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.03 }}
          >
            <label>
              {field.label}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            <div className="multiselect-options">
              {field.options?.map((option) => {
                const isSelected = selectedValues.includes(option);
                const isKeineSelected = selectedValues.includes('Keine');
                // If "Keine" is selected, disable other options; if other option selected, disable "Keine"
                const isDisabled = option === 'Keine'
                  ? selectedValues.length > 0 && !isKeineSelected
                  : isKeineSelected;

                return (
                  <label
                    key={option}
                    className={`multiselect-checkbox ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isDisabled}
                      onChange={(e) => {
                        let newValues: string[];
                        if (option === 'Keine') {
                          // If selecting "Keine", clear all others
                          newValues = e.target.checked ? ['Keine'] : [];
                        } else {
                          if (e.target.checked) {
                            // Add this option, remove "Keine" if present
                            newValues = [...selectedValues.filter(v => v !== 'Keine'), option];
                          } else {
                            // Remove this option
                            newValues = selectedValues.filter(v => v !== option);
                          }
                        }
                        updateField(field.name, newValues);
                      }}
                    />
                    <span className="checkbox-label">{option}</span>
                  </label>
                );
              })}
            </div>
          </motion.div>
        );

      case 'seitenmarkise':
        // Parse existing seitenmarkise data
        type SeitenmarkisePosition = { active: boolean; aufteilung: string; breite?: number; links?: number; rechts?: number };
        type SeitenmarkiseData = Record<string, SeitenmarkisePosition>;

        let seitenmarkiseData: SeitenmarkiseData = {};
        const rawSeitenmarkise = formData[field.name];
        if (typeof rawSeitenmarkise === 'string' && rawSeitenmarkise) {
          try {
            seitenmarkiseData = JSON.parse(rawSeitenmarkise);
          } catch {
            seitenmarkiseData = {};
          }
        } else if (typeof rawSeitenmarkise === 'object' && rawSeitenmarkise && !Array.isArray(rawSeitenmarkise)) {
          seitenmarkiseData = rawSeitenmarkise as SeitenmarkiseData;
        }

        const positions = field.positions || ['Rechts', 'Links', 'Vorne', 'Hinten'];

        const updateSeitenmarkise = (position: string, updates: Partial<{ active: boolean; aufteilung: string; breite?: number; links?: number; rechts?: number }>) => {
          const newData = { ...seitenmarkiseData };
          newData[position] = { ...newData[position], ...updates };
          // If deactivating, clear the data for that position
          if (updates.active === false) {
            delete newData[position];
          }
          updateField(field.name, JSON.stringify(newData));
        };

        return (
          <motion.div
            key={field.name}
            id={field.name}
            className="form-field seitenmarkise-field full-width"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.03 }}
          >
            <label className="seitenmarkise-main-label">
              {field.label}
              <span className="optional-hint">(Optional)</span>
            </label>
            <div className="seitenmarkise-positions">
              {positions.map((position) => {
                const posData = seitenmarkiseData[position] || { active: false, aufteilung: '' };
                const isActive = posData.active === true;
                const aufteilung = posData.aufteilung || '';

                return (
                  <div key={position} className={`seitenmarkise-position ${isActive ? 'active' : ''}`}>
                    <label className="position-checkbox">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(e) => {
                          if (e.target.checked) {
                            updateSeitenmarkise(position, { active: true, aufteilung: '' });
                          } else {
                            updateSeitenmarkise(position, { active: false });
                          }
                        }}
                      />
                      <span className="position-label">{position}</span>
                    </label>

                    <AnimatePresence>
                      {isActive && (
                        <motion.div
                          className="position-details"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                        >
                          <div className="aufteilung-selection">
                            <label className="aufteilung-option">
                              <input
                                type="radio"
                                name={`aufteilung-${field.name}-${position}`}
                                checked={aufteilung === 'mit'}
                                onChange={() => updateSeitenmarkise(position, {
                                  aufteilung: 'mit',
                                  breite: undefined,
                                  links: posData.links || undefined,
                                  rechts: posData.rechts || undefined
                                })}
                              />
                              <span>Mit Aufteilung</span>
                            </label>
                            <label className="aufteilung-option">
                              <input
                                type="radio"
                                name={`aufteilung-${field.name}-${position}`}
                                checked={aufteilung === 'ohne'}
                                onChange={() => updateSeitenmarkise(position, {
                                  aufteilung: 'ohne',
                                  links: undefined,
                                  rechts: undefined,
                                  breite: posData.breite || undefined
                                })}
                              />
                              <span>Ohne Aufteilung</span>
                            </label>
                          </div>

                          <AnimatePresence>
                            {aufteilung === 'mit' && (
                              <motion.div
                                className="aufteilung-inputs mit-aufteilung"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                              >
                                <div className="input-row">
                                  <label>Links:</label>
                                  <div className="input-with-unit">
                                    <input
                                      type="number"
                                      value={posData.links || ''}
                                      onChange={(e) => updateSeitenmarkise(position, {
                                        links: e.target.value ? parseFloat(e.target.value) : undefined
                                      })}
                                      placeholder="0"
                                      min="0"
                                    />
                                    <span className="unit">mm</span>
                                  </div>
                                </div>
                                <div className="input-row">
                                  <label>Rechts:</label>
                                  <div className="input-with-unit">
                                    <input
                                      type="number"
                                      value={posData.rechts || ''}
                                      onChange={(e) => updateSeitenmarkise(position, {
                                        rechts: e.target.value ? parseFloat(e.target.value) : undefined
                                      })}
                                      placeholder="0"
                                      min="0"
                                    />
                                    <span className="unit">mm</span>
                                  </div>
                                </div>
                              </motion.div>
                            )}

                            {aufteilung === 'ohne' && (
                              <motion.div
                                className="aufteilung-inputs ohne-aufteilung"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                              >
                                <div className="input-row">
                                  <label>Breite:</label>
                                  <div className="input-with-unit">
                                    <input
                                      type="number"
                                      value={posData.breite || ''}
                                      onChange={(e) => updateSeitenmarkise(position, {
                                        breite: e.target.value ? parseFloat(e.target.value) : undefined
                                      })}
                                      placeholder="0"
                                      min="0"
                                    />
                                    <span className="unit">mm</span>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.div>
        );

      case 'conditional':
        if (field.conditionalType === 'ja_nein_with_value') {
          const isJa = formData[`${field.name}Active`] === true;
          const allowZero = field.allowZero === true;
          // For allowZero fields, show 0 as value; otherwise show empty string when 0
          const numValue = typeof value === 'number' ? value : (typeof value === 'string' ? parseFloat(value) : undefined);
          const displayValue: string | number = allowZero
            ? (numValue !== undefined && !isNaN(numValue) ? numValue : '')
            : (numValue || '');
          return (
            <motion.div
              key={field.name}
              id={field.name}
              className={`form-field conditional-ja-nein${errorClass}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.03 }}
            >
              <label>
                {field.label}
                {isFieldRequired(field.name) && <span className="required">*</span>}
              </label>
              <div className="ja-nein-buttons">
                <button
                  type="button"
                  className={`ja-nein-btn ${isJa ? 'active' : ''}`}
                  onClick={() => {
                    updateField(`${field.name}Active`, true);
                  }}
                >
                  Ja
                </button>
                <button
                  type="button"
                  className={`ja-nein-btn ${!isJa && formData[`${field.name}Active`] !== undefined ? 'active' : ''}`}
                  onClick={() => {
                    updateField(`${field.name}Active`, false);
                    updateField(field.name, '');
                  }}
                >
                  Nein
                </button>
              </div>
              <AnimatePresence>
                {isJa && (
                  <motion.div
                    className="conditional-value-input"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <label>{field.valueLabel || 'Wert'} ({field.valueUnit || 'mm'})</label>
                    <input
                      type="number"
                      value={displayValue}
                      onChange={(e) => {
                        const inputValue = e.target.value;
                        if (inputValue === '') {
                          updateField(field.name, '');
                        } else {
                          updateField(field.name, parseFloat(inputValue));
                        }
                      }}
                      placeholder={`${field.valueUnit || 'mm'} eingeben`}
                      min="0"
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        }
        return null;

      case 'bauform':
        const bauformType = formData['bauformType'] as string || '';
        const eingeruecktLinks = formData['bauformLinksActive'] === true;
        const eingeruecktRechts = formData['bauformRechtsActive'] === true;

        return (
          <motion.div
            key={field.name}
            id={field.name}
            className={`form-field bauform-field${errorClass}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.03 }}
          >
            <label>
              {field.label}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            <div className="bauform-button-group">
              <button
                type="button"
                className={`bauform-option-btn ${bauformType === 'BUNDIG' ? 'selected' : ''}`}
                onClick={() => {
                  updateField('bauformType', 'BUNDIG');
                  updateField('bauformLinksActive', false);
                  updateField('bauformRechtsActive', false);
                  updateField('bauformLinksValue', '');
                  updateField('bauformRechtsValue', '');
                  updateField(field.name, 'BUNDIG');
                }}
              >
                BÜNDIG
              </button>
              <button
                type="button"
                className={`bauform-option-btn ${bauformType === 'EINGERUCKT' ? 'selected' : ''}`}
                onClick={() => {
                  updateField('bauformType', 'EINGERUCKT');
                }}
              >
                EINGERÜCKT
              </button>
            </div>

            <AnimatePresence>
              {bauformType === 'EINGERUCKT' && (
                <motion.div
                  className="eingerueckt-options"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <div className="eingerueckt-row">
                    <label className="checkbox-option">
                      <input
                        type="checkbox"
                        checked={eingeruecktLinks}
                        onChange={(e) => {
                          updateField('bauformLinksActive', e.target.checked);
                          if (!e.target.checked) updateField('bauformLinksValue', '');
                          // Update combined value
                          const linksVal = e.target.checked ? (formData['bauformLinksValue'] || '') : '';
                          const rechtsVal = eingeruecktRechts ? (formData['bauformRechtsValue'] || '') : '';
                          updateField(field.name, `EINGERUCKT${linksVal ? ` LINKS ${linksVal} CM` : ''}${rechtsVal ? ` RECHTS ${rechtsVal} CM` : ''}`);
                        }}
                      />
                      <span>Links</span>
                    </label>
                    {eingeruecktLinks && (
                      <input
                        type="number"
                        className="eingerueckt-value"
                        value={formData['bauformLinksValue'] as number || ''}
                        onChange={(e) => {
                          updateField('bauformLinksValue', e.target.value);
                          const rechtsVal = eingeruecktRechts ? (formData['bauformRechtsValue'] || '') : '';
                          updateField(field.name, `EINGERUCKT LINKS ${e.target.value} MM${rechtsVal ? ` RECHTS ${rechtsVal} MM` : ''}`);
                        }}
                        placeholder="mm"
                        min="0"
                      />
                    )}
                  </div>
                  <div className="eingerueckt-row">
                    <label className="checkbox-option">
                      <input
                        type="checkbox"
                        checked={eingeruecktRechts}
                        onChange={(e) => {
                          updateField('bauformRechtsActive', e.target.checked);
                          if (!e.target.checked) updateField('bauformRechtsValue', '');
                          // Update combined value
                          const linksVal = eingeruecktLinks ? (formData['bauformLinksValue'] || '') : '';
                          const rechtsVal = e.target.checked ? (formData['bauformRechtsValue'] || '') : '';
                          updateField(field.name, `EINGERUCKT${linksVal ? ` LINKS ${linksVal} MM` : ''}${rechtsVal ? ` RECHTS ${rechtsVal} MM` : ''}`);
                        }}
                      />
                      <span>Rechts</span>
                    </label>
                    {eingeruecktRechts && (
                      <input
                        type="number"
                        className="eingerueckt-value"
                        value={formData['bauformRechtsValue'] as number || ''}
                        onChange={(e) => {
                          updateField('bauformRechtsValue', e.target.value);
                          const linksVal = eingeruecktLinks ? (formData['bauformLinksValue'] || '') : '';
                          updateField(field.name, `EINGERUCKT${linksVal ? ` LINKS ${linksVal} MM` : ''} RECHTS ${e.target.value} MM`);
                        }}
                        placeholder="mm"
                        min="0"
                      />
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );

      case 'fundament':
        const fundamentValue = value as string;
        const showFundamentInput = fundamentValue === 'Aylux';

        return (
          <motion.div
            key={field.name}
            id={`${field.name}-container`}
            className={`form-field${errorClass}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.03 }}
          >
            <label htmlFor={field.name}>
              {field.label}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            <select
              id={field.name}
              value={fundamentValue}
              onChange={(e) => {
                updateField(field.name, e.target.value);
                if (e.target.value !== 'Aylux') {
                  updateField(`${field.name}Value`, '');
                }
              }}
              required={field.required}
            >
              <option value="">Bitte wählen...</option>
              {field.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <AnimatePresence>
              {showFundamentInput && (
                <motion.div
                  className="fundament-value-input"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <label>Fundament Anzahl/Details</label>
                  <input
                    type="text"
                    value={formData[`${field.name}Value`] as string || ''}
                    onChange={(e) => updateField(`${field.name}Value`, e.target.value)}
                    placeholder="Anzahl oder Details eingeben"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );

      case 'markise_trigger':
        const markiseActive = formData['markiseActive'] === true;

        return (
          <motion.div
            key={field.name}
            className="form-field markise-trigger-field"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.03 }}
          >
            <label>
              {field.label}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            <div className="ja-nein-buttons">
              <button
                type="button"
                className={`ja-nein-btn ${markiseActive ? 'active' : ''}`}
                onClick={() => {
                  updateField('markiseActive', true);
                }}
              >
                Ja
              </button>
              <button
                type="button"
                className={`ja-nein-btn ${!markiseActive && formData['markiseActive'] !== undefined ? 'active' : ''}`}
                onClick={() => {
                  updateField('markiseActive', false);
                  updateField('markiseData', '');
                }}
              >
                Nein
              </button>
            </div>
            {markiseActive && (
              <div className="markise-info-hint">
                <span className="hint-icon">i</span>
                <span>Die Markise-Konfiguration erfolgt im nächsten Schritt.</span>
              </div>
            )}
          </motion.div>
        );

      case 'senkrecht_section':
        const senkrechtActive = formData['senkrechtMarkiseActive'] === 'Ja';
        const senkrechtPositions: string[] = (() => {
          try {
            const data = formData['senkrechtMarkiseData'];
            if (typeof data === 'string') {
              const parsed = JSON.parse(data);
              if (Array.isArray(parsed)) {
                // Support both new format (string[]) and old format (object[])
                if (parsed.length > 0 && typeof parsed[0] === 'string') return parsed;
                if (parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0].position) {
                  return parsed.map((item: Record<string, unknown>) => String(item.position)).filter(Boolean);
                }
              }
            }
            if (Array.isArray(data)) return data.filter((item): item is string => typeof item === 'string');
            return [];
          } catch { return []; }
        })();

        const allPositionOptions = ['LINKS', 'RECHTS', 'FRONT', 'FRONT LINKS', 'FRONT RECHTS', 'HINTEN LINKS', 'HINTEN RECHTS'];

        const togglePosition = (pos: string) => {
          const newPositions = senkrechtPositions.includes(pos)
            ? senkrechtPositions.filter(p => p !== pos)
            : [...senkrechtPositions, pos];
          updateField('senkrechtMarkiseData', JSON.stringify(newPositions));
        };

        return (
          <motion.div
            key={field.name}
            id={field.name}
            className="form-field senkrecht-section"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.03 }}
          >
            <label>
              Senkrecht Markise <span className="required">*</span>
            </label>
            <select
              value={formData['senkrechtMarkiseActive'] === 'Ja' ? 'Ja' : (formData['senkrechtMarkiseActive'] === 'Keine' ? 'Keine' : '')}
              onChange={(e) => {
                const val = e.target.value;
                updateField('senkrechtMarkiseActive', val);
                if (val === 'Keine') {
                  updateField('senkrechtMarkiseData', '[]');
                }
              }}
            >
              <option value="">Bitte wählen...</option>
              <option value="Keine">Keine</option>
              <option value="Ja">Ja</option>
            </select>

            <AnimatePresence>
              {senkrechtActive && (
                <motion.div
                  className="senkrecht-positions"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <label className="senkrecht-positions-label">
                    Position(en) wählen <span className="required">*</span>
                  </label>
                  <div className="senkrecht-positions-grid">
                    {allPositionOptions.map(pos => (
                      <label key={pos} className={`senkrecht-position-chip ${senkrechtPositions.includes(pos) ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={senkrechtPositions.includes(pos)}
                          onChange={() => togglePosition(pos)}
                        />
                        <span>{pos}</span>
                      </label>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );

        /* === ARCHIVED: Original detailed senkrecht_section (kept for potential rollback) ===
        // This was the full senkrecht markise form with modell, dimensions, stoff, antrieb etc.
        // Replaced with simplified JA/KEINE + multi-select positions module.
        // Old data format: senkrechtMarkiseData = [{position, modell, befestigungsart, breite, hoehe, zip, antrieb, antriebseite, anschlussseite, gestellfarbe, stoffNummer}]
        // New data format: senkrechtMarkiseData = ["LINKS", "FRONT", ...]
        === END ARCHIVED === */

      case 'festes_element_section':
        const festesActive = formData['festesElementActive'] === 'Ja';
        const festesPositions: string[] = (() => {
          try {
            const data = formData['festesElementData'];
            if (typeof data === 'string') {
              const parsed = JSON.parse(data);
              if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string');
            }
            if (Array.isArray(data)) return data.filter((item): item is string => typeof item === 'string');
            return [];
          } catch { return []; }
        })();

        const festesPositionOptions = ['LINKS', 'RECHTS', 'FRONT', 'FRONT LINKS', 'FRONT RECHTS', 'HINTEN LINKS', 'HINTEN RECHTS'];

        const toggleFestesPosition = (pos: string) => {
          const newPositions = festesPositions.includes(pos)
            ? festesPositions.filter(p => p !== pos)
            : [...festesPositions, pos];
          updateField('festesElementData', JSON.stringify(newPositions));
        };

        return (
          <motion.div
            key={field.name}
            id={field.name}
            className="form-field senkrecht-section"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.03 }}
          >
            <label>
              Festes Element <span className="required">*</span>
            </label>
            <select
              value={formData['festesElementActive'] === 'Ja' ? 'Ja' : (formData['festesElementActive'] === 'Keine' ? 'Keine' : '')}
              onChange={(e) => {
                const val = e.target.value;
                updateField('festesElementActive', val);
                if (val === 'Keine' || val === '') {
                  updateField('festesElementData', '[]');
                }
              }}
            >
              <option value="">Bitte wählen...</option>
              <option value="Keine">Keine</option>
              <option value="Ja">Ja</option>
            </select>

            <AnimatePresence>
              {festesActive && (
                <motion.div
                  className="senkrecht-positions"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <label className="senkrecht-positions-label">
                    Position(en) wählen <span className="required">*</span>
                  </label>
                  <div className="senkrecht-positions-grid">
                    {festesPositionOptions.map(pos => (
                      <label key={pos} className={`senkrecht-position-chip ${festesPositions.includes(pos) ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={festesPositions.includes(pos)}
                          onChange={() => toggleFestesPosition(pos)}
                        />
                        <span>{pos}</span>
                      </label>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );

      case 'schiebe_element_section':
        const schiebeActive = formData['schiebeElementActive'] === 'Ja';
        const schiebePositions: string[] = (() => {
          try {
            const data = formData['schiebeElementData'];
            if (typeof data === 'string') {
              const parsed = JSON.parse(data);
              if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string');
            }
            if (Array.isArray(data)) return data.filter((item): item is string => typeof item === 'string');
            return [];
          } catch { return []; }
        })();

        const schiebePositionOptions = ['LINKS', 'RECHTS', 'FRONT', 'FRONT LINKS', 'FRONT RECHTS', 'HINTEN LINKS', 'HINTEN RECHTS'];

        const toggleSchiebePosition = (pos: string) => {
          const newPositions = schiebePositions.includes(pos)
            ? schiebePositions.filter(p => p !== pos)
            : [...schiebePositions, pos];
          updateField('schiebeElementData', JSON.stringify(newPositions));
        };

        return (
          <motion.div
            key={field.name}
            id={field.name}
            className="form-field senkrecht-section"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.03 }}
          >
            <label>
              Schiebe Element <span className="required">*</span>
            </label>
            <select
              value={formData['schiebeElementActive'] === 'Ja' ? 'Ja' : (formData['schiebeElementActive'] === 'Keine' ? 'Keine' : '')}
              onChange={(e) => {
                const val = e.target.value;
                updateField('schiebeElementActive', val);
                if (val === 'Keine' || val === '') {
                  updateField('schiebeElementData', '[]');
                }
              }}
            >
              <option value="">Bitte wählen...</option>
              <option value="Keine">Keine</option>
              <option value="Ja">Ja</option>
            </select>

            <AnimatePresence>
              {schiebeActive && (
                <motion.div
                  className="senkrecht-positions"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <label className="senkrecht-positions-label">
                    Position(en) wählen <span className="required">*</span>
                  </label>
                  <div className="senkrecht-positions-grid">
                    {schiebePositionOptions.map(pos => (
                      <label key={pos} className={`senkrecht-position-chip ${schiebePositions.includes(pos) ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={schiebePositions.includes(pos)}
                          onChange={() => toggleSchiebePosition(pos)}
                        />
                        <span>{pos}</span>
                      </label>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );

      case 'keil_fenster_section':
        const keilFensterActive = formData['keilFensterActive'] === 'Ja';
        const keilFensterPositions: string[] = (() => {
          try {
            const data = formData['keilFensterData'];
            if (typeof data === 'string') {
              const parsed = JSON.parse(data);
              if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string');
            }
            if (Array.isArray(data)) return data.filter((item): item is string => typeof item === 'string');
            return [];
          } catch { return []; }
        })();

        const keilFensterPositionOptions = ['LINKS', 'RECHTS'];

        const toggleKeilFensterPosition = (pos: string) => {
          const newPositions = keilFensterPositions.includes(pos)
            ? keilFensterPositions.filter(p => p !== pos)
            : [...keilFensterPositions, pos];
          updateField('keilFensterData', JSON.stringify(newPositions));
        };

        return (
          <motion.div
            key={field.name}
            id={field.name}
            className="form-field senkrecht-section"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.03 }}
          >
            <label>
              Keil Fenster <span className="required">*</span>
            </label>
            <select
              value={formData['keilFensterActive'] === 'Ja' ? 'Ja' : (formData['keilFensterActive'] === 'Keine' ? 'Keine' : '')}
              onChange={(e) => {
                const val = e.target.value;
                updateField('keilFensterActive', val);
                if (val === 'Keine' || val === '') {
                  updateField('keilFensterData', '[]');
                }
              }}
            >
              <option value="">Bitte wählen...</option>
              <option value="Keine">Keine</option>
              <option value="Ja">Ja</option>
            </select>

            <AnimatePresence>
              {keilFensterActive && (
                <motion.div
                  className="senkrecht-positions"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <label className="senkrecht-positions-label">
                    Position(en) wählen <span className="required">*</span>
                  </label>
                  <div className="senkrecht-positions-grid">
                    {keilFensterPositionOptions.map(pos => (
                      <label key={pos} className={`senkrecht-position-chip ${keilFensterPositions.includes(pos) ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={keilFensterPositions.includes(pos)}
                          onChange={() => toggleKeilFensterPosition(pos)}
                        />
                        <span>{pos}</span>
                      </label>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );

      case 'textarea':
        return (
          <motion.div
            key={field.name}
            className="form-field full-width"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.03 }}
          >
            <label htmlFor={field.name}>
              {field.label}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            <textarea
              id={field.name}
              value={value as string}
              onChange={(e) => updateField(field.name, e.target.value)}
              placeholder={field.placeholder || `${field.label} eingeben`}
              required={field.required}
              rows={4}
            />
          </motion.div>
        );

      default:
        return null;
    }
  };

  // Weitere Produkte helper functions
  const handleWPCategoryChange = (index: number, value: string) => {
    if (!updateWeitereProdukte) return;
    const newProducts = [...weitereProdukte];
    newProducts[index] = {
      ...newProducts[index],
      category: value,
      productType: '',
      model: '',
      specifications: {}
    };
    updateWeitereProdukte(newProducts);
  };

  const handleWPProductTypeChange = (index: number, value: string | string[]) => {
    if (!updateWeitereProdukte) return;
    const newProducts = [...weitereProdukte];
    newProducts[index] = {
      ...newProducts[index],
      productType: Array.isArray(value) ? value.join(', ') : value,
      model: '',
      specifications: {}
    };
    updateWeitereProdukte(newProducts);
  };

  const handleWPModelChange = (index: number, value: string) => {
    if (!updateWeitereProdukte) return;
    const newProducts = [...weitereProdukte];
    newProducts[index] = {
      ...newProducts[index],
      model: value,
      specifications: {}
    };
    updateWeitereProdukte(newProducts);
  };

  const handleWPSpecChange = (index: number, fieldName: string, value: string | number | boolean) => {
    if (!updateWeitereProdukte) return;
    const newProducts = [...weitereProdukte];
    newProducts[index] = {
      ...newProducts[index],
      specifications: {
        ...newProducts[index].specifications,
        [fieldName]: value
      }
    };
    updateWeitereProdukte(newProducts);
  };

  const addWeitereProdukt = () => {
    if (!updateWeitereProdukte) return;
    const newProducts = [...weitereProdukte, createEmptyProdukt()];
    updateWeitereProdukte(newProducts);
    setExpandedProduktIndex(newProducts.length - 1);
  };

  const removeWeitereProdukt = (index: number) => {
    if (!updateWeitereProdukte) return;
    const newProducts = weitereProdukte.filter((_, i) => i !== index);
    updateWeitereProdukte(newProducts);
    if (expandedProduktIndex >= newProducts.length) {
      setExpandedProduktIndex(newProducts.length - 1);
    }
  };

  const getWPProductTypes = (cat: string) => {
    if (!cat) return [];
    return Object.keys(productConfig[cat] || {});
  };

  const getWPFields = (cat: string, pt: string) => {
    if (!cat || !pt) return [];
    return productConfig[cat]?.[pt]?.fields || [];
  };

  const getWPModels = (cat: string, pt: string) => {
    if (!cat || !pt) return [];
    return productConfig[cat]?.[pt]?.models || [];
  };

  const getWPColorsForModel = (cat: string, pt: string, mdl: string): string[] => {
    if (!cat || !pt || !productConfig[cat]?.[pt]) return [];
    const allColors = productConfig[cat][pt].modelColors;
    if (!allColors) return [];
    if (mdl && allColors[mdl]) return allColors[mdl];
    // No model selected - merge all colors
    const merged = new Set<string>();
    Object.values(allColors).forEach((c: string[]) => c.forEach(v => merged.add(v)));
    return Array.from(merged);
  };

  const getWPProductLabel = (product: WeiteresProdukt, index: number) => {
    if (product.category && product.productType) {
      return `${product.category} - ${product.productType}${product.model ? ` (${product.model})` : ''}`;
    }
    return `Weiteres Produkt ${index + 1}`;
  };

  const renderWPSpecField = (product: WeiteresProdukt, index: number, field: FieldConfig) => {
    if (!fieldAppliesToModel(field, product.model)) return null;
    const value = product.specifications[field.name];
    // Skip montageteam and markise_trigger fields in weitere produkte
    if (field.name === 'montageteam' || field.type === 'markise_trigger') return null;

    // Check showWhen condition for conditional field visibility
    if (field.showWhen) {
      const dependentValue = product.specifications[field.showWhen.field];
      // Support both value (equals) and notEquals conditions
      if (field.showWhen.value !== undefined) {
        if (dependentValue !== field.showWhen.value) {
          return null; // Don't render this field
        }
      } else if (field.showWhen.notEquals !== undefined) {
        if (dependentValue === field.showWhen.notEquals || !dependentValue) {
          return null; // Don't render this field
        }
      }
    }

    switch (field.type) {
      case 'number':
        return (
          <div key={field.name} className="form-field">
            <label>
              {field.label}
              {field.unit && <span className="unit-label">({field.unit})</span>}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            <div className="number-input-wrapper">
              <input
                type="number"
                value={value as number || ''}
                onChange={(e) => handleWPSpecChange(index, field.name, parseFloat(e.target.value) || 0)}
                placeholder="0"
                min="0"
              />
              {field.unit && <span className="unit-suffix">{field.unit}</span>}
            </div>
          </div>
        );

      case 'select':
        return (
          <div key={field.name} className="form-field">
            <label>
              {field.label}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            <select
              value={value as string || ''}
              onChange={(e) => handleWPSpecChange(index, field.name, e.target.value)}
            >
              <option value="">Bitte wählen...</option>
              {field.options?.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        );

      case 'modelColorSelect':
        const colors = getWPColorsForModel(product.category, product.productType, product.model);
        return (
          <div key={field.name} className="form-field">
            <label>
              {field.label}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            <select
              value={value as string || ''}
              onChange={(e) => handleWPSpecChange(index, field.name, e.target.value)}
            >
              <option value="">Bitte wählen...</option>
              {colors.map(color => (
                <option key={color} value={color}>{color}</option>
              ))}
              {field.hasCustomOption && <option value="SONDERFARBE">SONDERFARBE</option>}
            </select>
          </div>
        );

      case 'conditional':
        const isActive = product.specifications[`${field.name}Active`] === true;
        return (
          <div key={field.name} className="form-field conditional-field">
            <label>
              {field.label}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            <div className="button-group">
              <button
                type="button"
                className={`option-btn ${isActive ? 'selected' : ''}`}
                onClick={() => handleWPSpecChange(index, `${field.name}Active`, true)}
              >
                Ja
              </button>
              <button
                type="button"
                className={`option-btn ${product.specifications[`${field.name}Active`] === false ? 'selected' : ''}`}
                onClick={() => handleWPSpecChange(index, `${field.name}Active`, false)}
              >
                Nein
              </button>
            </div>
            {isActive && (
              <div className="conditional-value">
                <input
                  type="number"
                  value={value as number || ''}
                  onChange={(e) => handleWPSpecChange(index, field.name, parseFloat(e.target.value) || 0)}
                  placeholder="0"
                />
                {field.valueUnit && <span className="unit-suffix">{field.valueUnit}</span>}
              </div>
            )}
          </div>
        );

      case 'fundament':
        return (
          <div key={field.name} className="form-field">
            <label>
              {field.label}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            <select
              value={value as string || ''}
              onChange={(e) => handleWPSpecChange(index, field.name, e.target.value)}
            >
              <option value="">Bitte wählen...</option>
              {field.options?.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            {value === 'Aylux' && (
              <div className="fundament-details">
                <label>Fundament Anzahl/Details</label>
                <input
                  type="text"
                  value={product.specifications.fundamentValue as string || ''}
                  onChange={(e) => handleWPSpecChange(index, 'fundamentValue', e.target.value)}
                  placeholder="z.B. 4 Stück, 80x80mm"
                />
              </div>
            )}
          </div>
        );

      case 'bauform':
        const bauformType = product.specifications.bauformType as string;
        return (
          <div key={field.name} className="form-field bauform-field">
            <label>
              {field.label}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            <div className="button-group">
              <button
                type="button"
                className={`option-btn ${bauformType === 'BUNDIG' ? 'selected' : ''}`}
                onClick={() => handleWPSpecChange(index, 'bauformType', 'BUNDIG')}
              >
                BÜNDIG
              </button>
              <button
                type="button"
                className={`option-btn ${bauformType === 'EINGERUCKT' ? 'selected' : ''}`}
                onClick={() => handleWPSpecChange(index, 'bauformType', 'EINGERUCKT')}
              >
                EINGERÜCKT
              </button>
            </div>
            {bauformType === 'EINGERUCKT' && (
              <div className="bauform-details">
                <div className="bauform-option">
                  <label>
                    <input
                      type="checkbox"
                      checked={product.specifications.bauformLinksActive === true}
                      onChange={(e) => handleWPSpecChange(index, 'bauformLinksActive', e.target.checked)}
                    />
                    Links
                  </label>
                  {product.specifications.bauformLinksActive && (
                    <input
                      type="number"
                      value={product.specifications.bauformLinksValue as number || ''}
                      onChange={(e) => handleWPSpecChange(index, 'bauformLinksValue', parseFloat(e.target.value) || 0)}
                      placeholder="mm"
                    />
                  )}
                </div>
                <div className="bauform-option">
                  <label>
                    <input
                      type="checkbox"
                      checked={product.specifications.bauformRechtsActive === true}
                      onChange={(e) => handleWPSpecChange(index, 'bauformRechtsActive', e.target.checked)}
                    />
                    Rechts
                  </label>
                  {product.specifications.bauformRechtsActive && (
                    <input
                      type="number"
                      value={product.specifications.bauformRechtsValue as number || ''}
                      onChange={(e) => handleWPSpecChange(index, 'bauformRechtsValue', parseFloat(e.target.value) || 0)}
                      placeholder="mm"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        );

      case 'multiselect':
        const wpMultiValue = (product.specifications[field.name] as string[]) || [];
        const handleWPMultiSelectChange = (option: string, checked: boolean) => {
          let newValue: string[];
          if (option === 'Keine') {
            newValue = checked ? ['Keine'] : [];
          } else {
            if (checked) {
              newValue = wpMultiValue.filter(v => v !== 'Keine');
              newValue.push(option);
            } else {
              newValue = wpMultiValue.filter(v => v !== option);
            }
          }
          handleWPSpecChange(index, field.name, newValue as unknown as string);
        };
        return (
          <div key={field.name} className="form-field full-width multiselect-field">
            <label>
              {field.label}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            <div className="multiselect-options">
              {field.options?.map(option => {
                const isSelected = wpMultiValue.includes(option);
                const isDisabled = option !== 'Keine' && wpMultiValue.includes('Keine');
                return (
                  <label
                    key={option}
                    className={`multiselect-checkbox ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isDisabled}
                      onChange={(e) => handleWPMultiSelectChange(option, e.target.checked)}
                    />
                    <span>{option}</span>
                  </label>
                );
              })}
            </div>
          </div>
        );

      case 'seitenmarkise':
        const wpPositions = field.positions || ['Rechts', 'Links', 'Vorne', 'Hinten'];
        const wpSeitenmarkiseRaw = product.specifications[field.name];
        type WPSeitenmarkisePos = { active: boolean; aufteilung: string; links?: number; rechts?: number; breite?: number };
        let wpSeitenmarkiseData: Record<string, WPSeitenmarkisePos> = {};

        if (typeof wpSeitenmarkiseRaw === 'string' && wpSeitenmarkiseRaw) {
          try {
            wpSeitenmarkiseData = JSON.parse(wpSeitenmarkiseRaw);
          } catch {
            wpSeitenmarkiseData = {};
          }
        } else if (typeof wpSeitenmarkiseRaw === 'object' && wpSeitenmarkiseRaw && !Array.isArray(wpSeitenmarkiseRaw)) {
          wpSeitenmarkiseData = wpSeitenmarkiseRaw as Record<string, WPSeitenmarkisePos>;
        }

        const updateWPSeitenmarkise = (position: string, updates: Partial<WPSeitenmarkisePos>) => {
          const newData = { ...wpSeitenmarkiseData };
          newData[position] = { ...newData[position], ...updates };
          if (updates.active === false) {
            delete newData[position];
          }
          handleWPSpecChange(index, field.name, JSON.stringify(newData));
        };

        return (
          <div key={field.name} className="form-field full-width seitenmarkise-field">
            <label className="seitenmarkise-main-label">
              {field.label}
              <span className="optional-hint">(Optional)</span>
            </label>
            <div className="seitenmarkise-positions">
              {wpPositions.map(position => {
                const posData = wpSeitenmarkiseData[position] || { active: false, aufteilung: '' };
                const isActive = posData.active === true;
                const aufteilung = posData.aufteilung || '';

                return (
                  <div key={position} className={`seitenmarkise-position ${isActive ? 'active' : ''}`}>
                    <label className="position-checkbox">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(e) => {
                          if (e.target.checked) {
                            updateWPSeitenmarkise(position, { active: true, aufteilung: '' });
                          } else {
                            updateWPSeitenmarkise(position, { active: false });
                          }
                        }}
                      />
                      <span className="position-label">{position}</span>
                    </label>

                    {isActive && (
                      <div className="position-details">
                        <div className="aufteilung-selection">
                          <label className="aufteilung-option">
                            <input
                              type="radio"
                              name={`aufteilung-wp-${product.id}-${position}`}
                              checked={aufteilung === 'mit'}
                              onChange={() => updateWPSeitenmarkise(position, { aufteilung: 'mit', breite: undefined })}
                            />
                            <span>Mit Aufteilung</span>
                          </label>
                          <label className="aufteilung-option">
                            <input
                              type="radio"
                              name={`aufteilung-wp-${product.id}-${position}`}
                              checked={aufteilung === 'ohne'}
                              onChange={() => updateWPSeitenmarkise(position, { aufteilung: 'ohne', links: undefined, rechts: undefined })}
                            />
                            <span>Ohne Aufteilung</span>
                          </label>
                        </div>

                        {aufteilung === 'mit' && (
                          <div className="aufteilung-inputs mit-aufteilung">
                            <div className="input-row">
                              <label>Links:</label>
                              <div className="input-with-unit">
                                <input
                                  type="number"
                                  value={posData.links || ''}
                                  onChange={(e) => updateWPSeitenmarkise(position, { links: parseFloat(e.target.value) || 0 })}
                                  placeholder="0"
                                  min="0"
                                />
                                <span className="unit">mm</span>
                              </div>
                            </div>
                            <div className="input-row">
                              <label>Rechts:</label>
                              <div className="input-with-unit">
                                <input
                                  type="number"
                                  value={posData.rechts || ''}
                                  onChange={(e) => updateWPSeitenmarkise(position, { rechts: parseFloat(e.target.value) || 0 })}
                                  placeholder="0"
                                  min="0"
                                />
                                <span className="unit">mm</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {aufteilung === 'ohne' && (
                          <div className="aufteilung-inputs ohne-aufteilung">
                            <div className="input-row">
                              <label>Breite:</label>
                              <div className="input-with-unit">
                                <input
                                  type="number"
                                  value={posData.breite || ''}
                                  onChange={(e) => updateWPSeitenmarkise(position, { breite: parseFloat(e.target.value) || 0 })}
                                  placeholder="0"
                                  min="0"
                                />
                                <span className="unit">mm</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );

      case 'senkrecht_section': {
        const wpSenkActive = product.specifications['senkrechtMarkiseActive'] === 'Ja';
        const wpSenkPositions: string[] = (() => {
          try {
            const d = product.specifications['senkrechtMarkiseData'];
            if (typeof d === 'string') {
              const p = JSON.parse(d);
              if (Array.isArray(p)) return p.filter((i: unknown): i is string => typeof i === 'string');
            }
            return [];
          } catch { return []; }
        })();
        const senkPosOpts = ['LINKS', 'RECHTS', 'FRONT', 'FRONT LINKS', 'FRONT RECHTS', 'HINTEN LINKS', 'HINTEN RECHTS'];
        return (
          <div key={field.name} className="form-field senkrecht-section">
            <label>Senkrecht Markise <span className="required">*</span></label>
            <select
              value={product.specifications['senkrechtMarkiseActive'] === 'Ja' ? 'Ja' : (product.specifications['senkrechtMarkiseActive'] === 'Keine' ? 'Keine' : '')}
              onChange={(e) => {
                handleWPSpecChange(index, 'senkrechtMarkiseActive', e.target.value);
              }}
            >
              <option value="">Bitte wählen...</option>
              <option value="Keine">Keine</option>
              <option value="Ja">Ja</option>
            </select>
            {wpSenkActive && (
              <div className="senkrecht-positions" style={{ marginTop: '0.75rem' }}>
                <label className="senkrecht-positions-label">Position(en) wählen <span className="required">*</span></label>
                <div className="senkrecht-positions-grid">
                  {senkPosOpts.map(pos => (
                    <label key={pos} className={`senkrecht-position-chip ${wpSenkPositions.includes(pos) ? 'selected' : ''}`}>
                      <input type="checkbox" checked={wpSenkPositions.includes(pos)} onChange={() => {
                        const np = wpSenkPositions.includes(pos) ? wpSenkPositions.filter(p => p !== pos) : [...wpSenkPositions, pos];
                        handleWPSpecChange(index, 'senkrechtMarkiseData', JSON.stringify(np));
                      }} />
                      <span>{pos}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      }

      case 'festes_element_section': {
        const wpFestActive = product.specifications['festesElementActive'] === 'Ja';
        const wpFestPositions: string[] = (() => {
          try {
            const d = product.specifications['festesElementData'];
            if (typeof d === 'string') {
              const p = JSON.parse(d);
              if (Array.isArray(p)) return p.filter((i: unknown): i is string => typeof i === 'string');
            }
            return [];
          } catch { return []; }
        })();
        const festPosOpts = ['LINKS', 'RECHTS', 'FRONT', 'FRONT LINKS', 'FRONT RECHTS', 'HINTEN LINKS', 'HINTEN RECHTS'];
        return (
          <div key={field.name} className="form-field senkrecht-section">
            <label>Festes Element <span className="required">*</span></label>
            <select
              value={product.specifications['festesElementActive'] === 'Ja' ? 'Ja' : (product.specifications['festesElementActive'] === 'Keine' ? 'Keine' : '')}
              onChange={(e) => {
                handleWPSpecChange(index, 'festesElementActive', e.target.value);
              }}
            >
              <option value="">Bitte wählen...</option>
              <option value="Keine">Keine</option>
              <option value="Ja">Ja</option>
            </select>
            {wpFestActive && (
              <div className="senkrecht-positions" style={{ marginTop: '0.75rem' }}>
                <label className="senkrecht-positions-label">Position(en) wählen <span className="required">*</span></label>
                <div className="senkrecht-positions-grid">
                  {festPosOpts.map(pos => (
                    <label key={pos} className={`senkrecht-position-chip ${wpFestPositions.includes(pos) ? 'selected' : ''}`}>
                      <input type="checkbox" checked={wpFestPositions.includes(pos)} onChange={() => {
                        const np = wpFestPositions.includes(pos) ? wpFestPositions.filter(p => p !== pos) : [...wpFestPositions, pos];
                        handleWPSpecChange(index, 'festesElementData', JSON.stringify(np));
                      }} />
                      <span>{pos}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      }

      case 'schiebe_element_section': {
        const wpSchiebeActive2 = product.specifications['schiebeElementActive'] === 'Ja';
        const wpSchiebePositions2: string[] = (() => {
          try {
            const d = product.specifications['schiebeElementData'];
            if (typeof d === 'string') {
              const p = JSON.parse(d);
              if (Array.isArray(p)) return p.filter((i: unknown): i is string => typeof i === 'string');
            }
            return [];
          } catch { return []; }
        })();
        const schiebePosOpts2 = ['LINKS', 'RECHTS', 'FRONT', 'FRONT LINKS', 'FRONT RECHTS', 'HINTEN LINKS', 'HINTEN RECHTS'];
        return (
          <div key={field.name} className="form-field senkrecht-section">
            <label>Schiebe Element <span className="required">*</span></label>
            <select
              value={product.specifications['schiebeElementActive'] === 'Ja' ? 'Ja' : (product.specifications['schiebeElementActive'] === 'Keine' ? 'Keine' : '')}
              onChange={(e) => {
                handleWPSpecChange(index, 'schiebeElementActive', e.target.value);
              }}
            >
              <option value="">Bitte wählen...</option>
              <option value="Keine">Keine</option>
              <option value="Ja">Ja</option>
            </select>
            {wpSchiebeActive2 && (
              <div className="senkrecht-positions" style={{ marginTop: '0.75rem' }}>
                <label className="senkrecht-positions-label">Position(en) wählen <span className="required">*</span></label>
                <div className="senkrecht-positions-grid">
                  {schiebePosOpts2.map(pos => (
                    <label key={pos} className={`senkrecht-position-chip ${wpSchiebePositions2.includes(pos) ? 'selected' : ''}`}>
                      <input type="checkbox" checked={wpSchiebePositions2.includes(pos)} onChange={() => {
                        const np = wpSchiebePositions2.includes(pos) ? wpSchiebePositions2.filter(p => p !== pos) : [...wpSchiebePositions2, pos];
                        handleWPSpecChange(index, 'schiebeElementData', JSON.stringify(np));
                      }} />
                      <span>{pos}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      }

      case 'keil_fenster_section': {
        const wpKeilActive2 = product.specifications['keilFensterActive'] === 'Ja';
        const wpKeilPositions2: string[] = (() => {
          try {
            const d = product.specifications['keilFensterData'];
            if (typeof d === 'string') {
              const p = JSON.parse(d);
              if (Array.isArray(p)) return p.filter((i: unknown): i is string => typeof i === 'string');
            }
            return [];
          } catch { return []; }
        })();
        const keilPosOpts2 = ['LINKS', 'RECHTS'];
        return (
          <div key={field.name} className="form-field senkrecht-section">
            <label>Keil Fenster <span className="required">*</span></label>
            <select
              value={product.specifications['keilFensterActive'] === 'Ja' ? 'Ja' : (product.specifications['keilFensterActive'] === 'Keine' ? 'Keine' : '')}
              onChange={(e) => {
                handleWPSpecChange(index, 'keilFensterActive', e.target.value);
              }}
            >
              <option value="">Bitte wählen...</option>
              <option value="Keine">Keine</option>
              <option value="Ja">Ja</option>
            </select>
            {wpKeilActive2 && (
              <div className="senkrecht-positions" style={{ marginTop: '0.75rem' }}>
                <label className="senkrecht-positions-label">Position(en) wählen <span className="required">*</span></label>
                <div className="senkrecht-positions-grid">
                  {keilPosOpts2.map(pos => (
                    <label key={pos} className={`senkrecht-position-chip ${wpKeilPositions2.includes(pos) ? 'selected' : ''}`}>
                      <input type="checkbox" checked={wpKeilPositions2.includes(pos)} onChange={() => {
                        const np = wpKeilPositions2.includes(pos) ? wpKeilPositions2.filter(p => p !== pos) : [...wpKeilPositions2, pos];
                        handleWPSpecChange(index, 'keilFensterData', JSON.stringify(np));
                      }} />
                      <span>{pos}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      }

      case 'text':
        return (
          <div key={field.name} className="form-field">
            <label>
              {field.label}
              {isFieldRequired(field.name) && <span className="required">*</span>}
            </label>
            <input
              type="text"
              value={value as string || ''}
              onChange={(e) => handleWPSpecChange(index, field.name, e.target.value)}
              placeholder={field.placeholder || `${field.label} eingeben`}
            />
          </div>
        );

      default:
        return null;
    }
  };

  const renderWPProductForm = (product: WeiteresProdukt, index: number) => {
    const productTypes = getWPProductTypes(product.category);
    const isMarkise = product.category === 'MARKISE';
    const effectiveProductType = product.productType;
    const wpFields = getWPFields(product.category, effectiveProductType);
    const models = getWPModels(product.category, effectiveProductType);

    return (
      <div className="product-form-content">
        <div className="form-field">
          <label>Kategorie <span className="required">*</span></label>
          <select
            value={product.category}
            onChange={(e) => handleWPCategoryChange(index, e.target.value)}
          >
            <option value="">Bitte wählen...</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        {product.category && (
          <div className="form-field">
            <label>Produkttyp <span className="required">*</span></label>
            <select
              value={product.productType}
              onChange={(e) => handleWPProductTypeChange(index, e.target.value)}
            >
              <option value="">Bitte wählen...</option>
              {productTypes.map(pt => (
                <option key={pt} value={pt}>{pt}</option>
              ))}
            </select>
          </div>
        )}

        {product.productType && models.length > 0 && (
          <div className="form-field">
            <label>Modell <span className="required">*</span></label>
            <select
              value={product.model}
              onChange={(e) => handleWPModelChange(index, e.target.value)}
            >
              <option value="">Bitte wählen...</option>
              {models.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}

        {product.productType && product.model && (
          <div className="specs-grid">
            {wpFields.map(field => renderWPSpecField(product, index, field))}
            {isLewensModel(product.model) && (
              <LewensCatalogOptions
                models={product.model}
                value={product.specifications.lewensCatalogOptions}
                onChange={value => handleWPSpecChange(index, 'lewensCatalogOptions', value)}
              />
            )}
          </div>
        )}

        {isMarkise && product.model && (
          <div className="form-field full-width markise-bemerkungen-field">
            <label>Markise Bemerkung</label>
            <textarea
              value={product.specifications.markiseBemerkung as string || ''}
              onChange={(e) => handleWPSpecChange(index, 'markiseBemerkung', e.target.value)}
              placeholder="Zusätzliche Anmerkungen zur Markise..."
              rows={3}
            />
          </div>
        )}
      </div>
    );
  };

  // Helper function to check if a field is in the missing fields list
  const isFieldMissing = (fieldName: string): boolean => {
    return showValidationErrors && missingFields.some(f => f.name === fieldName || f.name.startsWith(fieldName));
  };

  return (
    <div className="dynamic-specification-form">
      <motion.div
        className="section-header"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <h2>Spezifikationen</h2>
        <p className="section-description">
          {category} / {productType} / {modelDisplay}
        </p>
      </motion.div>

      {/* Missing Fields Progress Bar - Always visible when there are missing fields */}
      <AnimatePresence>
        {missingFields.length > 0 && (
          <motion.div
            className="missing-fields-bar"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <div className="missing-bar-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            {/* Desktop: Show field names */}
            <div className="missing-bar-content desktop-only">
              <span className="missing-label">Fehlt:</span>
              <div className="missing-fields-tags">
                {missingFields.slice(0, 4).map((field, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="missing-field-tag"
                    onClick={() => scrollToField(field.name)}
                  >
                    {field.label}
                  </button>
                ))}
                {missingFields.length > 4 && (
                  <span className="missing-more">+{missingFields.length - 4} weitere</span>
                )}
              </div>
            </div>

            {/* Mobile: Show count with dropdown */}
            <div className="missing-bar-content mobile-only">
              <button
                type="button"
                className="missing-count-btn"
                onClick={() => setShowMissingDropdown(!showMissingDropdown)}
              >
                <span>{missingFields.length} Felder fehlen</span>
                <svg className={`dropdown-arrow ${showMissingDropdown ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6,9 12,15 18,9" />
                </svg>
              </button>

              <AnimatePresence>
                {showMissingDropdown && (
                  <motion.div
                    className="missing-dropdown"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    {missingFields.map((field, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="missing-dropdown-item"
                        onClick={() => scrollToField(field.name)}
                      >
                        {field.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="missing-bar-progress">
              <span className="progress-text">{filledRequiredFields}/{totalRequiredFields}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* All fields complete message */}
      <AnimatePresence>
        {missingFields.length === 0 && totalRequiredFields > 0 && (
          <motion.div
            className="fields-complete-bar"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <div className="complete-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22,4 12,14.01 9,11.01" />
              </svg>
            </div>
            <span>Alle Pflichtfelder ausgefüllt</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="specifications-grid">
        {(() => {
          const renderedGroups = new Set<string>();
          return fields.map((field, index) => {
            // If field has gridGroup, render as part of group
            if (field.gridGroup) {
              // Skip if already rendered this group
              if (renderedGroups.has(field.gridGroup)) {
                return null;
              }
              renderedGroups.add(field.gridGroup);

              // Get all fields in this group
              const groupFields = fields.filter(f => f.gridGroup === field.gridGroup);

              return (
                <div key={`group-${field.gridGroup}`} className={`field-grid-group field-grid-group-${groupFields.length}`}>
                  {groupFields.map((gf, gi) => renderField(gf, index + gi, isFieldMissing(gf.name)))}
                </div>
              );
            }

            // Regular field without group
            return renderField(field, index, isFieldMissing(field.name));
          });
        })()}
        {(Array.isArray(model) ? model : [model]).some(isLewensModel) && (
          <LewensCatalogOptions
            models={model}
            value={formData.lewensCatalogOptions}
            onChange={value => updateField('lewensCatalogOptions', value)}
          />
        )}
      </div>

      {/* Weitere Produkte Section */}
      {updateWeitereProdukte && (
        <div className="weitere-produkte-section">
          <motion.div
            className="section-divider"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <h3>Weitere Produkte</h3>
            <p className="section-description">Nur für komplett unabhängige Zusatzprodukte verwenden (z.B. 2. Überdachung am gleichen Haus, oder Wintergarten + separate Gelenkarmmarkise)</p>
          </motion.div>

          {/* Product Cards */}
          {weitereProdukte.length > 0 && (
            <div className="product-cards">
              {weitereProdukte.map((product, index) => (
                <motion.div
                  key={product.id}
                  className={`product-card ${expandedProduktIndex === index ? 'expanded' : 'collapsed'}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.1 }}
                >
                  <div
                    className="product-card-header"
                    onClick={() => setExpandedProduktIndex(expandedProduktIndex === index ? -1 : index)}
                  >
                    <div className="product-card-title">
                      <span className="product-number">{index + 1}</span>
                      <span className="product-label">{getWPProductLabel(product, index)}</span>
                    </div>
                    <div className="product-card-actions">
                      <button
                        type="button"
                        className="remove-product-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeWeitereProdukt(index);
                        }}
                        title="Produkt entfernen"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                      <span className={`expand-icon ${expandedProduktIndex === index ? 'expanded' : ''}`}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="6,9 12,15 18,9" />
                        </svg>
                      </span>
                    </div>
                  </div>
                  <AnimatePresence>
                    {expandedProduktIndex === index && (
                      <motion.div
                        className="product-card-content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                      >
                        {renderWPProductForm(product, index)}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>
          )}

          {/* Add Product Button */}
          <motion.button
            type="button"
            className="add-product-btn"
            onClick={addWeitereProdukt}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.2 }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Weiteres Produkt hinzufügen
          </motion.button>
        </div>
      )}

      {/* Global Bemerkungen Section */}
      <motion.div
        className="global-bemerkungen-section"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.3 }}
      >
        <label htmlFor="globalBemerkungen">
          Bemerkungen
        </label>
        <textarea
          id="globalBemerkungen"
          value={bemerkungen}
          onChange={(e) => updateBemerkungen?.(e.target.value)}
          placeholder="Zusätzliche Anmerkungen oder Bemerkungen..."
          rows={4}
        />
      </motion.div>
    </div>
  );
};

export default DynamicSpecificationForm;
