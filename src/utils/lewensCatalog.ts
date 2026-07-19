import catalogData from '../config/lewensCatalogOptions.json';

export interface LewensCatalogComponent {
  code: string;
  label: string;
  group: string;
  calculation: 'fixed' | 'dimension' | 'per_m' | 'per_m2';
  price?: number;
  unit?: string;
  measure_axis?: string;
  automatic?: boolean;
  models?: string[];
  scopes?: string[];
  prices_by_variant?: Array<{ variant: Record<string, unknown>; price: number }>;
  prices_by_model?: Record<string, number>;
}

export interface LewensCatalogGroup {
  id: string;
  label: string;
  mode: 'multiple' | 'single';
}

export type LewensCatalogSelectionMap = Record<string, Record<string, number>>;

interface LewensCatalogData {
  scopes: Record<string, string[]>;
  groups: LewensCatalogGroup[];
  components: LewensCatalogComponent[];
}

const catalog = catalogData as LewensCatalogData;

export const lewensCatalogGroups = catalog.groups;

export const lewensModels = new Set(
  Object.values(catalog.scopes).flat()
);

export function isLewensModel(model: string | undefined | null): boolean {
  return Boolean(model && lewensModels.has(model));
}

export function getLewensComponentsForModel(model: string): LewensCatalogComponent[] {
  return catalog.components.filter(component => {
    if (component.automatic) return false;
    if (component.models?.includes(model)) return true;
    return component.scopes?.some(scope => catalog.scopes[scope]?.includes(model)) || false;
  });
}

export function parseLewensSelections(value: unknown): LewensCatalogSelectionMap {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as LewensCatalogSelectionMap;
  }
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as LewensCatalogSelectionMap
      : {};
  } catch {
    return {};
  }
}

export function getLewensSelectedComponents(
  value: unknown,
  model: string,
  specifications: Record<string, unknown> = {}
) {
  const selections = parseLewensSelections(value)[model] || {};
  const selected = Object.entries(selections)
    .filter(([, quantity]) => Number(quantity) > 0)
    .map(([code, quantity]) => ({ code, quantity: Number(quantity) }));
  if (catalog.scopes.murano?.includes(model)) {
    const automatic = new Map(selected.map(item => [item.code, item]));
    if (String(specifications.lewensSteelReinforcement || '').toLowerCase().includes('mit')) {
      automatic.set('roof_steel_reinforcement', { code: 'roof_steel_reinforcement', quantity: 1 });
    }
    if (String(specifications.lewensGlassDivision || '').toLowerCase().includes('mit')) {
      automatic.set('roof_glass_joint', { code: 'roof_glass_joint', quantity: 1 });
    }
    const postCount = Number(specifications.anzahlStuetzen);
    if (Number.isFinite(postCount) && postCount > 2) {
      automatic.set('roof_third_post', { code: 'roof_third_post', quantity: postCount - 2 });
    }
    return [...automatic.values()];
  }
  return selected;
}

export function formatLewensCatalogPrice(component: LewensCatalogComponent, model?: string): string {
  if (component.prices_by_variant?.length) return 'ausführungsabhängig';
  const modelPrice = model ? component.prices_by_model?.[model] : null;
  const value = modelPrice ?? component.price;
  if (value == null) return 'maßabhängig';
  const price = value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return component.unit ? `${price} € / ${component.unit}` : `${price} €`;
}
