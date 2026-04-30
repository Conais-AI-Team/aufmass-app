import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  api, getProductImages, uploadProductImage, deleteProductImage, setProductImageCoverFlag,
  getProductCoverPdf, uploadProductCoverPdf, setCoverPdfPages, deleteProductCoverPdf,
  fetchBranchPdfBytes
} from '../services/api';
import type { ProductImage, ProductCoverPdf } from '../services/api';
import { invalidateProductImagesCache } from '../utils/productImagesCache';
import { PdfThumbnailGrid } from '../components/PdfThumbnailGrid';
import productConfigData from '../config/productConfig.json';
import type { ProductConfig } from '../types/productConfig';
import './ProductPricing.css';
import '../components/PdfThumbnailGrid.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const productConfig = productConfigData as ProductConfig;

interface CustomField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select';
  unit?: string;
  options?: string[];
  required?: boolean;
}

interface Product {
  id: number;
  product_name: string;
  breite: number;
  tiefe: number;
  price: number;
  category?: string;
  product_type?: string;
  branch_id: string | null;
  pricing_type?: 'dimension' | 'unit';
  unit_label?: string;
  description?: string;
  custom_fields?: string;
}

interface PendingColumn {
  breite: number;
  prices: Record<number, string>; // tiefe -> price
}

interface PendingRow {
  tiefe: number;
  prices: Record<number, string>; // breite -> price
}

export default function ProductPricing() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Filter state
  const [filterCategory, setFilterCategory] = useState('');
  const [filterProductType, setFilterProductType] = useState('');
  const [filterModel, setFilterModel] = useState('');

  // Expanded accordions
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  // Edit state for existing cells
  const [editingCell, setEditingCell] = useState<{ productName: string; breite: number; tiefe: number } | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  // Pending new columns/rows per product (inline editing, no modal)
  const [pendingColumns, setPendingColumns] = useState<Record<string, PendingColumn[]>>({});
  const [pendingRows, setPendingRows] = useState<Record<string, PendingRow[]>>({});

  // New product modal state
  const [newProductModalOpen, setNewProductModalOpen] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductCategory, setNewProductCategory] = useState('');
  const [newProductType, setNewProductType] = useState('');
  const [newProductEntries, setNewProductEntries] = useState<{ breite: string; tiefe: string; price: string }[]>([
    { breite: '', tiefe: '', price: '' }
  ]);
  const [newProductPricingType, setNewProductPricingType] = useState<'dimension' | 'unit'>('dimension');
  const [newProductUnitLabel, setNewProductUnitLabel] = useState('');
  const [newProductDescription, setNewProductDescription] = useState('');
  const [newProductUnitPrice, setNewProductUnitPrice] = useState('');

  // Custom input mode for each dropdown
  const [customCategoryMode, setCustomCategoryMode] = useState(false);
  const [customProductTypeMode, setCustomProductTypeMode] = useState(false);
  const [customModelMode, setCustomModelMode] = useState(false);

  // Inline add price for empty cells (cells with "-")
  const [addingPrice, setAddingPrice] = useState<{ productName: string; breite: number; tiefe: number } | null>(null);
  const [addingPriceValue, setAddingPriceValue] = useState('');

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'product' | 'row' | 'column'; productName: string; value?: number } | null>(null);

  // Description editing for existing products
  const [editingDescription, setEditingDescription] = useState<string | null>(null);
  const [editDescriptionValue, setEditDescriptionValue] = useState('');

  // Product images per product_id
  const [productImages, setProductImages] = useState<Record<number, ProductImage[]>>({});
  const [imageUploadingFor, setImageUploadingFor] = useState<number | null>(null);

  // Cover-PDF override per product_id
  const [coverPdfs, setCoverPdfs] = useState<Record<number, ProductCoverPdf | null>>({});
  const [coverPdfUploadingFor, setCoverPdfUploadingFor] = useState<number | null>(null);
  const [coverPdfPicker, setCoverPdfPicker] = useState<{ productId: number; bytes: Uint8Array; pages: number[] } | null>(null);
  const [coverPdfPickerSaving, setCoverPdfPickerSaving] = useState(false);

  // Lazy-load images and cover-PDF when a product accordion expands
  const ensureImagesLoaded = async (productId: number) => {
    if (productImages[productId]) return;
    try {
      const images = await getProductImages(productId);
      setProductImages(prev => ({ ...prev, [productId]: images }));
    } catch (e) {
      console.error('Failed to load product images:', e);
    }
  };

  const ensureCoverPdfLoaded = async (productId: number) => {
    if (productId in coverPdfs) return;
    try {
      const cp = await getProductCoverPdf(productId);
      setCoverPdfs(prev => ({ ...prev, [productId]: cp }));
    } catch (e) {
      console.error('Failed to load cover PDF:', e);
    }
  };

  const handleCoverPdfUpload = async (productId: number, file: File) => {
    if (file.type !== 'application/pdf') {
      alert('Bitte eine PDF-Datei auswählen');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('Datei zu groß (max. 10 MB)');
      return;
    }
    setCoverPdfUploadingFor(productId);
    try {
      const cp = await uploadProductCoverPdf(productId, file);
      setCoverPdfs(prev => ({ ...prev, [productId]: cp }));
      // Upload sonrası direkt page picker'ı aç
      const bytes = await fetchBranchPdfBytes(cp.file_path);
      if (bytes) {
        setCoverPdfPicker({ productId, bytes, pages: cp.selected_pages || [] });
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setCoverPdfUploadingFor(null);
    }
  };

  const handleCoverPdfDelete = async (productId: number) => {
    if (!window.confirm('Cover-PDF wirklich entfernen?')) return;
    try {
      await deleteProductCoverPdf(productId);
      setCoverPdfs(prev => ({ ...prev, [productId]: null }));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const openCoverPdfPicker = async (productId: number) => {
    const cp = coverPdfs[productId];
    if (!cp) return;
    const bytes = await fetchBranchPdfBytes(cp.file_path);
    if (!bytes) {
      alert('PDF konnte nicht geladen werden');
      return;
    }
    setCoverPdfPicker({ productId, bytes, pages: cp.selected_pages || [] });
  };

  const saveCoverPdfPickerSelection = async () => {
    if (!coverPdfPicker) return;
    if (coverPdfPicker.pages.length === 0) {
      alert('Bitte mindestens eine Seite auswählen');
      return;
    }
    setCoverPdfPickerSaving(true);
    try {
      await setCoverPdfPages(coverPdfPicker.productId, coverPdfPicker.pages);
      setCoverPdfs(prev => ({
        ...prev,
        [coverPdfPicker.productId]: prev[coverPdfPicker.productId]
          ? { ...prev[coverPdfPicker.productId]!, selected_pages: coverPdfPicker.pages }
          : prev[coverPdfPicker.productId]
      }));
      setCoverPdfPicker(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setCoverPdfPickerSaving(false);
    }
  };

  const handleImageUpload = async (productId: number, file: File) => {
    setImageUploadingFor(productId);
    try {
      const newImage = await uploadProductImage(productId, file);
      setProductImages(prev => ({
        ...prev,
        [productId]: [...(prev[productId] || []), newImage]
      }));
      invalidateProductImagesCache(productId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setImageUploadingFor(null);
    }
  };

  const handleImageDelete = async (productId: number, imageId: number) => {
    if (!window.confirm('Bild wirklich löschen?')) return;
    try {
      await deleteProductImage(productId, imageId);
      setProductImages(prev => ({
        ...prev,
        [productId]: (prev[productId] || []).filter(img => img.id !== imageId)
      }));
      invalidateProductImagesCache(productId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleCoverToggle = async (productId: number, imageId: number, currentFlag: boolean) => {
    try {
      await setProductImageCoverFlag(productId, imageId, !currentFlag);
      setProductImages(prev => ({
        ...prev,
        [productId]: (prev[productId] || []).map(img =>
          img.id === imageId ? { ...img, show_on_cover: !currentFlag } : img
        )
      }));
      invalidateProductImagesCache(productId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  };

  // Custom fields editing for existing products
  const [editingCustomFields, setEditingCustomFields] = useState<string | null>(null);
  const [customFieldsDraft, setCustomFieldsDraft] = useState<CustomField[]>([]);

  // Custom fields for new product modal
  const [newProductCustomFields, setNewProductCustomFields] = useState<CustomField[]>([]);

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    try {
      setLoading(true);
      const data = await api.get<Product[]>('/lead-products');
      setProducts(data);
      const names = [...new Set(data.map(p => p.product_name))];
      if (names.length > 0) {
        setExpandedProducts(new Set([names[0]]));
      }
    } catch (err) {
      console.error('Failed to load products:', err);
      setError('Fehler beim Laden der Produkte');
    } finally {
      setLoading(false);
    }
  };

  // Group products by name and create matrix structure
  const productMatrices = useMemo(() => {
    const grouped: Record<string, {
      products: Product[];
      pricing_type: 'dimension' | 'unit';
      unit_label?: string;
      description?: string;
      custom_fields?: CustomField[];
      breiteValues: number[];
      tiefeValues: number[];
      matrix: Record<string, Record<string, Product>>;
    }> = {};

    products.forEach(p => {
      if (!grouped[p.product_name]) {
        let parsedCustomFields: CustomField[] | undefined;
        try {
          parsedCustomFields = p.custom_fields ? JSON.parse(p.custom_fields) : undefined;
        } catch { parsedCustomFields = undefined; }
        grouped[p.product_name] = {
          products: [],
          pricing_type: (p.pricing_type as 'dimension' | 'unit') || 'dimension',
          unit_label: p.unit_label,
          description: p.description,
          custom_fields: parsedCustomFields,
          breiteValues: [],
          tiefeValues: [],
          matrix: {}
        };
      } else if (!grouped[p.product_name].custom_fields && p.custom_fields) {
        // Pick custom_fields from any row that has it
        try {
          grouped[p.product_name].custom_fields = JSON.parse(p.custom_fields);
        } catch { /* ignore */ }
      }
      grouped[p.product_name].products.push(p);

      // Only build dimension matrix for dimension-based products
      if ((p.pricing_type || 'dimension') === 'dimension') {
        if (!grouped[p.product_name].breiteValues.includes(p.breite)) {
          grouped[p.product_name].breiteValues.push(p.breite);
        }
        if (!grouped[p.product_name].tiefeValues.includes(p.tiefe)) {
          grouped[p.product_name].tiefeValues.push(p.tiefe);
        }

        if (!grouped[p.product_name].matrix[p.breite]) {
          grouped[p.product_name].matrix[p.breite] = {};
        }
        grouped[p.product_name].matrix[p.breite][p.tiefe] = p;
      }
    });

    Object.values(grouped).forEach(g => {
      g.breiteValues.sort((a, b) => a - b);
      g.tiefeValues.sort((a, b) => a - b);
    });

    return grouped;
  }, [products]);

  // Get unique categories and product types from actual products in DB
  const filterOptions = useMemo(() => {
    const categories = new Set<string>();
    const productTypes = new Map<string, Set<string>>(); // category -> product types
    const models = new Map<string, Set<string>>(); // "category|productType" -> models

    products.forEach(p => {
      if (p.category) {
        categories.add(p.category);
        if (!productTypes.has(p.category)) {
          productTypes.set(p.category, new Set());
        }
        if (p.product_type) {
          productTypes.get(p.category)!.add(p.product_type);
          const key = `${p.category}|${p.product_type}`;
          if (!models.has(key)) {
            models.set(key, new Set());
          }
          models.get(key)!.add(p.product_name);
        }
      }
      // Also include products without category in a special group
      if (!p.category) {
        categories.add('__uncategorized__');
      }
    });

    return {
      categories: Array.from(categories).sort(),
      getProductTypes: (cat: string) => Array.from(productTypes.get(cat) || []).sort(),
      getModels: (cat: string, pt: string) => Array.from(models.get(`${cat}|${pt}`) || []).sort()
    };
  }, [products]);

  // Filter product names based on selected filters
  const filteredProductNames = useMemo(() => {
    let filtered = Object.keys(productMatrices);

    if (filterCategory) {
      if (filterCategory === '__uncategorized__') {
        // Show products without category
        filtered = filtered.filter(name => {
          const p = products.find(pr => pr.product_name === name);
          return !p?.category;
        });
      } else {
        filtered = filtered.filter(name => {
          const p = products.find(pr => pr.product_name === name);
          return p?.category === filterCategory;
        });
      }
    }

    if (filterProductType) {
      filtered = filtered.filter(name => {
        const p = products.find(pr => pr.product_name === name);
        return p?.product_type === filterProductType;
      });
    }

    if (filterModel) {
      filtered = filtered.filter(name => name === filterModel);
    }

    return filtered.sort();
  }, [productMatrices, products, filterCategory, filterProductType, filterModel]);

  const toggleAccordion = (name: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price) + ' €';
  };

  // Check if product has pending changes
  const hasPendingChanges = (productName: string) => {
    const cols = pendingColumns[productName] || [];
    const rows = pendingRows[productName] || [];
    return cols.length > 0 || rows.length > 0;
  };

  // ========== EXISTING CELL EDITING ==========
  const startEdit = (productName: string, breite: number, tiefe: number, currentPrice: number) => {
    setEditingCell({ productName, breite, tiefe });
    setEditValue(currentPrice.toString());
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const saveEdit = async () => {
    if (!editingCell) return;
    const product = productMatrices[editingCell.productName]?.matrix[editingCell.breite]?.[editingCell.tiefe];
    if (!product) return;

    const newPrice = parseFloat(editValue);
    if (isNaN(newPrice) || newPrice < 0) return;

    try {
      await api.put(`/lead-products/${product.id}`, { price: newPrice });
      await loadProducts();
      cancelEdit();
    } catch (err) {
      console.error('Failed to update price:', err);
    }
  };

  // ========== INLINE ADD COLUMN (NO MODAL) ==========
  const addPendingColumn = (productName: string) => {
    const data = productMatrices[productName];
    if (!data) return;

    const newCol: PendingColumn = {
      breite: 0,
      prices: {}
    };
    // Initialize price entries for all existing tiefe values
    data.tiefeValues.forEach(t => {
      newCol.prices[t] = '';
    });
    // Also add prices for pending rows
    (pendingRows[productName] || []).forEach(row => {
      if (row.tiefe > 0) {
        newCol.prices[row.tiefe] = '';
      }
    });

    setPendingColumns(prev => ({
      ...prev,
      [productName]: [...(prev[productName] || []), newCol]
    }));
  };

  const updatePendingColumnBreite = (productName: string, index: number, value: string) => {
    setPendingColumns(prev => {
      const cols = [...(prev[productName] || [])];
      cols[index] = { ...cols[index], breite: parseInt(value) || 0 };
      return { ...prev, [productName]: cols };
    });
  };

  const updatePendingColumnPrice = (productName: string, colIndex: number, tiefe: number, price: string) => {
    setPendingColumns(prev => {
      const cols = [...(prev[productName] || [])];
      cols[colIndex] = {
        ...cols[colIndex],
        prices: { ...cols[colIndex].prices, [tiefe]: price }
      };
      return { ...prev, [productName]: cols };
    });
  };

  const removePendingColumn = (productName: string, index: number) => {
    setPendingColumns(prev => {
      const cols = [...(prev[productName] || [])];
      cols.splice(index, 1);
      return { ...prev, [productName]: cols };
    });
  };

  // ========== INLINE ADD ROW (NO MODAL) ==========
  const addPendingRow = (productName: string) => {
    const data = productMatrices[productName];
    if (!data) return;

    const newRow: PendingRow = {
      tiefe: 0,
      prices: {}
    };
    // Initialize price entries for all existing breite values
    data.breiteValues.forEach(b => {
      newRow.prices[b] = '';
    });
    // Also add prices for pending columns
    (pendingColumns[productName] || []).forEach(col => {
      if (col.breite > 0) {
        newRow.prices[col.breite] = '';
      }
    });

    setPendingRows(prev => ({
      ...prev,
      [productName]: [...(prev[productName] || []), newRow]
    }));
  };

  const updatePendingRowTiefe = (productName: string, index: number, value: string) => {
    setPendingRows(prev => {
      const rows = [...(prev[productName] || [])];
      rows[index] = { ...rows[index], tiefe: parseInt(value) || 0 };
      return { ...prev, [productName]: rows };
    });
  };

  const updatePendingRowPrice = (productName: string, rowIndex: number, breite: number, price: string) => {
    setPendingRows(prev => {
      const rows = [...(prev[productName] || [])];
      rows[rowIndex] = {
        ...rows[rowIndex],
        prices: { ...rows[rowIndex].prices, [breite]: price }
      };
      return { ...prev, [productName]: rows };
    });
  };

  const removePendingRow = (productName: string, index: number) => {
    setPendingRows(prev => {
      const rows = [...(prev[productName] || [])];
      rows.splice(index, 1);
      return { ...prev, [productName]: rows };
    });
  };

  // ========== SAVE PENDING CHANGES ==========
  const savePendingChanges = async (productName: string) => {
    const cols = pendingColumns[productName] || [];
    const rows = pendingRows[productName] || [];
    const data = productMatrices[productName];

    if (!data) return;

    const entriesToSave: { breite: number; tiefe: number; price: number }[] = [];

    // Collect entries from pending columns
    cols.forEach(col => {
      if (col.breite > 0) {
        // For existing tiefe values
        data.tiefeValues.forEach(tiefe => {
          const priceStr = col.prices[tiefe];
          if (priceStr && parseFloat(priceStr) > 0) {
            entriesToSave.push({ breite: col.breite, tiefe, price: parseFloat(priceStr) });
          }
        });
        // For pending row tiefe values
        rows.forEach(row => {
          if (row.tiefe > 0) {
            const priceStr = col.prices[row.tiefe];
            if (priceStr && parseFloat(priceStr) > 0) {
              entriesToSave.push({ breite: col.breite, tiefe: row.tiefe, price: parseFloat(priceStr) });
            }
          }
        });
      }
    });

    // Collect entries from pending rows
    rows.forEach(row => {
      if (row.tiefe > 0) {
        // For existing breite values
        data.breiteValues.forEach(breite => {
          const priceStr = row.prices[breite];
          if (priceStr && parseFloat(priceStr) > 0) {
            // Check if not already added from columns
            const alreadyAdded = entriesToSave.some(e => e.breite === breite && e.tiefe === row.tiefe);
            if (!alreadyAdded) {
              entriesToSave.push({ breite, tiefe: row.tiefe, price: parseFloat(priceStr) });
            }
          }
        });
      }
    });

    if (entriesToSave.length === 0) {
      setError('Mindestens ein Preis muss eingegeben werden');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await Promise.all(
        entriesToSave.map(entry =>
          api.post('/lead-products', {
            product_name: productName,
            breite: entry.breite,
            tiefe: entry.tiefe,
            price: entry.price
          })
        )
      );

      // Clear pending state
      setPendingColumns(prev => ({ ...prev, [productName]: [] }));
      setPendingRows(prev => ({ ...prev, [productName]: [] }));

      await loadProducts();
    } catch (err) {
      console.error('Save error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unbekannter Fehler';
      setError(`Fehler beim Speichern: ${errorMessage}`);
    } finally {
      setSaving(false);
    }
  };

  const cancelPendingChanges = (productName: string) => {
    setPendingColumns(prev => ({ ...prev, [productName]: [] }));
    setPendingRows(prev => ({ ...prev, [productName]: [] }));
  };

  // ========== NEW PRODUCT MODAL (MULTI-ADD) ==========
  const openNewProductModal = () => {
    setNewProductName('');
    setNewProductEntries([{ breite: '', tiefe: '', price: '' }]);
    setError('');
    setNewProductModalOpen(true);
  };

  const closeNewProductModal = () => {
    setNewProductModalOpen(false);
    setNewProductName('');
    setNewProductCategory('');
    setNewProductType('');
    setNewProductEntries([{ breite: '', tiefe: '', price: '' }]);
    setNewProductPricingType('dimension');
    setNewProductUnitLabel('');
    setNewProductUnitPrice('');
    setNewProductDescription('');
    setNewProductCustomFields([]);
    setCustomCategoryMode(false);
    setCustomProductTypeMode(false);
    setCustomModelMode(false);
    setError('');
  };

  // Get available product types for selected category (only if not custom category)
  const availableProductTypes: string[] = useMemo(() => {
    if (customCategoryMode || !newProductCategory) return [] as string[];
    const configTypes = Object.keys(productConfig[newProductCategory] || {});
    const dbTypes = filterOptions.getProductTypes(newProductCategory).filter(t => !configTypes.includes(t));
    return [...configTypes, ...dbTypes.sort()];
  }, [customCategoryMode, newProductCategory, filterOptions]);

  // Get available models for selected category + product type (only if not custom)
  const availableModels = !customCategoryMode && !customProductTypeMode && newProductCategory && newProductType
    ? productConfig[newProductCategory]?.[newProductType]?.models || []
    : [];

  const addNewProductEntry = () => {
    setNewProductEntries(prev => [...prev, { breite: '', tiefe: '', price: '' }]);
  };

  const updateNewProductEntry = (index: number, field: 'breite' | 'tiefe' | 'price', value: string) => {
    setNewProductEntries(prev => {
      const arr = [...prev];
      arr[index] = { ...arr[index], [field]: value };
      return arr;
    });
  };

  const removeNewProductEntry = (index: number) => {
    if (newProductEntries.length <= 1) return;
    setNewProductEntries(prev => prev.filter((_, i) => i !== index));
  };

  const saveNewProduct = async () => {
    if (!newProductCategory) {
      setError('Kategorie ist erforderlich');
      return;
    }
    if (!newProductType) {
      setError('Produkttyp ist erforderlich');
      return;
    }
    if (!newProductName.trim()) {
      setError('Produktname ist erforderlich');
      return;
    }

    setSaving(true);
    setError('');

    try {
      if (newProductPricingType === 'unit') {
        // Unit-based product: single price entry
        if (!newProductUnitPrice || parseFloat(newProductUnitPrice) <= 0) {
          setError('Preis ist erforderlich');
          setSaving(false);
          return;
        }
        await api.post('/lead-products', {
          product_name: newProductName.trim(),
          category: newProductCategory,
          product_type: newProductType,
          pricing_type: 'unit',
          unit_label: newProductUnitLabel.trim() || null,
          description: newProductDescription.trim() || null,
          custom_fields: newProductCustomFields.filter(f => f.label.trim()).length > 0 ? newProductCustomFields.filter(f => f.label.trim()).map(f => ({ ...f, options: f.options?.map(o => o.trim()).filter(Boolean) })) : null,
          breite: 0,
          tiefe: 0,
          price: parseFloat(newProductUnitPrice)
        });
      } else {
        // Dimension-based product: multiple entries
        const validEntries = newProductEntries.filter(e =>
          e.breite && parseInt(e.breite) > 0 &&
          e.tiefe && parseInt(e.tiefe) > 0 &&
          e.price && parseFloat(e.price) > 0
        );

        if (validEntries.length === 0) {
          setError('Mindestens ein vollständiger Eintrag (Breite, Tiefe, Preis) ist erforderlich');
          setSaving(false);
          return;
        }

        await Promise.all(
          validEntries.map(entry =>
            api.post('/lead-products', {
              product_name: newProductName.trim(),
              category: newProductCategory,
              product_type: newProductType,
              pricing_type: 'dimension',
              description: newProductDescription.trim() || null,
              custom_fields: newProductCustomFields.filter(f => f.label.trim()).length > 0 ? newProductCustomFields.filter(f => f.label.trim()).map(f => ({ ...f, options: f.options?.map(o => o.trim()).filter(Boolean) })) : null,
              breite: parseInt(entry.breite),
              tiefe: parseInt(entry.tiefe),
              price: parseFloat(entry.price)
            })
          )
        );
      }

      await loadProducts();
      setExpandedProducts(prev => new Set(prev).add(newProductName.trim()));
      closeNewProductModal();
    } catch (err) {
      console.error('Save error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unbekannter Fehler';
      setError(`Fehler beim Speichern: ${errorMessage}`);
    } finally {
      setSaving(false);
    }
  };

  // ========== DELETE HANDLERS ==========
  const handleDeleteProduct = async (productName: string) => {
    const productsToDelete = products.filter(p => p.product_name === productName);
    try {
      await Promise.all(productsToDelete.map(p => api.delete(`/lead-products/${p.id}`)));
      await loadProducts();
      setDeleteConfirm(null);
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleDeleteRow = async (productName: string, tiefe: number) => {
    const productsToDelete = products.filter(p => p.product_name === productName && p.tiefe === tiefe);
    try {
      await Promise.all(productsToDelete.map(p => api.delete(`/lead-products/${p.id}`)));
      await loadProducts();
      setDeleteConfirm(null);
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleDeleteColumn = async (productName: string, breite: number) => {
    const productsToDelete = products.filter(p => p.product_name === productName && p.breite === breite);
    try {
      await Promise.all(productsToDelete.map(p => api.delete(`/lead-products/${p.id}`)));
      await loadProducts();
      setDeleteConfirm(null);
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  // ========== DESCRIPTION EDITING ==========
  const saveDescription = async (productName: string) => {
    const productsToUpdate = products.filter(p => p.product_name === productName);
    if (productsToUpdate.length === 0) return;

    try {
      await Promise.all(
        productsToUpdate.map(p =>
          api.put(`/lead-products/${p.id}`, {
            description: editDescriptionValue.trim() || null
          })
        )
      );
      await loadProducts();
      setEditingDescription(null);
      setEditDescriptionValue('');
    } catch (err) {
      console.error('Failed to update description:', err);
    }
  };

  // ========== CUSTOM FIELDS EDITING ==========
  const addCustomField = (fields: CustomField[], setFields: (f: CustomField[]) => void) => {
    setFields([...fields, { id: `f${Date.now()}`, label: '', type: 'text', required: false }]);
  };

  const updateCustomField = (fields: CustomField[], setFields: (f: CustomField[]) => void, index: number, updates: Partial<CustomField>) => {
    const updated = [...fields];
    updated[index] = { ...updated[index], ...updates };
    setFields(updated);
  };

  const removeCustomField = (fields: CustomField[], setFields: (f: CustomField[]) => void, index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const saveCustomFields = async (productName: string) => {
    const productsToUpdate = products.filter(p => p.product_name === productName);
    if (productsToUpdate.length === 0) return;

    // Filter out fields with empty labels
    const validFields = customFieldsDraft
      .filter(f => f.label.trim())
      .map(f => ({ ...f, options: f.options?.map(o => o.trim()).filter(Boolean) }));
    const cfPayload = validFields.length > 0 ? validFields : null;

    try {
      setSaving(true);
      // Only update first row — custom_fields is product-level, not per-variant
      await api.put(`/lead-products/${productsToUpdate[0].id}`, { custom_fields: cfPayload });
      await loadProducts();
      setEditingCustomFields(null);
      setCustomFieldsDraft([]);
    } catch (err) {
      console.error('Failed to update custom fields:', err);
    } finally {
      setSaving(false);
    }
  };

  const renderCustomFieldsEditor = (fields: CustomField[], setFields: (f: CustomField[]) => void) => (
    <div className="custom-fields-editor">
      {fields.map((field, idx) => (
        <div key={field.id} className="custom-field-row">
          <input
            type="text"
            value={field.label}
            onChange={(e) => updateCustomField(fields, setFields, idx, { label: e.target.value })}
            placeholder="Feldname..."
            className="cf-label-input"
          />
          <select
            value={field.type}
            onChange={(e) => updateCustomField(fields, setFields, idx, { type: e.target.value as CustomField['type'], options: e.target.value === 'select' ? [''] : undefined, unit: e.target.value === 'number' ? '' : undefined })}
            className="cf-type-select"
          >
            <option value="text">Text</option>
            <option value="number">Zahl</option>
            <option value="select">Auswahl</option>
          </select>
          {field.type === 'number' && (
            <input
              type="text"
              value={field.unit || ''}
              onChange={(e) => updateCustomField(fields, setFields, idx, { unit: e.target.value })}
              placeholder="Einheit (mm, cm...)"
              className="cf-unit-input"
            />
          )}
          {field.type === 'select' && (
            <input
              type="text"
              value={(field.options || []).join(',')}
              onChange={(e) => updateCustomField(fields, setFields, idx, { options: e.target.value.split(',') })}
              placeholder="Optionen (kommagetrennt)"
              className="cf-options-input"
            />
          )}
          <label className="cf-required-label">
            <input
              type="checkbox"
              checked={field.required || false}
              onChange={(e) => updateCustomField(fields, setFields, idx, { required: e.target.checked })}
            />
            Pflicht
          </label>
          <button
            type="button"
            className="cf-remove-btn"
            onClick={() => removeCustomField(fields, setFields, idx)}
            title="Feld entfernen"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="cf-add-btn"
        onClick={() => addCustomField(fields, setFields)}
      >
        + Feld hinzufügen
      </button>
    </div>
  );

  // ========== ADD PRICE TO EMPTY CELL ==========
  const startAddingPrice = (productName: string, breite: number, tiefe: number) => {
    setAddingPrice({ productName, breite, tiefe });
    setAddingPriceValue('');
  };

  const cancelAddingPrice = () => {
    setAddingPrice(null);
    setAddingPriceValue('');
  };

  const saveAddingPrice = async () => {
    if (!addingPrice) return;
    const price = parseFloat(addingPriceValue);
    if (isNaN(price) || price <= 0) return;

    const { productName, breite, tiefe } = addingPrice;

    // Optimistic update - add to local state immediately
    const tempProduct: Product = {
      id: Date.now(), // temporary ID
      product_name: productName,
      breite,
      tiefe,
      price,
      branch_id: null
    };
    setProducts(prev => [...prev, tempProduct]);
    cancelAddingPrice();

    try {
      const newProduct = await api.post<Product>('/lead-products', {
        product_name: productName,
        breite,
        tiefe,
        price
      });
      // Replace temp product with real one from server
      setProducts(prev => prev.map(p =>
        p.id === tempProduct.id ? newProduct : p
      ));
    } catch (err) {
      console.error('Failed to add price:', err);
      // Rollback on error
      setProducts(prev => prev.filter(p => p.id !== tempProduct.id));
      setError('Fehler beim Speichern des Preises');
    }
  };

  // ========== RENDER ==========
  return (
    <div className="product-pricing-page">
      <header className="page-header">
        <div className="header-left">
          <h1>Produkte & Preise</h1>
          <span className="product-count">{filteredProductNames.length} Produkte</span>
        </div>
        <div className="header-right">
          <motion.button
            className="btn-primary"
            onClick={openNewProductModal}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Neues Produkt
          </motion.button>
        </div>
      </header>

      {/* Filter Section */}
      {!loading && Object.keys(productMatrices).length > 0 && (
        <div className="filter-section">
          <div className="filter-group">
            <label>Kategorie</label>
            <select
              value={filterCategory}
              onChange={e => {
                setFilterCategory(e.target.value);
                setFilterProductType('');
                setFilterModel('');
              }}
            >
              <option value="">Alle Kategorien</option>
              {filterOptions.categories.map(cat => (
                <option key={cat} value={cat}>
                  {cat === '__uncategorized__' ? 'Ohne Kategorie' : cat}
                </option>
              ))}
            </select>
          </div>

          {filterCategory && filterCategory !== '__uncategorized__' && filterOptions.getProductTypes(filterCategory).length > 0 && (
            <div className="filter-group">
              <label>Produkttyp</label>
              <select
                value={filterProductType}
                onChange={e => {
                  setFilterProductType(e.target.value);
                  setFilterModel('');
                }}
              >
                <option value="">Alle Produkttypen</option>
                {filterOptions.getProductTypes(filterCategory).map(pt => (
                  <option key={pt} value={pt}>{pt}</option>
                ))}
              </select>
            </div>
          )}

          {filterProductType && filterOptions.getModels(filterCategory, filterProductType).length > 0 && (
            <div className="filter-group">
              <label>Modell</label>
              <select
                value={filterModel}
                onChange={e => setFilterModel(e.target.value)}
              >
                <option value="">Alle Modelle</option>
                {filterOptions.getModels(filterCategory, filterProductType).map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          )}

          {(filterCategory || filterProductType || filterModel) && (
            <button
              className="btn-clear-filter"
              onClick={() => {
                setFilterCategory('');
                setFilterProductType('');
                setFilterModel('');
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
              Filter zurücksetzen
            </button>
          )}
        </div>
      )}

      {error && <div className="page-error">{error}</div>}

      {loading ? (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Lade Produkte...</p>
        </div>
      ) : Object.keys(productMatrices).length === 0 ? (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <h3>Keine Produkte</h3>
          <p>Fügen Sie Ihr erstes Produkt hinzu</p>
          <button className="btn-primary" onClick={openNewProductModal}>
            Erstes Produkt hinzufügen
          </button>
        </div>
      ) : filteredProductNames.length === 0 ? (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <h3>Keine Ergebnisse</h3>
          <p>Keine Produkte entsprechen den gewählten Filtern</p>
          <button
            className="btn-secondary"
            onClick={() => {
              setFilterCategory('');
              setFilterProductType('');
              setFilterModel('');
            }}
          >
            Filter zurücksetzen
          </button>
        </div>
      ) : (
        <div className="product-accordions">
          {filteredProductNames.map(productName => {
            const data = productMatrices[productName];
            const isExpanded = expandedProducts.has(productName);
            const totalPrices = data.products.length;
            const pCols = pendingColumns[productName] || [];
            const pRows = pendingRows[productName] || [];
            const hasChanges = hasPendingChanges(productName);

            return (
              <div key={productName} className={`product-accordion ${isExpanded ? 'expanded' : ''}`}>
                <div className="accordion-header" onClick={() => toggleAccordion(productName)}>
                  <div className="accordion-title">
                    <svg className="accordion-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <span className="product-name">{productName}</span>
                    <span className="price-count">
                      {data.pricing_type === 'unit'
                        ? `Einheitspreis${data.unit_label ? ` (${data.unit_label})` : ''}`
                        : `${totalPrices} Preise`
                      }
                    </span>
                  </div>
                  <div className="accordion-actions" onClick={e => e.stopPropagation()}>
                    {data.pricing_type !== 'unit' && (
                      <>
                        <button className="btn-icon-small" onClick={() => addPendingColumn(productName)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                          Breite
                        </button>
                        <button className="btn-icon-small" onClick={() => addPendingRow(productName)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                          Tiefe
                        </button>
                      </>
                    )}
                    <button
                      className="btn-icon-small delete"
                      onClick={() => setDeleteConfirm({ type: 'product', productName })}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      className="accordion-content"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      {data.pricing_type === 'unit' ? (
                        <div className="unit-pricing-card">
                          <div className="unit-pricing-row">
                            <div className="unit-pricing-field">
                              <label>Einheit</label>
                              {editingCell?.productName === productName && editingCell?.breite === -1 ? (
                                <input
                                  type="text"
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  onBlur={async () => {
                                    const product = data.products[0];
                                    if (product && editValue !== (data.unit_label || '')) {
                                      await api.put(`/lead-products/${product.id}`, { unit_label: editValue });
                                      await loadProducts();
                                    }
                                    setEditingCell(null);
                                  }}
                                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingCell(null); }}
                                  autoFocus
                                  placeholder="z.B. Adet, Metrekare, Stück"
                                />
                              ) : (
                                <span
                                  className="unit-value clickable"
                                  onClick={() => { setEditingCell({ productName, breite: -1, tiefe: 0 }); setEditValue(data.unit_label || ''); }}
                                >
                                  {data.unit_label || '(klicken zum Bearbeiten)'}
                                </span>
                              )}
                            </div>
                            <div className="unit-pricing-field">
                              <label>Preis (EUR)</label>
                              {editingCell?.productName === productName && editingCell?.breite === -2 ? (
                                <input
                                  type="number"
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  onBlur={async () => {
                                    const product = data.products[0];
                                    if (product && editValue) {
                                      await api.put(`/lead-products/${product.id}`, { price: parseFloat(editValue) });
                                      await loadProducts();
                                    }
                                    setEditingCell(null);
                                  }}
                                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingCell(null); }}
                                  autoFocus
                                  min="0"
                                  step="0.01"
                                />
                              ) : (
                                <span
                                  className="unit-value clickable price"
                                  onClick={() => { setEditingCell({ productName, breite: -2, tiefe: 0 }); setEditValue(String(data.products[0]?.price || 0)); }}
                                >
                                  {(data.products[0]?.price || 0).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                      <div className="matrix-wrapper">
                        <table className="price-matrix">
                          <thead>
                            <tr>
                              <th className="corner-cell">
                                <span className="axis-label tiefe-label">TIEFE</span>
                                <span className="axis-label breite-label">BREITE</span>
                              </th>
                              {/* Existing Breite columns */}
                              {data.breiteValues.map(breite => (
                                <th key={breite} className="breite-header">
                                  <span>{breite}</span>
                                  <button
                                    className="delete-col-btn"
                                    onClick={() => setDeleteConfirm({ type: 'column', productName, value: breite })}
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                  </button>
                                </th>
                              ))}
                              {/* Pending new columns */}
                              {pCols.map((col, colIdx) => (
                                <th key={`pending-col-${colIdx}`} className="breite-header pending-header">
                                  <input
                                    type="number"
                                    className="pending-dimension-input"
                                    placeholder="Breite"
                                    value={col.breite || ''}
                                    onChange={e => updatePendingColumnBreite(productName, colIdx, e.target.value)}
                                    onClick={e => e.stopPropagation()}
                                  />
                                  <button
                                    className="delete-col-btn"
                                    onClick={() => removePendingColumn(productName, colIdx)}
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                  </button>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {/* Existing Tiefe rows */}
                            {data.tiefeValues.map(tiefe => (
                              <tr key={tiefe}>
                                <td className="tiefe-header">
                                  <span>{tiefe}</span>
                                  <button
                                    className="delete-row-btn"
                                    onClick={() => setDeleteConfirm({ type: 'row', productName, value: tiefe })}
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                  </button>
                                </td>
                                {/* Existing cells */}
                                {data.breiteValues.map(breite => {
                                  const product = data.matrix[breite]?.[tiefe];
                                  const isEditing = editingCell?.productName === productName &&
                                    editingCell?.breite === breite &&
                                    editingCell?.tiefe === tiefe;
                                  const isAddingPrice = addingPrice?.productName === productName &&
                                    addingPrice?.breite === breite &&
                                    addingPrice?.tiefe === tiefe;

                                  return (
                                    <td key={`${breite}-${tiefe}`} className={`price-cell ${isEditing ? 'editing' : ''} ${isAddingPrice ? 'adding' : ''}`}>
                                      {isEditing ? (
                                        <div className="edit-cell">
                                          <input
                                            type="number"
                                            value={editValue}
                                            onChange={e => setEditValue(e.target.value)}
                                            onKeyDown={e => {
                                              if (e.key === 'Enter') saveEdit();
                                              if (e.key === 'Escape') cancelEdit();
                                            }}
                                            autoFocus
                                          />
                                          <div className="edit-actions">
                                            <button className="save-btn" onClick={saveEdit}>
                                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <polyline points="20 6 9 17 4 12" />
                                              </svg>
                                            </button>
                                            <button className="cancel-btn" onClick={cancelEdit}>
                                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M18 6L6 18M6 6l12 12" />
                                              </svg>
                                            </button>
                                          </div>
                                        </div>
                                      ) : isAddingPrice ? (
                                        <div className="edit-cell">
                                          <input
                                            type="number"
                                            value={addingPriceValue}
                                            onChange={e => setAddingPriceValue(e.target.value)}
                                            onKeyDown={e => {
                                              if (e.key === 'Enter') saveAddingPrice();
                                              if (e.key === 'Escape') cancelAddingPrice();
                                            }}
                                            placeholder="€"
                                            autoFocus
                                          />
                                          <div className="edit-actions">
                                            <button className="save-btn" onClick={saveAddingPrice}>
                                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <polyline points="20 6 9 17 4 12" />
                                              </svg>
                                            </button>
                                            <button className="cancel-btn" onClick={cancelAddingPrice}>
                                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M18 6L6 18M6 6l12 12" />
                                              </svg>
                                            </button>
                                          </div>
                                        </div>
                                      ) : product ? (
                                        <button
                                          className="price-btn"
                                          onClick={() => startEdit(productName, breite, tiefe, product.price)}
                                        >
                                          {formatPrice(product.price)}
                                        </button>
                                      ) : (
                                        <button
                                          className="empty-price-btn"
                                          onClick={() => startAddingPrice(productName, breite, tiefe)}
                                          title="Klicken um Preis hinzuzufügen"
                                        >
                                          -
                                        </button>
                                      )}
                                    </td>
                                  );
                                })}
                                {/* Pending column cells for existing rows */}
                                {pCols.map((col, colIdx) => (
                                  <td key={`pending-col-${colIdx}-row-${tiefe}`} className="price-cell pending-cell">
                                    <input
                                      type="number"
                                      className="pending-price-input"
                                      placeholder="€"
                                      value={col.prices[tiefe] || ''}
                                      onChange={e => updatePendingColumnPrice(productName, colIdx, tiefe, e.target.value)}
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                            {/* Pending new rows */}
                            {pRows.map((row, rowIdx) => (
                              <tr key={`pending-row-${rowIdx}`}>
                                <td className="tiefe-header pending-header">
                                  <input
                                    type="number"
                                    className="pending-dimension-input"
                                    placeholder="Tiefe"
                                    value={row.tiefe || ''}
                                    onChange={e => updatePendingRowTiefe(productName, rowIdx, e.target.value)}
                                  />
                                  <button
                                    className="delete-row-btn"
                                    onClick={() => removePendingRow(productName, rowIdx)}
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                  </button>
                                </td>
                                {/* Existing breite columns */}
                                {data.breiteValues.map(breite => (
                                  <td key={`pending-row-${rowIdx}-col-${breite}`} className="price-cell pending-cell">
                                    <input
                                      type="number"
                                      className="pending-price-input"
                                      placeholder="€"
                                      value={row.prices[breite] || ''}
                                      onChange={e => updatePendingRowPrice(productName, rowIdx, breite, e.target.value)}
                                    />
                                  </td>
                                ))}
                                {/* Pending column cells for pending rows */}
                                {pCols.map((col, colIdx) => (
                                  <td key={`pending-row-${rowIdx}-pending-col-${colIdx}`} className="price-cell pending-cell">
                                    <input
                                      type="number"
                                      className="pending-price-input"
                                      placeholder="€"
                                      value={col.prices[row.tiefe] || ''}
                                      onChange={e => {
                                        // Update in pending column's prices
                                        updatePendingColumnPrice(productName, colIdx, row.tiefe, e.target.value);
                                      }}
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        {/* Save/Cancel buttons when there are pending changes */}
                        {hasChanges && (
                          <div className="pending-actions">
                            <button className="btn-cancel" onClick={() => cancelPendingChanges(productName)}>
                              Abbrechen
                            </button>
                            <button
                              className="btn-save"
                              onClick={() => savePendingChanges(productName)}
                              disabled={saving}
                            >
                              {saving ? 'Speichern...' : 'Speichern'}
                            </button>
                          </div>
                        )}
                      </div>
                      )}

                      {/* Description Section - below table */}
                      <div className="description-section">
                        {editingDescription === productName ? (
                          <div className="description-editor">
                            <textarea
                              value={editDescriptionValue}
                              onChange={e => setEditDescriptionValue(e.target.value)}
                              placeholder="Produktbeschreibung eingeben..."
                              rows={3}
                              className="description-textarea"
                              autoFocus
                            />
                            <div className="description-editor-actions">
                              <button
                                className="btn-desc-save"
                                onClick={() => saveDescription(productName)}
                              >
                                Speichern
                              </button>
                              <button
                                className="btn-desc-cancel"
                                onClick={() => { setEditingDescription(null); setEditDescriptionValue(''); }}
                              >
                                Abbrechen
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            className={`description-toggle ${data.description ? 'has-content' : ''}`}
                            onClick={() => {
                              setEditingDescription(productName);
                              setEditDescriptionValue(data.description || '');
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="desc-icon">
                              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                            {data.description ? (
                              <span className="desc-content">{data.description}</span>
                            ) : (
                              <span className="desc-placeholder">Beschreibung hinzufügen</span>
                            )}
                          </button>
                        )}
                      </div>

                      {/* Product Images & Cover-PDF Section */}
                      {data.products[0]?.id && (() => {
                        const productId = data.products[0].id;
                        if (!productImages[productId] && imageUploadingFor !== productId) {
                          ensureImagesLoaded(productId);
                        }
                        if (!(productId in coverPdfs) && coverPdfUploadingFor !== productId) {
                          ensureCoverPdfLoaded(productId);
                        }
                        const images = productImages[productId] || [];
                        const coverPdf = coverPdfs[productId];
                        const pdfActive = !!coverPdf;
                        return (
                          <>
                          <div className={`product-images-section ${pdfActive ? 'is-disabled-by-pdf' : ''}`}>
                            <div className="pi-header">
                              <span className="pi-label">Produktbilder</span>
                              <span className="pi-hint">{images.length}/3 · max 2 für Cover</span>
                            </div>
                            {pdfActive && (
                              <div className="pi-pdf-overlay-msg">
                                Cover-PDF ist aktiv. Bilder werden nicht für die PDF verwendet.
                              </div>
                            )}
                            <div className="pi-grid">
                              {images.map((img) => (
                                <div key={img.id} className="pi-tile">
                                  <img
                                    src={`${API_BASE_URL}/product-image/${img.image_path}?t=${img.uploaded_at || ''}`}
                                    alt=""
                                    onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
                                  />
                                  <button
                                    type="button"
                                    className="pi-delete"
                                    onClick={() => handleImageDelete(productId, img.id)}
                                    title="Löschen"
                                    disabled={pdfActive}
                                  >×</button>
                                  <label className={`pi-cover-toggle ${img.show_on_cover ? 'is-on' : ''}`}>
                                    <input
                                      type="checkbox"
                                      checked={img.show_on_cover}
                                      onChange={() => handleCoverToggle(productId, img.id, img.show_on_cover)}
                                      disabled={pdfActive}
                                    />
                                    <span>{img.show_on_cover ? '★ Cover' : 'Cover'}</span>
                                  </label>
                                </div>
                              ))}
                              {images.length < 3 && !pdfActive && (
                                <label className="pi-tile pi-upload">
                                  {imageUploadingFor === productId ? (
                                    <span>Lädt hoch...</span>
                                  ) : (
                                    <>
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
                                        <path d="M12 5v14M5 12h14" />
                                      </svg>
                                      <span>Bild hinzufügen</span>
                                    </>
                                  )}
                                  <input
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    hidden
                                    onChange={(e) => {
                                      if (e.target.files?.[0]) handleImageUpload(productId, e.target.files[0]);
                                      e.target.value = '';
                                    }}
                                  />
                                </label>
                              )}
                            </div>
                          </div>

                          {/* Cover-PDF Section (override) */}
                          <div className="cover-pdf-section">
                            <div className="cpdf-header">
                              <span className="cpdf-label">Cover-PDF (optional)</span>
                              <span className="cpdf-hint">Eigenes PDF für die Titelseite – überschreibt obige Bilder</span>
                            </div>
                            {coverPdf ? (
                              <div className="cpdf-active">
                                <button
                                  type="button"
                                  className="cpdf-info cpdf-info-button"
                                  onClick={() => openCoverPdfPicker(productId)}
                                  title="Klicken zum Ändern der Seitenauswahl"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                  </svg>
                                  <span className="cpdf-pages-info">
                                    {coverPdf.page_count} Seiten · {coverPdf.selected_pages?.length || 0} ausgewählt
                                  </span>
                                  <span className="cpdf-edit-hint">zum Ändern klicken</span>
                                </button>
                                <button
                                  type="button"
                                  className="btn-cpdf-delete"
                                  onClick={() => handleCoverPdfDelete(productId)}
                                  title="Cover-PDF entfernen"
                                >
                                  Entfernen
                                </button>
                              </div>
                            ) : (
                              <label className="cpdf-upload">
                                {coverPdfUploadingFor === productId ? (
                                  <span>Lädt hoch...</span>
                                ) : (
                                  <>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                                      <polyline points="17 8 12 3 7 8" />
                                      <line x1="12" y1="3" x2="12" y2="15" />
                                    </svg>
                                    <span>Cover-PDF hochladen</span>
                                  </>
                                )}
                                <input
                                  type="file"
                                  accept="application/pdf"
                                  hidden
                                  onChange={(e) => {
                                    if (e.target.files?.[0]) handleCoverPdfUpload(productId, e.target.files[0]);
                                    e.target.value = '';
                                  }}
                                />
                              </label>
                            )}
                          </div>
                          </>
                        );
                      })()}

                      {/* Custom Fields (Form Builder) Section */}
                      <div className="custom-fields-section">
                        {editingCustomFields === productName ? (
                          <div className="custom-fields-editor-wrapper">
                            <h4 className="cf-section-title">Formularfelder</h4>
                            {renderCustomFieldsEditor(customFieldsDraft, setCustomFieldsDraft)}
                            <div className="cf-editor-actions">
                              <button
                                className="btn-desc-save"
                                onClick={() => saveCustomFields(productName)}
                                disabled={saving}
                              >
                                {saving ? 'Speichern...' : 'Speichern'}
                              </button>
                              <button
                                className="btn-desc-cancel"
                                onClick={() => { setEditingCustomFields(null); setCustomFieldsDraft([]); }}
                              >
                                Abbrechen
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            className={`description-toggle ${data.custom_fields && data.custom_fields.length > 0 ? 'has-content' : ''}`}
                            onClick={() => {
                              setEditingCustomFields(productName);
                              setCustomFieldsDraft(data.custom_fields ? [...data.custom_fields] : []);
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="desc-icon">
                              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                              <rect x="9" y="3" width="6" height="4" rx="1" />
                              <path d="M9 12h6M9 16h6" />
                            </svg>
                            {data.custom_fields && data.custom_fields.length > 0 ? (
                              <span className="desc-content">{data.custom_fields.length} Formularfeld{data.custom_fields.length > 1 ? 'er' : ''}</span>
                            ) : (
                              <span className="desc-placeholder">Formularfelder hinzufügen</span>
                            )}
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {/* New Product Modal (Multi-Add) */}
      <AnimatePresence>
        {newProductModalOpen && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeNewProductModal}
          >
            <motion.div
              className="product-modal new-product-modal"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>Neues Produkt erstellen</h2>
                <button className="close-btn" onClick={closeNewProductModal}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="modal-body">
                {error && <div className="modal-error">{error}</div>}

                {/* Pricing Type Toggle - FIRST */}
                <div className="form-group">
                  <label>Preismodell *</label>
                  <div className="pricing-type-toggle">
                    <button
                      type="button"
                      className={`toggle-btn ${newProductPricingType === 'dimension' ? 'active' : ''}`}
                      onClick={() => setNewProductPricingType('dimension')}
                    >
                      Maßbasiert (Breite × Tiefe)
                    </button>
                    <button
                      type="button"
                      className={`toggle-btn ${newProductPricingType === 'unit' ? 'active' : ''}`}
                      onClick={() => setNewProductPricingType('unit')}
                    >
                      Einheitspreis
                    </button>
                  </div>
                </div>

                {/* Category Selection */}
                <div className="form-group">
                  <label>Kategorie *</label>
                  {customCategoryMode ? (
                    <div className="custom-input-wrapper">
                      <input
                        type="text"
                        value={newProductCategory}
                        onChange={e => setNewProductCategory(e.target.value)}
                        placeholder="Eigene Kategorie eingeben..."
                        autoFocus
                      />
                      <button
                        type="button"
                        className="btn-toggle-mode"
                        onClick={() => {
                          setCustomCategoryMode(false);
                          setNewProductCategory('');
                          setNewProductType('');
                          setNewProductName('');
                          setCustomProductTypeMode(false);
                          setCustomModelMode(false);
                        }}
                        title="Zurück zur Auswahl"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <select
                      value={newProductCategory}
                      onChange={e => {
                        if (e.target.value === '__custom__') {
                          setCustomCategoryMode(true);
                          setNewProductCategory('');
                          setNewProductType('');
                          setNewProductName('');
                        } else {
                          setNewProductCategory(e.target.value);
                          setNewProductType('');
                          setNewProductName('');
                        }
                      }}
                    >
                      <option value="">Kategorie wählen...</option>
                      {(() => {
                        const configCats = Object.keys(productConfig);
                        const dbCats = filterOptions.categories.filter(c => c !== '__uncategorized__' && !configCats.includes(c));
                        return [...configCats, ...dbCats.sort()].map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ));
                      })()}
                      <option value="__custom__">➕ Andere eingeben...</option>
                    </select>
                  )}
                </div>

                {/* Product Type Selection */}
                {newProductCategory && (
                  <div className="form-group">
                    <label>Produkttyp *</label>
                    {customCategoryMode || customProductTypeMode ? (
                      <div className="custom-input-wrapper">
                        <input
                          type="text"
                          value={newProductType}
                          onChange={e => setNewProductType(e.target.value)}
                          placeholder="Eigenen Produkttyp eingeben..."
                          autoFocus={customProductTypeMode}
                        />
                        {!customCategoryMode && (
                          <button
                            type="button"
                            className="btn-toggle-mode"
                            onClick={() => {
                              setCustomProductTypeMode(false);
                              setNewProductType('');
                              setNewProductName('');
                              setCustomModelMode(false);
                            }}
                            title="Zurück zur Auswahl"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ) : (
                      <select
                        value={newProductType}
                        onChange={e => {
                          if (e.target.value === '__custom__') {
                            setCustomProductTypeMode(true);
                            setNewProductType('');
                            setNewProductName('');
                          } else {
                            setNewProductType(e.target.value);
                            setNewProductName('');
                          }
                        }}
                      >
                        <option value="">Produkttyp wählen...</option>
                        {availableProductTypes.map((pt: string) => (
                          <option key={pt} value={pt}>{pt}</option>
                        ))}
                        <option value="__custom__">➕ Andere eingeben...</option>
                      </select>
                    )}
                  </div>
                )}

                {/* Model/Product Name Selection */}
                {newProductType && (
                  <div className="form-group">
                    <label>Modell / Produktname *</label>
                    {customCategoryMode || customProductTypeMode || customModelMode || availableModels.length === 0 ? (
                      <div className="custom-input-wrapper">
                        <input
                          type="text"
                          value={newProductName}
                          onChange={e => setNewProductName(e.target.value)}
                          placeholder="Produktname eingeben..."
                          autoFocus={customModelMode}
                        />
                        {!customCategoryMode && !customProductTypeMode && availableModels.length > 0 && (
                          <button
                            type="button"
                            className="btn-toggle-mode"
                            onClick={() => {
                              setCustomModelMode(false);
                              setNewProductName('');
                            }}
                            title="Zurück zur Auswahl"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ) : (
                      <select
                        value={newProductName}
                        onChange={e => {
                          if (e.target.value === '__custom__') {
                            setCustomModelMode(true);
                            setNewProductName('');
                          } else {
                            setNewProductName(e.target.value);
                          }
                        }}
                      >
                        <option value="">Modell wählen...</option>
                        {availableModels.map(model => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                        <option value="__custom__">➕ Andere eingeben...</option>
                      </select>
                    )}
                  </div>
                )}

                {/* Description */}
                {newProductName && (
                  <div className="form-group">
                    <label>Beschreibung (optional)</label>
                    <textarea
                      value={newProductDescription}
                      onChange={e => setNewProductDescription(e.target.value)}
                      placeholder="Produktbeschreibung eingeben..."
                      rows={3}
                      className="description-textarea"
                    />
                  </div>
                )}

                {/* Custom Fields Builder for new product */}
                {newProductName && (
                  <div className="form-group">
                    <label>Formularfelder (optional)</label>
                    {renderCustomFieldsEditor(newProductCustomFields, setNewProductCustomFields)}
                  </div>
                )}

                {/* Unit pricing inputs */}
                {newProductPricingType === 'unit' && newProductName && (
                  <div className="unit-pricing-inputs">
                    <div className="form-group">
                      <label>Einheit</label>
                      <input
                        type="text"
                        value={newProductUnitLabel}
                        onChange={e => setNewProductUnitLabel(e.target.value)}
                        placeholder="z.B. Stück, Adet, Metrekare, Pauschal"
                      />
                    </div>
                    <div className="form-group">
                      <label>Preis (€) *</label>
                      <input
                        type="number"
                        value={newProductUnitPrice}
                        onChange={e => setNewProductUnitPrice(e.target.value)}
                        placeholder="45"
                        min="0"
                        step="0.01"
                      />
                    </div>
                  </div>
                )}

                {/* Dimension price entries - each row: Breite | Tiefe | Price */}
                {newProductPricingType === 'dimension' && (
                <div className="price-entries-section">
                  <div className="entries-header">
                    <div className="entry-label">Breite (cm)</div>
                    <div className="entry-label">Tiefe (cm)</div>
                    <div className="entry-label">Preis (€)</div>
                    <div className="entry-action"></div>
                  </div>
                  {newProductEntries.map((entry, idx) => (
                    <div key={idx} className="price-entry-row">
                      <input
                        type="number"
                        value={entry.breite}
                        onChange={e => updateNewProductEntry(idx, 'breite', e.target.value)}
                        placeholder="200"
                      />
                      <input
                        type="number"
                        value={entry.tiefe}
                        onChange={e => updateNewProductEntry(idx, 'tiefe', e.target.value)}
                        placeholder="150"
                      />
                      <input
                        type="number"
                        value={entry.price}
                        onChange={e => updateNewProductEntry(idx, 'price', e.target.value)}
                        placeholder="1800"
                      />
                      {newProductEntries.length > 1 ? (
                        <button className="btn-remove-entry" onClick={() => removeNewProductEntry(idx)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      ) : (
                        <div className="entry-action-placeholder"></div>
                      )}
                    </div>
                  ))}
                  <button className="btn-add-entry" onClick={addNewProductEntry}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Weitere Zeile
                  </button>
                </div>
                )}
              </div>

              <div className="modal-footer">
                <button className="btn-cancel" onClick={closeNewProductModal}>Abbrechen</button>
                <button className="btn-save" onClick={saveNewProduct} disabled={saving}>
                  {saving ? 'Speichern...' : 'Produkt erstellen'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDeleteConfirm(null)}
          >
            <motion.div
              className="delete-modal"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
            >
              <h3>Löschen bestätigen</h3>
              <p>
                {deleteConfirm.type === 'product' && `Möchten Sie das gesamte Produkt "${deleteConfirm.productName}" mit allen Preisen löschen?`}
                {deleteConfirm.type === 'row' && `Möchten Sie die gesamte Zeile (Tiefe ${deleteConfirm.value} cm) löschen?`}
                {deleteConfirm.type === 'column' && `Möchten Sie die gesamte Spalte (Breite ${deleteConfirm.value} cm) löschen?`}
              </p>
              <div className="delete-modal-actions">
                <button className="btn-cancel" onClick={() => setDeleteConfirm(null)}>Abbrechen</button>
                <button
                  className="btn-delete"
                  onClick={() => {
                    if (deleteConfirm.type === 'product') {
                      handleDeleteProduct(deleteConfirm.productName);
                    } else if (deleteConfirm.type === 'row') {
                      handleDeleteRow(deleteConfirm.productName, deleteConfirm.value!);
                    } else if (deleteConfirm.type === 'column') {
                      handleDeleteColumn(deleteConfirm.productName, deleteConfirm.value!);
                    }
                  }}
                >
                  Löschen
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cover-PDF Page Picker Modal */}
      <AnimatePresence>
        {coverPdfPicker && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !coverPdfPickerSaving && setCoverPdfPicker(null)}
          >
            <motion.div
              className="modal-content cpdf-picker-modal"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>Cover-Seiten auswählen</h2>
                <button
                  className="modal-close"
                  onClick={() => !coverPdfPickerSaving && setCoverPdfPicker(null)}
                  disabled={coverPdfPickerSaving}
                >×</button>
              </div>
              <div className="modal-body">
                <p className="cpdf-picker-hint">
                  Klicken Sie auf die Seiten, die als Cover verwendet werden sollen. Mehrfachauswahl möglich.
                </p>
                <PdfThumbnailGrid
                  pdfBytes={coverPdfPicker.bytes}
                  selectedPages={coverPdfPicker.pages}
                  onChange={(pages) => setCoverPdfPicker(prev => prev ? { ...prev, pages } : null)}
                />
                <div className="cpdf-picker-summary">
                  {coverPdfPicker.pages.length === 0
                    ? <span style={{ color: '#ef4444' }}>Keine Seite ausgewählt</span>
                    : <span>{coverPdfPicker.pages.length} Seite(n) ausgewählt: {coverPdfPicker.pages.join(', ')}</span>
                  }
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="btn-cancel"
                  onClick={() => setCoverPdfPicker(null)}
                  disabled={coverPdfPickerSaving}
                >Abbrechen</button>
                <button
                  className="btn-primary"
                  onClick={saveCoverPdfPickerSelection}
                  disabled={coverPdfPickerSaving || coverPdfPicker.pages.length === 0}
                >{coverPdfPickerSaving ? 'Speichern...' : 'Übernehmen'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
