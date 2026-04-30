import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { AufmassForm } from '../App';
import { FormData } from '../types';
import { DynamicFormData } from '../types/productConfig';
import { api, getForm, createForm, updateForm, uploadImages, savePdf, updateLeadStatus, getAbnahme, getAbnahmeImages, markLeadAngebotAsSent, FormData as ApiFormData } from '../services/api';
import { generatePDF } from '../utils/pdfGenerator';
import EmailComposer from '../components/EmailComposer';
import LeadFormModal from '../components/LeadFormModal';
import { useToast } from '../components/Toast';

interface LeadItem {
  id: number;
  product_name: string;
  breite: number;
  tiefe: number;
  quantity: number;
  unit_price: number;
  total_price: number;
}

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
  const [emailComposer, setEmailComposer] = useState<{ to: string; subject: string; body: string; formId: number } | null>(null);
  const [savedFormId, setSavedFormId] = useState<number | null>(null);
  const [savedKundeEmail, setSavedKundeEmail] = useState('');
  const [savedKundeName, setSavedKundeName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formStatus, setFormStatus] = useState<string>('neu');

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

    // MODÜL B — Intercept "angebot_versendet" so the user lands in
    // LeadFormModal (Aus Aufmaß flow) instead of just flipping the status.
    // The modal save will trigger backend cross-sync (markLeadAngebotAsSent
    // → syncFormsFromLead) which sets the form status, so we don't update
    // the status here. If the user cancels the modal nothing changes —
    // mirroring the Dashboard card dropdown behaviour.
    const baseStatus = newStatus.includes(':') ? newStatus.split(':')[0] : newStatus;
    if (baseStatus === 'angebot_versendet') {
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
    } catch (err) {
      console.error('Error updating status:', err);
      toast.error('Fehler', 'Status konnte nicht aktualisiert werden.');
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
          // Map lead product to form product selection
          let productSelection = { category: '', productType: '', model: '' };
          let specifications: DynamicFormData = {};

          // Get first lead item for main product
          const firstItem = leadState.leadItems?.[0];
          if (firstItem) {
            // Map PREMIUMLINE product to form structure
            if (firstItem.product_name.toUpperCase().includes('PREMIUMLINE')) {
              productSelection = {
                category: 'ÜBERDACHUNG',
                productType: 'Glasdach',
                model: 'Arona'
              };
            }
            // Convert cm to mm for the form (form uses mm)
            specifications.breite = firstItem.breite * 10;
            specifications.tiefe = firstItem.tiefe * 10;
          }

          // Build weitereProdukte from additional lead items
          const weitereProdukte = (leadState.leadItems || []).slice(1).map((item, index) => {
            const wpSpecs: DynamicFormData = {
              breite: item.breite * 10,
              tiefe: item.tiefe * 10
            };
            return {
              id: `lead-wp-${index}`,
              category: 'ÜBERDACHUNG',
              productType: 'Glasdach',
              model: 'Arona',
              specifications: wpSpecs
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
            signatureName: apiData.signatureName || null
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
        bemerkungen: data.bemerkungen || ''
      };

      apiData.status = 'entwurf';

      if (id === 'new') {
        await createForm(apiData);
      } else {
        const formId = parseInt(id!);
        await updateForm(formId, apiData);
      }

      toast.success('Gespeichert', 'Entwurf wurde gespeichert.');
      navigate('/');
    } catch (err) {
      console.error('Error saving draft:', err);
      toast.error('Fehler', 'Entwurf konnte nicht gespeichert werden.');
    }
  };

  const handleCancel = () => {
    navigate('/');
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
          onClick={() => navigate('/')}
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

  return (
    <>
      <AufmassForm
        initialData={initialData}
        onSave={handleSave}
        onDraftSave={handleDraftSave}
        onSignaturePersist={handleSignaturePersist}
        onCancel={handleCancel}
        onSendEmail={handleSendEmail}
        formStatus={formStatus}
        onStatusChange={handleStatusChange}
        isExistingForm={id !== 'new'}
      />
      <AnimatePresence>
        {emailComposer && (
          <EmailComposer
            to={emailComposer.to}
            subject={emailComposer.subject}
            body={emailComposer.body}
            formId={emailComposer.formId}
            emailType="aufmass"
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
        onSuccess={async (savedLeadId) => {
          setLeadModalOpen(false);
          setLeadModalEditData(null);
          setLeadModalFromAufmassId(null);
          // MODÜL B: When the modal is opened from the status bar's "Angebot
          // Versendet" intercept, the user's intent is already "send the
          // offer", so flag the lead as sent immediately. Backend cross-sync
          // (syncFormsFromLead) then flips this Aufmaß to angebot_versendet.
          if (savedLeadId) {
            try {
              await markLeadAngebotAsSent(savedLeadId);
            } catch (err) {
              console.error('mark-angebot-sent after save failed:', err);
            }
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
    </>
  );
};

export default FormPage;
