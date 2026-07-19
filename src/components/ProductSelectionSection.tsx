import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import productConfigData from '../config/productConfig.json';
import type { ProductConfig } from '../types/productConfig';
import './ProductSelectionSection.css';
import './SectionStyles.css';

const productConfig = productConfigData as ProductConfig;

interface ProductSelectionSectionProps {
  selection: {
    category: string;
    productType: string;
    model: string | string[];
  };
  updateSelection: (field: 'category' | 'productType' | 'model', value: string | string[]) => void;
}

// Zubehör (accessories) and Montage (installation) are commercial add-ons that belong in the
// Angebot, not the on-site measurement form. The measurement team only captures the physical
// product here; accessories/installation are priced when the offer is drawn up.
const MEASUREMENT_HIDDEN_CATEGORIES = ['ZUBEHÖR', 'MONTAGE'];

const ProductSelectionSection = ({ selection, updateSelection }: ProductSelectionSectionProps) => {
  const categories = Object.keys(productConfig).filter(
    (category) => !MEASUREMENT_HIDDEN_CATEGORIES.includes(category)
  );

  const productTypes = selection.category
    ? Object.keys(productConfig[selection.category] || {})
    : [];
  const models = selection.category && selection.productType
    ? (productConfig[selection.category]?.[selection.productType]?.models || [])
    : [];
  const requiresModelSelection = true;
  const selectedModel = Array.isArray(selection.model) ? (selection.model[0] || '') : (selection.model || '');

  // Glasdach gets multi-select, others get single dropdown
  const isMultiModelSelect = selection.category === 'ÜBERDACHUNG' && selection.productType === 'Glasdach';
  const selectedModels: string[] = Array.isArray(selection.model) ? selection.model : (selection.model ? [selection.model] : []);

  // Multi-select dropdown state
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleModelToggle = (model: string) => {
    const current = [...selectedModels];
    const idx = current.indexOf(model);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(model);
    }
    updateSelection('model', current);
  };

  const handleCategorySelect = (category: string) => {
    updateSelection('category', category);
    updateSelection('productType', '');
    updateSelection('model', []);
  };

  const handleProductTypeSelect = (productType: string) => {
    updateSelection('productType', productType);
    updateSelection('model', []);
  };

  return (
    <div className="product-selection-section">
      <motion.div
        className="section-header"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <h2>Produktauswahl</h2>
        <p className="section-description">Wählen Sie Kategorie, Produkttyp und Modell</p>
      </motion.div>

      {/* Category Selection */}
      <div className="selection-step">
        <h3 className="step-title">1. Kategorie wählen</h3>
        <div className="category-grid">
          {categories.map((category, index) => {
            const isSelected = selection.category === category;

            return (
              <motion.button
                key={category}
                className={`category-card ${isSelected ? 'selected' : ''}`}
                onClick={() => handleCategorySelect(category)}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                <span className="category-name">{category}</span>
                {isSelected && (
                  <motion.div
                    className="check-icon"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500 }}
                  >
                    ✓
                  </motion.div>
                )}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Product Type Selection */}
      {selection.category && (
        <motion.div
          className="selection-step"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h3 className="step-title">2. Produkttyp wählen</h3>
          <div className="product-type-grid">
            {productTypes.map((productType, index) => {
              const isSelected = selection.productType === productType;

              return (
                <motion.button
                  key={productType}
                  className={`product-type-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleProductTypeSelect(productType)}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span className="product-type-name">{productType}</span>
                  {isSelected && (
                    <motion.div
                      className="check-icon-small"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 500 }}
                    >
                      ✓
                    </motion.div>
                  )}
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Model Selection */}
      {selection.productType && requiresModelSelection && models.length > 0 && (
        <motion.div
          className="selection-step"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {isMultiModelSelect ? (
            <>
              <h3 className="step-title">3. Modell wählen <span className="multi-hint">(Mehrfachauswahl möglich)</span></h3>
              <div className="model-dropdown-container" ref={dropdownRef}>
                <div
                  className={`model-dropdown-trigger ${isModelDropdownOpen ? 'open' : ''}`}
                  onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                >
                  <span className="model-dropdown-placeholder">
                    {selectedModels.length === 0
                      ? 'Bitte Modell(e) wählen...'
                      : selectedModels.join(', ')}
                  </span>
                  <span className={`model-dropdown-arrow ${isModelDropdownOpen ? 'open' : ''}`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="6,9 12,15 18,9" />
                    </svg>
                  </span>
                </div>
                <AnimatePresence>
                  {isModelDropdownOpen && (
                    <motion.div
                      className="model-dropdown-menu"
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                    >
                      {models.map((model) => {
                        const isSelected = selectedModels.includes(model);
                        return (
                          <div
                            key={model}
                            className={`model-dropdown-item ${isSelected ? 'selected' : ''}`}
                            onClick={() => handleModelToggle(model)}
                          >
                            <span className={`model-dropdown-checkbox ${isSelected ? 'checked' : ''}`}>
                              {isSelected && '✓'}
                            </span>
                            <span className="model-dropdown-label">{model}</span>
                          </div>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          ) : (
            <>
              <h3 className="step-title">3. Modell wählen</h3>
              <select
                className="model-select"
                value={selectedModel}
                onChange={(e) => updateSelection('model', e.target.value)}
              >
                <option value="">Bitte Modell wählen...</option>
                {models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </>
          )}
        </motion.div>
      )}

      {/* Selection Summary */}
      {selection.category && selection.productType && (!requiresModelSelection || (isMultiModelSelect ? selectedModels.length > 0 : !!selectedModel)) && (
        <motion.div
          className="selection-summary"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <h4>Ihre Auswahl:</h4>
          <div className="summary-details">
            <div className="summary-item">
              <span className="summary-label">Kategorie:</span>
              <span className="summary-value">{selection.category}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Produkttyp:</span>
              <span className="summary-value">{selection.productType}</span>
            </div>
            {requiresModelSelection && (
              <div className="summary-item">
                <span className="summary-label">Modell:</span>
                <span className="summary-value">{isMultiModelSelect ? selectedModels.join(', ') : selectedModel}</span>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default ProductSelectionSection;
