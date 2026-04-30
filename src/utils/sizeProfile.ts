// MODÜL B v3: size profile detection from productConfig.json
// 8 dimension profiles (P1–P8), each with axis list + display labels.
// Used by LeadFormModal/Angebot to show correct input fields and call
// the generic /api/lead-products/:name/lookup endpoint.

import productConfigData from '../config/productConfig.json';

interface ProductConfigField {
  name: string;
  label?: string;
  type?: string;
  unit?: string;
}

interface ProductConfigType {
  models?: string[];
  fields?: ProductConfigField[];
}

const productConfig = productConfigData as Record<string, Record<string, ProductConfigType>>;

export type SizeProfile = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8';

export const PROFILE_AXES: Record<SizeProfile, string[]> = {
  P1: ['breite', 'tiefe'],
  P2: ['markisenbreite', 'markisenlaenge'],
  P3: ['markisenbreite', 'markisenlaenge', 'markisenhoehe'],
  P4: ['markisenbreite', 'markisenhoehe'],
  P5: ['markisenbreite'],
  P6: ['breite', 'hoehe'],
  P7: ['breite', 'vorneHoehe', 'hintenHoehe'],
  P8: ['laenge', 'vorneHoehe', 'hintenHoehe'],
};

// Display labels for each axis (Almanca)
export const AXIS_LABELS: Record<string, string> = {
  breite: 'Breite',
  tiefe: 'Tiefe',
  hoehe: 'Höhe',
  laenge: 'Länge',
  markisenbreite: 'Breite',
  markisenlaenge: 'Länge',
  markisenhoehe: 'Höhe',
  vorneHoehe: 'Vorne Höhe',
  hintenHoehe: 'Hinten Höhe',
};

/** Infer size profile from a product's fields[] in productConfig.json. */
export function inferSizeProfile(fields: ProductConfigField[] | undefined): SizeProfile | null {
  const names = (fields || []).map(f => f.name);
  if (names.includes('markisenbreite') && names.includes('markisenlaenge') && names.includes('markisenhoehe')) return 'P3';
  if (names.includes('markisenbreite') && names.includes('markisenlaenge')) return 'P2';
  if (names.includes('markisenbreite') && names.includes('markisenhoehe')) return 'P4';
  if (names.includes('markisenbreite')) return 'P5';
  if (names.includes('breite') && names.includes('vorneHoehe') && names.includes('hintenHoehe')) return 'P7';
  if (names.includes('laenge') && names.includes('vorneHoehe') && names.includes('hintenHoehe')) return 'P8';
  if (names.includes('breite') && names.includes('hoehe')) return 'P6';
  if (names.includes('breite') && names.includes('tiefe')) return 'P1';
  return null;
}

/** Get size profile for a given category + product type, or null if unknown. */
export function getSizeProfileForType(category: string | undefined, productType: string | undefined): SizeProfile | null {
  if (!category || !productType) return null;
  const typeData = productConfig[category]?.[productType];
  return inferSizeProfile(typeData?.fields);
}

/** Extract size_values from Aufmaß specifications (numeric mm fields only). */
export function extractSizeValues(
  specifications: Record<string, unknown> | undefined,
  profile: SizeProfile
): Record<string, number> {
  const out: Record<string, number> = {};
  const axes = PROFILE_AXES[profile];
  for (const axis of axes) {
    const v = specifications?.[axis];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      out[axis] = v;
    }
  }
  return out;
}

/** Format size_values for display: "5000 × 3500 mm" or "5000 × 3000 × 2800 mm". */
export function formatSizeValues(sizeValues: Record<string, number>): string {
  const values = Object.values(sizeValues);
  if (values.length === 0) return '';
  return values.join(' × ') + ' mm';
}

/** Parse multi-select model field — Aufmaß main product can have multiple models.
 *  data.model can be a JSON array string ('["Skyline","Topline"]') or comma-separated. */
export function parseModelList(raw: unknown): string[] {
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map(String).map(x => x.trim()).filter(Boolean);
    } catch { /* fall through */ }
  }
  return s.split(',').map(x => x.trim()).filter(Boolean);
}
