import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, saveLeadPdf, saveAngebotPdf, getForm, getImageUrl, lookupLeadProductBySize } from '../services/api';
import type { FormData as AufmassFormData } from '../services/api';
import { generateAngebotPDF } from '../utils/angebotPdfGenerator';
import { getSizeProfileForType, PROFILE_AXES, extractSizeValues, parseModelList, type SizeProfile } from '../utils/sizeProfile';
import { MARKETING_SOURCES } from '../utils/marketingSources';
import './LeadFormModal.css';

interface AngebotData {
  id: number;
  angebot_nummer?: string;
  subtotal?: number;
  total_discount?: number;
  total_price: number;
  notes?: string;
  items: EditLeadItem[];
  extras: { description: string; price: number }[];
}

interface EditLeadItem {
  product_name: string;
  breite: number;
  tiefe: number;
  quantity: number;
  unit_price: number;
  discount?: number;
  total_price: number;
  pricing_type?: 'dimension' | 'unit';
  unit_label?: string;
  custom_field_values?: string | Record<string, string>;
}

interface EditLeadData {
  id: number;
  customer_firstname: string;
  customer_lastname: string;
  customer_email: string;
  customer_phone?: string;
  customer_address?: string;
  marketing_source?: string | null;
  notes?: string;
  subtotal?: number;
  total_discount?: number;
  total_price: number;
  items: EditLeadItem[];
  extras: { description: string; price: number }[];
  angebote?: AngebotData[];
  angebot_nummer?: string;
  kunden_nummer?: string;
}

interface LeadFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  // MODÜL B: onSuccess optionally receives the saved lead id and whether the
  // user ticked "send by e-mail", so the parent can chain the EmailComposer.
  onSuccess: (leadId?: number, sendEmail?: boolean) => void;
  editData?: EditLeadData | null;
  editAngebotId?: number | null;
  newAngebotForLeadId?: number | null;
  // MODÜL B: When set, the modal seeds itself from this Aufmaß form
  // (customer + product + measurements + photos read-only).
  fromAufmassFormId?: number | null;
}

interface ProductDimensions {
  [breite: number]: { tiefe: number; price: number }[];
}

interface CustomField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select';
  unit?: string;
  options?: string[];
  required?: boolean;
}

interface ProductRow {
  id: string;
  product_name: string;
  breite: number | '';
  tiefe: number | '';
  quantity: number;
  price: number;
  discount: number; // Discount in Euro
  dimensions: ProductDimensions;
  pricing_type: 'dimension' | 'unit';
  unit_label?: string;
  description?: string;
  custom_fields?: CustomField[];
  custom_field_values?: Record<string, string>;
  // For rounding display
  roundedBreite?: number;
  roundedTiefe?: number;
  // MODÜL B: when seeded from an Aufmaß, remember the original measurements
  // so we can restore them after the product picker resets the row.
  aufmassBreite?: number;
  aufmassTiefe?: number;
  // MODÜL B v3: N-axis support for non-2D profiles (Markise UNTERGLAS, Keil, etc.)
  // When set, the row uses these instead of breite/tiefe for the lookup call.
  size_profile?: SizeProfile | null;
  size_axes?: string[];
  size_values?: Record<string, number>;
  // Source category/product_type — needed for re-running profile detection
  source_category?: string;
  source_product_type?: string;
  // Last lookup status (drives the "Preis fehlt" / "auf X×Y aufgerundet" badge)
  lookup_status?: 'matched' | 'rounded' | 'price_missing' | 'no_match';
  rounded_to?: Record<string, number>;
}

// MODÜL B v3: All dimensions are in mm (productConfig.json reference).
// Dynamic round-up against the actual grid loaded from /dimensions endpoint —
// works for any custom grid the branch added (3500, 4250 etc), not a hardcoded step.

const findClosestBreiteInGrid = (dimensions: ProductDimensions, requested: number): number | null => {
  const keys = Object.keys(dimensions).map(Number).filter(k => k >= requested).sort((a, b) => a - b);
  return keys.length > 0 ? keys[0] : null;
};

const findClosestTiefeInGrid = (
  tiefes: { tiefe: number; price: number }[],
  requested: number
): { tiefe: number; price: number } | null => {
  const matches = tiefes.filter(t => t.tiefe >= requested).sort((a, b) => a.tiefe - b.tiefe);
  return matches.length > 0 ? matches[0] : null;
};

// Legacy: hardcoded step round (used if dimensions yet to load — fallback only)
const roundBreiteToGrid = (mmValue: number): number => {
  const min = 2000, max = 12000, step = 1000;
  return Math.max(min, Math.min(max, Math.ceil(mmValue / step) * step));
};

const roundTiefeToGrid = (mmValue: number): number => {
  const min = 1500, max = 6000, step = 500;
  return Math.max(min, Math.min(max, Math.ceil(mmValue / step) * step));
};

interface LeadExtra {
  id: string;
  description: string;
  price: number | '';
  assignTo?: string; // 'all' or product row id — only used when einzelAngebote is true
}

const generateId = () => Math.random().toString(36).substr(2, 9);

export default function LeadFormModal({ isOpen, onClose, onSuccess, editData, editAngebotId, newAngebotForLeadId, fromAufmassFormId }: LeadFormModalProps) {
  // Customer info
  const [firstname, setFirstname] = useState('');
  const [lastname, setLastname] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [marketingSource, setMarketingSource] = useState('');
  const [notes, setNotes] = useState('');

  // Products
  const [productNames, setProductNames] = useState<string[]>([]);
  const [productRows, setProductRows] = useState<ProductRow[]>([]);
  const [extras, setExtras] = useState<LeadExtra[]>([]);

  // Discounts
  const [showItemDiscounts, setShowItemDiscounts] = useState(false);
  const [totalDiscount, setTotalDiscount] = useState<number>(0);

  // Einzelangebote (separate quotes per product)
  const [einzelAngebote, setEinzelAngebote] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // MODÜL B — fromAufmass mode state
  const [aufmassData, setAufmassData] = useState<(AufmassFormData & { bilder?: { id: number; file_name: string; file_type: string }[] }) | null>(null);
  const [sendEmailAfterSave, setSendEmailAfterSave] = useState(false);

  const isEditMode = !!editData && !newAngebotForLeadId;
  const isNewAngebotMode = !!newAngebotForLeadId;
  // MODÜL B: fromAufmass features (banner + photos) are available whenever
  // a source Aufmaß id is provided, even in edit mode. The status-bar
  // intercept always passes fromAufmassFormId so the user sees the Aufmaß
  // context regardless of whether the lead already existed.
  const isFromAufmassMode = !isNewAngebotMode && !!fromAufmassFormId;
  // Auto-fill of customer/products/notes only happens when there is NO
  // editData yet — edit mode keeps its own fields.
  const isFromAufmassAutoFill = isFromAufmassMode && !isEditMode;

  // Initialize form
  useEffect(() => {
    if (isOpen) {
      loadProductNames();
      if (isFromAufmassAutoFill && fromAufmassFormId) {
        // MODÜL B fromAufmass mode: pull customer + product hint + photos from
        // the source Aufmaß. Customer fields stay editable. Product picker is
        // left to the user (lead-products taxonomy ≠ Aufmaß category/model)
        // but breite/tiefe and bemerkungen are seeded for convenience.
        loadFromAufmass(fromAufmassFormId);
      } else if (isNewAngebotMode && editData) {
        // New angebot mode: pre-fill customer info (readonly), clear products
        setFirstname(editData.customer_firstname || '');
        setLastname(editData.customer_lastname || '');
        setEmail(editData.customer_email || '');
        setPhone(editData.customer_phone || '');
        setAddress(editData.customer_address || '');
        setMarketingSource(editData.marketing_source || '');
        setNotes('');
        setTotalDiscount(0);
        setProductRows([createEmptyRow()]);
        setExtras([]);
      } else if (editData) {
        // MODÜL B: edit mode opened from the status-bar intercept also gets
        // the source Aufmaß loaded so the banner + photos still render.
        // Doesn't touch firstname/lastname/products — that comes from editData.
        if (fromAufmassFormId) {
          getForm(fromAufmassFormId)
            .then(setAufmassData)
            .catch(err => console.error('Failed to load Aufmaß metadata for edit mode:', err));
        }
        // Populate form with existing data
        setFirstname(editData.customer_firstname || '');
        setLastname(editData.customer_lastname || '');
        setEmail(editData.customer_email || '');
        setPhone(editData.customer_phone || '');
        setAddress(editData.customer_address || '');
        setMarketingSource(editData.marketing_source || '');
        // If editing a specific angebot, use that angebot's data
        const targetAngebot = editAngebotId && editData.angebote
          ? editData.angebote.find(a => a.id === editAngebotId)
          : null;
        const editItems = targetAngebot ? targetAngebot.items : editData.items;
        const editExtras = targetAngebot ? targetAngebot.extras : editData.extras;
        setNotes(targetAngebot ? (targetAngebot.notes || '') : (editData.notes || ''));
        setTotalDiscount(targetAngebot ? (targetAngebot.total_discount || 0) : (editData.total_discount || 0));

        // Load product rows from edit data
        const loadEditRows = async () => {
          const rows: ProductRow[] = [];
          for (const item of editItems) {
            const row = createEmptyRow();
            row.product_name = item.product_name;
            row.quantity = item.quantity;
            row.price = item.unit_price;
            row.discount = item.discount || 0;
            row.pricing_type = item.pricing_type || 'dimension';
            row.unit_label = item.unit_label;
            if (item.pricing_type === 'unit') {
              row.breite = '';
              row.tiefe = '';
            } else {
              row.breite = item.breite || '';
              row.tiefe = item.tiefe || '';
            }
            // Parse custom_field_values
            if (item.custom_field_values) {
              row.custom_field_values = typeof item.custom_field_values === 'string'
                ? JSON.parse(item.custom_field_values)
                : item.custom_field_values;
            }
            // Load dimensions and custom_fields for the product
            try {
              const result = await loadDimensions(item.product_name);
              row.dimensions = result.dimensions || {};
              row.description = result.description;
              row.custom_fields = result.custom_fields;
              if (item.pricing_type === 'unit') {
                row.unit_label = result.unit_label;
              }
            } catch { /* ignore */ }
            rows.push(row);
          }
          setProductRows(rows.length > 0 ? rows : [createEmptyRow()]);
          // Check if any items have discounts
          if (editItems.some(i => (i.discount || 0) > 0)) {
            setShowItemDiscounts(true);
          }
        };
        loadEditRows();

        // Load extras
        if (editExtras && editExtras.length > 0) {
          setExtras(editExtras.map(e => ({
            id: generateId(),
            description: e.description,
            price: e.price
          })));
        } else {
          setExtras([]);
        }
      } else if (productRows.length === 0) {
        setProductRows([createEmptyRow()]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editData, editAngebotId, newAngebotForLeadId, fromAufmassFormId]);

  const createEmptyRow = (): ProductRow => ({
    id: generateId(),
    product_name: '',
    breite: '',
    tiefe: '',
    quantity: 1,
    price: 0,
    discount: 0,
    pricing_type: 'dimension',
    dimensions: {}
  });

  // MODÜL B — Seed the form from a source Aufmaß. Customer fields, notes,
  // and breite/tiefe are copied; product_name and price are left for the user
  // to pick from the lead-products dropdown (different taxonomy upstream).
  const loadFromAufmass = async (formId: number) => {
    try {
      const data = await getForm(formId);
      setAufmassData(data);
      setFirstname(data.kundeVorname || '');
      setLastname(data.kundeNachname || '');
      setEmail(data.kundeEmail || '');
      setPhone(data.kundeTelefon || '');
      setAddress(data.kundenlokation || '');
      setNotes(data.bemerkungen || '');
      setTotalDiscount(0);
      setExtras([]);
      setSendEmailAfterSave(false);

      // MODÜL B v3: Build one row per (product × model) — main product can be
      // multi-select (N models on same dims), weitereProdukte are single-select
      // (each has its own dims/model).
      type AufmassEntry = {
        category?: string;
        productType?: string;
        modelName: string;
        specifications: Record<string, unknown>;
      };
      const entries: AufmassEntry[] = [];

      const mainSpecs = (data.specifications || {}) as Record<string, unknown>;
      const mainModels = parseModelList(data.model);
      if (mainModels.length === 0) {
        // No model selected — push a single empty row so the user can pick manually
        entries.push({
          category: data.category,
          productType: data.productType,
          modelName: '',
          specifications: mainSpecs,
        });
      } else {
        for (const m of mainModels) {
          entries.push({
            category: data.category,
            productType: data.productType,
            modelName: m,
            specifications: mainSpecs,
          });
        }
      }

      // weitereProdukte — single-select model each, own specifications
      if (Array.isArray(data.weitereProdukte)) {
        for (const wp of data.weitereProdukte) {
          const wpSpecs = (wp.specifications || {}) as Record<string, unknown>;
          const wpModelList = parseModelList(wp.model);
          if (wpModelList.length === 0) {
            entries.push({
              category: wp.category,
              productType: wp.productType,
              modelName: '',
              specifications: wpSpecs,
            });
          } else {
            // Defensive: even if WeitereProdukte UI is single-select today, support multi
            for (const m of wpModelList) {
              entries.push({
                category: wp.category,
                productType: wp.productType,
                modelName: m,
                specifications: wpSpecs,
              });
            }
          }
        }
      }

      // Get available product names — auto-fill skipped if model not in this branch's catalog
      const availableNames = await api.get<string[]>('/lead-products/names').catch(() => [] as string[]);

      const enrichedRows = await Promise.all(entries.map(async (entry) => {
        const r = createEmptyRow();

        // Determine size profile from category/product_type
        const profile = getSizeProfileForType(entry.category, entry.productType);
        const axes = profile ? PROFILE_AXES[profile] : [];
        const sizeValues = profile ? extractSizeValues(entry.specifications, profile) : {};

        r.size_profile = profile;
        r.size_axes = axes;
        r.size_values = sizeValues;
        r.source_category = entry.category;
        r.source_product_type = entry.productType;

        // Legacy 2D fields kept in sync for the existing UI
        // (axes[0] → breite slot, axes[1] → tiefe slot — generic mapping for display)
        if (axes[0] && sizeValues[axes[0]] != null) {
          r.breite = sizeValues[axes[0]];
          r.aufmassBreite = sizeValues[axes[0]];
        }
        if (axes[1] && sizeValues[axes[1]] != null) {
          r.tiefe = sizeValues[axes[1]];
          r.aufmassTiefe = sizeValues[axes[1]];
        }

        if (!entry.modelName || !availableNames.includes(entry.modelName)) {
          // Mark as "no_match" so the badge says "Modell nicht im Katalog"
          if (entry.modelName) r.lookup_status = 'no_match';
          return r;
        }

        r.product_name = entry.modelName;

        // Generic N-axis lookup via the new endpoint (handles all 8 profiles)
        if (Object.keys(sizeValues).length > 0) {
          try {
            const result = await lookupLeadProductBySize(entry.modelName, sizeValues);
            if (result.matched && result.lead_product) {
              const lp = result.lead_product;
              if (lp.price != null && lp.price > 0) {
                r.price = lp.price;
                r.lookup_status = result.exact ? 'matched' : 'rounded';
                if (!result.exact && result.rounded_to) {
                  r.rounded_to = result.rounded_to;
                  // Reflect rounded values in legacy display fields too
                  if (axes[0] && result.rounded_to[axes[0]] != null) r.roundedBreite = result.rounded_to[axes[0]];
                  if (axes[1] && result.rounded_to[axes[1]] != null) r.roundedTiefe = result.rounded_to[axes[1]];
                }
              } else {
                r.lookup_status = 'price_missing';
              }
              // Hydrate description/custom_fields from the legacy /dimensions response
              // (lookup endpoint doesn't return them yet — fetch separately, non-blocking)
              loadDimensions(entry.modelName).then(dims => {
                if (dims.description) r.description = dims.description;
                if (dims.custom_fields) r.custom_fields = dims.custom_fields;
              }).catch(() => { /* ignore */ });
              // Also fill .dimensions for the existing edit UI
              try {
                const dims = await loadDimensions(entry.modelName);
                r.dimensions = dims.dimensions || {};
                r.pricing_type = dims.pricing_type;
                if (dims.pricing_type === 'unit') {
                  r.unit_label = dims.unit_label;
                  if (!r.price && dims.unit_price) r.price = dims.unit_price;
                }
                r.description = dims.description;
                r.custom_fields = dims.custom_fields;
              } catch { /* ignore */ }
            } else {
              r.lookup_status = 'no_match';
            }
          } catch (e) {
            console.warn('Generic lookup failed for', entry.modelName, e);
            r.lookup_status = 'no_match';
          }
        }

        return r;
      }));

      setProductRows(enrichedRows.length > 0 ? enrichedRows : [createEmptyRow()]);
    } catch (err) {
      console.error('Failed to load Aufmaß for auto-fill:', err);
      setError('Aufmaß-Daten konnten nicht geladen werden.');
    }
  };

  // MODÜL B — Photos from the source Aufmaß, image-typed only (PDFs filtered)
  const aufmassImages = (aufmassData?.bilder || []).filter(b =>
    (b.file_type || '').startsWith('image/')
  );

  const loadProductNames = async () => {
    try {
      const data = await api.get<string[]>('/lead-products/names');
      setProductNames(data);
    } catch (err) {
      console.error('Failed to load products:', err);
    }
  };

  const loadDimensions = async (productName: string): Promise<{ pricing_type: 'dimension' | 'unit'; dimensions?: ProductDimensions; unit_label?: string; unit_price?: number; description?: string; custom_fields?: CustomField[] }> => {
    try {
      const data = await api.get<Record<string, unknown>>(`/lead-products/${encodeURIComponent(productName)}/dimensions`);
      const custom_fields = data.custom_fields as CustomField[] | undefined;
      if (data.pricing_type === 'unit') {
        return { pricing_type: 'unit', unit_label: data.unit_label as string, unit_price: data.unit_price as number, description: data.description as string | undefined, custom_fields };
      }
      return { pricing_type: 'dimension', dimensions: (data.dimensions as ProductDimensions) || data as unknown as ProductDimensions, description: data.description as string | undefined, custom_fields };
    } catch (err) {
      console.error('Failed to load dimensions:', err);
      return { pricing_type: 'dimension', dimensions: {} };
    }
  };

  const updateRow = useCallback(async (rowId: string, field: string, value: string | number) => {
    setProductRows(prev => prev.map(row => {
      if (row.id !== rowId) return row;

      const updated = { ...row, [field]: value };

      // Reset dependent fields
      if (field === 'product_name') {
        updated.breite = '';
        updated.tiefe = '';
        updated.price = 0;
        updated.dimensions = {};
        updated.pricing_type = 'dimension';
        updated.unit_label = undefined;
        updated.roundedBreite = undefined;
        updated.roundedTiefe = undefined;
        // Load dimensions for new product
        if (value) {
          loadDimensions(value as string).then(result => {
            setProductRows(prev => prev.map(r => {
              if (r.id !== rowId) return r;
              if (result.pricing_type === 'unit') {
                return { ...r, pricing_type: 'unit', unit_label: result.unit_label, price: result.unit_price || 0, dimensions: {}, description: result.description, custom_fields: result.custom_fields, custom_field_values: {} };
              }
              const dims = result.dimensions || {};
              const next: ProductRow = { ...r, pricing_type: 'dimension', dimensions: dims, description: result.description, custom_fields: result.custom_fields, custom_field_values: {} };
              // MODÜL B: if this row was seeded from an Aufmaß, restore the
              // original measurements after the product picker reset and
              // compute the price from the freshly loaded dimension matrix.
              if (r.aufmassBreite && r.aufmassTiefe && Object.keys(dims).length > 0) {
                next.breite = r.aufmassBreite;
                next.tiefe = r.aufmassTiefe;
                const rb = roundBreiteToGrid(r.aufmassBreite);
                const rt = roundTiefeToGrid(r.aufmassTiefe);
                next.roundedBreite = rb;
                next.roundedTiefe = rt;
                const breiteKey = Object.keys(dims).find(b => Number(b) === rb);
                if (breiteKey) {
                  const found = dims[Number(breiteKey)].find(d => d.tiefe === rt);
                  next.price = found?.price || 0;
                }
              }
              return next;
            }));
          });
        }
      } else if (field === 'breite' || field === 'tiefe') {
        const breiteValue = field === 'breite' ? (value as number) : (updated.breite as number);
        const tiefeValue = field === 'tiefe' ? (value as number) : (updated.tiefe as number);

        if (breiteValue && tiefeValue && Object.keys(updated.dimensions).length > 0) {
          // Dynamic round-up against actual grid keys (handles custom branch grids)
          const rb = findClosestBreiteInGrid(updated.dimensions, breiteValue);
          if (rb !== null) {
            const rtMatch = findClosestTiefeInGrid(updated.dimensions[rb], tiefeValue);
            if (rtMatch) {
              updated.roundedBreite = rb;
              updated.roundedTiefe = rtMatch.tiefe;
              updated.price = rtMatch.price;
            } else {
              // Tiefe out of grid: leave price 0, mark only breite-rounded
              updated.roundedBreite = rb;
              updated.roundedTiefe = undefined;
              updated.price = 0;
            }
          } else {
            // Beyond grid max: no rounding possible
            updated.roundedBreite = undefined;
            updated.roundedTiefe = undefined;
            updated.price = 0;
          }
        } else {
          updated.price = 0;
          updated.roundedBreite = undefined;
          updated.roundedTiefe = undefined;
        }
      }

      return updated;
    }));
  }, []);

  const addProductRow = () => {
    setProductRows(prev => [...prev, createEmptyRow()]);
  };

  const removeProductRow = (rowId: string) => {
    setProductRows(prev => {
      const filtered = prev.filter(r => r.id !== rowId);
      // Always keep at least one row
      return filtered.length === 0 ? [createEmptyRow()] : filtered;
    });
  };

  const updateCustomFieldValue = (rowId: string, fieldId: string, value: string) => {
    setProductRows(prev => prev.map(r =>
      r.id === rowId ? { ...r, custom_field_values: { ...(r.custom_field_values || {}), [fieldId]: value } } : r
    ));
  };

  const updateRowDiscount = (rowId: string, discount: number) => {
    setProductRows(prev => prev.map(r =>
      r.id === rowId ? { ...r, discount: Math.max(0, discount) } : r
    ));
  };

  const addExtra = () => {
    setExtras(prev => [...prev, { id: generateId(), description: '', price: '' }]);
  };

  const updateExtra = (id: string, field: 'description' | 'price', value: string | number) => {
    setExtras(prev => prev.map(e =>
      e.id === id ? { ...e, [field]: value } : e
    ));
  };

  const removeExtra = (id: string) => {
    setExtras(prev => prev.filter(e => e.id !== id));
  };

  // Calculate subtotal (before discounts)
  const calculateSubtotal = () => {
    const productsTotal = productRows
      .filter(r => r.price > 0)
      .reduce((sum, r) => sum + (r.price * r.quantity), 0);
    const extrasTotal = extras
      .filter(e => e.price)
      .reduce((sum, e) => sum + Number(e.price), 0);
    return productsTotal + extrasTotal;
  };

  // Calculate total item discounts
  const calculateItemDiscounts = () => {
    return productRows
      .filter(r => r.discount > 0)
      .reduce((sum, r) => sum + r.discount, 0);
  };

  // Calculate total (after all discounts)
  const calculateTotal = () => {
    const subtotal = calculateSubtotal();
    const itemDiscounts = calculateItemDiscounts();
    const totalDisc = totalDiscount || 0;
    return Math.max(0, subtotal - itemDiscounts - totalDisc);
  };

  // Calculate discount percentage for a single row
  const getRowDiscountPercent = (row: ProductRow) => {
    const rowTotal = row.price * row.quantity;
    if (rowTotal <= 0 || row.discount <= 0) return 0;
    return Math.round((row.discount / rowTotal) * 100);
  };

  // Calculate total discount percentage
  const getTotalDiscountPercent = () => {
    const subtotal = calculateSubtotal();
    const allDiscounts = calculateItemDiscounts() + (totalDiscount || 0);
    if (subtotal <= 0 || allDiscounts <= 0) return 0;
    return Math.round((allDiscounts / subtotal) * 100);
  };

  const getValidItems = () => {
    return productRows.filter(r => {
      if (!r.product_name || r.price <= 0) return false;
      if (r.pricing_type === 'unit') return true;
      return r.breite && r.tiefe;
    });
  };

  const getValidExtras = () => {
    return extras.filter(e => e.description.trim() && e.price && Number(e.price) > 0);
  };

  const handleSubmit = async () => {
    if (!firstname.trim() || !lastname.trim()) {
      setError('Vorname und Nachname sind erforderlich');
      return;
    }

    if (!email.trim() || !email.includes('@')) {
      setError('Gültige E-Mail-Adresse erforderlich');
      return;
    }

    const validItems = getValidItems();
    const validExtras = getValidExtras();

    if (validItems.length === 0 && validExtras.length === 0) {
      setError('Mindestens ein Produkt oder eine Zusatzleistung erforderlich');
      return;
    }

    setLoading(true);
    setError('');

    // MODÜL B: id of the lead we just created/updated, used so the parent
    // can chain the EmailComposer when sendEmailAfterSave is true.
    let savedLeadId: number | undefined;

    // Helper to build item payload for a single product row
    const buildItemPayload = (r: ProductRow) => ({
      product_name: r.product_name,
      breite: r.pricing_type === 'unit' ? 0 : r.breite,
      tiefe: r.pricing_type === 'unit' ? 0 : r.tiefe,
      quantity: r.quantity,
      unit_price: r.price,
      discount: r.discount || 0,
      pricing_type: r.pricing_type,
      unit_label: r.unit_label || null,
      custom_field_values: r.custom_field_values && Object.keys(r.custom_field_values).length > 0 ? r.custom_field_values : null
    });

    // Helper to build PDF item for a single product row
    const buildPdfItem = (r: ProductRow) => ({
      product_name: r.product_name,
      breite: r.pricing_type === 'unit' ? 0 : (r.breite as number),
      tiefe: r.pricing_type === 'unit' ? 0 : (r.tiefe as number),
      quantity: r.quantity,
      unit_price: r.price,
      discount: r.discount || 0,
      discount_percent: getRowDiscountPercent(r),
      total_price: (r.price * r.quantity) - (r.discount || 0),
      pricing_type: r.pricing_type,
      unit_label: r.unit_label || undefined,
      description: r.description || undefined,
      custom_fields: r.custom_fields || undefined,
      custom_field_values: r.custom_field_values && Object.keys(r.custom_field_values).length > 0 ? r.custom_field_values : undefined
    });

    const customerBase = {
      customer_firstname: firstname.trim(),
      customer_lastname: lastname.trim(),
      customer_email: email.trim(),
      customer_phone: phone.trim() || null,
      customer_address: address.trim() || null,
      marketing_source: marketingSource || null,
      notes: notes.trim() || null,
    };

    try {
      if (einzelAngebote && !isEditMode) {
        // === EINZELANGEBOTE MODE: Each product becomes a separate lead ===
        for (const item of validItems) {
          // Find extras assigned to this item or to 'all'
          const itemExtras = validExtras.filter(e => {
            const assign = e.assignTo || 'all';
            return assign === 'all' || assign === item.id;
          });

          const itemTotal = (item.price * item.quantity) - (item.discount || 0);
          const extrasTotal = itemExtras.reduce((s, e) => s + Number(e.price), 0);

          const payload = {
            ...customerBase,
            items: [buildItemPayload(item)],
            extras: itemExtras.map(e => ({ description: e.description.trim(), price: Number(e.price) })),
            total_discount: 0,
            subtotal: itemTotal + extrasTotal,
            total_price: itemTotal + extrasTotal
          };

          const result = await api.post<{ id: number }>('/leads', payload);

          // Generate PDF in background — modal kapanmasini bloklamasin
          // (multi-product cover + AGB merge dakikalar surebilir).
          const einzelLeadId = result.id;
          const einzelPdfPayload = {
            customer_firstname: firstname.trim(),
            customer_lastname: lastname.trim(),
            customer_email: email.trim(),
            customer_phone: phone.trim() || undefined,
            customer_address: address.trim() || undefined,
            notes: notes.trim() || undefined,
            items: [buildPdfItem(item)],
            extras: itemExtras.map(e => ({ description: e.description.trim(), price: Number(e.price) })),
            subtotal: itemTotal + extrasTotal,
            item_discounts: item.discount || 0,
            total_discount: 0,
            total_discount_percent: 0,
            total_price: itemTotal + extrasTotal
          };
          void (async () => {
            try {
              const pdfResult = await generateAngebotPDF(einzelPdfPayload, { returnBlob: true });
              if (pdfResult?.blob) await saveLeadPdf(einzelLeadId, pdfResult.blob);
            } catch (pdfErr) {
              console.error('Einzelangebot PDF failed:', pdfErr);
            }
          })();
        }
        // einzelAngebote may have created several leads; we don't pick a
        // single id to chain the EmailComposer in this mode (would be
        // ambiguous). savedLeadId stays undefined → no auto-send.
      } else if (isNewAngebotMode && newAngebotForLeadId) {
        savedLeadId = newAngebotForLeadId;
        // === NEW ANGEBOT MODE: Add angebot to existing lead ===
        const angebotPayload = {
          items: validItems.map(buildItemPayload),
          extras: validExtras.map(e => ({ description: e.description.trim(), price: Number(e.price) })),
          notes: notes.trim() || null,
          total_discount: totalDiscount || 0,
          subtotal: calculateSubtotal(),
          total_price: calculateTotal()
        };

        const result = await api.post<{ id: number; angebot_nummer: string }>(`/leads/${newAngebotForLeadId}/angebote`, angebotPayload);

        // Generate and save PDF in background — modal kapanmasini bloklamasin
        const newAngLeadId = newAngebotForLeadId;
        const newAngId = result.id;
        const newAngebotNummer = result.angebot_nummer;
        const newAngPdfPayload = {
          customer_firstname: firstname.trim(),
          customer_lastname: lastname.trim(),
          customer_email: email.trim(),
          customer_phone: phone.trim() || undefined,
          customer_address: address.trim() || undefined,
          notes: notes.trim() || undefined,
          kunden_nummer: editData?.kunden_nummer || undefined,
          angebot_nummer: newAngebotNummer || undefined,
          items: validItems.map(buildPdfItem),
          extras: validExtras.map(e => ({ description: e.description.trim(), price: Number(e.price) })),
          subtotal: calculateSubtotal(),
          item_discounts: calculateItemDiscounts(),
          total_discount: totalDiscount || 0,
          total_discount_percent: getTotalDiscountPercent(),
          total_price: calculateTotal()
        };
        void (async () => {
          try {
            const pdfResult = await generateAngebotPDF(newAngPdfPayload, { returnBlob: true });
            if (pdfResult?.blob) await saveAngebotPdf(newAngLeadId, newAngId, pdfResult.blob);
          } catch (pdfErr) {
            console.error('Angebot PDF generation failed:', pdfErr);
          }
        })();
      } else {
        // === NORMAL MODE: Single lead with all products ===
        const payload = {
          ...customerBase,
          items: validItems.map(buildItemPayload),
          extras: validExtras.map(e => ({ description: e.description.trim(), price: Number(e.price) })),
          total_discount: totalDiscount || 0,
          subtotal: calculateSubtotal(),
          total_price: calculateTotal(),
          ...(editAngebotId ? { angebot_id: editAngebotId } : {}),
          // MODÜL B: link the new lead back to the source Aufmaß so the
          // bidirectional sync (status / angebot_sent_at) can reach it.
          ...(isFromAufmassMode && fromAufmassFormId ? { aufmass_form_id: fromAufmassFormId } : {})
        };

        const result = isEditMode
          ? await api.put<{ id: number; angebot_nummer?: string; kunden_nummer?: string }>(`/leads/${editData!.id}`, payload)
          : await api.post<{ id: number; angebot_nummer?: string; kunden_nummer?: string }>('/leads', payload);
        const leadId = isEditMode ? editData!.id : result.id;
        savedLeadId = leadId;
        const resAngebotNummer = (result as { angebot_nummer?: string }).angebot_nummer || editData?.angebot_nummer;
        const resKundenNummer = (result as { kunden_nummer?: string }).kunden_nummer || editData?.kunden_nummer;

        // Generate and save Angebot PDF in background — modal kapanmasini bloklamasin
        const normalLeadId = leadId;
        const normalAngebotId = editAngebotId;
        const normalPdfPayload = {
          customer_firstname: firstname.trim(),
          customer_lastname: lastname.trim(),
          customer_email: email.trim(),
          customer_phone: phone.trim() || undefined,
          customer_address: address.trim() || undefined,
          notes: notes.trim() || undefined,
          kunden_nummer: resKundenNummer || undefined,
          angebot_nummer: resAngebotNummer || undefined,
          items: validItems.map(buildPdfItem),
          extras: validExtras.map(e => ({ description: e.description.trim(), price: Number(e.price) })),
          subtotal: calculateSubtotal(),
          item_discounts: calculateItemDiscounts(),
          total_discount: totalDiscount || 0,
          total_discount_percent: getTotalDiscountPercent(),
          total_price: calculateTotal(),
          // MODÜL B: forward Aufmaß photos so the generator can embed them.
          // Empty for non-fromAufmass modes — keeps prior behavior intact.
          bilder: isFromAufmassMode ? aufmassImages : undefined
        };
        void (async () => {
          try {
            const pdfResult = await generateAngebotPDF(normalPdfPayload, { returnBlob: true });
            if (!pdfResult?.blob) return;
            if (normalAngebotId) {
              const { saveAngebotPdf } = await import('../services/api');
              await saveAngebotPdf(normalLeadId, normalAngebotId, pdfResult.blob);
            } else {
              await saveLeadPdf(normalLeadId, pdfResult.blob);
            }
          } catch (pdfErr) {
            console.error('Angebot PDF generation failed:', pdfErr);
          }
        })();
      }

      // MODÜL B: pass savedLeadId + sendEmailAfterSave so the parent can
      // auto-open EmailComposer for the freshly saved lead.
      onSuccess(savedLeadId, sendEmailAfterSave);
      resetForm();
      onClose();
    } catch (err) {
      setError(isEditMode ? 'Fehler beim Aktualisieren des Angebots' : 'Fehler beim Erstellen des Angebots');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFirstname('');
    setLastname('');
    setEmail('');
    setPhone('');
    setAddress('');
    setNotes('');
    setProductRows([createEmptyRow()]);
    setExtras([]);
    setTotalDiscount(0);
    setEinzelAngebote(false);
    setError('');
    setAufmassData(null);
    setSendEmailAfterSave(false);
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(price);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="lead-modal-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="lead-modal"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={e => e.stopPropagation()}
        >
          <div className="lead-modal-header">
            <h2>
              {isFromAufmassMode
                ? `Angebot aus Aufmaß #${fromAufmassFormId}`
                : isNewAngebotMode
                  ? 'Weiteres Angebot hinzufügen'
                  : isEditMode
                    ? 'Angebot bearbeiten'
                    : 'Neues Angebot erstellen'}
            </h2>
            <button className="close-btn" onClick={onClose}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="lead-modal-body">
            {error && <div className="lead-error">{error}</div>}

            {isFromAufmassMode && aufmassData && (
              <div className="from-aufmass-banner">
                <strong>Aus Aufmaß #{fromAufmassFormId}:</strong>{' '}
                {[aufmassData.category, aufmassData.productType, aufmassData.model].filter(Boolean).join(' / ')}
                {aufmassData.kundenlokation ? ` — ${aufmassData.kundenlokation}` : ''}
                <div className="from-aufmass-banner-hint">
                  Kunde, Maße und Bilder wurden vorausgefüllt. Bitte das passende Produkt aus der Liste wählen und den Preis erfassen.
                </div>
              </div>
            )}

            {/* Customer Info Section */}
            <section className="lead-section">
              <h3>Kundendaten {isNewAngebotMode && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 400 }}>(schreibgeschützt)</span>}</h3>
              <div className="lead-form-grid">
                <div className="form-group">
                  <label>Vorname *</label>
                  <input
                    type="text"
                    value={firstname}
                    onChange={e => setFirstname(e.target.value)}
                    placeholder="Vorname"
                    readOnly={isNewAngebotMode}
                    style={isNewAngebotMode ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                  />
                </div>
                <div className="form-group">
                  <label>Nachname *</label>
                  <input
                    type="text"
                    value={lastname}
                    onChange={e => setLastname(e.target.value)}
                    placeholder="Nachname"
                    readOnly={isNewAngebotMode}
                    style={isNewAngebotMode ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                  />
                </div>
                <div className="form-group">
                  <label>E-Mail *</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="email@beispiel.de"
                    required
                    readOnly={isNewAngebotMode}
                    style={isNewAngebotMode ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                  />
                </div>
                <div className="form-group">
                  <label>Telefon</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+49 123 456789"
                    readOnly={isNewAngebotMode}
                    style={isNewAngebotMode ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                  />
                </div>
                <div className="form-group full-width">
                  <label>Adresse</label>
                  <input
                    type="text"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="Straße, PLZ, Ort"
                    readOnly={isNewAngebotMode}
                    style={isNewAngebotMode ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                  />
                </div>
                <div className="form-group full-width">
                  <label>Wie sind Sie auf uns aufmerksam geworden?</label>
                  <select
                    value={marketingSource}
                    onChange={e => setMarketingSource(e.target.value)}
                    disabled={isNewAngebotMode}
                    style={isNewAngebotMode ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                  >
                    <option value="">Bitte auswählen...</option>
                    {MARKETING_SOURCES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            {/* Products Section */}
            <section className="lead-section">
              <h3>Produkte</h3>

              <div className="product-rows">
                {productRows.map((row, index) => (
                  <div key={row.id} className="product-row-card">
                    <div className="product-row-header">
                      <span className="lead-product-number">Produkt {index + 1}</span>
                      {productRows.length > 1 && (
                        <button className="btn-remove-row" onClick={() => removeProductRow(row.id)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>

                    <div className="product-row-selects">
                      <div className="select-group">
                        <label>Produkt</label>
                        <select
                          value={row.product_name}
                          onChange={e => updateRow(row.id, 'product_name', e.target.value)}
                        >
                          <option value="">Produkt wählen...</option>
                          {productNames.map(name => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                      </div>

                      {row.pricing_type === 'unit' ? (
                        <div className="select-group quantity-group">
                          <label>Menge{row.unit_label ? ` (${row.unit_label})` : ''}</label>
                          <input
                            type="number"
                            min="1"
                            value={row.quantity}
                            onChange={e => updateRow(row.id, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                          />
                        </div>
                      ) : (
                        <>
                          <div className="select-group">
                            <label>Breite (mm)</label>
                            <input
                              type="number"
                              min="1"
                              max="12000"
                              value={row.breite}
                              onChange={e => updateRow(row.id, 'breite', e.target.value ? Number(e.target.value) : '')}
                              disabled={!row.product_name}
                              placeholder="z.B. 4850"
                              className="dimension-input"
                            />
                          </div>

                          <div className="select-group">
                            <label>Tiefe (mm)</label>
                            <input
                              type="number"
                              min="1"
                              max="6000"
                              value={row.tiefe}
                              onChange={e => updateRow(row.id, 'tiefe', e.target.value ? Number(e.target.value) : '')}
                              disabled={!row.product_name}
                              placeholder="z.B. 2870"
                              className="dimension-input"
                            />
                          </div>

                          <div className="select-group quantity-group">
                            <label>Menge</label>
                            <input
                              type="number"
                              min="1"
                              value={row.quantity}
                              onChange={e => updateRow(row.id, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                              disabled={!row.price}
                            />
                          </div>
                        </>
                      )}
                    </div>

                    {row.price > 0 && (
                      <div className="product-row-price-section">
                        <div className="product-row-price">
                          <div className="price-breakdown">
                            {row.pricing_type === 'unit' ? (
                              <>
                                <span className="price-dims">{formatPrice(row.price)}{row.unit_label ? ` / ${row.unit_label}` : ''}</span>
                                {row.quantity > 1 && <span className="price-qty">x {row.quantity}</span>}
                              </>
                            ) : (
                              <>
                                <span className="price-dims">{row.breite} x {row.tiefe} cm</span>
                                {(row.roundedBreite !== row.breite || row.roundedTiefe !== row.tiefe) && (
                                  <span className="price-rounded">→ Preis für {row.roundedBreite} x {row.roundedTiefe} cm</span>
                                )}
                                {row.quantity > 1 && <span className="price-qty">x {row.quantity}</span>}
                              </>
                            )}
                          </div>
                          <span className="price-value">{formatPrice(row.price * row.quantity)}</span>
                        </div>

                        {/* Discount input for this product - only show when enabled */}
                        {showItemDiscounts && (
                          <div className="product-discount-row">
                            <label>Rabatt (€)</label>
                            <div className="discount-input-wrapper">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={row.discount || ''}
                                onChange={e => updateRowDiscount(row.id, parseFloat(e.target.value) || 0)}
                                placeholder="0"
                                className="discount-input"
                              />
                              {row.discount > 0 && (
                                <span className="discount-percent">-{getRowDiscountPercent(row)}%</span>
                              )}
                            </div>
                            {row.discount > 0 && (
                              <span className="price-after-discount">
                                → {formatPrice((row.price * row.quantity) - row.discount)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {/* No catalog price could be resolved — explain WHY, derived
                        live from the row state (not the stale lookup_status flag,
                        which updateRow never refreshes) so it stays correct after
                        manual edits. Covers three cases the old warning missed:
                        model not in catalog, size not priced, unit price missing. */}
                    {row.product_name && !(row.price > 0) && (
                      row.pricing_type === 'unit' ? (
                        <div className="product-row-warning">
                          Kein Preis im Katalog hinterlegt — bitte in „Produkte &amp; Preise" ergänzen
                        </div>
                      ) : (row.breite && row.tiefe) ? (
                        Object.keys(row.dimensions).length > 0 ? (
                          <div className="product-row-warning">
                            Keine Preisdaten für diese Größe verfügbar
                          </div>
                        ) : (
                          <div className="product-row-warning">
                            Modell nicht im Katalog — bitte in „Produkte &amp; Preise" anlegen
                          </div>
                        )
                      ) : null
                    )}

                    {/* Custom Fields */}
                    {row.custom_fields && row.custom_fields.length > 0 && (
                      <div className="custom-fields-fill">
                        <div className="cf-fill-title">Produktdetails</div>
                        <div className="cf-fill-grid">
                          {row.custom_fields.map(field => (
                            <div key={field.id} className="cf-fill-field">
                              <label>{field.label}{field.required && <span className="cf-required">*</span>}</label>
                              {field.type === 'select' ? (
                                <select
                                  value={(row.custom_field_values || {})[field.id] || ''}
                                  onChange={e => updateCustomFieldValue(row.id, field.id, e.target.value)}
                                >
                                  <option value="">Bitte wählen...</option>
                                  {(field.options || []).map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              ) : field.type === 'text' ? (
                                <textarea
                                  value={(row.custom_field_values || {})[field.id] || ''}
                                  onChange={e => updateCustomFieldValue(row.id, field.id, e.target.value)}
                                  placeholder={field.label}
                                  rows={1}
                                />
                              ) : (
                                <div className="cf-input-wrapper">
                                  <input
                                    type="number"
                                    value={(row.custom_field_values || {})[field.id] || ''}
                                    onChange={e => updateCustomFieldValue(row.id, field.id, e.target.value)}
                                    placeholder={field.label}
                                  />
                                  {field.unit && (
                                    <span className="cf-unit">{field.unit}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button type="button" className="btn-add-row" onClick={addProductRow}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Weiteres Produkt hinzufügen
              </button>

              {/* Per-item discount toggle */}
              <label className="discount-toggle-label product-discount-toggle">
                <input
                  type="checkbox"
                  checked={showItemDiscounts}
                  onChange={e => {
                    const enabled = e.target.checked;
                    setShowItemDiscounts(enabled);
                    if (!enabled) {
                      setProductRows(prev => prev.map(r => ({ ...r, discount: 0 })));
                    }
                  }}
                />
                <span>Artikel-Rabatte aktivieren</span>
              </label>

            </section>

            {/* Extras Section */}
            <section className="lead-section">
              <h3>Zusatzleistungen (optional)</h3>

              {extras.length > 0 && (
                <div className="extras-list">
                  {extras.map(extra => (
                    <div key={extra.id} className="extra-row">
                      <input
                        type="text"
                        value={extra.description}
                        onChange={e => updateExtra(extra.id, 'description', e.target.value)}
                        placeholder="Beschreibung (z.B. Montage)"
                        className="extra-desc"
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={extra.price}
                        onChange={e => updateExtra(extra.id, 'price', e.target.value)}
                        placeholder="Preis €"
                        className="extra-price"
                      />
                      {einzelAngebote && (
                        <select
                          className="extra-assign"
                          value={extra.assignTo || 'all'}
                          onChange={e => setExtras(prev => prev.map(ex => ex.id === extra.id ? { ...ex, assignTo: e.target.value } : ex))}
                        >
                          <option value="all">Alle Angebote</option>
                          {productRows.filter(r => r.product_name).map((r, i) => (
                            <option key={r.id} value={r.id}>Produkt {i + 1}: {r.product_name}</option>
                          ))}
                        </select>
                      )}
                      <button className="btn-remove-extra" onClick={() => removeExtra(extra.id)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button type="button" className="btn-add-extra" onClick={addExtra}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Zusatzleistung hinzufügen
              </button>
            </section>

            {/* Beschreibung */}
            <section className="lead-section">
              <h3>Beschreibung</h3>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Beschreibung des Angebots / zusätzliche Bemerkungen..."
                rows={4}
              />
            </section>

            {/* MODÜL B — Photos pulled in from the source Aufmaß. Read-only:
                no upload/remove because the Aufmaß remains the system of
                record for these images. They get embedded in the Angebot PDF
                automatically by the generator. */}
            {isFromAufmassMode && aufmassImages.length > 0 && (
              <section className="lead-section">
                <h3>Fotos vom Aufmaß ({aufmassImages.length})</h3>
                <p className="aufmass-photos-hint">
                  Diese Fotos stammen vom verknüpften Aufmaß und werden im Angebot-PDF eingebettet.
                </p>
                <div className="aufmass-photos-grid">
                  {aufmassImages.map(img => (
                    <a
                      key={img.id}
                      href={getImageUrl(img.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="aufmass-photo-thumb"
                      title={img.file_name}
                    >
                      <img src={getImageUrl(img.id)} alt={img.file_name} loading="lazy" />
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* Pricing Summary */}
            <div className="lead-pricing-summary">
              {/* Subtotal */}
              <div className="pricing-row subtotal-row">
                <span>Zwischensumme:</span>
                <span className="pricing-value">{formatPrice(calculateSubtotal())}</span>
              </div>

              {/* Item discounts (if any) */}
              {showItemDiscounts && calculateItemDiscounts() > 0 && (
                <div className="pricing-row discount-row">
                  <span>Produktrabatte:</span>
                  <span className="pricing-value discount-value">-{formatPrice(calculateItemDiscounts())}</span>
                </div>
              )}

              {/* Total discount input — hidden in Einzelangebote mode */}
              <div className="pricing-row total-discount-row" style={einzelAngebote ? { display: 'none' } : undefined}>
                <div className="total-discount-label">
                  <span>Gesamtrabatt (€):</span>
                  {totalDiscount > 0 && (
                    <span className="total-discount-percent">
                      -{Math.round((totalDiscount / calculateSubtotal()) * 100)}%
                    </span>
                  )}
                </div>
                <div className="total-discount-input-wrapper">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={totalDiscount || ''}
                    onChange={e => setTotalDiscount(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="total-discount-input"
                  />
                </div>
              </div>

              {/* Final Total */}
              <div className="pricing-row total-row">
                <span>Gesamtsumme:</span>
                <div className="total-with-discount">
                  <span className="total-price">{formatPrice(calculateTotal())}</span>
                  {getTotalDiscountPercent() > 0 && (
                    <span className="total-savings">Sie sparen {getTotalDiscountPercent()}%</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="lead-modal-footer">
            {/* MODÜL B Soru-3 (a): when ticked, the parent auto-opens the
                EmailComposer right after save and the eventual e-mail send
                triggers markLeadAngebotAsSent on the lead. Hidden in
                Einzelangebote mode because it can produce multiple leads. */}
            {!einzelAngebote && (
              <label className="send-email-toggle">
                <input
                  type="checkbox"
                  checked={sendEmailAfterSave}
                  onChange={e => setSendEmailAfterSave(e.target.checked)}
                />
                <span>Angebot direkt per E-Mail senden</span>
              </label>
            )}
            <button className="btn-cancel" onClick={onClose}>Abbrechen</button>
            <button className="btn-save" onClick={handleSubmit} disabled={loading}>
              {loading ? 'Speichern...' : (isEditMode ? 'Angebot aktualisieren' : 'Angebot speichern')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
