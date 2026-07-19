function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableValue(value[key]);
      return out;
    }, {});
  }
  return value;
}

function valuesEqual(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function appliesToVariant(row, priceVariant) {
  const required = row.price_variant?.applies_variant;
  if (!required || typeof required !== 'object') return true;
  return Object.entries(required).every(([key, value]) => valuesEqual(priceVariant[key], value));
}

function fitsRequestedSize(row, sizeValues) {
  const componentSize = row.size_values && typeof row.size_values === 'object' ? row.size_values : {};
  return Object.entries(componentSize).every(([axis, value]) => {
    const requested = Number(sizeValues[axis]);
    return Number.isFinite(requested) && Number(value) >= requested;
  });
}

function sizeScore(row, sizeValues) {
  const componentSize = row.size_values && typeof row.size_values === 'object' ? row.size_values : {};
  return Object.entries(componentSize).reduce((sum, [axis, value]) => {
    const requested = Number(sizeValues[axis]);
    return sum + Math.max(0, Number(value) - (Number.isFinite(requested) ? requested : 0));
  }, 0);
}

export function calculateLewensOptionPricing({ rows, selections, sizeValues = {}, priceVariant = {} }) {
  const breakdown = [];
  const unresolved = [];

  for (const selection of selections) {
    const candidates = rows
      .filter(row => row.price_variant?.price_component === selection.code)
      .filter(row => appliesToVariant(row, priceVariant))
      .filter(row => fitsRequestedSize(row, sizeValues))
      .sort((left, right) => sizeScore(left, sizeValues) - sizeScore(right, sizeValues) || (left.id || 0) - (right.id || 0));
    const row = candidates[0];
    if (!row || row.price == null) {
      unresolved.push(selection.code);
      continue;
    }

    const calculation = row.price_variant?.calculation || 'fixed';
    const unitPrice = Number(row.price);
    let factor = selection.quantity;
    if (calculation === 'per_m2') {
      const areaM2 = selection.measure || (
        Number(sizeValues.markisenbreite || sizeValues.breite || 0)
        * Number(sizeValues.markisenlaenge || sizeValues.tiefe || sizeValues.markisenhoehe || 0)
        / 1_000_000
      );
      factor = areaM2 * selection.quantity;
    } else if (calculation === 'per_m') {
      const measureAxis = row.price_variant?.measure_axis;
      const lengthM = selection.measure || (Number(sizeValues[measureAxis] || 0) / 1000);
      factor = lengthM * selection.quantity;
    }
    if (!Number.isFinite(unitPrice) || !Number.isFinite(factor) || factor <= 0) {
      unresolved.push(selection.code);
      continue;
    }

    const total = Math.round(unitPrice * factor * 100) / 100;
    breakdown.push({
      code: selection.code,
      label: row.price_variant?.component_label || row.description || selection.code,
      calculation,
      unit_price: unitPrice,
      quantity: Math.round(factor * 1000) / 1000,
      total,
      source_document: row.source_document || null,
      source_page: row.source_page || null,
    });
  }

  return {
    additional_price: Math.round(breakdown.reduce((sum, item) => sum + item.total, 0) * 100) / 100,
    components: breakdown,
    unresolved,
  };
}
