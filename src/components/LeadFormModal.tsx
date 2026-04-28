import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, saveLeadPdf, saveAngebotPdf, getForm, getImageUrl } from '../services/api';
import type { FormData as AufmassFormData } from '../services/api';
import { generateAngebotPDF } from '../utils/angebotPdfGenerator';
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
}

// Rounding functions for price calculation
const roundBreiteToGrid = (value: number): number => {
  // Breite grid: 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200
  const min = 200;
  const max = 1200;
  const step = 100;
  const rounded = Math.ceil(value / step) * step;
  return Math.max(min, Math.min(max, rounded));
};

const roundTiefeToGrid = (value: number): number => {
  // Tiefe grid: 150, 200, 250, 300, 350, 400, 450, 500, 550, 600
  const min = 150;
  const max = 600;
  const step = 50;
  const rounded = Math.ceil(value / step) * step;
  return Math.max(min, Math.min(max, rounded));
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
  const isFromAufmassMode = !isEditMode && !isNewAngebotMode && !!fromAufmassFormId;

  // Initialize form
  useEffect(() => {
    if (isOpen) {
      loadProductNames();
      if (isFromAufmassMode && fromAufmassFormId) {
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
        setNotes('');
        setTotalDiscount(0);
        setProductRows([createEmptyRow()]);
        setExtras([]);
      } else if (editData) {
        // Populate form with existing data
        setFirstname(editData.customer_firstname || '');
        setLastname(editData.customer_lastname || '');
        setEmail(editData.customer_email || '');
        setPhone(editData.customer_phone || '');
        setAddress(editData.customer_address || '');
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

      // Build one row per product in the Aufmaß (main + weitereProdukte) so
      // the user only needs to pick the matching lead-product entry and the
      // dimensions are already there.
      const aufmassProducts: { breite?: number; tiefe?: number }[] = [];
      const mainSpecs = (data.specifications || {}) as Record<string, unknown>;
      aufmassProducts.push({
        breite: typeof mainSpecs.breite === 'number' ? mainSpecs.breite : undefined,
        tiefe: typeof mainSpecs.tiefe === 'number' ? mainSpecs.tiefe : undefined,
      });
      if (Array.isArray(data.weitereProdukte)) {
        for (const wp of data.weitereProdukte) {
          const specs = (wp.specifications || {}) as Record<string, unknown>;
          aufmassProducts.push({
            breite: typeof specs.breite === 'number' ? specs.breite : undefined,
            tiefe: typeof specs.tiefe === 'number' ? specs.tiefe : undefined,
          });
        }
      }
      const rows = aufmassProducts.map(p => {
        const r = createEmptyRow();
        if (p.breite) {
          r.breite = p.breite;
          r.aufmassBreite = p.breite;
        }
        if (p.tiefe) {
          r.tiefe = p.tiefe;
          r.aufmassTiefe = p.tiefe;
        }
        return r;
      });
      setProductRows(rows.length > 0 ? rows : [createEmptyRow()]);
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
        // Calculate price using rounded values
        const breiteValue = field === 'breite' ? (value as number) : (updated.breite as number);
        const tiefeValue = field === 'tiefe' ? (value as number) : (updated.tiefe as number);

        if (breiteValue && tiefeValue && Object.keys(updated.dimensions).length > 0) {
          // Round values for price lookup
          const roundedBreite = roundBreiteToGrid(breiteValue);
          const roundedTiefe = roundTiefeToGrid(tiefeValue);

          updated.roundedBreite = roundedBreite;
          updated.roundedTiefe = roundedTiefe;

          // Find price from dimensions matrix using rounded values
          const breiteKey = Object.keys(updated.dimensions).find(b => Number(b) === roundedBreite);
          if (breiteKey && updated.dimensions[Number(breiteKey)]) {
            const found = updated.dimensions[Number(breiteKey)].find(d => d.tiefe === roundedTiefe);
            updated.price = found?.price || 0;
          } else {
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

          // Generate PDF for this single-item lead
          try {
            const pdfResult = await generateAngebotPDF({
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
            }, { returnBlob: true });

            if (pdfResult?.blob) {
              await saveLeadPdf(result.id, pdfResult.blob);
            }
          } catch (pdfErr) {
            console.error('Einzelangebot PDF failed:', pdfErr);
          }
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

        // Generate and save PDF for this angebot
        try {
          const itemDiscountsTotal = calculateItemDiscounts();
          const pdfResult = await generateAngebotPDF({
            customer_firstname: firstname.trim(),
            customer_lastname: lastname.trim(),
            customer_email: email.trim(),
            customer_phone: phone.trim() || undefined,
            customer_address: address.trim() || undefined,
            notes: notes.trim() || undefined,
            kunden_nummer: editData?.kunden_nummer || undefined,
            angebot_nummer: result.angebot_nummer || undefined,
            items: validItems.map(buildPdfItem),
            extras: validExtras.map(e => ({ description: e.description.trim(), price: Number(e.price) })),
            subtotal: calculateSubtotal(),
            item_discounts: itemDiscountsTotal,
            total_discount: totalDiscount || 0,
            total_discount_percent: getTotalDiscountPercent(),
            total_price: calculateTotal()
          }, { returnBlob: true });

          if (pdfResult?.blob) {
            await saveAngebotPdf(newAngebotForLeadId, result.id, pdfResult.blob);
          }
        } catch (pdfErr) {
          console.error('Angebot PDF generation failed:', pdfErr);
        }
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

        // Generate and save Angebot PDF
        try {
          const itemDiscountsTotal = calculateItemDiscounts();
          const pdfResult = await generateAngebotPDF({
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
            item_discounts: itemDiscountsTotal,
            total_discount: totalDiscount || 0,
            total_discount_percent: getTotalDiscountPercent(),
            total_price: calculateTotal()
          }, { returnBlob: true });

          if (pdfResult?.blob) {
            if (editAngebotId) {
              const { saveAngebotPdf } = await import('../services/api');
              await saveAngebotPdf(leadId, editAngebotId, pdfResult.blob);
            } else {
              await saveLeadPdf(leadId, pdfResult.blob);
            }
          }
        } catch (pdfErr) {
          console.error('Angebot PDF generation failed:', pdfErr);
        }
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
                            <label>Breite (cm)</label>
                            <input
                              type="number"
                              min="1"
                              max="1200"
                              value={row.breite}
                              onChange={e => updateRow(row.id, 'breite', e.target.value ? Number(e.target.value) : '')}
                              disabled={!row.product_name}
                              placeholder="z.B. 485"
                              className="dimension-input"
                            />
                          </div>

                          <div className="select-group">
                            <label>Tiefe (cm)</label>
                            <input
                              type="number"
                              min="1"
                              max="600"
                              value={row.tiefe}
                              onChange={e => updateRow(row.id, 'tiefe', e.target.value ? Number(e.target.value) : '')}
                              disabled={!row.product_name}
                              placeholder="z.B. 287"
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
                    {row.pricing_type !== 'unit' && row.breite && row.tiefe && row.price === 0 && Object.keys(row.dimensions).length > 0 && (
                      <div className="product-row-warning">
                        Keine Preisdaten für diese Größe verfügbar
                      </div>
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
