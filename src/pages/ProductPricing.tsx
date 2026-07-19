import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import {
  api, getProductImages, uploadProductImage, deleteProductImage, setProductImageCoverFlag,
  getProductCoverPdf, uploadProductCoverPdf, setCoverPdfPages, deleteProductCoverPdf,
  fetchBranchPdfBytes, adjustProductPrice
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
  price_variant?: Record<string, unknown> | string | null;
  price_count?: number;
  variant_options?: ProductVariantOption[];
  is_summary?: boolean;
}

interface ProductVariantOption {
  key: string;
  label?: string;
  count: number;
}

interface PendingColumn {
  breite: number;
  prices: Record<number, string>; // tiefe -> price
}

interface PendingRow {
  tiefe: number;
  prices: Record<number, string>; // breite -> price
}

interface ImportProductPayload {
  category?: string | null;
  product_type?: string | null;
  product_name: string;
  pricing_type: 'dimension' | 'unit';
  breite: number;
  tiefe: number;
  price: number;
  unit_label?: string | null;
  description?: string | null;
  custom_fields?: string | null;
  price_variant?: Record<string, unknown> | null;
}

interface ImportPreviewRow {
  rowNumber: number;
  payload: ImportProductPayload;
  errors: string[];
}

export default function ProductPricing() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  // Filter state
  const [filterCategory, setFilterCategory] = useState('');
  const [filterProductType, setFilterProductType] = useState('');
  const [filterModel, setFilterModel] = useState('');

  // Expanded accordions
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [selectedProductVariants, setSelectedProductVariants] = useState<Record<string, string>>({});
  const [loadedProductNames, setLoadedProductNames] = useState<Set<string>>(new Set());
  const [loadingProductNames, setLoadingProductNames] = useState<Set<string>>(new Set());

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

  // Per-product percentage price adjustment (scales all rows/columns)
  const [adjustingProduct, setAdjustingProduct] = useState<string | null>(null);
  const [adjustPercent, setAdjustPercent] = useState('');
  const [adjustBusy, setAdjustBusy] = useState(false);

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

  // Excel/CSV import preview
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
  const [importRows, setImportRows] = useState<ImportPreviewRow[]>([]);
  const [importFileName, setImportFileName] = useState('');
  const [importResult, setImportResult] = useState<string | null>(null);

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    try {
      setLoading(true);
      const data = await api.get<Product[]>('/lead-products/summary');
      setProducts(data);
      setExpandedProducts(new Set());
      setLoadedProductNames(new Set());
    } catch (err) {
      console.error('Failed to load products:', err);
      setError('Fehler beim Laden der Produkte');
    } finally {
      setLoading(false);
    }
  };

  const ensureProductLoaded = async (productName: string, force = false): Promise<Product[]> => {
    if (!force && loadedProductNames.has(productName)) {
      return products.filter(p => p.product_name === productName && !p.is_summary);
    }

    setLoadingProductNames(prev => new Set(prev).add(productName));
    try {
      const rows = await api.get<Product[]>(`/lead-products/${encodeURIComponent(productName)}/matrix`);
      setProducts(prev => [
        ...prev.filter(p => p.product_name !== productName),
        ...rows
      ]);
      setLoadedProductNames(prev => new Set(prev).add(productName));
      return rows;
    } catch (err) {
      console.error('Failed to load product matrix:', err);
      setError('Fehler beim Laden der Preismatrix');
      return [];
    } finally {
      setLoadingProductNames(prev => {
        const next = new Set(prev);
        next.delete(productName);
        return next;
      });
    }
  };

  const handleAdjustPrice = async (productName: string) => {
    const pct = parseFloat(adjustPercent.replace(',', '.'));
    if (!Number.isFinite(pct) || pct === 0) {
      setError('Bitte einen gültigen Prozentwert eingeben (z. B. -10 oder 5).');
      return;
    }
    setAdjustBusy(true);
    try {
      const res = await adjustProductPrice(productName, pct);
      setAdjustingProduct(null);
      setAdjustPercent('');
      await ensureProductLoaded(productName, true);
      setError('');
      console.log(`[price-adjust] ${productName}: ${res.updated} Preise um ${pct}% angepasst`);
    } catch (err) {
      console.error('Price adjustment failed:', err);
      setError('Preisanpassung fehlgeschlagen.');
    } finally {
      setAdjustBusy(false);
    }
  };

  const normalizeVariantValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalizeVariantValue);
    if (value && typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = normalizeVariantValue((value as Record<string, unknown>)[key]);
          return acc;
        }, {});
    }
    return value;
  };

  const parsePriceVariant = (value: Product['price_variant']): Record<string, unknown> | null => {
    if (!value) return null;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : null;
      } catch {
        return null;
      }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  };

  const getPriceVariantKey = (value: Product['price_variant']) => {
    const parsed = parsePriceVariant(value);
    if (parsed?.price_component) {
      return JSON.stringify({
        price_component: parsed.price_component,
        component_label: parsed.component_label || parsed.price_component,
      });
    }
    return parsed ? JSON.stringify(normalizeVariantValue(parsed)) : '__default__';
  };

  const getPriceVariantLabel = (key: string) => {
    if (key === '__default__') return 'Standard';
    try {
      const variant = JSON.parse(key) as Record<string, unknown>;
      if (variant.price_component) return String(variant.component_label || variant.price_component);
      const preferred = [
        'zone',
        'snow_load_kn_m2',
        'glass_division',
        'roof_type',
        'rafter_height_mm',
        'price_basis',
        'covering',
        'glass',
        'freestanding',
        'tracks',
        'opening',
        'closure_type',
        'component',
        'price_component',
        'zip',
        'type_angle',
        'fabric',
        'retraction_brake'
      ];
      const labels: Record<string, string> = {
        zone: 'Schneelastzone',
        snow_load_kn_m2: 'Bemessungslast',
        glass_division: 'Glasteilung',
        roof_type: 'Dachtyp',
        rafter_height_mm: 'Sparrenhöhe',
        price_basis: 'Preisbasis',
        covering: 'Dacheindeckung',
        glass: 'Glas',
        freestanding: 'Freistehend',
        tracks: 'Spuren',
        opening: 'Öffnung',
        closure_type: 'Ausführung',
        component: 'Komponente',
        price_component: 'Preiskomponente',
        zip: 'ZIP',
        type_angle: 'Ausführung',
        fabric: 'Tuchart',
        retraction_brake: 'Rückschlagbremse'
      };
      const formatValue = (key: string, value: unknown) => {
        if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
        if (key === 'snow_load_kn_m2') return `${String(value).replace('.', ',')} kN/m²`;
        if (key === 'glass_division') return value === 'with' ? 'Mit' : 'Ohne';
        if (key === 'roof_type') {
          if (value === 'B') return 'Bündig (B)';
          if (value === 'U_50') return 'Überstand bis 50 cm';
          if (value === 'U_100') return 'Überstand bis 100 cm';
        }
        if (key === 'rafter_height_mm') return `${value} mm`;
        if (key === 'type_angle') return `${value}°`;
        if (key === 'opening') return value === 'center' ? 'Mittig' : 'Seitlich';
        if (key === 'glass' && value === 'without') return 'Ohne Glas';
        if (key === 'glass' && value === 'esg_8') return 'ESG 8 mm';
        if (key === 'glass' && value === 'esg_10') return 'ESG 10 mm';
        return String(value).replace(/_/g, ' ');
      };
      if ('snow_load_kn_m2' in variant) {
        return [
          formatValue('snow_load_kn_m2', variant.snow_load_kn_m2),
          `Glasteilung: ${formatValue('glass_division', variant.glass_division)}`,
          `Dachtyp: ${formatValue('roof_type', variant.roof_type)}`,
          ...('rafter_height_mm' in variant ? [`Sparren: ${formatValue('rafter_height_mm', variant.rafter_height_mm)}`] : []),
        ].join(' | ');
      }
      const keys = [...preferred.filter(k => k in variant), ...Object.keys(variant).filter(k => !preferred.includes(k)).sort()];
      return keys
        .map(k => `${labels[k] || k}: ${formatValue(k, variant[k])}`)
        .join(' | ');
    } catch {
      return key;
    }
  };

  const getPriceVariantFromKey = (key: string): Record<string, unknown> | null => {
    if (key === '__default__') return null;
    try {
      const parsed = JSON.parse(key);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  // Group products by name and create matrix structure
  const productMatrices = useMemo(() => {
    const grouped: Record<string, {
      products: Product[];
      visibleProducts: Product[];
      pricing_type: 'dimension' | 'unit';
      unit_label?: string;
      description?: string;
      custom_fields?: CustomField[];
      variantOptions: { key: string; label: string; count: number }[];
      activeVariantKey: string;
      activePriceVariant: Record<string, unknown> | null;
      price_count: number;
      isLoaded: boolean;
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
          visibleProducts: [],
          pricing_type: (p.pricing_type as 'dimension' | 'unit') || 'dimension',
          unit_label: p.unit_label,
          description: p.description,
          custom_fields: parsedCustomFields,
          variantOptions: [],
          activeVariantKey: '__default__',
          activePriceVariant: null,
          price_count: p.price_count || 0,
          isLoaded: !p.is_summary,
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
      grouped[p.product_name].price_count += p.is_summary ? 0 : 1;
      if (!p.is_summary) grouped[p.product_name].isLoaded = true;
      grouped[p.product_name].products.push(p);
    });

    Object.entries(grouped).forEach(([productName, g]) => {
      const variantCounts = new Map<string, number>();
      const summary = g.products.find(product => product.is_summary);
      if (summary?.variant_options?.length) {
        g.variantOptions = summary.variant_options
          .map(option => ({
            ...option,
            label: option.label || getPriceVariantLabel(option.key)
          }))
          .sort((a, b) => a.label.localeCompare(b.label, 'de'));
        g.price_count = summary.price_count || g.price_count;
      } else {
        g.products.forEach(product => {
          const key = getPriceVariantKey(product.price_variant);
          variantCounts.set(key, (variantCounts.get(key) || 0) + 1);
        });
        g.variantOptions = Array.from(variantCounts.entries())
          .map(([key, count]) => ({ key, label: getPriceVariantLabel(key), count }))
          .sort((a, b) => a.label.localeCompare(b.label, 'de'));
      }

      g.variantOptions.forEach(option => {
        variantCounts.set(option.key, option.count);
      });
      const requestedVariant = selectedProductVariants[productName];
      const activeVariant = requestedVariant && variantCounts.has(requestedVariant)
        ? requestedVariant
        : (g.variantOptions[0]?.key || '__default__');
      g.activeVariantKey = activeVariant;
      g.activePriceVariant = getPriceVariantFromKey(activeVariant);
      g.visibleProducts = g.isLoaded
        ? g.products.filter(product => !product.is_summary && getPriceVariantKey(product.price_variant) === activeVariant)
        : [];
      const rowsForMatrix = g.variantOptions.length > 1 ? g.visibleProducts : g.products;

      rowsForMatrix.forEach(p => {
        if (p.is_summary) return;
        g.unit_label ||= p.unit_label;
        g.description ||= p.description;

      if ((p.pricing_type || 'dimension') === 'dimension') {
        if (!g.breiteValues.includes(p.breite)) {
          g.breiteValues.push(p.breite);
        }
        if (!g.tiefeValues.includes(p.tiefe)) {
          g.tiefeValues.push(p.tiefe);
        }

        if (!g.matrix[p.breite]) {
          g.matrix[p.breite] = {};
        }
        g.matrix[p.breite][p.tiefe] = p;
      }
      });
    });

    Object.values(grouped).forEach(g => {
      g.breiteValues.sort((a, b) => a - b);
      g.tiefeValues.sort((a, b) => a - b);
    });

    return grouped;
  }, [products, selectedProductVariants]);

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
        void ensureProductLoaded(name);
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
  // currentPrice can be null for placeholder rows from eager seed (no price entered yet)
  const startEdit = (productName: string, breite: number, tiefe: number, currentPrice: number | null | undefined) => {
    setEditingCell({ productName, breite, tiefe });
    setEditValue(currentPrice != null ? currentPrice.toString() : '');
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
      // Optimistic update: only the changed row mutates — scroll position preserved.
      // Avoids the full-page re-render that loadProducts() triggered (page jumped to top).
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, price: newPrice } : p));
      cancelEdit();
    } catch (err) {
      console.error('Failed to update price:', err);
      alert('Preis konnte nicht gespeichert werden. Bitte Seite neu laden.');
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
            price: entry.price,
            price_variant: data.activePriceVariant
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
    const loadedRows = loadedProductNames.has(productName)
      ? products.filter(p => p.product_name === productName && !p.is_summary)
      : await ensureProductLoaded(productName);
    const productsToDelete = loadedRows.filter(p => !p.is_summary);
    try {
      await Promise.all(productsToDelete.map(p => api.delete(`/lead-products/${p.id}`)));
      await loadProducts();
      setDeleteConfirm(null);
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleDeleteRow = async (productName: string, tiefe: number) => {
    const productsToDelete = products.filter(p => p.product_name === productName && !p.is_summary && p.tiefe === tiefe);
    try {
      await Promise.all(productsToDelete.map(p => api.delete(`/lead-products/${p.id}`)));
      await loadProducts();
      setDeleteConfirm(null);
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleDeleteColumn = async (productName: string, breite: number) => {
    const productsToDelete = products.filter(p => p.product_name === productName && !p.is_summary && p.breite === breite);
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
    const rows = loadedProductNames.has(productName)
      ? products.filter(p => p.product_name === productName && !p.is_summary)
      : await ensureProductLoaded(productName);
    const productsToUpdate = rows.filter(p => !p.is_summary);
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
    const rows = loadedProductNames.has(productName)
      ? products.filter(p => p.product_name === productName && !p.is_summary)
      : await ensureProductLoaded(productName);
    const productsToUpdate = rows.filter(p => !p.is_summary);
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
    const activeProductData = productMatrices[productName];
    const priceVariant = activeProductData?.activePriceVariant || null;

    // Optimistic update - add to local state immediately
    const tempProduct: Product = {
      id: Date.now(), // temporary ID
      product_name: productName,
      breite,
      tiefe,
      price,
      branch_id: null,
      price_variant: priceVariant
    };
    setProducts(prev => [...prev, tempProduct]);
    cancelAddingPrice();

    try {
      const newProduct = await api.post<Product>('/lead-products', {
        product_name: productName,
        breite,
        tiefe,
        price,
        price_variant: priceVariant
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

  // ========== EXCEL / CSV IMPORT + CSV EXPORT ==========
  const csvEscape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const formatCsvPrice = (value: unknown): string => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const exportProductCsv = async (productName: string) => {
    if (!loadedProductNames.has(productName)) {
      await ensureProductLoaded(productName);
    }
    const data = productMatrices[productName];
    if (!data) return;
    const exportRows = data.variantOptions.length > 1 ? data.visibleProducts : data.products;
    const firstProduct = exportRows[0];
    if (!firstProduct) return;

    const makeLine = (values: unknown[]) => values.map(csvEscape).join(';');
    const lines: string[] = [];

    if (data.pricing_type === 'unit') {
      lines.push(makeLine(['Einheit', 'Preis']));
      exportRows.forEach(product => {
        lines.push(makeLine([product.unit_label || data.unit_label || 'Stk.', formatCsvPrice(product.price)]));
      });
    } else {
      lines.push(makeLine(['Tiefe \\ Breite', ...data.breiteValues]));
      data.tiefeValues.forEach(tiefe => {
        lines.push(makeLine([
          tiefe,
          ...data.breiteValues.map(breite => formatCsvPrice(data.matrix[breite]?.[tiefe]?.price))
        ]));
      });
    }

    const blob = new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${productName.replace(/[^a-z0-9_-]+/gi, '_')}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  const normalizeHeader = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

  const getImportValue = (row: Record<string, unknown>, aliases: string[]): unknown => {
    const normalizedAliases = aliases.map(normalizeHeader);
    for (const [key, value] of Object.entries(row)) {
      if (normalizedAliases.includes(normalizeHeader(key))) return value;
    }
    return '';
  };

  const parseImportNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    let normalized = String(value).replace(/\s/g, '').replace(/[€$]/g, '');
    if (normalized.includes(',') && normalized.includes('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else if (normalized.includes(',')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else if ((normalized.match(/\./g) || []).length > 1) {
      normalized = normalized.replace(/\./g, '');
    }
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  };

  const parseImportText = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text || null;
  };

  const buildImportPriceVariant = (row: Record<string, unknown>): Record<string, unknown> | null => {
    const entries: [string, string | null][] = [
      ['zone', parseImportText(getImportValue(row, ['zone', 'schneelastzone', 'snow_zone', 'snowzone']))],
      ['covering', parseImportText(getImportValue(row, ['covering', 'eindeckung', 'dacheindeckung', 'deckung']))],
      ['glass', parseImportText(getImportValue(row, ['glass', 'glas', 'glasart', 'glass_type']))],
      ['price_basis', parseImportText(getImportValue(row, ['price_basis', 'preisbasis', 'preis_basis', 'basis']))],
      ['tracks', parseImportText(getImportValue(row, ['tracks', 'spuren', 'laufspuren']))],
    ];
    const variant = Object.fromEntries(entries.filter(([, value]) => value));
    return Object.keys(variant).length > 0 ? variant : null;
  };

  const getImportProductNameFromFile = (fileName: string): string => {
    return fileName
      .replace(/\.[^.]+$/, '')
      .replace(/^\d+[-_\s]*/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const parseMatrixImportRows = (sheetRows: unknown[][], fileName: string): ImportPreviewRow[] | null => {
    const metadata: Record<string, string> = {};
    let headerIndex = -1;

    sheetRows.forEach((row, index) => {
      const first = parseImportText(row[0]);
      const second = parseImportText(row[1]);
      const normalizedFirst = first ? normalizeHeader(first) : '';

      if (first && second && ['produkt', 'product', 'product_name', 'modell', 'model', 'kategorie', 'category', 'produkttyp', 'product_type', 'typ', 'type', 'preismodell', 'pricing_type', 'beschreibung', 'description'].includes(normalizedFirst)) {
        metadata[normalizedFirst] = second;
      }

      if (
        headerIndex === -1 &&
        row.length > 1 &&
        (normalizedFirst.includes('tiefe') || normalizedFirst.includes('depth')) &&
        row.slice(1).some(cell => parseImportNumber(cell) !== null)
      ) {
        headerIndex = index;
      }
    });

    if (headerIndex === -1) return null;

    const headerRow = sheetRows[headerIndex];
    const breiteHeaders = headerRow.slice(1).map(parseImportNumber);
    const productName = metadata.produkt || metadata.product || metadata.product_name || metadata.modell || metadata.model || getImportProductNameFromFile(fileName);
    const category = metadata.kategorie || metadata.category || null;
    const productType = metadata.produkttyp || metadata.product_type || metadata.typ || metadata.type || null;
    const description = metadata.beschreibung || metadata.description || null;

    const previewRows: ImportPreviewRow[] = [];
    sheetRows.slice(headerIndex + 1).forEach((row, rowOffset) => {
      const tiefe = parseImportNumber(row[0]);
      if (tiefe === null && row.every(cell => !parseImportText(cell))) return;

      breiteHeaders.forEach((breite, colOffset) => {
        const price = parseImportNumber(row[colOffset + 1]);
        if (breite === null && price === null) return;

        const payload: ImportProductPayload = {
          category,
          product_type: productType,
          product_name: productName,
          pricing_type: 'dimension',
          breite: breite || 0,
          tiefe: tiefe || 0,
          price: price ?? 0,
          unit_label: null,
          description,
          custom_fields: null
        };

        const errors: string[] = [];
        if (!payload.product_name) errors.push('Produktname fehlt');
        if (!breite || !tiefe) errors.push('Breite/Tiefe fehlt');
        if (price === null || price < 0) errors.push('Preis fehlt oder ist ungültig');

        previewRows.push({ rowNumber: headerIndex + rowOffset + 2, payload, errors });
      });
    });

    return previewRows.length > 0 ? previewRows : null;
  };

  const parseUnitImportRows = (sheetRows: unknown[][], fileName: string): ImportPreviewRow[] | null => {
    const metadata: Record<string, string> = {};
    let headerIndex = -1;

    sheetRows.forEach((row, index) => {
      const first = parseImportText(row[0]);
      const second = parseImportText(row[1]);
      const normalizedFirst = first ? normalizeHeader(first) : '';

      if (first && second && ['produkt', 'product', 'product_name', 'modell', 'model', 'kategorie', 'category', 'produkttyp', 'product_type', 'typ', 'type', 'beschreibung', 'description'].includes(normalizedFirst)) {
        metadata[normalizedFirst] = second;
      }

      const normalizedRow = row.map(cell => normalizeHeader(String(cell || '')));
      if (headerIndex === -1 && normalizedRow.includes('einheit') && (normalizedRow.includes('preis') || normalizedRow.includes('price'))) {
        headerIndex = index;
      }
    });

    if (headerIndex === -1) return null;

    const headerRow = sheetRows[headerIndex].map(cell => normalizeHeader(String(cell || '')));
    const unitIndex = headerRow.indexOf('einheit');
    const priceIndex = headerRow.includes('preis') ? headerRow.indexOf('preis') : headerRow.indexOf('price');
    const productName = metadata.produkt || metadata.product || metadata.product_name || metadata.modell || metadata.model || getImportProductNameFromFile(fileName);
    const category = metadata.kategorie || metadata.category || null;
    const productType = metadata.produkttyp || metadata.product_type || metadata.typ || metadata.type || null;
    const description = metadata.beschreibung || metadata.description || null;

    const previewRows: ImportPreviewRow[] = [];
    sheetRows.slice(headerIndex + 1).forEach((row, rowOffset) => {
      if (row.every(cell => !parseImportText(cell))) return;
      const unitLabel = parseImportText(row[unitIndex]);
      const price = parseImportNumber(row[priceIndex]);
      const payload: ImportProductPayload = {
        category,
        product_type: productType,
        product_name: productName,
        pricing_type: 'unit',
        breite: 0,
        tiefe: 0,
        price: price ?? 0,
        unit_label: unitLabel,
        description,
        custom_fields: null
      };

      const errors: string[] = [];
      if (!payload.product_name) errors.push('Produktname fehlt');
      if (!unitLabel) errors.push('Einheit fehlt');
      if (price === null || price < 0) errors.push('Preis fehlt oder ist ungültig');

      previewRows.push({ rowNumber: headerIndex + rowOffset + 2, payload, errors });
    });

    return previewRows.length > 0 ? previewRows : null;
  };

  const parseRowBasedImportRows = (rawRows: Record<string, unknown>[], fileName: string): ImportPreviewRow[] => {
    const detectedNames = [...new Set(rawRows
      .map(row => parseImportText(getImportValue(row, ['product_name', 'produktname', 'produkt_name', 'produkt', 'modell', 'model', 'name'])))
      .filter((name): name is string => Boolean(name))
    )];
    const singleProductError = detectedNames.length > 1
      ? `Eine Importdatei darf nur ein Produkt enthalten. Gefunden: ${detectedNames.join(', ')}`
      : null;
    const fallbackProductName = detectedNames[0] || getImportProductNameFromFile(fileName);

    return rawRows.map((row, index) => {
      const category = parseImportText(getImportValue(row, ['category', 'kategorie']));
      const productType = parseImportText(getImportValue(row, ['product_type', 'produkttyp', 'produkt_typ', 'type', 'typ']));
      const productName = parseImportText(getImportValue(row, ['product_name', 'produktname', 'produkt_name', 'produkt', 'modell', 'model', 'name'])) || fallbackProductName;
      const rawPricingType = parseImportText(getImportValue(row, ['pricing_type', 'preismodell', 'preis_typ', 'price_type']));
      const unitLabel = parseImportText(getImportValue(row, ['unit_label', 'einheit', 'unit', 'einheit_label']));
      const breiteValue = parseImportNumber(getImportValue(row, ['breite', 'width', 'genislik', 'genişlik']));
      const tiefeValue = parseImportNumber(getImportValue(row, ['tiefe', 'depth', 'derinlik']));
      const priceValue = parseImportNumber(getImportValue(row, ['price', 'preis', 'betrag', 'fiyat', 'netto', 'brutto']));
      const description = parseImportText(getImportValue(row, ['description', 'beschreibung', 'aciklama', 'açıklama']));
      const customFields = parseImportText(getImportValue(row, ['custom_fields', 'formularfelder', 'fields']));
      const priceVariant = buildImportPriceVariant(row);
      const pricingType: 'dimension' | 'unit' =
        rawPricingType && ['unit', 'einheit', 'einheitspreis', 'piece', 'stuck', 'stueck'].includes(normalizeHeader(rawPricingType))
          ? 'unit'
          : (!breiteValue && !tiefeValue && unitLabel ? 'unit' : 'dimension');

      const payload: ImportProductPayload = {
        category,
        product_type: productType,
        product_name: productName,
        pricing_type: pricingType,
        breite: pricingType === 'unit' ? 0 : (breiteValue || 0),
        tiefe: pricingType === 'unit' ? 0 : (tiefeValue || 0),
        price: priceValue ?? 0,
        unit_label: unitLabel,
        description,
        custom_fields: customFields,
        price_variant: priceVariant
      };

      const errors: string[] = [];
      if (singleProductError) errors.push(singleProductError);
      if (!payload.product_name) errors.push('Produktname fehlt');
      if (pricingType === 'dimension' && (!breiteValue || !tiefeValue)) errors.push('Breite/Tiefe fehlt');
      if (priceValue === null || priceValue < 0) errors.push('Preis fehlt oder ist ungültig');

      return { rowNumber: index + 2, payload, errors };
    });
  };

  const parseProductImportRows = (sheetRows: unknown[][], rawRows: Record<string, unknown>[], fileName: string): ImportPreviewRow[] => {
    return parseMatrixImportRows(sheetRows, fileName)
      || parseUnitImportRows(sheetRows, fileName)
      || parseRowBasedImportRows(rawRows, fileName);
  };

  const handleImportFile = async (file: File) => {
    try {
      setImportResult(null);
      setError('');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        setError('Die Datei enthält kein Tabellenblatt');
        return;
      }
      const sheet = workbook.Sheets[firstSheetName];
      const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
      if (rawRows.length === 0 && sheetRows.length === 0) {
        setError('Keine Produktzeilen gefunden');
        return;
      }
      setImportFileName(file.name);
      setImportRows(parseProductImportRows(sheetRows, rawRows, file.name));
      setImportPreviewOpen(true);
    } catch (err) {
      console.error('Import parse error:', err);
      setError(err instanceof Error ? err.message : 'Datei konnte nicht gelesen werden');
    } finally {
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  const saveImportedProducts = async () => {
    const validRows = importRows.filter(row => row.errors.length === 0);
    if (validRows.length === 0) {
      setImportResult('Keine gültigen Zeilen zum Importieren.');
      return;
    }
    const importedProductNames = [...new Set(validRows.map(row => row.payload.product_name).filter(Boolean))];
    setSaving(true);
    setImportResult(null);
    try {
      const result = await api.post<{
        inserted: number;
        updated: number;
        skipped: number;
        errors?: { row: number; error: string }[];
      }>('/lead-products/import', {
        products: validRows.map(row => row.payload)
      });
      setImportResult(`Import abgeschlossen: ${result.inserted} neu, ${result.updated} aktualisiert, ${result.skipped} übersprungen.`);
      await loadProducts();
      setFilterCategory('');
      setFilterProductType('');
      setFilterModel('');
      if (importedProductNames.length > 0) {
        setExpandedProducts(new Set(importedProductNames));
      }
      if (result.inserted + result.updated > 0) {
        setImportPreviewOpen(false);
      }
    } catch (err) {
      console.error('Import save error:', err);
      setImportResult(err instanceof Error ? err.message : 'Import fehlgeschlagen');
    } finally {
      setSaving(false);
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
          <input
            ref={importFileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
            }}
          />
          <motion.button
            className="btn-toolbar"
            onClick={() => importFileRef.current?.click()}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Excel/CSV Import
          </motion.button>
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

      {/* Filter Section — chip-based for fast scanning across 50+ products */}
      {!loading && Object.keys(productMatrices).length > 0 && (() => {
        const allModelNames = Object.keys(productMatrices);
        const totalModels = allModelNames.length;
        const modelsWithPrice = allModelNames.filter(name => {
          const data = productMatrices[name];
          return (data?.price_count || data?.products.length || 0) > 0;
        }).length;
        const modelsWithoutPrice = totalModels - modelsWithPrice;

        return (
          <div className="filter-section">
            <div className="filter-summary">
              <strong>{totalModels} Modelle</strong>
              <span className="summary-pill summary-with-price">✓ {modelsWithPrice} mit Preis</span>
              {modelsWithoutPrice > 0 && (
                <span className="summary-pill summary-without-price">⚠ {modelsWithoutPrice} ohne Preis</span>
              )}
            </div>

            <div className="filter-chips-row">
              <span className="filter-chip-label">Kategorie:</span>
              <button
                className={`filter-chip ${!filterCategory ? 'is-active' : ''}`}
                onClick={() => { setFilterCategory(''); setFilterProductType(''); setFilterModel(''); }}
              >
                Alle <span className="chip-count">({totalModels})</span>
              </button>
              {filterOptions.categories.map(cat => {
                const catCount = allModelNames.filter(name => {
                  const p = products.find(pp => pp.product_name === name);
                  if (cat === '__uncategorized__') return !p?.category;
                  return p?.category === cat;
                }).length;
                if (catCount === 0) return null;
                return (
                  <button
                    key={cat}
                    className={`filter-chip ${filterCategory === cat ? 'is-active' : ''}`}
                    onClick={() => {
                      setFilterCategory(filterCategory === cat ? '' : cat);
                      setFilterProductType('');
                      setFilterModel('');
                    }}
                  >
                    {cat === '__uncategorized__' ? 'Ohne Kategorie' : cat}
                    <span className="chip-count">({catCount})</span>
                  </button>
                );
              })}
            </div>

            {filterCategory && filterCategory !== '__uncategorized__' && filterOptions.getProductTypes(filterCategory).length > 0 && (
              <div className="filter-chips-row">
                <span className="filter-chip-label">Typ:</span>
                <button
                  className={`filter-chip ${!filterProductType ? 'is-active' : ''}`}
                  onClick={() => { setFilterProductType(''); setFilterModel(''); }}
                >
                  Alle
                </button>
                {filterOptions.getProductTypes(filterCategory).map(pt => {
                  const ptCount = allModelNames.filter(name => {
                    const p = products.find(pp => pp.product_name === name);
                    return p?.category === filterCategory && p?.product_type === pt;
                  }).length;
                  if (ptCount === 0) return null;
                  return (
                    <button
                      key={pt}
                      className={`filter-chip ${filterProductType === pt ? 'is-active' : ''}`}
                      onClick={() => {
                        setFilterProductType(filterProductType === pt ? '' : pt);
                        setFilterModel('');
                      }}
                    >
                      {pt}
                      <span className="chip-count">({ptCount})</span>
                    </button>
                  );
                })}
              </div>
            )}

            {filterProductType && filterOptions.getModels(filterCategory, filterProductType).length > 0 && (
              <div className="filter-group" style={{ maxWidth: 280 }}>
                <label>Modell suchen</label>
                <input
                  type="text"
                  placeholder="Modellname eingeben..."
                  value={filterModel}
                  onChange={e => setFilterModel(e.target.value)}
                  list="filter-model-list"
                />
                <datalist id="filter-model-list">
                  {filterOptions.getModels(filterCategory, filterProductType).map(m => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
            )}
          </div>
        );
      })()}

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
            const isProductLoading = loadingProductNames.has(productName);
            const displayedProducts = data.variantOptions.length > 1 ? data.visibleProducts : data.products;
            const activeVariantCount = data.variantOptions.find(option => option.key === data.activeVariantKey)?.count;
            const totalPrices = data.isLoaded ? displayedProducts.length : (activeVariantCount || data.price_count || 0);
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
                    {data.variantOptions.length > 1 && (
                      <span className="price-count">{data.variantOptions.length} Varianten</span>
                    )}
                  </div>
                  <div className="accordion-actions" onClick={e => e.stopPropagation()}>
                    <button
                      className="btn-icon-small export"
                      onClick={() => data.isLoaded ? void exportProductCsv(productName) : void ensureProductLoaded(productName)}
                      title={data.isLoaded ? `${productName} als CSV exportieren` : 'Preise zuerst laden'}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      CSV
                    </button>
                    {data.isLoaded && data.pricing_type !== 'unit' && (
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
                    {adjustingProduct === productName ? (
                      <div className="price-adjust-inline" onClick={e => e.stopPropagation()}>
                        <input
                          type="number"
                          className="price-adjust-input"
                          value={adjustPercent}
                          onChange={e => setAdjustPercent(e.target.value)}
                          placeholder="z. B. -10"
                          step="0.5"
                          autoFocus
                          disabled={adjustBusy}
                          onKeyDown={e => {
                            if (e.key === 'Enter') void handleAdjustPrice(productName);
                            if (e.key === 'Escape') { setAdjustingProduct(null); setAdjustPercent(''); }
                          }}
                        />
                        <span className="price-adjust-suffix">%</span>
                        <button className="btn-icon-small" disabled={adjustBusy} onClick={() => void handleAdjustPrice(productName)} title="Anwenden">
                          {adjustBusy ? '…' : '✓'}
                        </button>
                        <button className="btn-icon-small" disabled={adjustBusy} onClick={() => { setAdjustingProduct(null); setAdjustPercent(''); }} title="Abbrechen">✕</button>
                      </div>
                    ) : (
                      <button
                        className="btn-icon-small"
                        onClick={() => { setAdjustingProduct(productName); setAdjustPercent(''); }}
                        title="Alle Preise dieses Produkts um Prozent anpassen (Auf-/Abschlag)"
                      >
                        %
                      </button>
                    )}
                    <button
                      className="btn-icon-small delete"
                      onClick={() => setDeleteConfirm({ type: 'product', productName })}
                      disabled={isProductLoading}
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
                      {data.variantOptions.length > 1 && (
                        <div className="variant-selector-row">
                          <label>Variante</label>
                          <select
                            value={data.activeVariantKey}
                            onChange={e => setSelectedProductVariants(prev => ({ ...prev, [productName]: e.target.value }))}
                          >
                            {data.variantOptions.map(option => (
                              <option key={option.key} value={option.key}>
                                {option.label} ({option.count})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {!data.isLoaded ? (
                        <div className="matrix-loading-state">
                          <div className="spinner"></div>
                          <span>{isProductLoading ? 'Preise werden geladen...' : 'Preise laden...'}</span>
                        </div>
                      ) : (
                      <>
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
                                    const product = displayedProducts[0];
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
                                    const product = displayedProducts[0];
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
                                  onClick={() => { setEditingCell({ productName, breite: -2, tiefe: 0 }); setEditValue(String(displayedProducts[0]?.price || 0)); }}
                                >
                                  {(displayedProducts[0]?.price || 0).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
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
                      </>
                      )}

                      {/* Description Section - below table */}
                      {data.isLoaded && <div className="description-section">
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
                      </div>}

                      {/* Product Images & Cover-PDF Section */}
                      {data.isLoaded && data.products[0]?.id && (() => {
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

      {/* Import Preview Modal */}
      <AnimatePresence>
        {importPreviewOpen && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !saving && setImportPreviewOpen(false)}
          >
            <motion.div
              className="product-modal import-preview-modal"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="modal-header">
                <div>
                  <h2>Import Vorschau</h2>
                  <p className="import-file-name">{importFileName}</p>
                </div>
                <button className="close-btn" onClick={() => !saving && setImportPreviewOpen(false)} disabled={saving}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="modal-body">
                <div className="import-summary">
                  <span>{importRows.length} Zeilen</span>
                  <span className="ok">{importRows.filter(r => r.errors.length === 0).length} gültig</span>
                  <span className="bad">{importRows.filter(r => r.errors.length > 0).length} fehlerhaft</span>
                </div>

                {importResult && <div className="modal-info">{importResult}</div>}

                <div className="import-preview-table-wrap">
                  <table className="import-preview-table">
                    <thead>
                      <tr>
                        <th>Zeile</th>
                        <th>Status</th>
                        <th>Kategorie</th>
                        <th>Typ</th>
                        <th>Produkt</th>
                        <th>Preismodell</th>
                        <th>Breite</th>
                        <th>Tiefe</th>
                        <th>Preis</th>
                        <th>Fehler</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 300).map(row => (
                        <tr key={row.rowNumber} className={row.errors.length > 0 ? 'has-error' : ''}>
                          <td>{row.rowNumber}</td>
                          <td>{row.errors.length === 0 ? 'OK' : 'Fehler'}</td>
                          <td>{row.payload.category || '-'}</td>
                          <td>{row.payload.product_type || '-'}</td>
                          <td>{row.payload.product_name || '-'}</td>
                          <td>{row.payload.pricing_type}</td>
                          <td>{row.payload.pricing_type === 'unit' ? '-' : row.payload.breite}</td>
                          <td>{row.payload.pricing_type === 'unit' ? '-' : row.payload.tiefe}</td>
                          <td>{row.payload.price.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</td>
                          <td>{row.errors.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importRows.length > 300 && (
                    <div className="import-preview-limit">Es werden die ersten 300 Zeilen angezeigt.</div>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button className="btn-cancel" onClick={() => setImportPreviewOpen(false)} disabled={saving}>
                  Abbrechen
                </button>
                <button
                  className="btn-save"
                  onClick={saveImportedProducts}
                  disabled={saving || importRows.filter(r => r.errors.length === 0).length === 0}
                >
                  {saving ? 'Importiert...' : 'Gültige Zeilen speichern'}
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
