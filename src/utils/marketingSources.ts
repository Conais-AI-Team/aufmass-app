// Shared marketing-source options for Aufmaß and Schnellangebot forms.
// Keep this list short and meaningful — every entry needs to be a channel
// the back-office actually uses to allocate marketing budget. "Andere" is
// kept as the fallback so users aren't blocked when none of the above fit.
//
// Order is by observed frequency at AYLUX (Google/Empfehlung dominate),
// so the most-likely options appear at the top of the dropdown.

export interface MarketingSource {
  value: string;        // stored in DB — use stable English-ish slugs
  label: string;        // shown in UI (German)
}

export const MARKETING_SOURCES: MarketingSource[] = [
  { value: 'google',          label: 'Google / Internet-Suche' },
  { value: 'empfehlung',      label: 'Empfehlung (Familie / Freunde / Bekannte)' },
  { value: 'social_media',    label: 'Social Media (Facebook, Instagram)' },
  { value: 'werbung_print',   label: 'Werbung (Zeitung / Flyer / Briefkasten)' },
  { value: 'messe',           label: 'Messe / Ausstellung' },
  { value: 'bestandskunde',   label: 'Bestandskunde' },
  { value: 'andere',          label: 'Andere' },
];

export const getMarketingSourceLabel = (value: string | null | undefined): string => {
  if (!value) return '';
  return MARKETING_SOURCES.find((s) => s.value === value)?.label || value;
};
