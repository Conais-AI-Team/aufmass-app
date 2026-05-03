import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api, getForms, deleteForm, getMontageteamStats, getMontageteams, updateForm, getImageUrl, getStoredUser, getStatusHistory, getAbnahme, saveAbnahme, uploadAbnahmeImages, getAbnahmeImages, getAbnahmeImageUrl, deleteAbnahmeImage, uploadImages, getPdfUrl, getPdfStatus, getForm, savePdf, getBranchFeatures, sendAesSignature, sendAbnahmeAesSignature, getEsignatureStatus, downloadBoldSignDocument, refreshSignatureStatus, getAngebot, saveAngebot, sendAngebotAesSignature, getSignatureNotifications, downloadSignedDocument, getLeadPdfUrl, createAbnahmeSignRequest, saveFormPdfSnapshot, getFormPdfSnapshots, getFormPdfSnapshotUrl, markLeadAngebotAsSent, markFormPostSent } from '../services/api';
import type { BranchFeatures, EsignatureStatus, EsignatureRequest, AngebotItem, SignatureNotification, FormPdfDocType, FormPdfSnapshot } from '../services/api';
import { generatePDF } from '../utils/pdfGenerator';
import type { AbnahmeImage } from '../services/api';
import type { FormData, MontageteamStats, Montageteam, StatusHistoryEntry, AbnahmeData } from '../services/api';
import { useStats } from '../AppWrapper';
import { useToast } from '../components/Toast';
import EmailComposer from '../components/EmailComposer';
import LeadFormModal from '../components/LeadFormModal';
import RechnungForm from '../components/RechnungForm';
import AnzahlungForm from '../components/AnzahlungForm';
import type { Rechnung, RechnungType } from '../services/api';
import { getRechnungenByForm, markRechnungSent, getAnzahlungenByForm, num, getRechnungPdfUrl } from '../services/api';
import './Dashboard.css';

// Check if current user is admin or office (both have elevated permissions)
const isAdminOrOffice = () => {
  const user = getStoredUser();
  return user?.role === 'admin' || user?.role === 'office';
};

// Used by the "mark sent by post" flow — only admins can flip the flag.
const isAdmin = () => getStoredUser()?.role === 'admin';

// Status options for forms - ordered workflow
const STATUS_OPTIONS = [
  { value: 'alle', label: 'Alle Aufmaße', color: '#7fa93d' },
  { value: 'entwurf', label: 'Entwurf', color: '#f97316' },
  { value: 'auftrag_abgelehnt', label: 'Auftrag Abgelehnt', color: '#6b7280' },
  { value: 'neu', label: 'Aufmaß Genommen', color: '#8b5cf6' },
  { value: 'angebot_versendet', label: 'Angebot Versendet', color: '#a78bfa' },
  { value: 'auftrag_erteilt', label: 'Auftrag Erteilt', color: '#3b82f6' },
  { value: 'rechnung_erstellt', label: 'Rechnung Entwurf', color: '#38bdf8' },
  { value: 'gesendet', label: 'Rechnung Gesendet', color: '#0ea5e9' },
  { value: 'bauantrag', label: 'Bauantrag', color: '#2563eb' },
  { value: 'anzahlung', label: 'Anzahlung Erhalten', color: '#06b6d4' },
  { value: 'bestellt', label: 'Bestellt/In Bearbeitung', color: '#f59e0b' },
  { value: 'montage_geplant', label: 'Montage Geplant', color: '#a855f7' },
  { value: 'montage_gestartet', label: 'Montage Gestartet', color: '#ec4899' },
  { value: 'abnahme', label: 'Abnahme', color: '#10b981' },
  { value: 'schluss_rechnung_erstellt', label: 'Schlussrechnung Entwurf', color: '#22d3ee' },
  { value: 'rest_rechnung_erstellt', label: 'Schlussrechnung Gesendet', color: '#0891b2' },
  { value: 'reklamation_eingegangen', label: 'Reklamation Eingegangen', color: '#ef4444' },
  { value: 'reklamation_bestellt', label: 'Reklamation Bestellt', color: '#dc2626' },
  { value: 'reklamation_abgelehnt', label: 'Reklamation Abgelehnt', color: '#b91c1c' },
  // Virtual filters — these don't map to a status, they filter on the
  // email_sent_at / post_sent_at flags. Filter and counter logic below
  // recognise these special values and short-circuit the status check.
  { value: '__email_sent', label: 'E-Mail versendet', color: '#16a34a' },
  { value: '__post_sent', label: 'Per Post versendet', color: '#2563eb' },
  { value: 'papierkorb', label: 'Papierkorb', color: '#71717a' },
];

// Status order for edit lock check (after auftrag_erteilt, editing is locked for non-admins)
const STATUS_ORDER = [
  'entwurf',
  'auftrag_abgelehnt',
  'neu',
  'angebot_versendet',
  'auftrag_erteilt',  // lock starts AFTER this
  'rechnung_erstellt',
  'gesendet',
  'bauantrag',
  'anzahlung',
  'bestellt',
  'montage_geplant',
  'montage_gestartet',
  'abnahme',
  'schluss_rechnung_erstellt',
  'rest_rechnung_erstellt',
  'reklamation_eingegangen',
  'reklamation_bestellt',
  'reklamation_abgelehnt',
];

// Check if form editing is locked (status is after auftrag_erteilt)
const isFormLocked = (status: string): boolean => {
  const statusIndex = STATUS_ORDER.indexOf(status);
  const lockThreshold = STATUS_ORDER.indexOf('auftrag_erteilt');
  return statusIndex > lockThreshold;
};

// Check if status change is going backward
const isStatusBackward = (currentStatus: string, newStatus: string): boolean => {
  const currentIndex = STATUS_ORDER.indexOf(currentStatus);
  const newIndex = STATUS_ORDER.indexOf(newStatus);
  return newIndex < currentIndex;
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { refreshStats } = useStats();
  const toast = useToast();
  const [forms, setForms] = useState<FormData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Pre-seed the status filter from the URL (?status=...) so the Dashboard
  // stat cards can deep-link into a filtered Aufmaße view. Falls back to
  // 'alle' when the param is missing or malformed.
  const [searchParams] = useSearchParams();
  const initialStatus = searchParams.get('status') || 'alle';
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>(initialStatus);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [formToDelete, setFormToDelete] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  // Sort order for the Aufmaß list. Default mirrors the existing backend
  // ordering ("Neueste zuerst" / created_at DESC). Persisted only in this
  // session — fresh navigation resets to default.
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [, setMontageteamStats] = useState<MontageteamStats[]>([]);
  const [montageteams, setMontageteams] = useState<Montageteam[]>([]);

  // Email composer state
  const [emailComposer, setEmailComposer] = useState<{ to: string; subject: string; body: string; formId?: number; rechnungId?: number; emailType?: string; attachmentName?: string } | null>(null);
  // MODÜL B — LeadFormModal triggered from the status dropdown when picking
  // "Angebot Versendet" (replaces the legacy AngebotItems modal flow).
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [leadModalEditData, setLeadModalEditData] = useState<unknown>(null);
  const [leadModalFromAufmassId, setLeadModalFromAufmassId] = useState<number | null>(null);
  // Confirm dialog id for the admin-only "mark sent by post" flow.
  const [postSentConfirmId, setPostSentConfirmId] = useState<number | null>(null);
  // Rechnung / Anzahlung modal state (Modul C)
  const [rechnungModalOpen, setRechnungModalOpen] = useState(false);
  const [rechnungFormId, setRechnungFormId] = useState<number | null>(null);
  const [rechnungType, setRechnungType] = useState<RechnungType>('anzahlungsrechnung');
  const [anzahlungModalOpen, setAnzahlungModalOpen] = useState(false);
  const [anzahlungFormId, setAnzahlungFormId] = useState<number | null>(null);
  // Pending Rechnung chain: when user goes to a status that needs an Angebot but
  // has none, we open the Angebot modal first; this remembers what to do after
  // the Angebot is saved.
  const [rechnungChainTarget, setRechnungChainTarget] = useState<{ formId: number; type: RechnungType } | null>(null);
  // Mark-sent confirm modal
  const [markSentTarget, setMarkSentTarget] = useState<{ rechnungId: number; rechnungNr: string } | null>(null);
  const [markSentBusy, setMarkSentBusy] = useState(false);
  // Restbetrag info shown inside the Abnahme modal — Angebot brutto minus
  // already-received Anzahlungen. Null means we couldn't compute it
  // (no Angebot yet, or fetch failed).
  const [abnahmeRestbetrag, setAbnahmeRestbetrag] = useState<{ brutto: number; anzahlungen: number; rest: number } | null>(null);
  const [teamDropdownOpen, setTeamDropdownOpen] = useState<number | null>(null);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState<number | null>(null);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [attachmentDropdownOpen, setAttachmentDropdownOpen] = useState<number | null>(null);
  // Lazy-loaded list of available PDF snapshots per form
  const [formSnapshots, setFormSnapshots] = useState<Record<number, FormPdfSnapshot[]>>({});
  // Lazy-loaded Rechnungen per form — each Rechnung gets its own dropdown
  // entry so Anzahlungsraten / Schlussrechnungen are individually openable.
  const [formRechnungen, setFormRechnungen] = useState<Record<number, Rechnung[]>>({});
  // Status history modal
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedFormHistory, setSelectedFormHistory] = useState<StatusHistoryEntry[]>([]);
  const [, setSelectedFormId] = useState<number | null>(null);
  // Abnahme modal
  const [abnahmeModalOpen, setAbnahmeModalOpen] = useState(false);
  const [abnahmeFormId, setAbnahmeFormId] = useState<number | null>(null);
  const [abnahmeData, setAbnahmeData] = useState<Partial<AbnahmeData>>({
    istFertig: false,
    hatProbleme: false,
    problemBeschreibung: '',
    maengelListe: [''],
    baustelleSauber: null,
    monteurNote: null,
    kundeName: '',
    kundeUnterschrift: false,
    bemerkungen: ''
  });
  const [abnahmeSaving, setAbnahmeSaving] = useState(false);
  // Mängel images
  const [maengelImages, setMaengelImages] = useState<AbnahmeImage[]>([]);
  const [maengelImageFiles, setMaengelImageFiles] = useState<File[]>([]);
  // Status date modal (for all status changes)
  const [statusDateModalOpen, setStatusDateModalOpen] = useState(false);
  const [statusDateFormId, setStatusDateFormId] = useState<number | null>(null);
  const [statusDateValue, setStatusDateValue] = useState<string>('');
  const [pendingStatus, setPendingStatus] = useState<string>('');

  // Angebot modal
  const [angebotModalOpen, setAngebotModalOpen] = useState(false);
  const [angebotFormId, setAngebotFormId] = useState<number | null>(null);
  const [angebotItems, setAngebotItems] = useState<AngebotItem[]>([{ bezeichnung: '', menge: 1, einzelpreis: 0, gesamtpreis: 0 }]);
  const [angebotDate, setAngebotDate] = useState<string>('');
  const [angebotBemerkungen, setAngebotBemerkungen] = useState<string>('');
  const [angebotSaving, setAngebotSaving] = useState(false);
  const [angebotConfirmOpen, setAngebotConfirmOpen] = useState(false);
  // angebotEditMode is now always false because the legacy AngebotItems modal
  // is no longer triggered (MODÜL B unified flow). Kept as a read-only state so
  // the legacy modal markup compiles without changes.
  const [angebotEditMode] = useState(false);

  // Document/Video upload state
  const [uploadingDocFormId, setUploadingDocFormId] = useState<number | null>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  // E-Signature state
  const [branchFeatures, setBranchFeatures] = useState<BranchFeatures | null>(null);
  const [esignatureStatuses, setEsignatureStatuses] = useState<Record<number, EsignatureStatus>>({});
  const [esignatureLoading, setEsignatureLoading] = useState<number | null>(null);
  const [abnahmeSignatureLoading, setAbnahmeSignatureLoading] = useState(false);
  const [refreshingSignatures, setRefreshingSignatures] = useState<Set<number>>(new Set());


  useEffect(() => {
    loadData();
  }, []);

  // Polling for pending signatures (every 30 seconds)
  useEffect(() => {
    if (!branchFeatures?.esignature_enabled) return;

    const pollPendingSignatures = async () => {
      // Find all pending signatures
      const pendingSignatures: { formId: number; requestId: number }[] = [];

      Object.entries(esignatureStatuses).forEach(([formId, status]) => {
        status.signatures?.forEach(sig => {
          if (sig.status === 'pending' || sig.status === 'viewed' || sig.status === 'signing') {
            pendingSignatures.push({ formId: Number(formId), requestId: sig.id });
          }
        });
      });

      if (pendingSignatures.length === 0) return;

      // Refresh status for each pending signature
      for (const { formId, requestId } of pendingSignatures) {
        try {
          const result = await refreshSignatureStatus(requestId);
          if (result.updated) {
            // Reload the full status for this form
            const newStatus = await getEsignatureStatus(formId);
            setEsignatureStatuses(prev => ({ ...prev, [formId]: newStatus }));
          }
        } catch (err) {
          console.error('Error polling signature status:', err);
        }
      }
    };

    // Poll every 2 minutes (BoldSign rate limit: 50 calls/hour)
    const interval = setInterval(pollPendingSignatures, 120000);

    return () => clearInterval(interval);
  }, [branchFeatures?.esignature_enabled, esignatureStatuses]);

  // Poll for new signature notifications (every 30 seconds)
  const lastNotificationCheckRef = useRef<string | null>(null);
  useEffect(() => {
    if (!branchFeatures?.esignature_enabled) return;

    const checkNotifications = async () => {
      try {
        const response = await getSignatureNotifications(lastNotificationCheckRef.current || undefined);

        // Show toast for each new signed document
        response.notifications.forEach((notification: SignatureNotification) => {
          const customerName = `${notification.kunde_vorname} ${notification.kunde_nachname}`.trim();
          const docType = notification.document_type === 'aufmass' ? 'Aufmaß'
            : notification.document_type === 'angebot' ? 'Angebot'
            : notification.document_type === 'abnahme' ? 'Abnahme' : 'Dokument';

          toast.success(
            'Neue Unterschrift',
            `${customerName} hat ${docType} unterschrieben`
          );

          // Refresh signature status for this form
          getEsignatureStatus(notification.form_id).then(newStatus => {
            setEsignatureStatuses(prev => ({ ...prev, [notification.form_id]: newStatus }));
          }).catch(() => {});
        });

        lastNotificationCheckRef.current = response.checked_at;
      } catch (err) {
        console.error('Error checking signature notifications:', err);
      }
    };

    // Initial check
    checkNotifications();

    // Poll every 30 seconds
    const interval = setInterval(checkNotifications, 30000);
    return () => clearInterval(interval);
  }, [branchFeatures?.esignature_enabled, toast]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [formsData, teamStats, teams, features] = await Promise.all([
        getForms(),
        getMontageteamStats(),
        getMontageteams(),
        getBranchFeatures().catch(() => null)
      ]);
      setForms(formsData);
      setMontageteamStats(teamStats);
      setMontageteams(teams.filter(t => t.is_active));
      setBranchFeatures(features);
      refreshStats();

      // Load signature statuses for recent forms (non-blocking)
      if (features?.esignature_enabled && formsData.length > 0) {
        // Load for first 20 forms to avoid too many requests
        const recentForms = formsData.slice(0, 20);
        Promise.all(
          recentForms.map(form =>
            getEsignatureStatus(form.id!).catch(() => null)
          )
        ).then(statuses => {
          const statusMap: Record<number, EsignatureStatus> = {};
          recentForms.forEach((form, i) => {
            if (statuses[i]) {
              statusMap[form.id!] = statuses[i]!;
            }
          });
          setEsignatureStatuses(prev => ({ ...prev, ...statusMap }));
        });
      }
    } catch (err) {
      console.error('Error loading data:', err);
      setError('Daten konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  const handleNewForm = () => navigate('/form/new');
  const handleEditForm = (id: number) => navigate(`/form/${id}`);

  // Open attachment upload for locked forms (non-admin users)
  const handleOpenAttachmentUpload = (id: number) => {
    setUploadingDocFormId(id);
    docInputRef.current?.click();
  };

  const handleDeleteForm = (id: number) => {
    setFormToDelete(id);
    setDeleteModalOpen(true);
  };

  const handleMontageteamChange = async (formId: number, teamName: string) => {
    try {
      const form = forms.find(f => f.id === formId);
      if (!form) return;

      const updatedSpecs = {
        ...form.specifications,
        montageteam: teamName || null
      };

      await updateForm(formId, { specifications: updatedSpecs });

      // Update local state
      setForms(forms.map(f =>
        f.id === formId
          ? { ...f, specifications: updatedSpecs }
          : f
      ));
      setTeamDropdownOpen(null);
    } catch (err) {
      console.error('Error updating montageteam:', err);
      toast.error('Fehler', 'Das Montageteam konnte nicht aktualisiert werden.');
    }
  };

  const getFormMontageteam = (form: FormData): string => {
    const specs = form.specifications as Record<string, unknown>;
    return (specs?.montageteam as string) || '';
  };

  const getFormStatus = (form: FormData): string => {
    const status = form.status || 'neu';
    // Map legacy statuses to new ones
    if (status === 'completed' || status === 'draft') {
      return 'neu';
    }
    return status;
  };

  // Aufmaß-stage = the user has taken measurements and possibly created an
  // Angebot, but nothing has been sent to the customer yet. Once status moves
  // past angebot_versendet, the lifecycle is "in flight" and stage badges
  // shouldn't claim "ausstehend" anymore.
  const isInAufmassStage = (form: FormData): boolean => {
    const s = getFormStatus(form);
    return s === 'entwurf' || s === 'neu' || s === 'aufmass_genommen';
  };

  // Angebot was drafted (lead_id linked from LeadFormModal save) but the
  // user didn't tick "send via e-mail" on save — status stays in aufmass
  // stage and we surface a "Versand ausstehend" badge so back-office can
  // trigger the send from the e-mail icon.
  const isAngebotPendingSend = (form: FormData): boolean => {
    return !!form.lead_id && isInAufmassStage(form);
  };

  const getStatusLabel = (status: string): string => {
    const option = STATUS_OPTIONS.find(o => o.value === status);
    return option?.label || 'Alle Aufmaße';
  };

  const getStatusColor = (status: string): string => {
    const option = STATUS_OPTIONS.find(o => o.value === status);
    return option?.color || '#7fa93d';
  };

  // Confirm + execute the admin-only postal mail mark. Refreshes the form
  // list so the badge + button overlay update without a manual reload.
  const handleConfirmMarkPostSent = async (formId: number) => {
    try {
      await markFormPostSent(formId);
      setPostSentConfirmId(null);
      const fresh = await getForms();
      setForms(fresh);
      toast.success('Per Post markiert', `Aufmaß #${formId} wurde als per Post versendet markiert.`);
    } catch (err) {
      console.error('Mark post-sent failed:', err);
      toast.error('Fehler', 'Konnte nicht als per Post versendet markiert werden.');
      setPostSentConfirmId(null);
    }
  };

  const handleStatusChange = async (formId: number, newStatus: string) => {
    // Get current form status
    const form = forms.find(f => f.id === formId);
    const currentStatus = form ? getFormStatus(form) : 'neu';

    // Prevent non-admin users from going backward in status
    if (!isAdminOrOffice() && isStatusBackward(currentStatus, newStatus)) {
      toast.warning('Nicht erlaubt', 'Status kann nur von einem Admin zurückgesetzt werden.');
      setStatusDropdownOpen(null);
      return;
    }

    // MODÜL B — Unified flow: when the user picks "angebot_versendet" from
    // the status dropdown, open the LeadFormModal (Aus Aufmaß or edit mode
    // based on form.lead_id) instead of the legacy AngebotItems modal. The
    // modal save chain (markLeadAngebotAsSent → syncFormsFromLead) flips the
    // form status, so we don't write it here. Cancelling the modal leaves
    // the form unchanged.
    if (newStatus === 'angebot_versendet') {
      try {
        // Always carry the source Aufmaß id so the modal can render the
        // "Aus Aufmaß" banner + photos in both fresh and edit modes.
        setLeadModalFromAufmassId(formId);
        if (form?.lead_id) {
          const leadDetail = await api.get<unknown>(`/leads/${form.lead_id}`);
          setLeadModalEditData(leadDetail);
        } else {
          setLeadModalEditData(null);
        }
        setLeadModalOpen(true);
      } catch (err) {
        console.error('Failed to open Angebot modal:', err);
        toast.error('Fehler', 'Angebot-Formular konnte nicht geöffnet werden.');
      }
      setStatusDropdownOpen(null);
      return;
    }

    // If selecting abnahme status, open abnahme modal first
    if (newStatus === 'abnahme') {
      setAbnahmeFormId(formId);
      // Reset image states
      setMaengelImageFiles([]);
      setAbnahmeRestbetrag(null);
      // Load existing abnahme data, images, signature status, and the
      // Restbetrag (Angebot-Brutto − Σ Anzahlungen) so we can warn the user
      // before they finalize the acceptance.
      try {
        const [existingAbnahme, existingImages, sigStatus, angebot, anzahlungen] = await Promise.all([
          getAbnahme(formId),
          getAbnahmeImages(formId),
          getEsignatureStatus(formId).catch(() => null),
          getAngebot(formId).catch(() => null),
          getAnzahlungenByForm(formId).catch(() => []),
        ]);
        if (angebot?.summary) {
          const brutto = num(angebot.summary.brutto_summe);
          const anzSum = (anzahlungen || []).reduce((s, a) => s + num(a.betrag), 0);
          setAbnahmeRestbetrag({ brutto, anzahlungen: anzSum, rest: brutto - anzSum });
        }
        if (existingAbnahme) {
          setAbnahmeData(existingAbnahme);
        } else {
          setAbnahmeData({
            istFertig: false,
            hatProbleme: false,
            problemBeschreibung: '',
            maengelListe: [''],
            baustelleSauber: null,
            monteurNote: null,
            kundeName: '',
            kundeUnterschrift: false,
            bemerkungen: ''
          });
        }
        setMaengelImages(existingImages || []);
        // Store signature status
        if (sigStatus) {
          setEsignatureStatuses(prev => ({ ...prev, [formId]: sigStatus }));
        }
      } catch {
        setAbnahmeData({
          istFertig: false,
          hatProbleme: false,
          problemBeschreibung: '',
          maengelListe: [''],
          baustelleSauber: null,
          monteurNote: null,
          kundeName: '',
          kundeUnterschrift: false,
          bemerkungen: ''
        });
        setMaengelImages([]);
      }
      setAbnahmeModalOpen(true);
      setStatusDropdownOpen(null);
      return;
    }

    // If selecting anzahlung status, open Anzahlung management modal (Modul C)
    if (newStatus === 'anzahlung') {
      setAnzahlungFormId(formId);
      setAnzahlungModalOpen(true);
      setStatusDropdownOpen(null);
      // Persist status change too — same pattern as plain status, just default to today
      try {
        await updateForm(formId, { status: newStatus, statusDate: new Date().toISOString().split('T')[0] });
        setForms(prev => prev.map(f => f.id === formId ? { ...f, status: newStatus } : f));
      } catch (err) {
        console.error('Error updating status to anzahlung:', err);
      }
      return;
    }

    // For all other status changes, open date picker modal
    setStatusDateFormId(formId);
    setPendingStatus(newStatus);
    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    setStatusDateValue(today);
    setStatusDateModalOpen(true);
    setStatusDropdownOpen(null);
  };

  // ============ MODUL C: RECHNUNG TRIGGER ============
  const handleOpenRechnung = (formId: number, type: RechnungType) => {
    setRechnungFormId(formId);
    setRechnungType(type);
    setRechnungModalOpen(true);
  };

  // Manually mark the latest Entwurf Rechnung as sent (postal/manual flow).
  // Opens a styled confirmation modal; the actual API call lives in confirmMarkRechnungSent.
  const handleMarkRechnungSent = async (formId: number) => {
    try {
      const rechnungen = await getRechnungenByForm(formId);
      const target = rechnungen.find(r => r.status === 'entwurf');
      if (!target) {
        toast.warning('Keine Entwurf-Rechnung', 'Es gibt keine Rechnung im Entwurf-Status.');
        return;
      }
      setMarkSentTarget({ rechnungId: target.id, rechnungNr: target.rechnung_nr });
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Konnte nicht geladen werden.');
    }
  };

  const confirmMarkRechnungSent = async () => {
    if (!markSentTarget) return;
    setMarkSentBusy(true);
    try {
      await markRechnungSent(markSentTarget.rechnungId);
      toast.success('Markiert', `Rechnung ${markSentTarget.rechnungNr} als gesendet markiert.`);
      setMarkSentTarget(null);
      loadData();
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Konnte nicht markiert werden.');
    } finally {
      setMarkSentBusy(false);
    }
  };

  // Open email composer for the latest Entwurf Rechnung of a form (used by the
  // "Senden" button on cards in *_erstellt status — manual delivery flow).
  // Build the customer-facing Rechnung e-mail body. For Anzahlungsrechnung
  // we expose BOTH the deposit slice AND the full Gesamtsumme so the customer
  // doesn't think they owe the entire project price upfront. Schlussrechnung
  // already invoices the remaining balance, so that case stays simple.
  const buildRechnungEmailBody = async (
    rechnung: Pick<Rechnung, 'type' | 'rechnung_nr' | 'kunde_vorname' | 'kunde_nachname' | 'brutto_betrag' | 'form_id'>,
  ): Promise<string> => {
    const greet = `Sehr geehrte/r ${rechnung.kunde_vorname || ''} ${rechnung.kunde_nachname || ''}`.trim() + ',';
    const labelDe = rechnung.type === 'schlussrechnung' ? 'Schlussrechnung' : 'Anzahlungsrechnung';
    const fmtEur = (n: number) =>
      n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' EUR';

    if (rechnung.type === 'anzahlungsrechnung') {
      const anzahlungBetrag = num(rechnung.brutto_betrag);
      let gesamtsumme = 0;
      try {
        const ang = await getAngebot(rechnung.form_id);
        gesamtsumme = num(ang?.summary?.brutto_summe || 0);
      } catch {
        // Angebot fetch failed — fall back to deposit-only wording rather than block the e-mail.
      }
      const restbetrag = gesamtsumme > anzahlungBetrag ? gesamtsumme - anzahlungBetrag : 0;
      const totalsLine = gesamtsumme > 0
        ? `\n\nÜbersicht zu Ihrem Auftrag:\n  • Gesamtbetrag (brutto): ${fmtEur(gesamtsumme)}\n  • Anzahlung (diese Rechnung): ${fmtEur(anzahlungBetrag)}\n  • Restbetrag (folgt mit Schlussrechnung): ${fmtEur(restbetrag)}`
        : `\n\nAnzahlungsbetrag (brutto): ${fmtEur(anzahlungBetrag)}`;
      return `${greet}\n\nim Anhang finden Sie unsere ${labelDe} mit der Nummer ${rechnung.rechnung_nr}.${totalsLine}\n\nWir bitten um Überweisung des Anzahlungsbetrags innerhalb des angegebenen Zahlungsziels. Den Restbetrag stellen wir Ihnen nach Abnahme mit der Schlussrechnung in Rechnung.\n\nMit freundlichen Grüßen`;
    }

    // Schlussrechnung — remaining-balance invoice, kept simple.
    return `${greet}\n\nim Anhang finden Sie unsere ${labelDe} mit der Nummer ${rechnung.rechnung_nr}.\n\nFälliger Restbetrag (brutto): ${fmtEur(num(rechnung.brutto_betrag))}\n\nMit freundlichen Grüßen`;
  };

  const handleResendRechnungEmail = async (formId: number) => {
    try {
      const rechnungen = await getRechnungenByForm(formId);
      const target = rechnungen.find(r => r.status === 'entwurf') || rechnungen[0];
      if (!target) {
        toast.warning('Keine Rechnung', 'Für dieses Aufmaß wurde noch keine Rechnung erstellt.');
        return;
      }
      const labelDe = target.type === 'schlussrechnung' ? 'Schlussrechnung' : 'Anzahlungsrechnung';
      const body = await buildRechnungEmailBody(target);
      setEmailComposer({
        to: target.kunde_email || '',
        subject: `${labelDe} ${target.rechnung_nr}`,
        body,
        rechnungId: target.id,
        emailType: target.type === 'schlussrechnung' ? 'rechnung_schluss' : 'rechnung_anzahlung',
        attachmentName: `Rechnung_${target.rechnung_nr}.pdf`,
      });
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Rechnung konnte nicht geladen werden.');
    }
  };

  const handleRechnungSaved = async (rechnung: Rechnung, opts: { sendEmail: boolean }) => {
    setRechnungModalOpen(false);
    // Backend bumps form.status to *_erstellt (Entwurf). Email send (or admin
    // mark-sent) advances it to gesendet / rest_rechnung_erstellt.
    loadData();
    if (opts.sendEmail && rechnung.kunde_email) {
      const labelDe = rechnung.type === 'schlussrechnung' ? 'Schlussrechnung' : 'Anzahlungsrechnung';
      const body = await buildRechnungEmailBody(rechnung);
      setEmailComposer({
        to: rechnung.kunde_email,
        subject: `${labelDe} ${rechnung.rechnung_nr}`,
        body,
        rechnungId: rechnung.id,
        emailType: rechnung.type === 'schlussrechnung' ? 'rechnung_schluss' : 'rechnung_anzahlung',
        attachmentName: `Rechnung_${rechnung.rechnung_nr}.pdf`,
      });
    } else {
      toast.success('Rechnung als Entwurf erstellt', `Nr. ${rechnung.rechnung_nr}. Per E-Mail oder manuell als „gesendet" markieren, um abzuschließen.`);
    }
  };

  // Open status history modal
  const handleOpenHistory = async (formId: number) => {
    try {
      const history = await getStatusHistory(formId);
      setSelectedFormHistory(history);
      setSelectedFormId(formId);
      setHistoryModalOpen(true);
    } catch (err) {
      console.error('Error loading status history:', err);
      toast.error('Fehler', 'Status-Historie konnte nicht geladen werden.');
    }
  };

  // Check if abnahme is locked (signed via e-signature)
  const abnahmeSignature = abnahmeFormId ? esignatureStatuses[abnahmeFormId]?.signatures?.find(s => s.document_type === 'abnahme') : null;
  const isAbnahmeLocked = abnahmeSignature?.status === 'signed';

  // Check if Abnahme photos are required but missing (min 2 photos for both cases)
  const totalPhotos = maengelImages.length + maengelImageFiles.length;
  const abnahmePhotosRequired = (abnahmeData.istFertig || abnahmeData.hatProbleme) && totalPhotos < 2;

  // Comprehensive Abnahme validation - core fields required, signature is separate
  const abnahmeValidation = {
    statusSelected: abnahmeData.istFertig === true || abnahmeData.hatProbleme === true,
    baustelleSauber: !!abnahmeData.baustelleSauber,
    monteurNote: !!abnahmeData.monteurNote && abnahmeData.monteurNote >= 1 && abnahmeData.monteurNote <= 6,
    photosOk: totalPhotos >= 2,
    kundeName: !!(abnahmeData.kundeName && abnahmeData.kundeName.trim())
    // Note: kundeUnterschrift validation removed - now handled via e-signature
  };
  const abnahmeIsValid = Object.values(abnahmeValidation).every(v => v);

  // Get missing fields for tooltip
  const abnahmeMissingFields: string[] = [];
  if (!abnahmeValidation.statusSelected) abnahmeMissingFields.push('Status wählen');
  if (!abnahmeValidation.baustelleSauber) abnahmeMissingFields.push('Baustelle sauber');
  if (!abnahmeValidation.monteurNote) abnahmeMissingFields.push('Monteur Note');
  if (!abnahmeValidation.photosOk) abnahmeMissingFields.push('Min. 2 Fotos');
  if (!abnahmeValidation.kundeName) abnahmeMissingFields.push('Kundenname');

  const persistAbnahmeDraft = async (): Promise<string> => {
    if (!abnahmeFormId) return 'abnahme';

    await saveAbnahme(abnahmeFormId, abnahmeData);

    if (maengelImageFiles.length > 0) {
      await uploadAbnahmeImages(abnahmeFormId, maengelImageFiles);
      setMaengelImageFiles([]);
    }

    const newStatus = abnahmeData.hatProbleme ? 'reklamation_eingegangen' : 'abnahme';
    await updateForm(abnahmeFormId, { status: newStatus });
    setForms(forms.map(f =>
      f.id === abnahmeFormId
        ? { ...f, status: newStatus }
        : f
    ));
    // Snapshot the Abnahme-PDF so historic versions stay accessible after further status changes
    const snapType = statusToSnapshotType(newStatus);
    if (snapType) void captureSnapshot(abnahmeFormId, snapType);

    return newStatus;
  };

  // buildMailtoLink removed - replaced by EmailComposer

  const getEmailTemplate = (form: FormData): { to: string; subject: string; body: string } => {
    const kundenName = `${form.kundeVorname} ${form.kundeNachname}`.trim();
    const status = getFormStatus(form);
    const montageDatumFormatted = form.montageDatum
      ? new Date(form.montageDatum).toLocaleDateString('de-DE')
      : '________';

    let subject = '';
    let body = '';

    // Angebot wartet auf Versand: lead drafted via LeadFormModal but the
    // user didn't trigger e-mail send during save. Surface the right
    // template so the icon-button send promotes the status afterwards.
    if (isAngebotPendingSend(form) || status === 'angebot_versendet') {
      subject = 'Ihr Angebot — AYLUX';
      body = `Sehr geehrte/r ${kundenName},

anbei erhalten Sie Ihr persönliches Angebot.

Bei Rückfragen oder Wünschen zur Anpassung stehen wir Ihnen gerne zur Verfügung.

Mit freundlichen Grüßen
Ihr AYLUX Team`;
      return { to: form.kundeEmail || '', subject, body };
    }

    switch (status) {
      case 'anzahlung':
        subject = 'Information zu Ihrer Bestellung/Anzahlung';
        body = `Sehr geehrte/r ${kundenName},

Ihre Anzahlung in Höhe von ______ Euro ist auf unserem Konto eingegangen. Sobald Ihre Bestellung in den Produktionsplan aufgenommen wurde, werden wir Sie zusätzlich informieren.

Vielen Dank, dass Sie sich für Aylux entschieden haben. Unsere voraussichtliche Montagefrist beträgt ca. 8–10 Wochen. Wir danken Ihnen für Ihre Geduld. Diese E-Mail stellt keinen Montagetermin dar. Nachdem Ihre Bestellung speziell nach den Maßen Ihres Hauses produziert wurde, werden wir Sie zur Vereinbarung eines Montagetermins erneut kontaktieren. Bitte verfolgen Sie daher unsere Informations-E-Mails.

Gerne beantworten wir Ihre Fragen, die Sie in dieser Zeit stellen möchten.

Mit freundlichen Grüßen
Aylux Team`;
        break;

      case 'bestellt':
        subject = 'Information zu Ihrer Bestellung';
        body = `Sehr geehrte/r ${kundenName},

Vielen Dank, dass Sie sich für Aylux entschieden haben. Ihre Bestellung wurde in die Produktion aufgenommen. Die Produktionszeit beträgt etwa 4 Wochen. Wir werden uns so bald wie möglich erneut mit Ihnen in Verbindung setzen, um einen Montagetermin zu vereinbaren. Bitte verfolgen Sie daher unsere Informations-E-Mails. Vielen Dank für Ihre Geduld.

Gerne beantworten wir Ihre Fragen, die Sie in dieser Zeit stellen möchten.

Mit freundlichen Grüßen
Aylux Team`;
        break;

      case 'montage_geplant':
        subject = 'Information zum Montagetermin Ihrer Bestellung';
        body = `Sehr geehrte/r ${kundenName},

der Produktionsprozess des von Ihnen bestellten Produkts ist abgeschlossen, und der vorgesehene Montagetermin ist der ${montageDatumFormatted}.

Bitte teilen Sie uns mit, ob der genannte Termin für Sie passend ist. Sollte der geplante Termin für Sie nicht geeignet sein, bitten wir Sie, uns die für Sie passenden Tage oder möglichen Zeiträume mitzuteilen. Nach Ihrer Bestätigung wird die Montageplanung finalisiert.

Bei Fragen stehen wir Ihnen jederzeit gerne zur Verfügung.

Vielen Dank für Ihr Interesse und Ihre Zusammenarbeit. Wir wünschen Ihnen einen schönen Tag.

Mit freundlichen Grüßen
Aylux Team`;
        break;

      case 'reklamation':
        subject = 'Information zu Reklamation / Restarbeiten';
        body = `Sehr geehrte/r ${kundenName},

wir möchten Sie darüber informieren, dass die erforderlichen Arbeiten im Zusammenhang mit Ihrer Reklamation / den Restarbeiten durchgeführt wurden. Die vorgenommenen bzw. noch vorzunehmenden Anpassungen sind in dem beigefügten Dokument detailliert aufgeführt. Wir bitten Sie, dieses entsprechend zu prüfen.

Wir werden Sie in kürzester Zeit bezüglich eines Montagetermins zur finalen Durchführung informieren. Bitte verfolgen Sie hierzu unsere weiteren Informations-E-Mails.

Sollten Sie in der Zwischenzeit Fragen haben, stehen wir Ihnen jederzeit gerne zur Verfügung.

Vielen Dank für Ihre Geduld und Ihr Verständnis.

Mit freundlichen Grüßen
Aylux Team`;
        break;
    }

    return {
      to: form.kundeEmail || '',
      subject,
      body
    };
  };

  // buildAbnahmeSignMailtoLink removed - replaced by EmailComposer

  const handleSaveAbnahme = async () => {
    if (!abnahmeFormId) return;

    if (!abnahmeIsValid) {
      toast.warning('Fehlende Felder', 'Bitte fuellen Sie alle erforderlichen Felder aus: ' + abnahmeMissingFields.join(', '));
      return;
    }

    setAbnahmeSaving(true);
    try {
      const newStatus = await persistAbnahmeDraft();
      const signRequest = await createAbnahmeSignRequest(abnahmeFormId);
      const currentForm = forms.find(f => f.id === abnahmeFormId);
      const updatedForm = currentForm ? { ...currentForm, status: newStatus, abnahmeSignPending: true } : null;

      setForms(prev => prev.map(f =>
        f.id === abnahmeFormId
          ? { ...f, status: newStatus, abnahmeSignPending: true }
          : f
      ));

      setAbnahmeModalOpen(false);
      setAbnahmeFormId(null);
      setMaengelImages([]);
      refreshStats();

      if (updatedForm?.kundeEmail) {
        const kundenName = `${updatedForm.kundeVorname} ${updatedForm.kundeNachname}`.trim();
        const restNote = abnahmeRestbetrag && abnahmeRestbetrag.rest > 0
          ? `\n\nHinweis: Nach Abnahme verbleibt ein Restbetrag in Höhe von ${abnahmeRestbetrag.rest.toLocaleString('de-DE', { minimumFractionDigits: 2 })} EUR. Eine Schlussrechnung wird Ihnen separat zugestellt.`
          : '';
        setEmailComposer({
          to: updatedForm.kundeEmail,
          subject: 'Bitte bestätigen Sie Ihre Abnahme',
          body: `Sehr geehrte/r ${kundenName},\n\nbitte bestätigen Sie die Abnahme über folgenden Link:\n${signRequest.signUrl}${restNote}\n\nMit freundlichen Grüßen\nAylux Team`,
          formId: abnahmeFormId,
          emailType: 'abnahme'
        });
      } else {
        try {
          await navigator.clipboard.writeText(signRequest.signUrl);
          toast.warning('E-Mail fehlt', 'Kein Kunde-E-Mail hinterlegt. Signaturlink wurde in die Zwischenablage kopiert.');
        } catch {
          toast.warning('E-Mail fehlt', 'Kein Kunde-E-Mail hinterlegt. Signaturlink wurde trotzdem erstellt.');
        }
      }
    } catch (err) {
      console.error('Error saving abnahme:', err);
      toast.error('Fehler', 'Abnahme konnte nicht gespeichert werden.');
    } finally {
      setAbnahmeSaving(false);
    }
  };
  // Handle document/video upload
  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !uploadingDocFormId) return;

    const file = files[0];
    const maxSize = 10 * 1024 * 1024; // 10MB

    if (file.size > maxSize) {
      toast.warning('Datei zu groß', 'Maximale Dateigröße: 10MB');
      return;
    }

    try {
      await uploadImages(uploadingDocFormId, [file]);
      // Refresh forms to show new file
      const formsData = await getForms();
      setForms(formsData);
      setAttachmentDropdownOpen(null);
    } catch (err) {
      console.error('Error uploading document:', err);
      toast.error('Fehler', 'Datei konnte nicht hochgeladen werden.');
    } finally {
      setUploadingDocFormId(null);
      if (docInputRef.current) {
        docInputRef.current.value = '';
      }
    }
  };

  // E-Signature handlers
  // Helper to generate and save PDF before signature
  const ensurePdfExists = async (formId: number, forSignature: boolean = false): Promise<boolean> => {
    try {
      // Get fresh form data including abnahme and angebot
      const [formData, abnahmeData, abnahmeImages, angebotData] = await Promise.all([
        getForm(formId),
        getAbnahme(formId),
        getAbnahmeImages(formId),
        getAngebot(formId).catch(() => ({ summary: null, items: [] }))
      ]);

      const pdfFormData = {
        ...formData,
        id: String(formData.id),
        productSelection: {
          category: formData.category,
          productType: formData.productType,
          model: formData.model ? formData.model.split(',') : []
        },
        specifications: formData.specifications as Record<string, string | number | boolean | string[]>,
        bilder: formData.bilder || [],
        customerSignature: formData.customerSignature || undefined,
        signatureName: formData.signatureName || undefined,
        abnahme: abnahmeData ? {
          ...abnahmeData,
          maengelBilder: abnahmeImages || []
        } : undefined,
        angebot: angebotData?.items?.length > 0 ? {
          items: angebotData.items,
          summary: angebotData.summary
        } : undefined
      };

      // Generate PDF (forSignature: true = lightweight PDF without images for SES)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await generatePDF(pdfFormData as any, { returnBlob: true, forSignature });

      if (result && result.blob) {
        await savePdf(formId, result.blob);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Error generating PDF for signature:', err);
      return false;
    }
  };

  const handleSendAesSignature = async (form: FormData) => {
    if (!form.id) return;
    setEsignatureLoading(form.id);
    try {
      // First ensure PDF exists (forSignature: true = lightweight PDF without images)
      const pdfReady = await ensurePdfExists(form.id, true);
      if (!pdfReady) {
        throw new Error('PDF konnte nicht erstellt werden');
      }

      await sendAesSignature(form.id);

      // BoldSign sends email directly to signer
      toast.success('Signatur gesendet', 'E-Signatur wurde erfolgreich an den Kunden gesendet.');

      // Refresh e-signature status
      loadEsignatureStatus(form.id);
    } catch (err) {
      console.error('Error sending AES signature:', err);
      toast.error('Fehler', err instanceof Error ? err.message : 'Fehler beim Senden der Signatur');
    } finally {
      setEsignatureLoading(null);
    }
  };


  const loadEsignatureStatus = async (formId: number) => {
    try {
      const statuses = await getEsignatureStatus(formId);
      setEsignatureStatuses(prev => ({ ...prev, [formId]: statuses }));
    } catch (err) {
      console.error('Error loading e-signature status:', err);
    }
  };

  // Manual refresh signature status from BoldSign API
  const handleRefreshSignatureStatus = async (requestId: number, formId: number) => {
    setRefreshingSignatures(prev => new Set(prev).add(requestId));
    try {
      const result = await refreshSignatureStatus(requestId);
      // Always reload to get fresh data
      const newStatus = await getEsignatureStatus(formId);
      setEsignatureStatuses(prev => ({ ...prev, [formId]: newStatus }));

      if (result.updated) {
        console.log(`Signature status updated: ${result.previous_status} -> ${result.current_status}`);
      }
    } catch (err) {
      console.error('Error refreshing signature status:', err);
    } finally {
      setRefreshingSignatures(prev => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  };

  // Send Abnahme signature
  const handleSendAbnahmeSignature = async () => {
    if (!abnahmeFormId) return;

    setAbnahmeSignatureLoading(true);
    try {
      // First ensure PDF exists
      await ensurePdfExists(abnahmeFormId, true);

      await sendAbnahmeAesSignature(abnahmeFormId);
      toast.success('Signatur gesendet', 'Abnahme E-Signatur wurde an den Kunden gesendet.');

      // Refresh signature status
      loadEsignatureStatus(abnahmeFormId);
    } catch (err) {
      console.error('Error sending Abnahme signature:', err);
      toast.error('Fehler', err instanceof Error ? err.message : 'Fehler beim Senden der Abnahme Signatur');
    } finally {
      setAbnahmeSignatureLoading(false);
    }
  };

  // ============ ANGEBOT HANDLERS ============

  // Update angebot item
  const updateAngebotItem = (index: number, field: keyof AngebotItem, value: string | number) => {
    setAngebotItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      // Auto-calculate gesamtpreis
      if (field === 'menge' || field === 'einzelpreis') {
        const menge = field === 'menge' ? Number(value) : updated[index].menge;
        const einzelpreis = field === 'einzelpreis' ? Number(value) : updated[index].einzelpreis;
        updated[index].gesamtpreis = menge * einzelpreis;
      }
      return updated;
    });
  };

  // Add new angebot item
  const addAngebotItem = () => {
    setAngebotItems(prev => [...prev, { bezeichnung: '', menge: 1, einzelpreis: 0, gesamtpreis: 0 }]);
  };

  // Remove angebot item
  const removeAngebotItem = (index: number) => {
    if (angebotItems.length > 1) {
      setAngebotItems(prev => prev.filter((_, i) => i !== index));
    }
  };

  // Calculate angebot totals
  const angebotNetto = angebotItems.reduce((sum, item) => sum + (item.gesamtpreis || 0), 0);
  const angebotMwst = angebotNetto * 0.19;
  const angebotBrutto = angebotNetto + angebotMwst;

  // Validate angebot
  const isAngebotValid = angebotItems.every(item =>
    item.bezeichnung.trim() !== '' &&
    item.menge > 0 &&
    item.einzelpreis >= 0
  ) && angebotDate !== '';

  // Save angebot and show confirmation
  const handleSaveAngebot = async () => {
    if (!angebotFormId || !isAngebotValid) return;

    setAngebotSaving(true);
    try {
      // Save angebot data
      await saveAngebot(angebotFormId, {
        items: angebotItems,
        angebot_datum: angebotDate,
        bemerkungen: angebotBemerkungen,
        mwst_satz: 19
      });

      // Regenerate PDF with angebot data
      await ensurePdfExists(angebotFormId, false);

      // If e-signature is enabled and not in edit mode, show confirmation dialog
      if (branchFeatures?.esignature_enabled && !angebotEditMode) {
        setAngebotConfirmOpen(true);
      } else {
        // If we got here because the user was actually trying to create a
        // Rechnung (and we forced them through Angebot first), promote the
        // status straight to auftrag_erteilt and open the Rechnung modal next.
        const chain = rechnungChainTarget && rechnungChainTarget.formId === angebotFormId ? rechnungChainTarget : null;
        const finalStatus = chain ? 'auftrag_erteilt' : 'angebot_versendet';
        await updateForm(angebotFormId, { status: finalStatus, statusDate: angebotDate });
        setForms(forms.map(f => f.id === angebotFormId ? { ...f, status: finalStatus, statusDate: angebotDate } : f));
        // Freeze the Angebot-PDF so it survives later status changes
        void captureSnapshot(angebotFormId, 'angebot');
        setAngebotModalOpen(false);
        const savedFormId = angebotFormId;
        setAngebotFormId(null);
        refreshStats();
        if (chain) {
          setRechnungChainTarget(null);
          setRechnungFormId(savedFormId);
          setRechnungType(chain.type);
          setRechnungModalOpen(true);
          toast.success('Angebot gespeichert', 'Rechnung wird jetzt erstellt...');
        } else {
          toast.success('Gespeichert', 'Angebot wurde gespeichert.');
        }
      }
    } catch (err) {
      console.error('Error saving angebot:', err);
      toast.error('Fehler', err instanceof Error ? err.message : 'Fehler beim Speichern des Angebots');
    } finally {
      setAngebotSaving(false);
    }
  };

  // Send angebot signature after confirmation
  const handleConfirmSendAngebot = async () => {
    if (!angebotFormId) return;

    setAngebotSaving(true);
    try {
      // Regenerate PDF without media before sending for signature
      await ensurePdfExists(angebotFormId, true);

      // Send e-signature
      await sendAngebotAesSignature(angebotFormId);

      // Update status
      await updateForm(angebotFormId, { status: 'angebot_versendet', statusDate: angebotDate });
      setForms(forms.map(f => f.id === angebotFormId ? { ...f, status: 'angebot_versendet', statusDate: angebotDate } : f));
      // Freeze the signed Angebot-PDF
      void captureSnapshot(angebotFormId, 'angebot');

      // Load signature status
      loadEsignatureStatus(angebotFormId);

      setAngebotConfirmOpen(false);
      setAngebotModalOpen(false);
      setAngebotFormId(null);
      refreshStats();
      toast.success('Angebot gesendet', 'E-Signatur wurde an den Kunden gesendet.');
    } catch (err) {
      console.error('Error sending angebot signature:', err);
      toast.error('Fehler', err instanceof Error ? err.message : 'Fehler beim Senden der Signatur');
    } finally {
      setAngebotSaving(false);
    }
  };

  // Get signature for specific document type
  const getSignatureByType = (formId: number, docType: 'aufmass' | 'abnahme' | 'angebot'): EsignatureRequest | null => {
    const status = esignatureStatuses[formId];
    if (!status?.signatures) return null;
    return status.signatures.find(s => s.document_type === docType) || null;
  };

  // Get signature status label and color
  const getSignatureStatusDisplay = (status: string): { label: string; color: string } => {
    switch (status) {
      case 'signed': return { label: 'Unterschrieben', color: '#10b981' };
      case 'pending': return { label: 'Ausstehend', color: '#f59e0b' };
      case 'viewed': return { label: 'Angesehen', color: '#3b82f6' };
      case 'signing': return { label: 'Wird unterschrieben', color: '#8b5cf6' };
      case 'declined': return { label: 'Abgelehnt', color: '#ef4444' };
      case 'expired': return { label: 'Abgelaufen', color: '#6b7280' };
      case 'failed': return { label: 'Fehlgeschlagen', color: '#ef4444' };
      default: return { label: status, color: '#6b7280' };
    }
  };

  // Download signed document
  const handleDownloadSignedDocument = async (documentId: string, docType: string) => {
    try {
      const blob = await downloadBoldSignDocument(documentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `signed-${docType}-${documentId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading signed document:', err);
      toast.error('Fehler', 'Signiertes Dokument konnte nicht heruntergeladen werden.');
    }
  };

  // E-signature available for these statuses (BoldSign AES only)
  const canSendEsignature = (status: string): boolean => {
    return ['neu', 'angebot_versendet', 'abnahme'].includes(status);
  };

  // Format date for display
  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // getEmailMailtoLink removed - replaced by EmailComposer
  // Open stored PDF in new tab - regenerate if outdated
  const [, setPdfGenerating] = useState<number | null>(null);

  const handleOpenPDF = async (formId: number, docType?: FormPdfDocType) => {
    // If a specific snapshot is requested, open it directly (frozen historical PDF)
    if (docType) {
      window.open(getFormPdfSnapshotUrl(formId, docType), '_blank');
      return;
    }

    try {
      // Always fetch form data to check for signature
      const [formData, abnahmeData, abnahmeImages] = await Promise.all([
        getForm(formId),
        getAbnahme(formId),
        getAbnahmeImages(formId)
      ]);

      const hasSignature = !!formData.customerSignature;

      // Check if PDF needs regeneration
      const status = await getPdfStatus(formId);

      // Use abnahmeOnly mode for abnahme/reklamation status forms
      const isAbnahmeStatus = formData.status === 'abnahme' || formData.status === 'reklamation_eingegangen';

      if (status.needsRegeneration || hasSignature || isAbnahmeStatus) {
        setPdfGenerating(formId);

        const pdfFormData = {
          ...formData,
          id: String(formData.id),
          productSelection: {
            category: formData.category,
            productType: formData.productType,
            model: formData.model ? formData.model.split(',') : []
          },
          specifications: formData.specifications as Record<string, string | number | boolean | string[]>,
          bilder: formData.bilder || [],
          customerSignature: formData.customerSignature || null,
          signatureName: formData.signatureName || null,
          abnahme: abnahmeData ? {
            ...abnahmeData,
            maengelBilder: abnahmeImages || []
          } : undefined
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await generatePDF(pdfFormData as any, { returnBlob: true, abnahmeOnly: isAbnahmeStatus });

        if (result && result.blob) {
          await savePdf(formId, result.blob);
          const blobUrl = URL.createObjectURL(result.blob);
          window.open(blobUrl, '_blank');
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
          setPdfGenerating(null);
          return;
        }
        setPdfGenerating(null);
      }

      // Open PDF in new tab
      const pdfUrl = getPdfUrl(formId);
      const cacheBustUrl = `${pdfUrl}${pdfUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
      window.open(cacheBustUrl, '_blank');
    } catch (err) {
      console.error('Error opening PDF:', err);
      setPdfGenerating(null);
      // Fallback - just try to open it
      const pdfUrl = getPdfUrl(formId);
      const cacheBustUrl = `${pdfUrl}${pdfUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
      window.open(cacheBustUrl, '_blank');
    }
  };

  // Map a status transition to the document type whose snapshot should be captured.
  // Only transitions that *change* what the PDF would contain trigger a snapshot.
  const statusToSnapshotType = (status: string): FormPdfDocType | null => {
    if (status === 'neu') return 'aufmass';                     // "Aufmaß Genommen"
    if (status === 'angebot_versendet') return 'angebot';
    if (status === 'abnahme' || status === 'reklamation_eingegangen') return 'abnahme';
    if (status === 'anzahlung') return 'rechnung';              // placeholder for now
    return null;
  };

  // Whether a given PDF type is meaningful for the form's current status.
  // Drives the enabled/disabled state of dropdown entries.
  const isPdfTypeAvailableForStatus = (status: string, docType: FormPdfDocType): boolean => {
    if (docType === 'rechnung') {
      // Rechnung snapshot exists once Ezgi's RechnungForm has saved a Rechnung PDF
      // (saveRechnungPdf endpoint mirrors it to aufmass_form_pdf_snapshots).
      return ['rechnung_erstellt', 'rechnung_gesendet', 'schluss_rechnung_erstellt', 'schluss_rechnung_gesendet',
              'anzahlung', 'auftrag_erteilt', 'bauantrag', 'bestellt', 'montage_geplant',
              'montage_gestartet', 'abnahme', 'reklamation_eingegangen'].includes(status);
    }
    // Aufmaß is always available once the form has progressed past "draft"
    if (docType === 'aufmass') {
      return !['entwurf', 'auftrag_abgelehnt', 'papierkorb'].includes(status);
    }
    // Angebot exists from "angebot_versendet" onward
    if (docType === 'angebot') {
      return ['angebot_versendet', 'auftrag_erteilt', 'bauantrag', 'anzahlung',
              'bestellt', 'montage_geplant', 'montage_gestartet',
              'abnahme', 'reklamation_eingegangen'].includes(status);
    }
    if (docType === 'abnahme') {
      return ['abnahme', 'reklamation_eingegangen'].includes(status);
    }
    return false;
  };

  // Click handler for a PDF-type entry: open existing snapshot or generate one on-the-fly.
  const handlePdfTypeClick = async (formId: number, docType: FormPdfDocType) => {
    const existing = (formSnapshots[formId] || []).find((s) => s.document_type === docType);
    // Rechnung has no client-side generator; only open if a saved snapshot exists.
    if (docType === 'rechnung') {
      if (existing) {
        window.open(getFormPdfSnapshotUrl(formId, docType), '_blank');
      } else {
        toast.warning('Keine Rechnung', 'Bitte zuerst eine Rechnung erstellen.');
      }
      return;
    }
    // Abnahme: prefer the customer-signed BoldSign PDF over the unsigned
    // snapshot. The unsigned version is only meaningful before the customer
    // confirms — once signed, the e-signed copy is the source of truth.
    if (docType === 'abnahme') {
      const sig = getSignatureByType(formId, 'abnahme');
      if (sig?.status === 'signed' && sig.boldsign_document_id) {
        try {
          const blob = await downloadBoldSignDocument(sig.boldsign_document_id);
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
          // Revoke after the new tab has had time to load — keeps memory clean.
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
          return;
        } catch (e) {
          console.error('Failed to open signed Abnahme PDF, falling back to snapshot:', e);
          // fall through to snapshot
        }
      }
    }
    if (existing) {
      window.open(getFormPdfSnapshotUrl(formId, docType), '_blank');
      return;
    }
    // No snapshot yet — render once, store as snapshot, then open it
    setPdfGenerating(formId);
    try {
      await captureSnapshot(formId, docType);
      window.open(getFormPdfSnapshotUrl(formId, docType), '_blank');
    } catch (e) {
      console.error('Failed to render snapshot on demand:', e);
      toast.error('Fehler', 'PDF konnte nicht erstellt werden');
    } finally {
      setPdfGenerating(null);
    }
  };

  // Generate the current state's PDF and store it as an immutable snapshot.
  // Best-effort — failures are logged, never block the status update.
  const captureSnapshot = async (formId: number, docType: FormPdfDocType): Promise<void> => {
    if (docType === 'rechnung') {
      // Rechnung-PDF generator yet to be built (handled by separate branch).
      return;
    }
    try {
      let pdfBlob: Blob | undefined;

      if (docType === 'angebot') {
        // MODÜL B v3: Angebot snapshots must use generateAngebotPDF, not the
        // Aufmaß generator. Find the linked lead → fetch its angebote → render.
        const formData = await getForm(formId);
        if (!formData.lead_id) {
          // No lead linked yet — nothing to snapshot
          return;
        }
        const { generateAngebotPDF } = await import('../utils/angebotPdfGenerator');
        const leadDetail = await api.get<{
          customer_firstname?: string; customer_lastname?: string; customer_email?: string;
          customer_phone?: string; customer_address?: string; notes?: string;
          kunden_nummer?: string; angebot_nummer?: string;
          subtotal?: number; total_discount?: number; total_price: number;
          items: { product_name: string; breite: number; tiefe: number; quantity: number; unit_price: number; discount?: number; pricing_type?: 'dimension' | 'unit'; unit_label?: string; description?: string; custom_fields?: { id: string; label: string; type: string; unit?: string }[]; custom_field_values?: Record<string, string> }[];
          extras: { description: string; price: number }[];
        }>(`/leads/${formData.lead_id}`);

        const itemDiscounts = (leadDetail.items || []).reduce((s, i) => s + (i.discount || 0), 0);
        const result = await generateAngebotPDF({
          customer_firstname: leadDetail.customer_firstname || '',
          customer_lastname: leadDetail.customer_lastname || '',
          customer_email: leadDetail.customer_email || '',
          customer_phone: leadDetail.customer_phone,
          customer_address: leadDetail.customer_address,
          notes: leadDetail.notes,
          kunden_nummer: leadDetail.kunden_nummer,
          angebot_nummer: leadDetail.angebot_nummer,
          items: (leadDetail.items || []).map(i => ({
            product_name: i.product_name,
            breite: i.breite,
            tiefe: i.tiefe,
            quantity: i.quantity,
            unit_price: i.unit_price,
            total_price: (i.unit_price * i.quantity) - (i.discount || 0),
            discount: i.discount,
            pricing_type: i.pricing_type,
            unit_label: i.unit_label,
            description: i.description,
            custom_fields: i.custom_fields,
            custom_field_values: i.custom_field_values,
          })),
          extras: leadDetail.extras || [],
          subtotal: leadDetail.subtotal,
          item_discounts: itemDiscounts,
          total_discount: leadDetail.total_discount,
          total_price: leadDetail.total_price,
        }, { returnBlob: true });
        pdfBlob = result?.blob;
      } else {
        // aufmass / abnahme — Aufmaß generator (existing behavior)
        const [formData, abnahmeData, abnahmeImages] = await Promise.all([
          getForm(formId),
          getAbnahme(formId).catch(() => null),
          getAbnahmeImages(formId).catch(() => [])
        ]);

        const pdfFormData = {
          ...formData,
          id: String(formData.id),
          productSelection: {
            category: formData.category,
            productType: formData.productType,
            model: formData.model ? formData.model.split(',') : []
          },
          specifications: formData.specifications as Record<string, string | number | boolean | string[]>,
          bilder: formData.bilder || [],
          customerSignature: formData.customerSignature || null,
          signatureName: formData.signatureName || null,
          abnahme: abnahmeData ? { ...abnahmeData, maengelBilder: abnahmeImages || [] } : undefined
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await generatePDF(pdfFormData as any, {
          returnBlob: true,
          abnahmeOnly: docType === 'abnahme'
        });
        pdfBlob = result?.blob;
      }

      if (pdfBlob) {
        await saveFormPdfSnapshot(formId, docType, pdfBlob);
        setFormSnapshots((prev) => ({
          ...prev,
          [formId]: [...(prev[formId] || []).filter(s => s.document_type !== docType),
                     { document_type: docType, created_at: new Date().toISOString() }]
        }));
      }
    } catch (err) {
      console.warn(`Snapshot capture failed (${docType}):`, err);
    }
  };

  // Load list of available snapshots for a form (lazy, when dropdown opens)
  const ensureSnapshotsLoaded = async (formId: number) => {
    if (formSnapshots[formId]) return;
    try {
      const list = await getFormPdfSnapshots(formId);
      setFormSnapshots((prev) => ({ ...prev, [formId]: list }));
    } catch (e) {
      console.warn('Failed to load snapshots:', e);
      setFormSnapshots((prev) => ({ ...prev, [formId]: [] }));
    }
  };

  const ensureRechnungenLoaded = async (formId: number) => {
    if (formRechnungen[formId]) return;
    try {
      const list = await getRechnungenByForm(formId);
      setFormRechnungen((prev) => ({ ...prev, [formId]: list }));
    } catch (e) {
      console.warn('Failed to load rechnungen:', e);
      setFormRechnungen((prev) => ({ ...prev, [formId]: [] }));
    }
  };

  const confirmDelete = async () => {
    if (formToDelete) {
      try {
        const form = forms.find(f => f.id === formToDelete);
        const isInTrash = form?.status === 'papierkorb';

        if (isInTrash) {
          // Permanently delete if already in trash
          await deleteForm(formToDelete);
          setForms(forms.filter(f => f.id !== formToDelete));
        } else {
          // Move to trash (papierkorb)
          await updateForm(formToDelete, { status: 'papierkorb' });
          setForms(forms.map(f =>
            f.id === formToDelete ? { ...f, status: 'papierkorb' } : f
          ));
        }
        refreshStats();
        setDeleteModalOpen(false);
        setFormToDelete(null);
      } catch (err) {
        toast.error('Fehler', 'Aufmaß konnte nicht gelöscht werden.');
      }
    }
  };

  // Restore form from trash
  const handleRestore = async (formId: number) => {
    try {
      await updateForm(formId, { status: 'neu' });
      setForms(forms.map(f =>
        f.id === formId ? { ...f, status: 'neu' } : f
      ));
      refreshStats();
      toast.success('Wiederhergestellt', 'Aufmaß wurde wiederhergestellt.');
    } catch (err) {
      toast.error('Fehler', 'Aufmaß konnte nicht wiederhergestellt werden.');
    }
  };

  const filteredForms = useMemo(() => {
    const term = searchTerm.toLowerCase();
    const filtered = forms.filter(form => {
      const matchesSearch = !term ||
        form.kundeVorname?.toLowerCase().includes(term) ||
        form.kundeNachname?.toLowerCase().includes(term) ||
        form.kundenlokation?.toLowerCase().includes(term) ||
        form.category?.toLowerCase().includes(term) ||
        form.productType?.toLowerCase().includes(term);
      // Virtual filters use the email_sent_at / post_sent_at flags rather
      // than the status column; they also exclude the trash bin.
      let matchesFilter: boolean;
      if (filterStatus === '__email_sent') {
        matchesFilter = !!form.email_sent_at && form.status !== 'papierkorb';
      } else if (filterStatus === '__post_sent') {
        matchesFilter = !!form.post_sent_at && form.status !== 'papierkorb';
      } else if (filterStatus === 'alle') {
        matchesFilter = form.status !== 'papierkorb';
      } else {
        matchesFilter = form.status === filterStatus;
      }
      return matchesSearch && matchesFilter;
    });
    // Sort by created_at — falls back to updated_at then 0 so missing
    // timestamps don't poison the comparison.
    const ts = (f: FormData) => new Date(f.created_at || f.updated_at || 0).getTime();
    return [...filtered].sort((a, b) =>
      sortOrder === 'asc' ? ts(a) - ts(b) : ts(b) - ts(a)
    );
  }, [forms, searchTerm, filterStatus, sortOrder]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { alle: 0, __email_sent: 0, __post_sent: 0 };
    for (const form of forms) {
      if (form.status !== 'papierkorb') counts.alle++;
      const s = form.status || 'neu';
      counts[s] = (counts[s] || 0) + 1;
      // Virtual flag-based counters — exclude trash so they line up with
      // the cards rendered when the chip is selected.
      if (form.email_sent_at && form.status !== 'papierkorb') counts.__email_sent++;
      if (form.post_sent_at && form.status !== 'papierkorb') counts.__post_sent++;
    }
    return counts;
  }, [forms]);

  const getTimeAgo = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Heute';
    if (days === 1) return 'Gestern';
    if (days < 7) return `vor ${days} Tagen`;
    return new Date(dateString).toLocaleDateString('de-DE');
  };

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="loading-spinner"></div>
        <p>Daten werden geladen...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-error">
        <h3>Fehler</h3>
        <p>{error}</p>
        <button onClick={loadData}>Erneut versuchen</button>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <header className="content-header">
        <div className="header-left">
          <h1>Aufmaß Übersicht</h1>
          <p className="header-subtitle">Verwalten Sie Ihre Aufmaße</p>
        </div>
        <div className="header-right">
          <motion.button className="btn-primary-new" onClick={handleNewForm} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
            Neues Aufmaß
          </motion.button>
        </div>
      </header>

      {/* Toolbar */}
      <div className="content-toolbar">
        <div className="toolbar-left">
          <div className="search-container">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            <input type="text" placeholder="Suchen..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            {searchTerm && <button className="clear-search" onClick={() => setSearchTerm('')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg></button>}
          </div>
          {/* Sort dropdown — admin & office only (back-office tooling).
              Regular users keep the default newest-first ordering. */}
          {isAdminOrOffice() && (
            <div className="sort-container">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 6h13M3 12h9M3 18h5" />
                <path d="M17 8l4-4 4 4M21 4v16" />
              </svg>
              <select
                className="sort-select"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as 'desc' | 'asc')}
                aria-label="Sortierung"
              >
                <option value="desc">Neueste zuerst</option>
                <option value="asc">Älteste zuerst</option>
              </select>
            </div>
          )}
          <div className="view-toggle">
            <button className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
            </button>
            <button className={`view-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Status filter row — separate from controls so chips wrap on their own line */}
      <div className="status-filter-row">
          {/* Desktop: Horizontal tabs */}
          <div className="status-filter-tabs desktop-only">
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`status-filter-tab ${filterStatus === option.value ? 'active' : ''}`}
                onClick={() => setFilterStatus(option.value)}
                style={{
                  '--tab-color': option.color,
                  borderColor: filterStatus === option.value ? option.color : 'transparent'
                } as React.CSSProperties}
              >
                <span className="status-dot" style={{ backgroundColor: option.color }} />
                <span className="tab-label">{option.label}</span>
                <span className="tab-count">
                  {statusCounts[option.value] || 0}
                </span>
              </button>
            ))}
          </div>
          {/* Mobile: Dropdown */}
          <div className="status-filter-dropdown-container mobile-only">
            <button
              className="status-filter-dropdown-btn"
              onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
              style={{ borderColor: getStatusColor(filterStatus) }}
            >
              <span className="status-dot" style={{ backgroundColor: getStatusColor(filterStatus) }} />
              <span>{getStatusLabel(filterStatus)}</span>
              <span className="dropdown-count">{statusCounts[filterStatus] || 0}</span>
              <svg className={`chevron ${filterDropdownOpen ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <AnimatePresence>
              {filterDropdownOpen && (
                <motion.div
                  className="status-filter-dropdown"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      className={`status-dropdown-option ${filterStatus === option.value ? 'selected' : ''}`}
                      onClick={() => {
                        setFilterStatus(option.value);
                        setFilterDropdownOpen(false);
                      }}
                    >
                      <span className="status-dot" style={{ backgroundColor: option.color }} />
                      <span>{option.label}</span>
                      <span className="option-count">
                        {statusCounts[option.value] || 0}
                      </span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
      </div>

      {/* Forms Grid */}
      <div className="content-area">
        {filteredForms.length === 0 ? (
          <div className="empty-state-modern">
            <h3>{searchTerm || filterStatus !== 'all' ? 'Keine Ergebnisse' : 'Keine Aufmaße'}</h3>
            <p>{searchTerm || filterStatus !== 'all' ? 'Andere Suchbegriffe probieren' : 'Erstellen Sie Ihr erstes Aufmaß'}</p>
            {!searchTerm && filterStatus === 'all' && (
              <button className="btn-primary-new" onClick={handleNewForm}>Erstes Aufmaß erstellen</button>
            )}
          </div>
        ) : (
          <div className={`forms-${viewMode}`}>
            <AnimatePresence mode="popLayout">
              {filteredForms.map((form, index) => (
                <motion.div key={form.id} className={`form-card-modern ${viewMode}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(index, 12) * 0.03 }}>
                  <div className="card-status-indicator" data-status={form.status || 'draft'} />
                  <div className="card-main">
                    <div className="card-header-modern">
                      <div className="customer-avatar">{(form.kundeVorname?.[0] || 'K').toUpperCase()}{(form.kundeNachname?.[0] || '').toUpperCase()}</div>
                      <div className="customer-details">
                        <h3>{form.kundeVorname} {form.kundeNachname}</h3>
                        <p className="customer-location">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
                          {form.kundenlokation || 'Keine Adresse'}
                        </p>
                        {/* Aufmaß-stage e-mail status badge — once stamped it stays
                            forever as a historic indicator that the Aufmaß-PDF
                            was delivered to the customer. The icon-button tick
                            below is the live "current stage" indicator. */}
                        {form.email_sent_at ? (
                          <span
                            className="email-sent-badge"
                            title={`Aufmaß E-Mail versendet: ${new Date(form.email_sent_at).toLocaleString('de-DE')}`}
                          >
                            ✓ Aufmaß E-Mail versendet
                          </span>
                        ) : (
                          <span
                            className="email-pending-badge"
                            title="Es wurde noch keine Aufmaß-E-Mail versendet"
                          >
                            📧 Aufmaß E-Mail ausstehend
                          </span>
                        )}
                        {/* Angebot drafted but not yet sent — surfaced so back-office
                            can trigger the e-mail send from the icon button. Disappears
                            once the form is promoted past angebot_versendet. */}
                        {isAngebotPendingSend(form) && (
                          <span
                            className="angebot-pending-badge"
                            title="Ein Angebot wurde erstellt, aber noch nicht an den Kunden versendet."
                          >
                            📋 Angebot wartet auf Versand
                          </span>
                        )}
                        {/* Postal status — admin-only manual flag. Same UX
                            as the e-mail badge but a separate channel. */}
                        {form.post_sent_at ? (
                          <span
                            className="post-sent-badge"
                            title={`Per Post versendet: ${new Date(form.post_sent_at).toLocaleString('de-DE')}`}
                          >
                            ✓ Per Post versendet
                          </span>
                        ) : (
                          <span
                            className="post-pending-badge"
                            title="Es wurde noch keine Postsendung markiert"
                          >
                            📬 Post ausstehend
                          </span>
                        )}
                      </div>
                      {isAdminOrOffice() ? (
                        <div className="status-selector">
                          <div className="status-pill-row">
                          <button
                            className="status-pill-btn"
                            style={{ backgroundColor: getStatusColor(getFormStatus(form)) }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setStatusDropdownOpen(statusDropdownOpen === form.id ? null : form.id!);
                            }}
                          >
                            {getStatusLabel(getFormStatus(form)).split('/')[0]}
                            <svg className="chevron-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
                          </button>
                          <button
                            className="status-history-btn"
                            title="Status-Historie"
                            onClick={(e) => { e.stopPropagation(); handleOpenHistory(form.id!); }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                          </button>
                          </div>
                          <AnimatePresence>
                            {statusDropdownOpen === form.id && (
                              <motion.div
                                className="status-dropdown"
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {STATUS_OPTIONS.filter(o => o.value !== 'alle' && !o.value.startsWith('__')).map((option) => (
                                  <button
                                    key={option.value}
                                    className={`status-option ${getFormStatus(form) === option.value ? 'selected' : ''}`}
                                    onClick={() => handleStatusChange(form.id!, option.value)}
                                  >
                                    <span className="status-dot" style={{ backgroundColor: option.color }} />
                                    <span>{option.label}</span>
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                          {/* Status date under status dropdown - show for all statuses */}
                          {(form.statusDate || (getFormStatus(form) === 'montage_geplant' && form.montageDatum)) && getFormStatus(form) !== 'papierkorb' && (
                            <div className="montage-date-badge" style={{ '--badge-color': getStatusColor(getFormStatus(form)) } as React.CSSProperties}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                              <span>{new Date(form.statusDate || form.montageDatum!).toLocaleDateString('de-DE')}</span>
                            </div>
                          )}
                          {/* Papierkorb deletion warning */}
                          {getFormStatus(form) === 'papierkorb' && form.papierkorbDate && (
                            <div className="montage-date-badge deletion-warning" style={{ '--badge-color': '#ef4444' } as React.CSSProperties}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                              <span>Löschung: {(() => { const d = new Date(form.papierkorbDate); d.setDate(d.getDate() + 30); return d.toLocaleDateString('de-DE'); })()}</span>
                            </div>
                          )}
                          {/* Signature status badge */}
                          {(() => {
                            const sigStatus = esignatureStatuses[form.id!];
                            const pendingSig = sigStatus?.signatures?.find(s => s.status === 'pending' || s.status === 'viewed' || s.status === 'signing');
                            const signedCount = sigStatus?.signatures?.filter(s => s.status === 'signed').length || 0;
                            if (pendingSig) {
                              const isRefreshing = refreshingSignatures.has(pendingSig.id);
                              return (
                                <div className="signature-status-badge pending">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                                  <span>{pendingSig.status === 'viewed' ? 'Angesehen' : pendingSig.status === 'signing' ? 'Wird signiert' : 'Signatur ausstehend'}</span>
                                  <button
                                    className={`signature-refresh-btn ${isRefreshing ? 'refreshing' : ''}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRefreshSignatureStatus(pendingSig.id, form.id!);
                                    }}
                                    disabled={isRefreshing}
                                    title="Status aktualisieren"
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                                  </button>
                                </div>
                              );
                            }
                            if (form.abnahmeSignPending) {
                              return (
                                <div className="signature-status-badge pending">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                                  <span>Kundenunterschrift ausstehend</span>
                                </div>
                              );
                            }
                            if (signedCount > 0) {
                              return (
                                <div className="signature-status-badge signed">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
                                  <span>{signedCount > 1 ? 'Signiert' : 'Signiert'}</span>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      ) : (
                        <div className="status-selector">
                          <div
                            className="status-pill-static"
                            style={{ backgroundColor: getStatusColor(getFormStatus(form)) }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenHistory(form.id!);
                            }}
                            title="Status-Historie anzeigen"
                          >
                            {getStatusLabel(getFormStatus(form)).split('/')[0]}
                          </div>
                          {/* Status date under status for non-admin - show for all statuses */}
                          {(form.statusDate || (getFormStatus(form) === 'montage_geplant' && form.montageDatum)) && getFormStatus(form) !== 'papierkorb' && (
                            <div className="montage-date-badge" style={{ '--badge-color': getStatusColor(getFormStatus(form)) } as React.CSSProperties}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                              <span>{new Date(form.statusDate || form.montageDatum!).toLocaleDateString('de-DE')}</span>
                            </div>
                          )}
                          {/* Papierkorb deletion warning */}
                          {getFormStatus(form) === 'papierkorb' && form.papierkorbDate && (
                            <div className="montage-date-badge deletion-warning" style={{ '--badge-color': '#ef4444' } as React.CSSProperties}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                              <span>Löschung: {(() => { const d = new Date(form.papierkorbDate); d.setDate(d.getDate() + 30); return d.toLocaleDateString('de-DE'); })()}</span>
                            </div>
                          )}
                          {/* Signature status badge */}
                          {(() => {
                            const sigStatus = esignatureStatuses[form.id!];
                            const pendingSig = sigStatus?.signatures?.find(s => s.status === 'pending' || s.status === 'viewed' || s.status === 'signing');
                            const signedCount = sigStatus?.signatures?.filter(s => s.status === 'signed').length || 0;
                            if (pendingSig) {
                              const isRefreshing = refreshingSignatures.has(pendingSig.id);
                              return (
                                <div className="signature-status-badge pending">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                                  <span>{pendingSig.status === 'viewed' ? 'Angesehen' : pendingSig.status === 'signing' ? 'Wird signiert' : 'Signatur ausstehend'}</span>
                                  <button
                                    className={`signature-refresh-btn ${isRefreshing ? 'refreshing' : ''}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRefreshSignatureStatus(pendingSig.id, form.id!);
                                    }}
                                    disabled={isRefreshing}
                                    title="Status aktualisieren"
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                                  </button>
                                </div>
                              );
                            }
                            if (form.abnahmeSignPending) {
                              return (
                                <div className="signature-status-badge pending">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                                  <span>Kundenunterschrift ausstehend</span>
                                </div>
                              );
                            }
                            if (signedCount > 0) {
                              return (
                                <div className="signature-status-badge signed">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
                                  <span>Signiert</span>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      )}
                    </div>
                    <div className="card-body-modern">
                      <div className="product-tags">
                        {form.category && <span className="product-tag category">{form.category}</span>}
                        {form.productType && <span className="product-tag type">{form.productType}</span>}
                        {form.model && <span className="product-tag model">{form.model}</span>}
                        {form.weitereProdukte && form.weitereProdukte.length > 0 && (
                          <span className="product-tag weitere" title={`${form.weitereProdukte.length} weitere Produkte`}>
                            +{form.weitereProdukte.length} weitere
                          </span>
                        )}
                      </div>
                      <div className="card-meta">
                        <div className="meta-item-modern">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                          <span>{getTimeAgo(form.datum || form.created_at)}</span>
                        </div>
                        <div className="meta-item-modern">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                          <span>{form.aufmasser || '-'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="card-actions-modern">
                    <div className="team-selector">
                      <button
                        className={`team-selector-btn ${getFormMontageteam(form) ? 'has-team' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setTeamDropdownOpen(teamDropdownOpen === form.id ? null : form.id!);
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>
                        <span>{getFormMontageteam(form) || 'Team'}</span>
                        <svg className="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
                      </button>
                      <AnimatePresence>
                        {teamDropdownOpen === form.id && (
                          <motion.div
                            className="team-dropdown"
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              className={`team-option ${!getFormMontageteam(form) ? 'selected' : ''}`}
                              onClick={() => handleMontageteamChange(form.id!, '')}
                            >
                              Kein Team
                            </button>
                            {montageteams.map((team) => (
                              <button
                                key={team.id}
                                className={`team-option ${getFormMontageteam(form) === team.name ? 'selected' : ''}`}
                                onClick={() => handleMontageteamChange(form.id!, team.name)}
                              >
                                {team.name}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <div className="attachment-selector">
                      <button
                        className={`action-btn attachment ${(form.pdf_count || 0) > 0 ? 'has-files' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const willOpen = attachmentDropdownOpen !== form.id;
                          setAttachmentDropdownOpen(willOpen ? form.id! : null);
                          if (willOpen) {
                            ensureSnapshotsLoaded(form.id!);
                            ensureRechnungenLoaded(form.id!);
                          }
                        }}
                        title="Dateien"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" /></svg>
                        {(form.pdf_count || 0) > 0 && <span className="file-count-badge">{form.pdf_count}</span>}
                      </button>
                      <AnimatePresence>
                        {attachmentDropdownOpen === form.id && (
                          <motion.div
                            className="attachment-dropdown"
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {/* PDF Vorschau list — frozen snapshots per document type.
                                Rechnung is excluded here and rendered as one entry per
                                Rechnung record below, since a single form can have
                                multiple Rechnungen (Anzahlungsraten + Schlussrechnung). */}
                            <div className="attachment-divider">PDF Vorschau</div>
                            {(() => {
                              const snapshots = formSnapshots[form.id!] || [];
                              const formStatus = getFormStatus(form);
                              const types: { type: FormPdfDocType; label: string }[] = [
                                { type: 'aufmass', label: 'Aufmaß-PDF' },
                                { type: 'angebot', label: 'Angebot-PDF' },
                                { type: 'abnahme', label: 'Abnahme-PDF' }
                              ];
                              return types.map(({ type, label }) => {
                                const snap = snapshots.find((s) => s.document_type === type);
                                const availableByStatus = isPdfTypeAvailableForStatus(formStatus, type);
                                const enabled = !!snap || availableByStatus;

                                // Abnahme: when a customer-signed copy exists, the
                                // Abnahme-PDF entry transparently opens the signed PDF.
                                const abnahmeSig = type === 'abnahme'
                                  ? getSignatureByType(form.id!, 'abnahme')
                                  : null;
                                const isSignedAbnahme = !!(abnahmeSig?.status === 'signed' && abnahmeSig.boldsign_document_id);
                                const displayLabel = type === 'abnahme' && isSignedAbnahme
                                  ? `${label} (signiert)`
                                  : label;

                                let titleText = '';
                                if (isSignedAbnahme) titleText = 'Vom Kunden signierte Abnahme öffnen';
                                else if (snap) titleText = `Erstellt am ${new Date(snap.created_at).toLocaleDateString('de-DE')}`;
                                else if (availableByStatus) titleText = 'Wird beim Klick erstellt und gespeichert';
                                else titleText = 'In diesem Status nicht verfügbar';

                                return (
                                  <button
                                    key={type}
                                    className="attachment-option generate-pdf"
                                    style={enabled ? undefined : { opacity: 0.45, cursor: 'not-allowed' }}
                                    disabled={!enabled}
                                    onClick={() => {
                                      if (!enabled) return;
                                      handlePdfTypeClick(form.id!, type);
                                      setAttachmentDropdownOpen(null);
                                    }}
                                    title={titleText}
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" /><path d="M12 11v6M9 14h6" /></svg>
                                    <span>{displayLabel}</span>
                                    {snap && (
                                      <span className="upload-hint">{new Date(snap.created_at).toLocaleDateString('de-DE')}</span>
                                    )}
                                  </button>
                                );
                              });
                            })()}
                            {/* Rechnungen — one entry per record. Anzahlungsrechnung
                                gets numbered when there are multiple, Schlussrechnung
                                stays singular (there's only ever one). Sorted by
                                rechnungsdatum so the chronological order matches
                                what the back-office expects. */}
                            {(() => {
                              const rechnungen = formRechnungen[form.id!] || [];
                              if (rechnungen.length === 0) return null;
                              const sorted = [...rechnungen].sort((a, b) =>
                                new Date(a.rechnungsdatum).getTime() - new Date(b.rechnungsdatum).getTime()
                              );
                              const anzahlungCount = sorted.filter(r => r.type === 'anzahlungsrechnung').length;
                              let anzahlungIdx = 0;
                              return sorted.map((r) => {
                                let label = '';
                                if (r.type === 'schlussrechnung') {
                                  label = 'Schlussrechnung';
                                } else {
                                  anzahlungIdx += 1;
                                  label = anzahlungCount > 1
                                    ? `Anzahlungsrechnung ${anzahlungIdx}`
                                    : 'Anzahlungsrechnung';
                                }
                                const dateStr = new Date(r.rechnungsdatum).toLocaleDateString('de-DE');
                                return (
                                  <a
                                    key={`rechnung-${r.id}`}
                                    href={getRechnungPdfUrl(r.id)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="attachment-option generate-pdf"
                                    onClick={() => setAttachmentDropdownOpen(null)}
                                    title={`${label} ${r.rechnung_nr} — ${dateStr}`}
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" /><path d="M12 11v6M9 14h6" /></svg>
                                    <span>{label} ({r.rechnung_nr})</span>
                                    <span className="upload-hint">{dateStr}</span>
                                  </a>
                                );
                              });
                            })()}
                            <button
                              className="attachment-option upload-doc"
                              onClick={() => {
                                setUploadingDocFormId(form.id!);
                                docInputRef.current?.click();
                              }}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                              <span>Datei hochladen</span>
                              <span className="upload-hint">(max. 10MB)</span>
                            </button>
                            {form.pdf_files && form.pdf_files.length > 0 && (
                              <>
                                <div className="attachment-divider">Angehängte PDFs</div>
                                {form.pdf_files.map((pdf) => (
                                  <a
                                    key={pdf.id}
                                    href={getImageUrl(pdf.id)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="attachment-option pdf-file"
                                    onClick={() => setAttachmentDropdownOpen(null)}
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" /><path d="M9 15h6"/><path d="M9 11h6"/></svg>
                                    <span className="pdf-filename">{pdf.file_name}</span>
                                  </a>
                                ))}
                              </>
                            )}
                            {form.media_files && form.media_files.length > 0 && (
                              <>
                                <div className="attachment-divider">Fotos & Videos</div>
                                {form.media_files.map((media) => (
                                  <a
                                    key={media.id}
                                    href={getImageUrl(media.id)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`attachment-option media-file ${media.file_type.startsWith('video/') ? 'video' : 'image'}`}
                                    onClick={() => setAttachmentDropdownOpen(null)}
                                  >
                                    {media.file_type.startsWith('video/') ? (
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                                    ) : (
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                                    )}
                                    <span className="media-filename">{media.file_name}</span>
                                  </a>
                                ))}
                              </>
                            )}
                            {/* Initial Angebot PDF from Lead */}
                            {form.lead_id && (
                              <>
                                <div className="attachment-divider">Initial Angebot</div>
                                <a
                                  href={getLeadPdfUrl(form.lead_id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="attachment-option pdf-file"
                                  onClick={() => setAttachmentDropdownOpen(null)}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" /><path d="M9 15h6"/><path d="M9 11h6"/></svg>
                                  <span className="pdf-filename">Angebot_{form.lead_id}.pdf</span>
                                </a>
                              </>
                            )}
                            {/* E-Signature Status Section */}
                            {branchFeatures?.esignature_enabled && (
                              <>
                                <div className="attachment-divider">E-Signaturen</div>
                                {(['aufmass', 'angebot', 'abnahme'] as const).map((docType) => {
                                  const sig = esignatureStatuses[form.id!]?.signatures?.find(
                                    s => s.document_type === docType
                                  );
                                  const label = docType === 'aufmass' ? 'Aufmaß'
                                    : docType === 'angebot' ? 'Angebot'
                                    : 'Abnahme';
                                  const isSigned = sig?.status === 'signed';
                                  const isPending = sig?.status === 'pending' || sig?.status === 'viewed' || sig?.status === 'signing';
                                  const notSent = !sig;

                                  return (
                                    <button
                                      key={docType}
                                      className={`attachment-option esig-status ${isSigned ? 'signed' : isPending ? 'pending' : 'not-sent'}`}
                                      disabled={notSent}
                                      onClick={async () => {
                                        if (isSigned && sig?.id) {
                                          try {
                                            const blob = await downloadSignedDocument(sig.id);
                                            const url = URL.createObjectURL(blob);
                                            const a = document.createElement('a');
                                            a.href = url;
                                            a.download = `${label}_${form.id}_signiert.pdf`;
                                            a.click();
                                            URL.revokeObjectURL(url);
                                          } catch (err) {
                                            toast.error('Fehler', 'Signiertes Dokument konnte nicht heruntergeladen werden.');
                                          }
                                        }
                                        setAttachmentDropdownOpen(null);
                                      }}
                                    >
                                      {isSigned ? (
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="esig-icon signed">
                                          <path d="M9 12l2 2 4-4" />
                                          <circle cx="12" cy="12" r="10" />
                                        </svg>
                                      ) : isPending ? (
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="esig-icon pending">
                                          <circle cx="12" cy="12" r="10" />
                                          <polyline points="12 6 12 12 16 14" />
                                        </svg>
                                      ) : (
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="esig-icon not-sent">
                                          <circle cx="12" cy="12" r="10" />
                                          <line x1="8" y1="12" x2="16" y2="12" />
                                        </svg>
                                      )}
                                      <span className="esig-label">{label}</span>
                                      <span className="esig-status-text">
                                        {isSigned ? 'Signiert' : isPending ? 'Wartet' : '—'}
                                      </span>
                                    </button>
                                  );
                                })}
                              </>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    {/* Modul C: Rechnung-Buttons */}
                    {getFormStatus(form) === 'auftrag_erteilt' && (
                      <button
                        className="action-btn"
                        style={{ background: 'rgba(14,165,233,0.1)', color: '#0ea5e9', border: '1px solid rgba(14,165,233,0.2)' }}
                        title="Anzahlungsrechnung erstellen"
                        onClick={(e) => { e.stopPropagation(); handleOpenRechnung(form.id!, 'anzahlungsrechnung'); }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>
                        <span>Rechnung</span>
                      </button>
                    )}
                    {getFormStatus(form) === 'abnahme' && (
                      <button
                        className="action-btn"
                        style={{ background: 'rgba(8,145,178,0.1)', color: '#0891b2', border: '1px solid rgba(8,145,178,0.2)' }}
                        title="Schlussrechnung erstellen"
                        onClick={(e) => { e.stopPropagation(); handleOpenRechnung(form.id!, 'schlussrechnung'); }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>
                        <span>Rest-Rechnung</span>
                      </button>
                    )}
                    {getFormStatus(form) === 'anzahlung' && (
                      <button
                        className="action-btn"
                        style={{ background: 'rgba(6,182,212,0.1)', color: '#06b6d4', border: '1px solid rgba(6,182,212,0.2)' }}
                        title="Anzahlungen verwalten"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAnzahlungFormId(form.id!);
                          setAnzahlungModalOpen(true);
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="6" x2="12" y2="12" /><line x1="12" y1="12" x2="16" y2="14" /></svg>
                        <span>Anzahlungen</span>
                      </button>
                    )}
                    {(getFormStatus(form) === 'rechnung_erstellt' || getFormStatus(form) === 'schluss_rechnung_erstellt') && (
                      <>
                        <button
                          className="action-btn"
                          style={{ background: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.25)' }}
                          title="Rechnung per E-Mail versenden"
                          onClick={(e) => { e.stopPropagation(); handleResendRechnungEmail(form.id!); }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                          <span>Senden</span>
                        </button>
                        {isAdminOrOffice() && (
                          <button
                            className="action-btn"
                            style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.25)' }}
                            title="Manuell als gesendet markieren (Post)"
                            onClick={(e) => { e.stopPropagation(); handleMarkRechnungSent(form.id!); }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                            <span>Als gesendet markieren</span>
                          </button>
                        )}
                      </>
                    )}
                    {form.kundeEmail && (() => {
                      // Stage-scoped icon tick: email_sent_at captures the Aufmaß-stage
                      // e-mail. Show the green check on the icon ONLY while in aufmass
                      // stage AND no Angebot is waiting to be sent. The text badge above
                      // the card stays forever — that's the historic record.
                      const stage = getFormStatus(form);
                      const angebotPending = isAngebotPendingSend(form);
                      const stageEmailSent = !!form.email_sent_at && isInAufmassStage(form) && !angebotPending;
                      // When an Angebot is awaiting send, the icon's primary action
                      // becomes "send Angebot" — emailType drives the post-send promotion.
                      const emailType = angebotPending ? 'angebot' : stage;
                      const titleText = angebotPending
                        ? `Angebot per E-Mail an ${form.kundeEmail} senden`
                        : stageEmailSent
                          ? `E-Mail an ${form.kundeEmail} (versendet: ${new Date(form.email_sent_at!).toLocaleString('de-DE')})`
                          : `E-Mail an ${form.kundeEmail}`;
                      return (
                        <button
                          className={`action-btn email ${stageEmailSent ? 'sent' : ''} ${angebotPending ? 'angebot-pending' : ''}`}
                          title={titleText}
                          onClick={(e) => {
                            e.stopPropagation();
                            const template = getEmailTemplate(form);
                            setEmailComposer({
                              to: template.to || form.kundeEmail || '',
                              subject: template.subject || '',
                              body: template.body || '',
                              formId: form.id,
                              emailType
                            });
                          }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                          {stageEmailSent && (
                            <span className="email-sent-check" aria-hidden="true">✓</span>
                          )}
                        </button>
                      );
                    })()}
                    {/* Admin-only postal "mark sent" button. Hidden once the
                        flag is set so the action surface stays clean (the
                        badge + button overlay still reflect the state).
                        Truck icon to clearly distinguish from the e-mail
                        envelope right next to it. */}
                    {isAdmin() && !form.post_sent_at && (
                      <button
                        className="action-btn post"
                        title="Als per Post versendet markieren"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPostSentConfirmId(form.id!);
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 2L11 13" />
                          <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                        </svg>
                      </button>
                    )}
                    {form.post_sent_at && (
                      <button
                        className="action-btn post sent"
                        title={`Per Post versendet: ${new Date(form.post_sent_at).toLocaleString('de-DE')}`}
                        disabled
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 2L11 13" />
                          <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                        </svg>
                        <span className="email-sent-check" aria-hidden="true">✓</span>
                      </button>
                    )}
                    {/* E-Signature button - only show if feature is enabled */}
                    {branchFeatures?.esignature_enabled && canSendEsignature(getFormStatus(form)) && (
                      <button
                        className={`action-btn esignature ${esignatureLoading === form.id ? 'loading' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSendAesSignature(form);
                        }}
                        disabled={esignatureLoading === form.id}
                        title="E-Signatur (BoldSign AES)"
                      >
                        {esignatureLoading === form.id ? (
                          <div className="spinner small"></div>
                        ) : (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                          </svg>
                        )}
                        <span>E-Signatur</span>
                      </button>
                    )}
                    {/* BEARBEITEN - only for admin or unlocked forms */}
                    {(isAdminOrOffice() || !isFormLocked(getFormStatus(form))) ? (
                      <button className="action-btn edit" onClick={() => handleEditForm(form.id!)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        <span>Bearbeiten</span>
                      </button>
                    ) : (
                      <button className="action-btn attachment" onClick={() => handleOpenAttachmentUpload(form.id!)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>
                        <span>Anhang</span>
                      </button>
                    )}
                    {/* MODÜL B — "Angebot erstellen" button: kunde + ürün dolu olan
                        Aufmaß'larda görünür. Tıklayınca Angebote sayfasını "Aus Aufmaß"
                        tab'ında açar ve ?from_aufmass=<id> ile auto-fill akışını tetikler. */}
                    {Boolean(((form.kundeVorname || '').trim() || (form.kundeNachname || '').trim()) &&
                             ((form.category || '').trim() && (form.productType || '').trim())) && (
                      <button
                        className="action-btn angebot"
                        title="Angebot aus diesem Aufmaß erstellen"
                        onClick={() => navigate(`/angebote?tab=aus_aufmass&from_aufmass=${form.id}`)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" /><path d="M12 18v-6" /><path d="M9 15h6" /></svg>
                        <span>Angebot</span>
                      </button>
                    )}
                    {/* Restore button - only for forms in Papierkorb */}
                    {getFormStatus(form) === 'papierkorb' && (
                      <button className="action-btn restore" onClick={() => handleRestore(form.id!)} title="Wiederherstellen">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                      </button>
                    )}
                    <button className="action-btn delete" onClick={() => handleDeleteForm(form.id!)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Delete Modal */}
      <AnimatePresence>
        {deleteModalOpen && (() => {
          const formToDeleteData = forms.find(f => f.id === formToDelete);
          const isInTrash = formToDeleteData?.status === 'papierkorb';
          // Calculate deletion date (30 days from now for new trash, or from papierkorbDate if exists)
          const deletionDate = new Date();
          deletionDate.setDate(deletionDate.getDate() + 30);
          const deletionDateStr = deletionDate.toLocaleDateString('de-DE');
          return (
            <motion.div className="modal-overlay-modern" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeleteModalOpen(false)}>
              <motion.div className="modal-modern" initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} onClick={(e) => e.stopPropagation()}>
                <h3>{isInTrash ? 'Endgültig löschen?' : 'In Papierkorb verschieben?'}</h3>
                {isInTrash ? (
                  <p>Diese Aktion kann nicht rückgängig gemacht werden. Das Aufmaß wird endgültig gelöscht.</p>
                ) : (
                  <>
                    <p>Das Aufmaß wird in den Papierkorb verschoben.</p>
                    <div className="delete-warning-box">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                      </svg>
                      <div className="delete-warning-text">
                        <strong>Achtung:</strong> Das Aufmaß wird automatisch am <strong>{deletionDateStr}</strong> endgültig gelöscht, falls nicht wiederhergestellt.
                      </div>
                    </div>
                  </>
                )}
                <div className="modal-actions-modern">
                  <button className="modal-btn secondary" onClick={() => setDeleteModalOpen(false)}>Abbrechen</button>
                  <button className="modal-btn danger" onClick={confirmDelete}>
                    {isInTrash ? 'Endgültig löschen' : 'In Papierkorb'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Status History Modal */}
      <AnimatePresence>
        {historyModalOpen && (
          <motion.div className="modal-overlay-modern" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setHistoryModalOpen(false)}>
            <motion.div className="modal-modern modal-large" initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} onClick={(e) => e.stopPropagation()}>
              <h3>Status-Historie</h3>
              <div className="status-history-list">
                {selectedFormHistory.length === 0 ? (
                  <p className="history-empty">Keine Status-Änderungen vorhanden</p>
                ) : (
                  selectedFormHistory.map((entry) => (
                    <div key={entry.id} className="history-entry">
                      <div className="history-status">
                        <span className="status-dot" style={{ backgroundColor: getStatusColor(entry.status) }} />
                        <span className="status-label">{getStatusLabel(entry.status)}</span>
                      </div>
                      <div className="history-meta">
                        <span className="history-date">{formatDateTime(entry.changed_at)}</span>
                        {entry.changed_by_name && <span className="history-user">von {entry.changed_by_name}</span>}
                      </div>
                      {entry.notes && <div className="history-notes">{entry.notes}</div>}
                    </div>
                  ))
                )}
              </div>
              <div className="modal-actions-modern">
                <button className="modal-btn secondary" onClick={() => setHistoryModalOpen(false)}>Schließen</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status Date Modal - for all status changes */}
      <AnimatePresence>
        {statusDateModalOpen && (
          <motion.div
            className="modal-overlay-modern"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setStatusDateModalOpen(false)}
          >
            <motion.div
              className="modal-modern montage-modal"
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3>{STATUS_OPTIONS.find(s => s.value === pendingStatus)?.label || 'Status ändern'}</h3>
              <p className="montage-modal-description">Datum für diese Statusänderung</p>
              <div className="montage-date-input">
                <label>Datum</label>
                <input
                  type="date"
                  value={statusDateValue}
                  onChange={(e) => setStatusDateValue(e.target.value)}
                />
              </div>
              <div className="modal-actions">
                <button
                  className="modal-cancel"
                  onClick={() => setStatusDateModalOpen(false)}
                >
                  Abbrechen
                </button>
                <button
                  className="modal-confirm"
                  disabled={!statusDateValue}
                  onClick={async () => {
                    if (!statusDateFormId || !statusDateValue || !pendingStatus) return;
                    try {
                      // Update form with status and date
                      const updateData: { status: string; statusDate?: string; montageDatum?: string } = {
                        status: pendingStatus,
                        statusDate: statusDateValue
                      };
                      // Also update montageDatum for montage_geplant status
                      if (pendingStatus === 'montage_geplant') {
                        updateData.montageDatum = statusDateValue;
                      }
                      await updateForm(statusDateFormId, updateData);
                      setForms(forms.map(f =>
                        f.id === statusDateFormId
                          ? {
                              ...f,
                              status: pendingStatus,
                              statusDate: statusDateValue,
                              ...(pendingStatus === 'montage_geplant' ? { montageDatum: statusDateValue } : {})
                            }
                          : f
                      ));
                      // Trigger snapshot if this status implies a new document type
                      const snapType = statusToSnapshotType(pendingStatus);
                      if (snapType) void captureSnapshot(statusDateFormId, snapType);
                      // Capture before clearing — used by the Rechnung chain below
                      const chainedFormId = statusDateFormId;
                      const chainedStatus = pendingStatus;
                      setStatusDateModalOpen(false);
                      setStatusDateFormId(null);
                      setStatusDateValue('');
                      setPendingStatus('');
                      refreshStats();

                      // Modul C chain: when the user picks an "Entwurf" status,
                      // open the Rechnung modal automatically. If no Angebot exists,
                      // open the Angebot modal first and remember the chain so we
                      // resume into the Rechnung modal once the Angebot is saved.
                      const rechnungChainStatus =
                        chainedStatus === 'rechnung_erstellt' ? 'anzahlungsrechnung'
                        : chainedStatus === 'schluss_rechnung_erstellt' ? 'schlussrechnung'
                        : null;
                      if (rechnungChainStatus) {
                        try {
                          const ang = await getAngebot(chainedFormId);
                          if (ang?.items && ang.items.length > 0) {
                            setRechnungFormId(chainedFormId);
                            setRechnungType(rechnungChainStatus);
                            setRechnungModalOpen(true);
                          } else {
                            // Modul B akışı: Angebot artık LeadFormModal üzerinden
                            // oluşturuluyor. Chain target set edip LeadFormModal'ı
                            // açıyoruz; save sonrası onSuccess handler chain'i
                            // devam ettirip Rechnung modal'ını açacak.
                            toast.warning('Angebot fehlt', 'Bitte zuerst ein Angebot erstellen — danach wird die Rechnung automatisch fortgesetzt.');
                            setRechnungChainTarget({ formId: chainedFormId, type: rechnungChainStatus });
                            setLeadModalEditData(null);
                            setLeadModalFromAufmassId(chainedFormId);
                            setLeadModalOpen(true);
                          }
                        } catch (chainErr) {
                          console.error('Rechnung chain failed:', chainErr);
                        }
                      }
                    } catch (err) {
                      console.error('Error updating status:', err);
                      toast.error('Fehler', 'Status konnte nicht gespeichert werden.');
                    }
                  }}
                >
                  Speichern
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Angebot Modal */}
      <AnimatePresence>
        {angebotModalOpen && (
          <motion.div className="modal-overlay-modern" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setAngebotModalOpen(false); setAngebotConfirmOpen(false); }}>
            <motion.div className="modal-modern modal-large angebot-modal" initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} onClick={(e) => e.stopPropagation()}>
              <h3>{angebotEditMode ? 'Angebot bearbeiten' : 'Angebot erstellen'}</h3>

              {/* Angebot Form */}
              <div className="angebot-form">
                {/* Date Picker */}
                <div className="form-group">
                  <label>Angebotsdatum *</label>
                  <input
                    type="date"
                    value={angebotDate}
                    onChange={(e) => setAngebotDate(e.target.value)}
                    required
                  />
                </div>

                {/* Line Items */}
                <div className="angebot-items">
                  <div className="angebot-items-header">
                    <span>Bezeichnung / Beschreibung *</span>
                    <span>Menge</span>
                    <span>Preis (EUR)</span>
                    <span>Gesamt</span>
                    <span></span>
                  </div>
                  {angebotItems.map((item, index) => (
                    <div key={index} className="angebot-item-row">
                      <input
                        type="text"
                        placeholder="Beschreibung eingeben..."
                        value={item.bezeichnung}
                        onChange={(e) => updateAngebotItem(index, 'bezeichnung', e.target.value)}
                        required
                      />
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={item.menge}
                        onChange={(e) => updateAngebotItem(index, 'menge', parseFloat(e.target.value) || 0)}
                        required
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.einzelpreis}
                        onChange={(e) => updateAngebotItem(index, 'einzelpreis', parseFloat(e.target.value) || 0)}
                        required
                      />
                      <span className="col-gesamtpreis">{item.gesamtpreis.toFixed(2)} EUR</span>
                      <button
                        type="button"
                        className="btn-remove-item"
                        onClick={() => removeAngebotItem(index)}
                        disabled={angebotItems.length === 1}
                        title="Entfernen"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ))}

                  <button type="button" className="btn-add-item" onClick={addAngebotItem}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Position hinzufugen
                  </button>
                </div>

                {/* Totals */}
                <div className="angebot-totals">
                  <div className="total-row">
                    <span>Netto:</span>
                    <span>{angebotNetto.toFixed(2)} EUR</span>
                  </div>
                  <div className="total-row">
                    <span>MwSt. (19%):</span>
                    <span>{angebotMwst.toFixed(2)} EUR</span>
                  </div>
                  <div className="total-row total-brutto">
                    <span>Brutto:</span>
                    <span>{angebotBrutto.toFixed(2)} EUR</span>
                  </div>
                </div>

                {/* Bemerkungen */}
                <div className="form-group">
                  <label>Bemerkungen</label>
                  <textarea
                    value={angebotBemerkungen}
                    onChange={(e) => setAngebotBemerkungen(e.target.value)}
                    placeholder="Optionale Bemerkungen zum Angebot..."
                    rows={3}
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="modal-actions-modern">
                <button
                  className="modal-btn secondary"
                  onClick={() => { setAngebotModalOpen(false); setAngebotConfirmOpen(false); }}
                  disabled={angebotSaving}
                >
                  Abbrechen
                </button>
                <button
                  className="modal-btn primary"
                  onClick={handleSaveAngebot}
                  disabled={!isAngebotValid || angebotSaving}
                >
                  {angebotSaving ? 'Speichern...' : (angebotEditMode ? 'Angebot speichern' : 'Speichern & Senden')}
                </button>
              </div>

              {/* Confirmation Dialog Overlay */}
              <AnimatePresence>
                {angebotConfirmOpen && (
                  <motion.div
                    className="confirm-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <motion.div
                      className="confirm-dialog"
                      initial={{ scale: 0.9 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0.9 }}
                    >
                      <div className="confirm-icon warning">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                      </div>
                      <h4>E-Signatur senden?</h4>
                      <p>
                        Das Angebot wird per E-Mail an den Kunden gesendet.
                        Der Kunde muss das Angebot digital unterschreiben.
                      </p>
                      <p className="confirm-warning">
                        Stellen Sie sicher, dass alle Angaben korrekt sind!
                      </p>
                      <div className="confirm-actions">
                        <button
                          className="btn-secondary"
                          onClick={() => setAngebotConfirmOpen(false)}
                          disabled={angebotSaving}
                        >
                          Zuruck
                        </button>
                        <button
                          className="btn-primary"
                          onClick={handleConfirmSendAngebot}
                          disabled={angebotSaving}
                        >
                          {angebotSaving ? 'Senden...' : 'Ja, Angebot senden'}
                        </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Abnahme Modal */}
      <AnimatePresence>
        {abnahmeModalOpen && (
          <motion.div className="modal-overlay-modern" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAbnahmeModalOpen(false)}>
            <motion.div className="modal-modern modal-large abnahme-modal" initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} onClick={(e) => e.stopPropagation()}>
              <h3>Abnahme-Protokoll</h3>
              {/* Locked Banner */}
              {isAbnahmeLocked && (
                <div className="abnahme-locked-banner">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  <span>Diese Abnahme wurde bereits abgeschlossen und kann nicht mehr bearbeitet werden.</span>
                </div>
              )}
              {/* Modul C: Restbetrag warning before acceptance */}
              {abnahmeRestbetrag && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '12px 16px', borderRadius: '10px', margin: '0 0 14px 0',
                  background: abnahmeRestbetrag.rest > 0 ? 'rgba(245,158,11,0.10)' : 'rgba(16,185,129,0.10)',
                  border: `1px solid ${abnahmeRestbetrag.rest > 0 ? 'rgba(245,158,11,0.30)' : 'rgba(16,185,129,0.30)'}`,
                }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke={abnahmeRestbetrag.rest > 0 ? '#f59e0b' : '#10b981'} strokeWidth="2" width="20" height="20" style={{ flexShrink: 0 }}>
                    {abnahmeRestbetrag.rest > 0 ? (
                      <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>
                    ) : (
                      <><polyline points="20 6 9 17 4 12" /></>
                    )}
                  </svg>
                  <div style={{ fontSize: '13px', lineHeight: 1.4, color: 'var(--text-primary)' }}>
                    {abnahmeRestbetrag.rest > 0 ? (
                      <>
                        <strong>Verbleibender Restbetrag: {abnahmeRestbetrag.rest.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                          Brutto {abnahmeRestbetrag.brutto.toLocaleString('de-DE', { minimumFractionDigits: 2 })} EUR − Anzahlungen {abnahmeRestbetrag.anzahlungen.toLocaleString('de-DE', { minimumFractionDigits: 2 })} EUR · Bitte vor Abnahme mit dem Kunden klären.
                        </div>
                      </>
                    ) : (
                      <>
                        <strong>Vollständig bezahlt — kein Restbetrag offen.</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                          Brutto {abnahmeRestbetrag.brutto.toLocaleString('de-DE', { minimumFractionDigits: 2 })} EUR · Anzahlungen {abnahmeRestbetrag.anzahlungen.toLocaleString('de-DE', { minimumFractionDigits: 2 })} EUR
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
              <div className={`abnahme-form ${isAbnahmeLocked ? 'locked' : ''}`}>
                {/* Status Selection - Mutually Exclusive */}
                <div className="abnahme-status-selection">
                  <label className="abnahme-status-label">Status der Arbeit <span style={{ color: '#ef4444' }}>*</span></label>
                  <div className="abnahme-radio-group">
                    <label className={`abnahme-radio-option ${abnahmeData.istFertig && !abnahmeData.hatProbleme ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="abnahmeStatus"
                        checked={abnahmeData.istFertig === true && abnahmeData.hatProbleme === false}
                        disabled={isAbnahmeLocked}
                        onChange={() => setAbnahmeData({
                          ...abnahmeData,
                          istFertig: true,
                          hatProbleme: false,
                          maengelListe: ['']
                        })}
                      />
                      <span className="radio-icon"></span>
                      <span className="radio-text">ARBEIT IST FERTIG</span>
                    </label>
                    <label className={`abnahme-radio-option ${abnahmeData.hatProbleme ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="abnahmeStatus"
                        checked={abnahmeData.hatProbleme === true}
                        disabled={isAbnahmeLocked}
                        onChange={() => setAbnahmeData({
                          ...abnahmeData,
                          istFertig: false,
                          hatProbleme: true
                        })}
                      />
                      <span className="radio-icon"></span>
                      <span className="radio-text">ES GIBT MÄNGEL</span>
                    </label>
                  </div>
                </div>

                {/* Common Fields - shown for both ARBEIT IST FERTIG and ES GIBT MÄNGEL */}
                {(abnahmeData.istFertig || abnahmeData.hatProbleme) && (
                  <motion.div
                    className="abnahme-common-section"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    {/* Baustelle Sauber */}
                    <div className="abnahme-row">
                      <label className="abnahme-field-label">Baustelle wurde sauber und aufgeräumt gelassen <span style={{ color: '#ef4444' }}>*</span></label>
                      <div className="abnahme-ja-nein-buttons">
                        <button
                          type="button"
                          className={`abnahme-ja-nein-btn ${abnahmeData.baustelleSauber === 'ja' ? 'active' : ''}`}
                          onClick={() => setAbnahmeData({ ...abnahmeData, baustelleSauber: 'ja' })}
                        >
                          JA
                        </button>
                        <button
                          type="button"
                          className={`abnahme-ja-nein-btn ${abnahmeData.baustelleSauber === 'nein' ? 'active' : ''}`}
                          onClick={() => setAbnahmeData({ ...abnahmeData, baustelleSauber: 'nein' })}
                        >
                          NEIN
                        </button>
                      </div>
                    </div>

                    {/* Monteur Note */}
                    <div className="abnahme-row">
                      <label className="abnahme-field-label">Bitte bewerten Sie Monteure Arbeit mit Schulnoten (1-6) <span style={{ color: '#ef4444' }}>*</span></label>
                      <div className="abnahme-note-buttons">
                        {[1, 2, 3, 4, 5, 6].map(note => (
                          <button
                            key={note}
                            type="button"
                            className={`abnahme-note-btn ${abnahmeData.monteurNote === note ? 'active' : ''}`}
                            onClick={() => setAbnahmeData({ ...abnahmeData, monteurNote: note })}
                          >
                            {note}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* ES GIBT MÄNGEL - Mängelliste only */}
                {abnahmeData.hatProbleme && (
                  <motion.div
                    className="abnahme-maengel-section"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    {/* Numbered Defects List */}
                    <div className="abnahme-row">
                      <label className="abnahme-field-label">Mängelliste</label>
                      <div className="abnahme-maengel-list">
                        {(abnahmeData.maengelListe || ['']).map((mangel, idx) => (
                          <div key={idx} className="abnahme-mangel-item">
                            <span className="mangel-number">{idx + 1})</span>
                            <input
                              type="text"
                              value={mangel}
                              onChange={(e) => {
                                const newList = [...(abnahmeData.maengelListe || [''])];
                                newList[idx] = e.target.value;
                                setAbnahmeData({ ...abnahmeData, maengelListe: newList });
                              }}
                              placeholder={`Mangel ${idx + 1} beschreiben...`}
                            />
                            {(abnahmeData.maengelListe || []).length > 1 && (
                              <button
                                type="button"
                                className="remove-mangel-btn"
                                onClick={() => {
                                  const newList = (abnahmeData.maengelListe || []).filter((_, i) => i !== idx);
                                  setAbnahmeData({ ...abnahmeData, maengelListe: newList });
                                }}
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          className="add-mangel-btn"
                          onClick={() => {
                            setAbnahmeData({
                              ...abnahmeData,
                              maengelListe: [...(abnahmeData.maengelListe || []), '']
                            });
                          }}
                        >
                          + Weiteren Mangel hinzufügen
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Abnahme Fotos Section - shown for both ARBEIT IST FERTIG and ES GIBT MÄNGEL */}
                {(abnahmeData.istFertig || abnahmeData.hatProbleme) && (
                  <motion.div
                    className="abnahme-fotos-common-section"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <div className="abnahme-row">
                      <label className="abnahme-field-label">
                        Abnahme Fotos <span className="required" style={{ color: '#ef4444' }}>* (min. 2)</span>
                      </label>
                      {abnahmePhotosRequired && (
                        <div className="maengel-fotos-required">
                          Mindestens 2 Fotos sind erforderlich
                        </div>
                      )}
                      <div className="maengel-fotos-section">
                        {/* Existing images from DB */}
                        {maengelImages.length > 0 && (
                          <div className="maengel-fotos-grid">
                            {maengelImages.map((img) => (
                              <div key={img.id} className="maengel-foto-item">
                                <img
                                  src={getAbnahmeImageUrl(img.id)}
                                  alt={img.file_name}
                                  onClick={() => window.open(getAbnahmeImageUrl(img.id), '_blank')}
                                />
                                <button
                                  type="button"
                                  className="remove-foto-btn"
                                  onClick={async () => {
                                    try {
                                      await deleteAbnahmeImage(img.id);
                                      setMaengelImages(maengelImages.filter(i => i.id !== img.id));
                                    } catch (err) {
                                      console.error('Error deleting image:', err);
                                    }
                                  }}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* New images to upload */}
                        {maengelImageFiles.length > 0 && (
                          <div className="maengel-fotos-grid pending">
                            {maengelImageFiles.map((file, idx) => (
                              <div key={idx} className="maengel-foto-item pending">
                                <img
                                  src={URL.createObjectURL(file)}
                                  alt={file.name}
                                />
                                <span className="pending-badge">Neu</span>
                                <button
                                  type="button"
                                  className="remove-foto-btn"
                                  onClick={() => {
                                    setMaengelImageFiles(maengelImageFiles.filter((_, i) => i !== idx));
                                  }}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Upload button */}
                        <label className="add-foto-btn">
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={async (e) => {
                              const picked = Array.from(e.target.files || []);
                              e.target.value = '';
                              // Compress before stashing into form state — same
                              // pattern as the main Aufmaß bilder upload.
                              const { compressImages } = await import('../utils/imageCompress');
                              const processed = await compressImages(picked);
                              setMaengelImageFiles([...maengelImageFiles, ...processed]);
                            }}
                          />
                          📷 Fotos hinzufügen
                        </label>
                      </div>
                    </div>
                  </motion.div>
                )}

                <div className="abnahme-row">
                  <label>Bemerkungen</label>
                  <textarea
                    value={abnahmeData.bemerkungen || ''}
                    onChange={(e) => setAbnahmeData({ ...abnahmeData, bemerkungen: e.target.value })}
                    placeholder="Zusätzliche Bemerkungen..."
                    rows={3}
                  />
                </div>

                <div className="abnahme-divider">Kundenbestätigung</div>

                <div className="abnahme-row">
                  <label>Name des Kunden <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    type="text"
                    value={abnahmeData.kundeName || ''}
                    onChange={(e) => setAbnahmeData({ ...abnahmeData, kundeName: e.target.value })}
                    placeholder="Vor- und Nachname"
                  />
                </div>

                {/* Legacy checkbox - hidden but keeps validation working */}
                <input
                  type="hidden"
                  value={abnahmeData.kundeUnterschrift ? 'true' : 'false'}
                />
                              </div>

              <div className="modal-actions-modern">
                <button className="modal-btn secondary" onClick={() => setAbnahmeModalOpen(false)}>
                  {isAbnahmeLocked ? 'Schliessen' : 'Abbrechen'}
                </button>
                {!isAbnahmeLocked && (
                  <button
                    className={`modal-btn primary ${!abnahmeIsValid ? 'disabled' : ''}`}
                    onClick={handleSaveAbnahme}
                    disabled={abnahmeSaving || !abnahmeIsValid}
                    title={!abnahmeIsValid ? `Fehlend: ${abnahmeMissingFields.join(', ')}` : ''}
                  >
                    {abnahmeSaving ? 'Speichern...' : 'Abnahme speichern'}
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Hidden file input for document/video upload */}
      <input
        type="file"
        ref={docInputRef}
        style={{ display: 'none' }}
        accept=".pdf,.doc,.docx,.xls,.xlsx,.mp4,.mov,.avi,.webm,.jpg,.jpeg,.png,.gif"
        onChange={handleDocumentUpload}
      />

      {/* Email Composer Modal */}
      <AnimatePresence>
        {emailComposer && (
          <EmailComposer
            to={emailComposer.to}
            subject={emailComposer.subject}
            body={emailComposer.body}
            formId={emailComposer.formId}
            rechnungId={emailComposer.rechnungId}
            emailType={emailComposer.emailType}
            attachmentName={emailComposer.attachmentName}
            onClose={() => setEmailComposer(null)}
            onSent={async () => {
              // When the user sent the icon-button "Angebot wartet auf Versand"
              // e-mail, promote the form to angebot_versendet so the badge
              // disappears and downstream stages (Auftrag, Rechnung) become
              // available without a manual status pick.
              const sentFormId = emailComposer?.formId;
              const sentEmailType = emailComposer?.emailType;
              if (sentEmailType === 'angebot' && sentFormId) {
                const form = forms.find(f => f.id === sentFormId);
                if (form?.lead_id) {
                  try {
                    await markLeadAngebotAsSent(form.lead_id);
                    setForms(prev => prev.map(f =>
                      f.id === sentFormId
                        ? { ...f, status: 'angebot_versendet', statusDate: new Date().toISOString().split('T')[0] }
                        : f
                    ));
                  } catch (err) {
                    console.error('Promote to angebot_versendet after e-mail failed:', err);
                  }
                }
              }
              loadData();
            }}
          />
        )}
      </AnimatePresence>

      {/* Mark-sent-by-post confirm dialog (admin only). Mirrors the lead
          manual-versendet modal from Modül B for visual consistency. */}
      <AnimatePresence>
        {postSentConfirmId !== null && (
          <motion.div
            className="modal-overlay-modern"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPostSentConfirmId(null)}
          >
            <motion.div
              className="modal-modern"
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3>Aufmaß per Post versendet?</h3>
              <p>Bestätigen Sie, dass dieses Aufmaß per Post an den Kunden versendet wurde. Diese Markierung kann nicht rückgängig gemacht werden.</p>
              <div className="modal-actions-modern">
                <button className="modal-btn secondary" onClick={() => setPostSentConfirmId(null)}>
                  Abbrechen
                </button>
                <button className="modal-btn primary" onClick={() => handleConfirmMarkPostSent(postSentConfirmId)}>
                  Als versendet markieren
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODÜL B — LeadFormModal opened by the status-dropdown
          "Angebot Versendet" intercept (replaces legacy AngebotItems modal). */}
      <LeadFormModal
        isOpen={leadModalOpen}
        onClose={() => {
          setLeadModalOpen(false);
          setLeadModalEditData(null);
          setLeadModalFromAufmassId(null);
        }}
        onSuccess={async (savedLeadId, sendEmail) => {
          // Capture chain state before clearing, so we can resume into
          // the Rechnung modal when the user came here via "Rechnung Entwurf"
          // status pick on a form that didn't have an Angebot yet.
          const chain = rechnungChainTarget;
          const fromFormId = leadModalFromAufmassId;
          setLeadModalOpen(false);
          setLeadModalEditData(null);
          setLeadModalFromAufmassId(null);
          // MODÜL B v3: Save alone is NOT "versendet". Only mark as sent if
          // the user ticked "Angebot direkt per E-Mail senden" — otherwise
          // the form stays in "neu" / "aufmass_genommen" until manual send.
          if (savedLeadId && sendEmail) {
            try {
              await markLeadAngebotAsSent(savedLeadId);
              // Optimistic local update only when the status actually flipped
              if (fromFormId) {
                setForms(prev => prev.map(f =>
                  f.id === fromFormId
                    ? { ...f, status: 'angebot_versendet', statusDate: new Date().toISOString().split('T')[0] }
                    : f
                ));
              }
            } catch (err) {
              console.error('mark-angebot-sent after save failed:', err);
            }
          }
          // MODÜL B v3: After every Angebot save (regardless of send-flag),
          // capture an Angebot-PDF snapshot so the dropdown shows the right doc.
          if (fromFormId) {
            void captureSnapshot(fromFormId, 'angebot');
          }

          // Modul C chain: if we were on the way to creating a Rechnung,
          // promote the form to auftrag_erteilt and open the Rechnung modal.
          if (chain && fromFormId && chain.formId === fromFormId) {
            try {
              await updateForm(fromFormId, { status: 'auftrag_erteilt', statusDate: new Date().toISOString().split('T')[0] });
            } catch (err) {
              console.error('Status promote to auftrag_erteilt failed:', err);
            }
            setRechnungChainTarget(null);
            setRechnungFormId(fromFormId);
            setRechnungType(chain.type);
            setRechnungModalOpen(true);
            toast.success('Angebot gespeichert', 'Rechnung wird jetzt erstellt...');
          }
        }}
        editData={leadModalEditData as React.ComponentProps<typeof LeadFormModal>['editData']}
        fromAufmassFormId={leadModalFromAufmassId}
      />

      {/* Rechnung Modal (Modul C) */}
      <AnimatePresence>
        {rechnungModalOpen && rechnungFormId !== null && (
          <RechnungForm
            formId={rechnungFormId}
            type={rechnungType}
            onClose={() => setRechnungModalOpen(false)}
            onSaved={handleRechnungSaved}
          />
        )}
      </AnimatePresence>

      {/* Anzahlung Modal (Modul C) */}
      <AnimatePresence>
        {anzahlungModalOpen && anzahlungFormId !== null && (
          <AnzahlungForm
            formId={anzahlungFormId}
            onClose={() => setAnzahlungModalOpen(false)}
            onSaved={() => loadData()}
          />
        )}
      </AnimatePresence>

      {/* Mark-sent confirm modal (Modul C) */}
      <AnimatePresence>
        {markSentTarget && (
          <motion.div
            className="modal-overlay-modern"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => !markSentBusy && setMarkSentTarget(null)}
            style={{ zIndex: 10000 }}
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              style={{
                width: '100%', maxWidth: '440px', margin: 'auto', borderRadius: '16px',
                background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                boxShadow: '0 25px 60px rgba(0,0,0,0.4)', overflow: 'hidden',
              }}
            >
              <div style={{ padding: '20px 22px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.2" width="18" height="18"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>Als gesendet markieren?</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>Rechnung {markSentTarget.rechnungNr}</div>
                </div>
              </div>
              <div style={{ padding: '16px 22px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                Diese Rechnung wurde per Post oder anders versendet. Mit der Bestätigung wird sie als <strong>gesendet</strong> markiert und der Aufmaß-Status wechselt zu „Rechnung Gesendet".
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 22px', borderTop: '1px solid var(--border-primary)', background: 'var(--bg-secondary)' }}>
                <button
                  disabled={markSentBusy}
                  onClick={() => setMarkSentTarget(null)}
                  style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 500, cursor: markSentBusy ? 'not-allowed' : 'pointer' }}
                >
                  Abbrechen
                </button>
                <button
                  disabled={markSentBusy}
                  onClick={confirmMarkRechnungSent}
                  style={{
                    padding: '8px 20px', borderRadius: '8px', border: 'none',
                    background: markSentBusy ? 'var(--bg-tertiary)' : 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#fff', fontSize: '13px', fontWeight: 600,
                    cursor: markSentBusy ? 'not-allowed' : 'pointer',
                    boxShadow: markSentBusy ? 'none' : '0 2px 8px rgba(16,185,129,0.3)',
                  }}
                >
                  {markSentBusy ? 'Markiert...' : 'Ja, als gesendet markieren'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </>
  );
};

export default Dashboard;

