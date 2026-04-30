import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api, getLeadPdfUrl, getAngebotPdfUrl, getStoredUser, saveLeadPdf, saveAngebotPdf } from '../services/api';
import { generateAngebotPDF } from '../utils/angebotPdfGenerator';
import LeadFormModal from '../components/LeadFormModal';
import EmailComposer from '../components/EmailComposer';
import { useToast } from '../components/Toast';
import './Angebote.css';

interface Angebot {
  id: number;
  lead_id: number;
  angebot_nummer: string;
  subtotal: number;
  total_discount: number;
  total_price: number;
  notes: string;
  status: string;
  created_at: string;
  items: LeadItem[];
  extras: LeadExtra[];
}

interface Lead {
  id: number;
  customer_firstname: string;
  customer_lastname: string;
  customer_email: string;
  customer_phone: string;
  customer_address: string;
  notes: string;
  total_price: number;
  subtotal?: number;
  total_discount?: number;
  status: string;
  created_by_name: string;
  created_at: string;
  angebot_nummer?: string;
  kunden_nummer?: string;
  angebot_count?: number;
}

interface ProductCustomField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select';
  unit?: string;
  options?: string[];
  required?: boolean;
}

interface LeadItem {
  id: number;
  product_id?: number;
  product_name: string;
  breite: number;
  tiefe: number;
  quantity: number;
  unit_price: number;
  discount?: number;
  total_price: number;
  pricing_type?: 'dimension' | 'unit';
  unit_label?: string;
  // Enriched on the backend (GET /api/leads/:id) so we can render PRODUKTDETAILS
  description?: string;
  custom_fields?: ProductCustomField[];
  custom_field_values?: Record<string, string>;
}

interface LeadExtra {
  id: number;
  description: string;
  price: number;
}

interface LeadDetail extends Lead {
  items: LeadItem[];
  extras: LeadExtra[];
  angebote?: Angebot[];
}

const LEAD_STATUS_OPTIONS = [
  { value: 'alle', label: 'Alle Angebote', color: '#7fa93d' },
  { value: 'unbearbeitet', label: 'Unbearbeitet', color: '#6b7280' },
  { value: 'wiedervorlage', label: 'Wiedervorlage', color: '#f59e0b' },
  { value: 'aufmass_termin', label: 'Aufmaß Termin', color: '#8b5cf6' },
  { value: 'aufmass_erstellt', label: 'Aufmaß Erstellt', color: '#10b981' },
  { value: 'showroom_termin', label: 'Showroom Termin', color: '#a78bfa' },
  { value: 'tag1_nicht_erreicht', label: '1.Tag nicht Erreicht', color: '#fb923c' },
  { value: 'tag2_nicht_erreicht', label: '2.Tag nicht Erreicht', color: '#f97316' },
  { value: 'tag3_nicht_erreicht', label: '3.Tag nicht Erreicht', color: '#ea580c' },
  { value: 'tag4_email', label: '4.Tag E-Mail Geschrieben', color: '#c2410c' },
  { value: 'auftrag_erteilt', label: 'Auftrag Erteilt', color: '#3b82f6' },
  { value: 'abgelehnt', label: 'Abgelehnt', color: '#ef4444' },
  { value: 'komplett_raus', label: 'Komplett Raus', color: '#71717a' },
  { value: 'offen', label: 'Offen', color: '#fbbf24' },
];

const LEAD_STATUS_ORDER = LEAD_STATUS_OPTIONS.filter(o => o.value !== 'alle').map(o => o.value);

const getLeadStatusLabel = (status: string) => {
  const opt = LEAD_STATUS_OPTIONS.find(o => o.value === status);
  return opt?.label || status;
};

const getLeadStatusColor = (status: string) => {
  const opt = LEAD_STATUS_OPTIONS.find(o => o.value === status);
  return opt?.color || '#6b7280';
};

const isAdminOrOffice = () => {
  const user = getStoredUser();
  return user?.role === 'admin' || user?.role === 'office';
};

const isLeadStatusBackward = (current: string, next: string): boolean => {
  return LEAD_STATUS_ORDER.indexOf(next) < LEAD_STATUS_ORDER.indexOf(current);
};

export default function Angebote() {
  const navigate = useNavigate();
  const toast = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState<number | null>(null);
  const [emailComposer, setEmailComposer] = useState<{ to: string; subject: string; body: string; leadId?: number; emailType?: string; attachmentName?: string; angebote?: import('../components/EmailComposer').AngebotAttachment[]; angebotPdfData?: import('../utils/angebotPdfGenerator').AngebotPdfData } | null>(null);
  const [editLeadData, setEditLeadData] = useState<LeadDetail | null>(null);
  const [editAngebotId, setEditAngebotId] = useState<number | null>(null);
  const [newAngebotLeadId, setNewAngebotLeadId] = useState<number | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadDetail | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteAngebotConfirm, setDeleteAngebotConfirm] = useState<{ leadId: number; angebotId: number } | null>(null);
  const [expandedLeadId, setExpandedLeadId] = useState<number | null>(null);
  const [expandedAngebote, setExpandedAngebote] = useState<Record<number, Angebot[]>>({});
  const [filterStatus, setFilterStatus] = useState('alle');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadLeads();
  }, []);

  // Close status dropdown on outside click
  useEffect(() => {
    if (!statusDropdownOpen) return;
    const close = () => setStatusDropdownOpen(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [statusDropdownOpen]);

  const loadLeads = async () => {
    try {
      const data = await api.get<Lead[]>('/leads');
      setLeads(data);
    } catch (err) {
      console.error('Failed to load leads:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetails = async (id: number) => {
    try {
      const data = await api.get<LeadDetail>(`/leads/${id}`);
      setSelectedLead(data);
      setDetailModalOpen(true);
    } catch (err) {
      console.error('Failed to load lead details:', err);
    }
  };

  const handleEditLead = async (id: number, angebotId?: number) => {
    try {
      const data = await api.get<LeadDetail>(`/leads/${id}`);
      setEditLeadData(data);
      setEditAngebotId(angebotId || null);
      setNewAngebotLeadId(null);
      setLeadModalOpen(true);
    } catch (err) {
      console.error('Failed to load lead for editing:', err);
    }
  };

  const handleAddAngebot = async (leadId: number) => {
    try {
      const data = await api.get<LeadDetail>(`/leads/${leadId}`);
      setEditLeadData(data);
      setEditAngebotId(null);
      setNewAngebotLeadId(leadId);
      setLeadModalOpen(true);
    } catch (err) {
      console.error('Failed to load lead for new angebot:', err);
    }
  };

  const handleCreateAufmass = async (lead: Lead | LeadDetail) => {
    try {
      let leadDetail: LeadDetail;
      if ('items' in lead) {
        leadDetail = lead;
      } else {
        leadDetail = await api.get<LeadDetail>(`/leads/${lead.id}`);
      }

      navigate('/form/new', {
        state: {
          fromLead: true,
          leadId: leadDetail.id,
          kundeVorname: leadDetail.customer_firstname,
          kundeNachname: leadDetail.customer_lastname,
          kundeEmail: leadDetail.customer_email,
          kundeTelefon: leadDetail.customer_phone,
          kundenlokation: leadDetail.customer_address,
          leadItems: leadDetail.items,
          leadExtras: leadDetail.extras,
          leadNotes: leadDetail.notes
        }
      });
    } catch (err) {
      console.error('Failed to load lead details:', err);
    }
  };

  const handleLeadStatusChange = async (leadId: number, newStatus: string) => {
    const lead = leads.find(l => l.id === leadId);
    const currentStatus = lead?.status || 'offen';

    if (!isAdminOrOffice() && isLeadStatusBackward(currentStatus, newStatus)) {
      toast.warning('Nicht erlaubt', 'Status kann nur von einem Admin zurückgesetzt werden.');
      setStatusDropdownOpen(null);
      return;
    }

    try {
      await api.put(`/leads/${leadId}/status`, { status: newStatus });
      setLeads(leads.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
      setStatusDropdownOpen(null);
    } catch (err) {
      console.error('Failed to update lead status:', err);
      toast.error('Fehler', 'Status konnte nicht aktualisiert werden.');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/leads/${id}`);
      setLeads(leads.filter(l => l.id !== id));
      setDeleteConfirmId(null);
    } catch (err) {
      console.error('Failed to delete lead:', err);
    }
  };

  const handleDeleteAngebot = async (leadId: number, angebotId: number) => {
    try {
      await api.delete(`/leads/${leadId}/angebote/${angebotId}`);
      setDeleteAngebotConfirm(null);
      // Refresh lead data
      loadLeads();
      if (expandedLeadId === leadId) {
        loadAngebote(leadId);
      }
    } catch (err) {
      console.error('Failed to delete angebot:', err);
    }
  };

  const loadAngebote = async (leadId: number) => {
    try {
      const data = await api.get<LeadDetail>(`/leads/${leadId}`);
      setExpandedAngebote(prev => ({ ...prev, [leadId]: data.angebote || [] }));
    } catch (err) {
      console.error('Failed to load angebote:', err);
    }
  };

  const toggleExpand = async (leadId: number) => {
    if (expandedLeadId === leadId) {
      setExpandedLeadId(null);
    } else {
      setExpandedLeadId(leadId);
      if (!expandedAngebote[leadId]) {
        await loadAngebote(leadId);
      }
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(price);
  };

  const getLatestAngebot = (lead: LeadDetail) => {
    if (!lead.angebote || lead.angebote.length === 0) return null;
    return [...lead.angebote].sort((a, b) => {
      const dateDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return dateDiff !== 0 ? dateDiff : b.id - a.id;
    })[0];
  };

  const buildPdfPayload = (lead: LeadDetail, angebot?: Angebot | null) => {
    const items = angebot?.items || lead.items || [];
    const extras = angebot?.extras || lead.extras || [];
    const itemDiscounts = items.reduce((sum, item) => sum + (item.discount || 0), 0);
    const subtotalFromItems = items.reduce((sum, item) => sum + ((item.unit_price || 0) * (item.quantity || 0)), 0) + extras.reduce((sum, extra) => sum + (extra.price || 0), 0);
    const subtotal = angebot?.subtotal ?? lead.subtotal ?? subtotalFromItems;
    const totalDiscount = angebot?.total_discount ?? lead.total_discount ?? 0;
    const totalDiscountPercent = subtotal > 0 ? Math.round(((itemDiscounts + totalDiscount) / subtotal) * 100) : 0;

    return {
      customer_firstname: lead.customer_firstname,
      customer_lastname: lead.customer_lastname,
      customer_email: lead.customer_email,
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
          ? Math.round((item.discount / (item.unit_price * item.quantity)) * 100)
          : 0,
        pricing_type: item.pricing_type,
        unit_label: item.unit_label,
        description: item.description || undefined,
        custom_fields: item.custom_fields || undefined,
        custom_field_values: item.custom_field_values || undefined
      })),
      extras: extras.map(extra => ({
        description: extra.description,
        price: extra.price
      })),
      subtotal,
      item_discounts: itemDiscounts,
      total_discount: totalDiscount,
      total_discount_percent: totalDiscountPercent,
      total_price: angebot?.total_price ?? lead.total_price
    };
  };

  const ensurePdfWindow = () => {
    const pdfWindow = window.open('', '_blank');
    if (pdfWindow) {
      pdfWindow.document.write('PDF wird geladen...');
    }
    return pdfWindow;
  };

  const openLeadPdfWithFallback = async (leadId: number, preload?: LeadDetail | null) => {
    const pdfWindow = ensurePdfWindow();
    if (!pdfWindow) return;

    try {
      // Always fetch latest lead detail so we know whether angebote exist
      const leadDetail = preload?.id === leadId ? preload : await api.get<LeadDetail>(`/leads/${leadId}`);
      const latestAngebot = getLatestAngebot(leadDetail);

      // Prefer angebot-level PDF when available — lead-level cache can be stale after edits
      if (latestAngebot) {
        // Always regenerate from current lead/angebot data to guarantee fresh content (Beschreibung etc.)
        const pdfResult = await generateAngebotPDF(buildPdfPayload(leadDetail, latestAngebot), { returnBlob: true });
        if (!pdfResult?.blob) {
          throw new Error('PDF blob could not be generated');
        }
        await saveAngebotPdf(leadId, latestAngebot.id, pdfResult.blob);
        pdfWindow.location.href = getAngebotPdfUrl(leadId, latestAngebot.id);
        return;
      }

      // Legacy fallback: lead has no angebote (should be rare)
      const pdfUrl = getLeadPdfUrl(leadId);
      const existingResponse = await fetch(pdfUrl, { cache: 'no-store' });
      if (existingResponse.ok) {
        pdfWindow.location.href = pdfUrl;
        return;
      }

      const pdfResult = await generateAngebotPDF(buildPdfPayload(leadDetail), { returnBlob: true });
      if (!pdfResult?.blob) {
        throw new Error('PDF blob could not be generated');
      }
      await saveLeadPdf(leadId, pdfResult.blob);
      pdfWindow.location.href = pdfUrl;
    } catch (err) {
      pdfWindow.close();
      console.error('Lead PDF fallback failed:', err);
      toast.error('Fehler', 'PDF konnte nicht erstellt werden.');
    }
  };

  const openAngebotPdfWithFallback = async (leadId: number, angebotId: number, preload?: LeadDetail | null) => {
    const pdfUrl = getAngebotPdfUrl(leadId, angebotId);
    const pdfWindow = ensurePdfWindow();
    if (!pdfWindow) return;

    try {
      // Always regenerate to ensure freshness (Beschreibung, prices, etc. reflect latest edits)
      const leadDetail = preload?.id === leadId ? preload : await api.get<LeadDetail>(`/leads/${leadId}`);
      const angebot = leadDetail.angebote?.find(item => item.id === angebotId);
      if (!angebot) {
        throw new Error(`Angebot ${angebotId} not found`);
      }

      const pdfResult = await generateAngebotPDF(buildPdfPayload(leadDetail, angebot), { returnBlob: true });
      if (!pdfResult?.blob) {
        throw new Error('PDF blob could not be generated');
      }

      await saveAngebotPdf(leadId, angebotId, pdfResult.blob);
      pdfWindow.location.href = pdfUrl;
    } catch (err) {
      pdfWindow.close();
      console.error('Angebot PDF fallback failed:', err);
      toast.error('Fehler', 'Angebot-PDF konnte nicht erstellt werden.');
    }
  };

  // Trigger browser download of a PDF blob
  // downloadPdfBlob removed - emails now sent via EmailComposer

  // buildAngebotMailto removed - replaced by EmailComposer

  // Send the latest angebot for a lead by e-mail (opens in-app composer)
  const handleSendLeadByEmail = async (lead: Lead | LeadDetail) => {
    if (!lead.customer_email) {
      toast.warning('Keine E-Mail', 'Für diesen Kunden ist keine E-Mail-Adresse hinterlegt.');
      return;
    }
    try {
      const leadDetail: LeadDetail = 'items' in lead
        ? lead
        : await api.get<LeadDetail>(`/leads/${lead.id}`);

      const angeboteList = leadDetail.angebote || [];

      // Generate and save PDFs for all Angebote in parallel (was sequential — much slower)
      const tasks = angeboteList.map(async (ang) => {
        try {
          const pdfResult = await generateAngebotPDF(
            buildPdfPayload(leadDetail, ang),
            { returnBlob: true }
          );
          if (pdfResult?.blob) {
            await saveAngebotPdf(leadDetail.id, ang.id, pdfResult.blob);
            return { id: ang.id, angebot_nummer: ang.angebot_nummer || `#${ang.id}`, ready: true };
          }
        } catch {
          // fall through to ready:false
        }
        return { id: ang.id, angebot_nummer: ang.angebot_nummer || `#${ang.id}`, ready: false };
      });
      const angeboteAttachments: import('../components/EmailComposer').AngebotAttachment[] = await Promise.all(tasks);

      // If no angebote, generate lead-level PDF
      if (angeboteList.length === 0) {
        const pdfResult = await generateAngebotPDF(
          buildPdfPayload(leadDetail, undefined),
          { returnBlob: true }
        );
        if (pdfResult?.blob) {
          await saveLeadPdf(leadDetail.id, pdfResult.blob);
        }
      }

      const customerName = `${leadDetail.customer_firstname || ''} ${leadDetail.customer_lastname || ''}`.trim();
      const greeting = customerName ? `Sehr geehrte/r ${customerName},` : 'Sehr geehrte Damen und Herren,';
      const angCount = angeboteAttachments.length;

      // If exactly one Angebot exists, expose its payload so the user can split per product
      const singleAng = angeboteList.length === 1 ? angeboteList[0] : null;
      setEmailComposer({
        to: leadDetail.customer_email,
        subject: `Ihr Angebot - AYLUX Sonnenschutzsysteme`,
        body: `${greeting}\n\nvielen Dank für Ihre Anfrage. In der Anlage erhalten Sie ${angCount > 1 ? 'unsere Angebote' : 'unser Angebot'}.\n\nBei Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\nIhr AYLUX Team`,
        leadId: leadDetail.id,
        emailType: 'angebot',
        angebote: angeboteAttachments.length > 0 ? angeboteAttachments : undefined,
        angebotPdfData: singleAng ? buildPdfPayload(leadDetail, singleAng) : (angeboteList.length === 0 ? buildPdfPayload(leadDetail, undefined) : undefined),
      });
    } catch (err) {
      console.error('Send lead by e-mail failed:', err);
      toast.error('Fehler', 'E-Mail konnte nicht vorbereitet werden.');
    }
  };

  // Send a specific angebot by e-mail (used from the per-angebot row)
  const handleSendAngebotByEmail = async (leadId: number, angebotId: number) => {
    try {
      const leadDetail = await api.get<LeadDetail>(`/leads/${leadId}`);
      if (!leadDetail.customer_email) {
        toast.warning('Keine E-Mail', 'Für diesen Kunden ist keine E-Mail-Adresse hinterlegt.');
        return;
      }
      const angebot = leadDetail.angebote?.find(a => a.id === angebotId);
      if (!angebot) throw new Error(`Angebot ${angebotId} not found`);

      const pdfResult = await generateAngebotPDF(
        buildPdfPayload(leadDetail, angebot),
        { returnBlob: true }
      );
      if (!pdfResult?.blob) throw new Error('PDF blob could not be generated');

      await saveAngebotPdf(leadId, angebotId, pdfResult.blob);

      const customerName = `${leadDetail.customer_firstname || ''} ${leadDetail.customer_lastname || ''}`.trim();
      const nrPart = angebot.angebot_nummer ? ` Nr. ${angebot.angebot_nummer}` : '';
      const greeting = customerName ? `Sehr geehrte/r ${customerName},` : 'Sehr geehrte Damen und Herren,';

      setEmailComposer({
        to: leadDetail.customer_email,
        subject: `Ihr Angebot${nrPart} - AYLUX Sonnenschutzsysteme`,
        body: `${greeting}\n\nvielen Dank für Ihre Anfrage. In der Anlage erhalten Sie unser Angebot${nrPart}.\n\nBei Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\nIhr AYLUX Team`,
        leadId: leadDetail.id,
        emailType: 'angebot',
        angebote: [{ id: angebotId, angebot_nummer: angebot.angebot_nummer || `#${angebotId}`, ready: true }],
        // Pass payload so EmailComposer can offer "Pro Produkt einzelne PDF" for multi-item angebote
        angebotPdfData: buildPdfPayload(leadDetail, angebot),
      });
    } catch (err) {
      console.error('Send angebot by e-mail failed:', err);
      toast.error('Fehler', 'E-Mail konnte nicht vorbereitet werden.');
    }
  };

  // Render PRODUKTDETAILS (custom field values) under an item in the detail modal.
  // Uses the product's custom_fields schema (enriched on backend) so labels are human-readable;
  // falls back to the field id when no schema is available.
  const renderItemProduktdetails = (item: LeadItem) => {
    const values = item.custom_field_values;
    if (!values || Object.keys(values).length === 0) return null;
    const schemaById: Record<string, ProductCustomField> = {};
    if (Array.isArray(item.custom_fields)) {
      for (const f of item.custom_fields) schemaById[f.id] = f;
    }
    const entries = Object.entries(values).filter(([, v]) => v != null && String(v).trim() !== '');
    if (entries.length === 0) return null;
    return (
      <div className="item-produktdetails">
        <span className="item-produktdetails-title">PRODUKTDETAILS</span>
        <div className="item-produktdetails-list">
          {entries.map(([fieldId, val]) => {
            const field = schemaById[fieldId];
            const label = field?.label || fieldId;
            const suffix = field?.type === 'number' && field.unit ? ` ${field.unit}` : '';
            return (
              <div key={fieldId} className="item-produktdetails-row">
                <span className="item-produktdetails-label">{label}:</span>
                <span className="item-produktdetails-value">{String(val)}{suffix}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const filteredLeads = leads.filter(lead => {
    const matchesStatus = filterStatus === 'alle' || lead.status === filterStatus;
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q ||
      `${lead.customer_firstname} ${lead.customer_lastname}`.toLowerCase().includes(q) ||
      lead.customer_email?.toLowerCase().includes(q) ||
      lead.customer_phone?.toLowerCase().includes(q) ||
      lead.customer_address?.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  const getAngebotCount = (lead: Lead) => parseInt(String(lead.angebot_count || 0));

  return (
    <div className="angebote-page">
      <header className="page-header">
        <div className="header-left">
          <h1>Angebote</h1>
        </div>
        <div className="header-right">
          <motion.button
            className="btn-primary"
            onClick={() => { setEditLeadData(null); setEditAngebotId(null); setNewAngebotLeadId(null); setLeadModalOpen(true); }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Neues Angebot
          </motion.button>
        </div>
      </header>

      {/* Filter Tabs + Search */}
      <div className="lead-filters">
        <div className="lead-filter-tabs">
          {LEAD_STATUS_OPTIONS.map(option => (
            <button
              key={option.value}
              className={`lead-filter-tab ${filterStatus === option.value ? 'active' : ''}`}
              onClick={() => setFilterStatus(option.value)}
              style={{ '--tab-color': option.color } as React.CSSProperties}
            >
              <span className="lead-status-dot" style={{ backgroundColor: option.color }} />
              <span>{option.label}</span>
              <span className="lead-tab-count">
                {option.value === 'alle'
                  ? leads.length
                  : leads.filter(l => l.status === option.value).length}
              </span>
            </button>
          ))}
        </div>
        <div className="lead-search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Suche nach Name, E-Mail, Adresse..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery('')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Lade Angebote...</p>
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <h3>{searchQuery || filterStatus !== 'alle' ? 'Keine Ergebnisse' : 'Keine Angebote'}</h3>
          <p>{searchQuery || filterStatus !== 'alle' ? 'Versuchen Sie andere Filter oder Suchbegriffe' : 'Erstellen Sie Ihr erstes Angebot'}</p>
          {!searchQuery && filterStatus === 'alle' && (
            <button className="btn-primary" onClick={() => setLeadModalOpen(true)}>
              Erstes Angebot erstellen
            </button>
          )}
        </div>
      ) : (
        <div className="leads-list">
          {filteredLeads.map(lead => (
            <motion.div
              key={lead.id}
              className="lead-card"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="lead-header">
                <div className="lead-customer">
                  <h3>{lead.customer_firstname} {lead.customer_lastname}</h3>
                  <div className="lead-meta">
                    {lead.kunden_nummer && <span className="kunden-nummer">Kd: {lead.kunden_nummer}</span>}
                    {/* Lead-level angebot badge only for single-angebot leads.
                        For multi-angebot leads the individual numbers live in the expanded
                        dropdown (and the count shows in the footer "X Angebote" toggle),
                        so showing lead.angebot_nummer here would visually duplicate the
                        first angebot. */}
                    {lead.angebot_nummer && getAngebotCount(lead) <= 1 && (
                      <span className="angebot-nummer">Ang: {lead.angebot_nummer}</span>
                    )}
                    <span className="lead-email">{lead.customer_email}</span>
                  </div>
                </div>
                <div className="lead-status" style={{ position: 'relative' }}>
                  <span
                    className="status-badge status-badge-clickable"
                    style={{
                      background: `${getLeadStatusColor(lead.status)}20`,
                      color: getLeadStatusColor(lead.status),
                      cursor: 'pointer'
                    }}
                    onClick={(e) => { e.stopPropagation(); setStatusDropdownOpen(statusDropdownOpen === lead.id ? null : lead.id); }}
                  >
                    {getLeadStatusLabel(lead.status)}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12, marginLeft: 4 }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                  <AnimatePresence>
                    {statusDropdownOpen === lead.id && (
                      <motion.div
                        className="lead-status-dropdown"
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {LEAD_STATUS_OPTIONS.filter(o => o.value !== 'alle').map(option => (
                          <button
                            key={option.value}
                            className={`lead-status-option ${lead.status === option.value ? 'selected' : ''}`}
                            onClick={() => handleLeadStatusChange(lead.id, option.value)}
                          >
                            <span className="lead-status-dot" style={{ backgroundColor: option.color }} />
                            <span>{option.label}</span>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="lead-details">
                {lead.customer_phone && (
                  <div className="detail-item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
                    </svg>
                    <span>{lead.customer_phone}</span>
                  </div>
                )}
                {lead.customer_address && (
                  <div className="detail-item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <span>{lead.customer_address}</span>
                  </div>
                )}
                <div className="detail-item">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <span>{formatDate(lead.created_at)}</span>
                </div>
              </div>

              <div className="lead-footer">
                <div className="lead-price">
                  {getAngebotCount(lead) > 1 ? (
                    <>
                      <span className="price-label">ANGEBOTE</span>
                      <span className="price-value angebot-count-badge" onClick={() => toggleExpand(lead.id)}>
                        {getAngebotCount(lead)} Angebote
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, marginLeft: 4, transform: expandedLeadId === lead.id ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="price-label">GESAMTSUMME</span>
                      <span className="price-value">{formatPrice(lead.total_price)}</span>
                    </>
                  )}
                </div>
                <div className="lead-actions">
                  <button
                    className="btn-icon"
                    title="PDF anzeigen"
                    onClick={() => openLeadPdfWithFallback(lead.id)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </button>
                  <button
                    className="btn-icon"
                    title="Per E-Mail senden"
                    onClick={() => handleSendLeadByEmail(lead)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                  </button>
                  <button
                    className="btn-icon"
                    title="Bearbeiten"
                    onClick={() => handleEditLead(lead.id)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    className="btn-icon"
                    title="Details anzeigen"
                    onClick={() => handleViewDetails(lead.id)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                  <button
                    className="btn-icon delete"
                    title="Löschen"
                    onClick={() => setDeleteConfirmId(lead.id)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                  <button
                    className="btn-new-angebot"
                    onClick={() => handleAddAngebot(lead.id)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Angebot
                  </button>
                  <button
                    className="btn-aufmass"
                    onClick={() => handleCreateAufmass(lead)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                      <line x1="12" y1="22.08" x2="12" y2="12" />
                    </svg>
                    Aufmaß erstellen
                  </button>
                </div>
              </div>

              {/* Expanded Angebote List */}
              <AnimatePresence>
                {expandedLeadId === lead.id && expandedAngebote[lead.id] && (
                  <motion.div
                    className="angebote-expanded"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    {expandedAngebote[lead.id].map((ang, idx) => (
                      <div key={ang.id} className="angebot-row">
                        <div className="angebot-row-info">
                          <span className="angebot-row-nummer">{ang.angebot_nummer || `Angebot ${idx + 1}`}</span>
                          <span className="angebot-row-price">{formatPrice(ang.total_price)}</span>
                        </div>
                        <div className="angebot-row-actions">
                          <button className="btn-icon-sm" title="PDF" onClick={() => openAngebotPdfWithFallback(lead.id, ang.id)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                          </button>
                          <button className="btn-icon-sm" title="Per E-Mail senden" onClick={() => handleSendAngebotByEmail(lead.id, ang.id)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                          </button>
                          <button className="btn-icon-sm" title="Bearbeiten" onClick={() => handleEditLead(lead.id, ang.id)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                          </button>
                          <button className="btn-icon-sm delete" title="Löschen" onClick={() => setDeleteAngebotConfirm({ leadId: lead.id, angebotId: ang.id })}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                          </button>
                        </div>
                        {deleteAngebotConfirm?.leadId === lead.id && deleteAngebotConfirm?.angebotId === ang.id && (
                          <div className="delete-confirm inline-confirm">
                            <p>Dieses Angebot löschen?</p>
                            <div className="confirm-actions">
                              <button className="btn-cancel" onClick={() => setDeleteAngebotConfirm(null)}>Abbrechen</button>
                              <button className="btn-delete" onClick={() => handleDeleteAngebot(lead.id, ang.id)}>Löschen</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    <button className="btn-add-angebot" onClick={() => handleAddAngebot(lead.id)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                      Neues Angebot hinzufügen
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Delete Confirmation */}
              {deleteConfirmId === lead.id && (
                <div className="delete-confirm">
                  <p>Angebot wirklich löschen?</p>
                  <div className="confirm-actions">
                    <button className="btn-cancel" onClick={() => setDeleteConfirmId(null)}>Abbrechen</button>
                    <button className="btn-delete" onClick={() => handleDelete(lead.id)}>Löschen</button>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Lead Form Modal */}
      <LeadFormModal
        isOpen={leadModalOpen}
        onClose={() => { setLeadModalOpen(false); setEditLeadData(null); setEditAngebotId(null); setNewAngebotLeadId(null); }}
        onSuccess={() => {
          setLeadModalOpen(false);
          setEditLeadData(null);
          setEditAngebotId(null);
          setNewAngebotLeadId(null);
          loadLeads();
          if (expandedLeadId) loadAngebote(expandedLeadId);
        }}
        editData={editLeadData}
        editAngebotId={editAngebotId}
        newAngebotForLeadId={newAngebotLeadId}
      />

      {/* Detail Modal */}
      <AnimatePresence>
        {detailModalOpen && selectedLead && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDetailModalOpen(false)}
          >
            <motion.div
              className="detail-modal"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>Angebot Details</h2>
                <button className="close-btn" onClick={() => setDetailModalOpen(false)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="modal-body">
                <section className="detail-section">
                  <h3>Kunde</h3>
                  <p><strong>{selectedLead.customer_firstname} {selectedLead.customer_lastname}</strong></p>
                  <p>{selectedLead.customer_email}</p>
                  {selectedLead.customer_phone && <p>{selectedLead.customer_phone}</p>}
                  {selectedLead.customer_address && <p>{selectedLead.customer_address}</p>}
                </section>

                {/* Show each angebot separately */}
                {selectedLead.angebote && selectedLead.angebote.length > 0 ? (
                  selectedLead.angebote.map((ang, idx) => (
                    <div key={ang.id} className="detail-angebot-section">
                      <div className="detail-angebot-header">
                        <h3>{ang.angebot_nummer || `Angebot ${idx + 1}`}</h3>
                        <span className="detail-angebot-price">{formatPrice(ang.total_price)}</span>
                      </div>

                      {ang.items.length > 0 && (
                        <section className="detail-section">
                          <h4>Produkte</h4>
                          <div className="items-table">
                            {ang.items.map(item => (
                              <div key={item.id} className="item-row">
                                <div className="item-info">
                                  <span className="item-name">{item.product_name}</span>
                                  <span className="item-dims">
                                    {item.pricing_type === 'unit'
                                      ? (item.unit_label || 'Einheit')
                                      : `${item.breite} x ${item.tiefe} cm`
                                    }
                                  </span>
                                  <span className="item-qty">x {item.quantity}</span>
                                </div>
                                <span className="item-price">{formatPrice(item.total_price)}</span>
                                {renderItemProduktdetails(item)}
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                      {ang.extras.length > 0 && (
                        <section className="detail-section">
                          <h4>Zusatzleistungen</h4>
                          <div className="items-table">
                            {ang.extras.map(extra => (
                              <div key={extra.id} className="item-row">
                                <span className="item-name">{extra.description}</span>
                                <span className="item-price">{formatPrice(extra.price)}</span>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                      <div className="detail-angebot-footer">
                        <button className="btn-secondary btn-sm" onClick={() => openAngebotPdfWithFallback(selectedLead.id, ang.id, selectedLead)}>
                          PDF anzeigen
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <>
                    {selectedLead.items.length > 0 && (
                      <section className="detail-section">
                        <h3>Produkte</h3>
                        <div className="items-table">
                          {selectedLead.items.map(item => (
                            <div key={item.id} className="item-row">
                              <div className="item-info">
                                <span className="item-name">{item.product_name}</span>
                                <span className="item-dims">
                                  {item.pricing_type === 'unit'
                                    ? (item.unit_label || 'Einheit')
                                    : `${item.breite} x ${item.tiefe} cm`
                                  }
                                </span>
                                <span className="item-qty">x {item.quantity}</span>
                                {renderItemProduktdetails(item)}
                              </div>
                              <span className="item-price">{formatPrice(item.total_price)}</span>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {selectedLead.extras.length > 0 && (
                      <section className="detail-section">
                        <h3>Zusatzleistungen</h3>
                        <div className="items-table">
                          {selectedLead.extras.map(extra => (
                            <div key={extra.id} className="item-row">
                              <span className="item-name">{extra.description}</span>
                              <span className="item-price">{formatPrice(extra.price)}</span>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                )}

                {selectedLead.notes && (
                  <section className="detail-section">
                    <h3>Beschreibung</h3>
                    <p className="notes-text">{selectedLead.notes}</p>
                  </section>
                )}

                <div className="detail-total">
                  {selectedLead.total_discount && selectedLead.total_discount > 0 ? (
                    <>
                      <div className="total-row subtotal-row">
                        <span>Zwischensumme:</span>
                        <span>{formatPrice(selectedLead.subtotal || (selectedLead.total_price + selectedLead.total_discount))}</span>
                      </div>
                      <div className="total-row discount-row">
                        <span>Rabatt:</span>
                        <span className="discount-value">-{formatPrice(selectedLead.total_discount)}</span>
                      </div>
                      <div className="total-row final-row">
                        <span>Gesamtsumme:</span>
                        <span className="total-price">{formatPrice(selectedLead.total_price)}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <span>Gesamtsumme:</span>
                      <span className="total-price">{formatPrice(selectedLead.total_price)}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button className="btn-cancel" onClick={() => setDetailModalOpen(false)}>Schließen</button>
                <button
                  className="btn-secondary"
                  onClick={() => openLeadPdfWithFallback(selectedLead.id, selectedLead)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  PDF anzeigen
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => handleSendLeadByEmail(selectedLead)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  Per E-Mail senden
                </button>
                <button className="btn-primary" onClick={() => {
                  setDetailModalOpen(false);
                  handleCreateAufmass(selectedLead);
                }}>
                  Aufmaß erstellen
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Email Composer Modal */}
      <AnimatePresence>
        {emailComposer && (
          <EmailComposer
            to={emailComposer.to}
            subject={emailComposer.subject}
            body={emailComposer.body}
            leadId={emailComposer.leadId}
            angebote={emailComposer.angebote}
            emailType={emailComposer.emailType}
            attachmentName={emailComposer.attachmentName}
            angebotPdfData={emailComposer.angebotPdfData}
            onClose={() => setEmailComposer(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
