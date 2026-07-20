import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { AufmassForm } from '../App';
import { FormData } from '../types';
import { DynamicFormData, ProductSelection, ProductConfig } from '../types/productConfig';
import productConfigData from '../config/productConfig.json';
import { api, getForm, createForm, updateForm, uploadImages, savePdf, updateLeadStatus, getAbnahme, getAbnahmeImages, FormData as ApiFormData } from '../services/api';
import type { Rechnung, RechnungType } from '../services/api';
import { generatePDF } from '../utils/pdfGenerator';
import EmailComposer from '../components/EmailComposer';
import LeadFormModal from '../components/LeadFormModal';
import RechnungForm from '../components/RechnungForm';
import AnzahlungForm from '../components/AnzahlungForm';
import AuftragAngebotSelection from '../components/AuftragAngebotSelection';
import type { AuftragAngebotOption } from '../components/AuftragAngebotSelection';
import { useToast } from '../components/Toast';
import { canCreateAdditionalRechnung, canCreateSchlussrechnung } from '../utils/workflow';

interface LeadItem {
  id: number;
  product_name: string;
  breite: number;
  tiefe: number;
  quantity: number;
  unit_price: number;
  total_price: number;
}

const productConfig = productConfigData as ProductConfig;

// Reverse lookup: given a lead product's name (a model), find its category +
// productType from productConfig so it carries into the Aufmaß form. Matches
// case-insensitively. Returns null when the product isn't in the config
// (e.g. accessories / unmapped catalog items) — the form is then left empty
// for that entry rather than force-mapped to a wrong product.
const resolveProductSelection = (
  productName: string
): { category: string; productType: string; model: string } | null => {
  if (!productName) return null;
  const target = productName.trim().toLowerCase();
  for (const category of Object.keys(productConfig)) {
    const productTypes = productConfig[category];
    for (const productType of Object.keys(productTypes)) {
      const models = productTypes[productType]?.models || [];
      const match = models.find(m => m.toLowerCase() === target);
      if (match) return { category, productType, model: match };
    }
  }
  return null;
};

// Lead items are stored in mm (LeadFormModal works in mm) — the same unit the
// Aufmaß form uses. Carry breite/tiefe across directly, no cm conversion.
const buildSpecsFromLeadItem = (item: LeadItem): DynamicFormData => {
  const specs: DynamicFormData = {};
  if (Number.isFinite(item.breite) && item.breite > 0) specs.breite = item.breite;
  if (Number.isFinite(item.tiefe) && item.tiefe > 0) specs.tiefe = item.tiefe;
  return specs;
};

interface LeadExtra {
  id: number;
  description: string;
  price: number;
}

interface LocationState {
  fromLead?: boolean;
  leadId?: number;
  kundeVorname?: string;
  kundeNachname?: string;
  kundeEmail?: string;
  kundeTelefon?: string;
  kundenlokation?: string;
  leadItems?: LeadItem[];
  leadExtras?: LeadExtra[];
  leadNotes?: string;
}

const FormPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [initialData, setInitialData] = useState<FormData | null>(null);
  const [emailComposer, setEmailComposer] = useState<{ to: string; subject: string; body: string; formId?: number; rechnungId?: number; emailType?: string; attachmentName?: string } | null>(null);
  // Modul C: Rechnung / Anzahlung modals
  const [rechnungModalOpen, setRechnungModalOpen] = useState(false);
  const [rechnungType, setRechnungType] = useState<RechnungType>('anzahlungsrechnung');
  const [anzahlungModalOpen, setAnzahlungModalOpen] = useState(false);
  const [savedFormId, setSavedFormId] = useState<number | null>(null);
  const [savedKundeEmail, setSavedKundeEmail] = useState('');
  const [savedKundeName, setSavedKundeName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formStatus, setFormStatus] = useState<string>('neu');
  const [auftragModalOpen, setAuftragModalOpen] = useState(false);
  const [auftragAngebote, setAuftragAngebote] = useState<AuftragAngebotOption[]>([]);
  const [selectedAuftragAngebotId, setSelectedAuftragAngebotId] = useState<number | null>(null);
  const [selectedAuftragItemIds, setSelectedAuftragItemIds] = useState<number[]>([]);
  const [selectedAuftragExtraIds, setSelectedAuftragExtraIds] = useState<number[]>([]);
  const [auftragDatum, setAuftragDatum] = useState(new Date().toISOString().split('T')[0]);
  const [auftragSaving, setAuftragSaving] = useState(false);

  // MODÜL B — LeadFormModal state for the unified Angebot Versendet flow
  // (fired from the form's status bar). When form.lead_id exists we open the
  // modal in edit mode, otherwise in fromAufmass mode for a new lead.
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [leadModalEditData, setLeadModalEditData] = useState<unknown>(null);
  const [leadModalFromAufmassId, setLeadModalFromAufmassId] = useState<number | null>(null);

  // Get lead data from navigation state
  const leadState = location.state as LocationState | null;

  const handleStatusChange = async (newStatus: string) => {
    if (!id || id === 'new') return;

    // MODÜL B — Intercept the pending send action so the user lands in
    // LeadFormModal (Aus Aufmaß flow) instead of just flipping the status.
    // The modal save will trigger backend cross-sync (markLeadAngebotAsSent
    // → syncFormsFromLead) which sets the form status, so we don't update
    // the status here. If the user cancels the modal nothing changes —
    // mirroring the Dashboard card dropdown behaviour.
    const baseStatus = newStatus.includes(':') ? newStatus.split(':')[0] : newStatus;
    if (baseStatus === 'angebot_ausstehend') {
      try {
        const formId = parseInt(id);
        const fresh = await getForm(formId);
        const linkedLeadId = fresh.lead_id;
        // Always pass the source Aufmaß id so the modal can render the
        // "Aus Aufmaß" banner + photos in both fresh and edit modes.
        setLeadModalFromAufmassId(formId);
        if (linkedLeadId) {
          // Edit mode — load the linked lead and open the modal on it.
          const leadDetail = await api.get<unknown>(`/leads/${linkedLeadId}`);
          setLeadModalEditData(leadDetail);
        } else {
          // No lead yet — fromAufmass mode for a new lead.
          setLeadModalEditData(null);
        }
        setLeadModalOpen(true);
      } catch (err) {
        console.error('Failed to open Angebot modal from status bar:', err);
        toast.error('Fehler', 'Angebot-Formular konnte nicht geöffnet werden.');
      }
      return;
    }

    try {
      // Check if status includes date (format: status_value:2025-12-15)
      if (newStatus.includes(':')) {
        const [status, datum] = newStatus.split(':');
        const updateData: { status: string; statusDate: string; montageDatum?: string } = {
          status,
          statusDate: datum
        };
        // Also update montageDatum for montage_geplant
        if (status === 'montage_geplant') {
          updateData.montageDatum = datum;
        }
        await updateForm(parseInt(id), updateData);
        setFormStatus(status);
      } else {
        await updateForm(parseInt(id), { status: newStatus });
        setFormStatus(newStatus);
      }
      // Modul C: when entering anzahlung status, open the payment management modal
      const plainStatus = newStatus.includes(':') ? newStatus.split(':')[0] : newStatus;
      if (plainStatus === 'anzahlung') {
        setAnzahlungModalOpen(true);
      }
    } catch (err) {
      console.error('Error updating status:', err);
      toast.error('Fehler', 'Status konnte nicht aktualisiert werden.');
    }
  };

  const handleRequestAuftrag = async () => {
    if (!id || id === 'new') return;
    try {
      const fresh = await getForm(Number(id));
      if (!fresh.lead_id) {
        toast.warning('Angebot fehlt', 'Bitte erstellen und versenden Sie zuerst ein Angebot.');
        return;
      }
      const lead = await api.get<{ angebote?: AuftragAngebotOption[]; angebot_sent_at?: string | null }>(`/leads/${fresh.lead_id}`);
      const allOffers = lead.angebote || [];
      const explicitlySent = allOffers.filter((offer) =>
        ['versendet', 'angenommen', 'abgelehnt'].includes(offer.status || '')
      );
      const choices = explicitlySent.length > 0
        ? explicitlySent
        : (lead.angebot_sent_at ? allOffers : []);
      if (choices.length === 0) {
        toast.warning('Angebot fehlt', 'Bitte versenden Sie zuerst mindestens ein Angebot.');
        return;
      }
      setAuftragAngebote(choices);
      const existingOffer = choices.find((offer) => offer.id === fresh.selectedAngebotId);
      const selectedOffer = existingOffer || (choices.length === 1 ? choices[0] : null);
      setSelectedAuftragAngebotId(selectedOffer?.id || null);
      if (selectedOffer) {
        const allowedItemIds = (selectedOffer.items || []).map((item) => item.id);
        const allowedExtraIds = (selectedOffer.extras || []).map((extra) => extra.id);
        setSelectedAuftragItemIds(
          existingOffer && Array.isArray(fresh.selectedAngebotItemIds)
            ? fresh.selectedAngebotItemIds.filter((itemId) => allowedItemIds.includes(itemId))
            : allowedItemIds
        );
        setSelectedAuftragExtraIds(
          existingOffer && Array.isArray(fresh.selectedAngebotExtraIds)
            ? fresh.selectedAngebotExtraIds.filter((extraId) => allowedExtraIds.includes(extraId))
            : allowedExtraIds
        );
      } else {
        setSelectedAuftragItemIds([]);
        setSelectedAuftragExtraIds([]);
      }
      setAuftragDatum(new Date().toISOString().split('T')[0]);
      setAuftragModalOpen(true);
    } catch (err) {
      console.error('Failed to prepare Auftrag selection:', err);
      toast.error('Fehler', 'Angebote konnten nicht geladen werden.');
    }
  };

  const handleConfirmAuftrag = async () => {
    if (!id || id === 'new' || !selectedAuftragAngebotId || selectedAuftragItemIds.length === 0 || !auftragDatum) return;
    setAuftragSaving(true);
    try {
      await updateForm(Number(id), {
        status: 'auftrag_erteilt',
        statusDate: auftragDatum,
        selectedAngebotId: selectedAuftragAngebotId,
        selectedAngebotItemIds: selectedAuftragItemIds,
        selectedAngebotExtraIds: selectedAuftragExtraIds,
      });
      setFormStatus('auftrag_erteilt');
      setAuftragModalOpen(false);
      toast.success('Auftrag erteilt', 'Das angenommene Angebot wurde für den Auftrag übernommen.');
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Auftrag konnte nicht gespeichert werden.');
    } finally {
      setAuftragSaving(false);
    }
  };

  // ============ MODUL C: RECHNUNG TRIGGER ============
  const handleOpenRechnung = (type: RechnungType) => {
    setRechnungType(type);
    setRechnungModalOpen(true);
  };

  const handleRechnungSaved = (rechnung: Rechnung, opts: { sendEmail: boolean }) => {
    setRechnungModalOpen(false);
    // Additional invoices keep the project at its current lifecycle step.
    // Only the Schlussrechnung moves the project into the terminal flow.
    if (rechnung.type === 'schlussrechnung') {
      setFormStatus('schluss_rechnung_erstellt');
    }
    if (opts.sendEmail && rechnung.kunde_email) {
      const labelDe = rechnung.type === 'schlussrechnung' ? 'Schlussrechnung' : 'Anzahlungsrechnung';
      setEmailComposer({
        to: rechnung.kunde_email,
        subject: `${labelDe} ${rechnung.rechnung_nr}`,
        body: `Sehr geehrte/r ${rechnung.kunde_vorname || ''} ${rechnung.kunde_nachname || ''},\n\nim Anhang finden Sie unsere ${labelDe} mit der Nummer ${rechnung.rechnung_nr}.\n\nMit freundlichen Grüßen`,
        rechnungId: rechnung.id,
        emailType: rechnung.type === 'schlussrechnung' ? 'rechnung_schluss' : 'rechnung_anzahlung',
        attachmentName: `Rechnung_${rechnung.rechnung_nr}.pdf`,
      });
    } else {
      toast.success('Rechnung als Entwurf erstellt', `Nr. ${rechnung.rechnung_nr}. Per E-Mail oder manuell als „gesendet" markieren, um abzuschließen.`);
    }
  };

  const buildPdfPayload = async (formId: number) => {
    const freshData = await getForm(formId);
    let abnahmeData = null;
    let abnahmeImages: { id: number; file_name: string; file_type: string }[] = [];

    try {
      [abnahmeData, abnahmeImages] = await Promise.all([
        getAbnahme(formId),
        getAbnahmeImages(formId)
      ]);
    } catch (err) {
      console.log('Could not fetch abnahme data for PDF generation:', err);
    }

    return {
      id: String(freshData.id),
      datum: freshData.datum || '',
      aufmasser: freshData.aufmasser || '',
      kundeVorname: freshData.kundeVorname || '',
      kundeNachname: freshData.kundeNachname || '',
      kundeEmail: freshData.kundeEmail || '',
      kundeTelefon: freshData.kundeTelefon || '',
      kundenlokation: freshData.kundenlokation || '',
      productSelection: {
        category: freshData.category || '',
        productType: freshData.productType || '',
        model: freshData.model || ''
      },
      specifications: (freshData.specifications || {}) as Record<string, string | number | boolean | string[]>,
      weitereProdukte: freshData.weitereProdukte || [],
      bilder: freshData.bilder || [],
      bemerkungen: freshData.bemerkungen || '',
      status: (freshData.status as 'draft' | 'completed' | 'archived') || 'draft',
      customerSignature: freshData.customerSignature || null,
      signatureName: freshData.signatureName || null,
      abnahme: abnahmeData ? {
        ...abnahmeData,
        maengelBilder: abnahmeImages || []
      } : undefined
    };
  };

  const persistStoredPdf = async (formId: number) => {
    const pdfData = await buildPdfPayload(formId);
    const pdfResult = await generatePDF(pdfData, { returnBlob: true });
    if (pdfResult?.blob) {
      await savePdf(formId, pdfResult.blob);
      return true;
    }
    return false;
  };

  const persistStoredPdfFromLocalData = async (formId: number, data: FormData) => {
    const pdfResult = await generatePDF({
      ...data,
      id: String(formId)
    }, { returnBlob: true });

    if (pdfResult?.blob) {
      await savePdf(formId, pdfResult.blob);
      return true;
    }

    return false;
  };

  const handleSignaturePersist = async (signatureData: string, sigName: string): Promise<void> => {
    if (!id || id === 'new') return;

    try {
      const formId = parseInt(id);
      await updateForm(formId, {
        customerSignature: signatureData,
        signatureName: sigName
      } as Partial<ApiFormData> & { customerSignature: string; signatureName: string });
      await persistStoredPdf(formId);
    } catch (err) {
      console.error('Error persisting signature:', err);
      toast.warning('PDF', 'Unterschrift lokal eklendi, fakat sofortiges PDF-Update başarısız oldu. Speichern ile tekrar kaydedebilirsiniz.');
    }
  };

  useEffect(() => {
    const loadForm = async () => {
      if (id === 'new') {
        // Check if coming from lead with pre-filled data
        if (leadState?.fromLead) {
          // Map lead product to form product selection. The product identity is
          // resolved from productConfig by its real name (not hardcoded), so any
          // catalogued product carries over — not just one special case.
          let productSelection: ProductSelection = { category: '', productType: '', model: '' };
          let specifications: DynamicFormData = {};

          // Get first lead item for main product
          const firstItem = leadState.leadItems?.[0];
          if (firstItem) {
            const resolved = resolveProductSelection(firstItem.product_name);
            if (resolved) {
              // ÜBERDACHUNG > Glasdach uses a multi-select model (string[]).
              const isMultiModel = resolved.category === 'ÜBERDACHUNG' && resolved.productType === 'Glasdach';
              productSelection = {
                category: resolved.category,
                productType: resolved.productType,
                model: isMultiModel ? [resolved.model] : resolved.model
              };
            }
            specifications = buildSpecsFromLeadItem(firstItem);
          }

          // Build weitereProdukte from additional lead items, each resolved by name.
          const weitereProdukte = (leadState.leadItems || []).slice(1).map((item, index) => {
            const resolved = resolveProductSelection(item.product_name);
            return {
              id: `lead-wp-${index}`,
              category: resolved?.category || '',
              productType: resolved?.productType || '',
              model: resolved?.model || '',
              specifications: buildSpecsFromLeadItem(item)
            };
          });

          setInitialData({
            datum: new Date().toISOString().split('T')[0],
            aufmasser: '',
            kundeVorname: leadState.kundeVorname || '',
            kundeNachname: leadState.kundeNachname || '',
            kundeEmail: leadState.kundeEmail || '',
            kundeTelefon: leadState.kundeTelefon || '',
            kundenlokation: leadState.kundenlokation || '',
            productSelection,
            specifications,
            weitereProdukte,
            bilder: [],
            bemerkungen: leadState.leadNotes || ''
          });
        } else {
          setInitialData(null);
        }
        setLoading(false);
      } else if (id) {
        try {
          const formId = parseInt(id);
          const apiData = await getForm(formId);

          // Transform API data to local FormData format
          const formData: FormData = {
            id: String(apiData.id),
            datum: apiData.datum || '',
            aufmasser: apiData.aufmasser || '',
            kundeVorname: apiData.kundeVorname || '',
            kundeNachname: apiData.kundeNachname || '',
            kundeEmail: apiData.kundeEmail || '',
            kundeTelefon: apiData.kundeTelefon || '',
            kundenlokation: apiData.kundenlokation || '',
            productSelection: {
              category: apiData.category || '',
              productType: apiData.productType || '',
              model: apiData.model || ''
            },
            specifications: (apiData.specifications || {}) as DynamicFormData,
            weitereProdukte: apiData.weitereProdukte || [],
            bilder: apiData.bilder || [],
            bemerkungen: apiData.bemerkungen || '',
            status: (apiData.status as 'draft' | 'completed' | 'archived') || 'draft',
            createdAt: apiData.created_at,
            updatedAt: apiData.updated_at,
            customerSignature: apiData.customerSignature || null,
            signatureName: apiData.signatureName || null,
            marketingSource: apiData.marketingSource ?? null
          };

          setInitialData(formData);
          setFormStatus(apiData.status || 'neu');
        } catch (err) {
          console.error('Error loading form:', err);
          setError('Formular konnte nicht geladen werden.');
        }
        setLoading(false);
      }
    };

    loadForm();
    // Navigation state is a one-shot input; reloading on object identity changes
    // would overwrite edits already made in the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSave = async (data: FormData): Promise<number | void> => {
    try {
      // Transform local FormData to API format
      const apiData: Omit<ApiFormData, 'id'> & { status?: string; customerSignature?: string; signatureName?: string } = {
        datum: data.datum,
        aufmasser: data.aufmasser,
        kundeVorname: data.kundeVorname,
        kundeNachname: data.kundeNachname,
        kundeEmail: data.kundeEmail || '',
        kundeTelefon: data.kundeTelefon || '',
        kundenlokation: data.kundenlokation,
        category: data.productSelection?.category || '',
        productType: data.productSelection?.productType || '',
        model: Array.isArray(data.productSelection?.model)
          ? JSON.stringify(data.productSelection.model)
          : (data.productSelection?.model || ''),
        specifications: data.specifications || {},
        markiseData: (data.specifications as Record<string, unknown>)?.markiseData,
        weitereProdukte: data.weitereProdukte || [],
        bemerkungen: data.bemerkungen || '',
        marketingSource: data.marketingSource ?? null,
      };

      // Always include signature fields to preserve them during edits
      if (data.customerSignature !== undefined) {
        (apiData as Record<string, unknown>).customerSignature = data.customerSignature || null;
        (apiData as Record<string, unknown>).signatureName = data.signatureName || null;
      }

      // Only set status to 'neu' for new forms, promote drafts on full save
      if (id === 'new') {
        apiData.status = 'neu';
      } else if (formStatus === 'entwurf') {
        apiData.status = 'neu';
      }

      // Pass lead_id if creating from a lead
      if (id === 'new' && leadState?.fromLead && leadState?.leadId) {
        (apiData as Record<string, unknown>).leadId = leadState.leadId;
      }

      let formId: number;

      if (id === 'new') {
        // Create new form
        const result = await createForm(apiData);
        formId = result.id;
      } else {
        // Update existing form
        formId = parseInt(id!);
        await updateForm(formId, apiData);
      }

      // Upload new images if any - MUST complete before PDF generation
      const newImages = data.bilder?.filter(b => b instanceof File) as File[];
      if (newImages && newImages.length > 0) {
        await uploadImages(formId, newImages);
      }

      // If this form was created from a lead, update lead status
      if (id === 'new' && leadState?.fromLead && leadState?.leadId) {
        try {
          await updateLeadStatus(leadState.leadId, 'aufmass_erstellt');
        } catch (statusErr) {
          console.error('Failed to update lead status:', statusErr);
        }
      }

      try {
        const pdfSaved = await persistStoredPdfFromLocalData(formId, {
          ...data,
          id: String(formId)
        });
        if (!pdfSaved) {
          toast.warning('PDF', 'Form kaydedildi ama PDF oluşturulamadı.');
        }
      } catch (pdfErr) {
        console.error('PDF generation failed:', pdfErr);
        toast.warning('PDF', 'Form kaydedildi ancak PDF kaydı başarısız oldu.');
      }

      // Store for email sending
      setSavedFormId(formId);
      setSavedKundeEmail(data.kundeEmail || '');
      setSavedKundeName(`${data.kundeVorname || ''} ${data.kundeNachname || ''}`.trim());

      return formId;
    } catch (err) {
      console.error('Error saving form:', err);
      toast.error('Fehler', 'Formular konnte nicht gespeichert werden.');
    }
  };

  const handleDraftSave = async (data: FormData): Promise<void> => {
    try {
      const apiData: Omit<ApiFormData, 'id'> & { status?: string } = {
        datum: data.datum,
        aufmasser: data.aufmasser,
        kundeVorname: data.kundeVorname,
        kundeNachname: data.kundeNachname,
        kundeEmail: data.kundeEmail || '',
        kundeTelefon: data.kundeTelefon || '',
        kundenlokation: data.kundenlokation,
        category: data.productSelection?.category || '',
        productType: data.productSelection?.productType || '',
        model: Array.isArray(data.productSelection?.model)
          ? JSON.stringify(data.productSelection.model)
          : (data.productSelection?.model || ''),
        specifications: data.specifications || {},
        markiseData: (data.specifications as Record<string, unknown>)?.markiseData,
        weitereProdukte: data.weitereProdukte || [],
        bemerkungen: data.bemerkungen || '',
        marketingSource: data.marketingSource ?? null
      };

      apiData.status = 'entwurf';

      if (id === 'new') {
        await createForm(apiData);
      } else {
        const formId = parseInt(id!);
        await updateForm(formId, apiData);
      }

      toast.success('Gespeichert', 'Entwurf wurde gespeichert.');
      navigate('/aufmasse');
    } catch (err) {
      console.error('Error saving draft:', err);
      toast.error('Fehler', 'Entwurf konnte nicht gespeichert werden.');
    }
  };

  const handleCancel = () => {
    navigate('/aufmasse');
  };

  if (loading) {
    return (
      <div className="loading-container" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--bg-primary)'
      }}>
        <div className="loading-spinner" style={{
          width: '48px',
          height: '48px',
          border: '4px solid var(--border-color)',
          borderTopColor: 'var(--primary-color)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }}></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container" style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        gap: '1rem'
      }}>
        <p style={{ color: 'var(--text-primary)' }}>{error}</p>
        <button
          onClick={() => navigate('/aufmasse')}
          style={{
            padding: '0.75rem 1.5rem',
            background: 'var(--primary-color)',
            color: 'var(--bg-primary)',
            border: 'none',
            borderRadius: '10px',
            cursor: 'pointer'
          }}
        >
          Zurück zum Dashboard
        </button>
      </div>
    );
  }

  const handleSendEmail = () => {
    const fid = savedFormId || (id && id !== 'new' ? Number(id) : null);
    if (!fid) return;
    // PDF is already generated during handleSave, just open composer
    setEmailComposer({
      to: savedKundeEmail || initialData?.kundeEmail || '',
      subject: `Ihr Aufmaß - AYLUX`,
      body: `Sehr geehrte/r ${savedKundeName || 'Kunde'},\n\nanbei erhalten Sie die Dokumentation Ihres Aufmaßes.\n\nBei Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\nIhr AYLUX Team`,
      formId: fid
    });
  };

  const numericFormId = id && id !== 'new' ? parseInt(id) : null;

  return (
    <>
      {/* Modul C: Rechnung action bar — only visible for existing forms in trigger statuses */}
      {numericFormId && (canCreateAdditionalRechnung(formStatus) || canCreateSchlussrechnung(formStatus) || formStatus === 'anzahlung') && (
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: '8px',
          padding: '10px 20px', borderBottom: '1px solid var(--border-primary)',
          background: 'var(--bg-secondary)',
        }}>
          {canCreateAdditionalRechnung(formStatus) && (
            <button
              onClick={() => handleOpenRechnung('anzahlungsrechnung')}
              style={{
                padding: '8px 16px', borderRadius: '8px', border: '1px solid rgba(14,165,233,0.3)',
                background: 'rgba(14,165,233,0.1)', color: '#0ea5e9',
                fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              Anzahlungsrechnung erstellen
            </button>
          )}
          {canCreateSchlussrechnung(formStatus) && (
            <button
              onClick={() => handleOpenRechnung('schlussrechnung')}
              style={{
                padding: '8px 16px', borderRadius: '8px', border: '1px solid rgba(8,145,178,0.3)',
                background: 'rgba(8,145,178,0.1)', color: '#0891b2',
                fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              Schlussrechnung erstellen
            </button>
          )}
          {formStatus === 'anzahlung' && (
            <button
              onClick={() => setAnzahlungModalOpen(true)}
              style={{
                padding: '8px 16px', borderRadius: '8px', border: '1px solid rgba(6,182,212,0.3)',
                background: 'rgba(6,182,212,0.1)', color: '#06b6d4',
                fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="12" cy="12" r="10" /><line x1="12" y1="6" x2="12" y2="12" /><line x1="12" y1="12" x2="16" y2="14" /></svg>
              Anzahlungen verwalten
            </button>
          )}
        </div>
      )}

      <AufmassForm
        initialData={initialData}
        onSave={handleSave}
        onDraftSave={handleDraftSave}
        onSignaturePersist={handleSignaturePersist}
        onCancel={handleCancel}
        onSendEmail={handleSendEmail}
        formStatus={formStatus}
        onStatusChange={handleStatusChange}
        onAuftragRequest={handleRequestAuftrag}
        isExistingForm={id !== 'new'}
      />
      <AnimatePresence>
        {auftragModalOpen && (
          <div className="modal-overlay-modern" onClick={() => !auftragSaving && setAuftragModalOpen(false)}>
            <div className="modal-modern montage-modal auftrag-modal" onClick={(event) => event.stopPropagation()}>
              <h3>Auftrag erteilt</h3>
              <p className="montage-modal-description">Datum und angenommenes Angebot auswählen</p>
              <div className="montage-date-input">
                <label>Datum</label>
                <input type="date" value={auftragDatum} onChange={(event) => setAuftragDatum(event.target.value)} />
              </div>
              <AuftragAngebotSelection
                angebote={auftragAngebote}
                selectedAngebotId={selectedAuftragAngebotId}
                selectedItemIds={selectedAuftragItemIds}
                selectedExtraIds={selectedAuftragExtraIds}
                onSelectAngebot={(angebotId) => {
                  const angebot = auftragAngebote.find((entry) => entry.id === angebotId);
                  setSelectedAuftragAngebotId(angebotId);
                  setSelectedAuftragItemIds((angebot?.items || []).map((item) => item.id));
                  setSelectedAuftragExtraIds((angebot?.extras || []).map((extra) => extra.id));
                }}
                onSelectedItemIdsChange={setSelectedAuftragItemIds}
                onSelectedExtraIdsChange={setSelectedAuftragExtraIds}
              />
              <div className="modal-actions-modern">
                <button className="modal-btn secondary" onClick={() => setAuftragModalOpen(false)} disabled={auftragSaving}>Abbrechen</button>
                <button className="modal-btn primary" onClick={handleConfirmAuftrag} disabled={auftragSaving || !auftragDatum || !selectedAuftragAngebotId || selectedAuftragItemIds.length === 0}>
                  {auftragSaving ? 'Speichern...' : 'Auftrag übernehmen'}
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {emailComposer && (
          <EmailComposer
            to={emailComposer.to}
            subject={emailComposer.subject}
            body={emailComposer.body}
            formId={emailComposer.formId}
            rechnungId={emailComposer.rechnungId}
            emailType={emailComposer.emailType || 'aufmass'}
            attachmentName={emailComposer.attachmentName}
            onClose={() => setEmailComposer(null)}
          />
        )}
      </AnimatePresence>
      {/* MODÜL B — LeadFormModal opened from the form's status bar when the
          user picks "Angebot Versendet". editData wins over fromAufmassId per
          the LeadFormModal mode-precedence rules. */}
      <LeadFormModal
        isOpen={leadModalOpen}
        onClose={() => {
          setLeadModalOpen(false);
          setLeadModalEditData(null);
          setLeadModalFromAufmassId(null);
        }}
        onSuccess={async (savedLeadId, sendEmail) => {
          setLeadModalOpen(false);
          setLeadModalEditData(null);
          setLeadModalFromAufmassId(null);
          // Saving creates the pending-send status. Only a successful
          // EmailComposer send promotes it to "angebot_versendet".
          if (savedLeadId && sendEmail) {
            navigate(`/angebote?sendLead=${savedLeadId}`);
            return;
          }
          // Reload the form so the new status (set by backend cross-sync)
          // shows up in the status bar without a manual refresh.
          if (id && id !== 'new') {
            try {
              const fresh = await getForm(parseInt(id));
              if (fresh.status) setFormStatus(fresh.status);
            } catch (err) {
              console.error('Reload after Angebot save failed:', err);
            }
          }
        }}
        editData={leadModalEditData as React.ComponentProps<typeof LeadFormModal>['editData']}
        fromAufmassFormId={leadModalFromAufmassId}
      />

      {/* Modul C: Rechnung modal */}
      <AnimatePresence>
        {rechnungModalOpen && numericFormId && (
          <RechnungForm
            formId={numericFormId}
            type={rechnungType}
            onClose={() => setRechnungModalOpen(false)}
            onSaved={handleRechnungSaved}
          />
        )}
      </AnimatePresence>

      {/* Modul C: Anzahlung modal */}
      <AnimatePresence>
        {anzahlungModalOpen && numericFormId && (
          <AnzahlungForm
            formId={numericFormId}
            onClose={() => setAnzahlungModalOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
};

export default FormPage;
