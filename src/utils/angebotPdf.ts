// Shared Angebot-PDF regeneration. Both the Angebote page and the Aufmaß-side
// dropdown must produce IDENTICAL PDFs (with the product cover merged), so the
// payload build + regenerate-and-save flow lives here instead of being
// duplicated. Regenerating on open guarantees cached PDFs are never stale.
import { api, getForm, saveAngebotPdf, saveLeadPdf } from '../services/api';
import { generateAngebotPDF } from './angebotPdfGenerator';
import type { AngebotPdfData, AngebotPdfItem } from './angebotPdfGenerator';

interface LeadPdfItem {
  product_id?: number;
  product_name: string;
  breite: number;
  tiefe: number;
  quantity: number;
  unit_price: number;
  total_price: number;
  discount?: number;
  pricing_type?: 'dimension' | 'unit';
  unit_label?: string;
  description?: string;
  custom_fields?: AngebotPdfItem['custom_fields'];
  custom_field_values?: Record<string, string>;
}
interface LeadPdfExtra { description: string; price: number; }
interface LeadPdfAngebot {
  id: number;
  angebot_nummer?: string;
  subtotal?: number;
  total_discount?: number;
  total_price: number;
  notes?: string;
  created_at?: string;
  items: LeadPdfItem[];
  extras: LeadPdfExtra[];
}
export interface LeadPdfDetail {
  id: number;
  customer_firstname?: string;
  customer_lastname?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_address?: string;
  notes?: string;
  kunden_nummer?: string;
  angebot_nummer?: string;
  created_at?: string;
  subtotal?: number;
  total_discount?: number;
  total_price: number;
  items: LeadPdfItem[];
  extras: LeadPdfExtra[];
  angebote?: LeadPdfAngebot[];
  aufmass_form_id?: number | null;
}

export function buildAngebotPdfPayload(lead: LeadPdfDetail, angebot?: LeadPdfAngebot | null): AngebotPdfData {
  const items = angebot?.items || lead.items || [];
  const extras = angebot?.extras || lead.extras || [];
  const itemDiscounts = items.reduce((sum, item) => sum + (item.discount || 0), 0);
  const subtotalFromItems = items.reduce((sum, item) => sum + ((item.unit_price || 0) * (item.quantity || 0)), 0)
    + extras.reduce((sum, extra) => sum + (extra.price || 0), 0);
  const subtotal = angebot?.subtotal ?? lead.subtotal ?? subtotalFromItems;
  const totalDiscount = angebot?.total_discount ?? lead.total_discount ?? 0;
  const totalDiscountPercent = subtotal > 0
    ? Math.round((((itemDiscounts + totalDiscount) / subtotal) * 100 + Number.EPSILON) * 100) / 100
    : 0;

  return {
    customer_firstname: lead.customer_firstname || '',
    customer_lastname: lead.customer_lastname || '',
    customer_email: lead.customer_email || '',
    customer_phone: lead.customer_phone || undefined,
    customer_address: lead.customer_address || undefined,
    notes: angebot?.notes || lead.notes || undefined,
    kunden_nummer: lead.kunden_nummer || undefined,
    angebot_nummer: angebot?.angebot_nummer || lead.angebot_nummer || undefined,
    created_at: angebot?.created_at || lead.created_at,
    items: items.map(item => ({
      product_id: item.product_id,
      product_name: item.product_name,
      breite: item.breite,
      tiefe: item.tiefe,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
      discount: item.discount || 0,
      discount_percent: item.discount && item.unit_price && item.quantity
        ? Math.round((((item.discount / (item.unit_price * item.quantity)) * 100) + Number.EPSILON) * 100) / 100
        : 0,
      pricing_type: item.pricing_type,
      unit_label: item.unit_label,
      description: item.description || undefined,
      custom_fields: item.custom_fields || undefined,
      custom_field_values: item.custom_field_values || undefined,
    })),
    extras: extras.map(extra => ({ description: extra.description, price: extra.price })),
    subtotal,
    item_discounts: itemDiscounts,
    total_discount: totalDiscount,
    total_discount_percent: totalDiscountPercent,
    total_price: angebot?.total_price ?? lead.total_price,
  };
}

// Regenerate an Angebot PDF (or the lead-level PDF when angebotId is null) from
// CURRENT data and save it server-side, where the product cover is merged in.
// This keeps every view — Angebote page or Aufmaß dropdown — cover-consistent.
export async function regenerateAndSaveAngebotPdf(leadId: number, angebotId: number | null): Promise<void> {
  const lead = await api.get<LeadPdfDetail>(`/leads/${leadId}`);
  const angebot = angebotId ? lead.angebote?.find(a => a.id === angebotId) : undefined;

  let bilder: AngebotPdfData['bilder'];
  if (lead.aufmass_form_id) {
    try {
      bilder = (await getForm(lead.aufmass_form_id)).bilder as AngebotPdfData['bilder'];
    } catch { /* photos are optional — skip on failure */ }
  }

  const result = await generateAngebotPDF(
    { ...buildAngebotPdfPayload(lead, angebot), bilder },
    { returnBlob: true, deferServerMerge: true }
  );
  if (!result?.blob) throw new Error('PDF konnte nicht erstellt werden');

  if (angebotId) await saveAngebotPdf(leadId, angebotId, result.blob, result.mergePlan);
  else await saveLeadPdf(leadId, result.blob, result.mergePlan);
}
