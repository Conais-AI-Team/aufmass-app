import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getForms, deleteForm, getMontageteamStats, getMontageteams, updateForm, getImageUrl, getStoredUser, getStatusHistory, getAbnahme, saveAbnahme, uploadAbnahmeImages, getAbnahmeImages, getAbnahmeImageUrl, deleteAbnahmeImage, uploadImages, getPdfUrl, getPdfStatus, getForm, savePdf, getBranchFeatures, sendAesSignature, sendAbnahmeAesSignature, getEsignatureStatus, downloadBoldSignDocument, refreshSignatureStatus, getAngebot, saveAngebot, sendAngebotAesSignature, getSignatureNotifications, downloadSignedDocument, getLeadPdfUrl, createAbnahmeSignRequest, saveFormPdfSnapshot, getFormPdfSnapshots, getFormPdfSnapshotUrl } from '../services/api';
import type { BranchFeatures, EsignatureStatus, EsignatureRequest, AngebotItem, SignatureNotification, FormPdfDocType, FormPdfSnapshot } from '../services/api';
import { generatePDF } from '../utils/pdfGenerator';
import type { AbnahmeImage } from '../services/api';
import type { FormData, MontageteamStats, Montageteam, StatusHistoryEntry, AbnahmeData } from '../services/api';
import { useStats } from '../AppWrapper';
import { useToast } from '../components/Toast';
import EmailComposer from '../components/EmailComposer';
import './Dashboard.css';

// Check if current user is admin or office (both have elevated permissions)
const isAdminOrOffice = () => {
  const user = getStoredUser();
  return user?.role === 'admin' || user?.role === 'office';
};

// Status options for forms - ordered workflow
const STATUS_OPTIONS = [
  { value: 'alle', label: 'Alle Aufmaße', color: '#7fa93d' },
  { value: 'entwurf', label: 'Entwurf', color: '#f97316' },
  { value: 'auftrag_abgelehnt', label: 'Auftrag Abgelehnt', color: '#6b7280' },
  { value: 'neu', label: 'Aufmaß Genommen', color: '#8b5cf6' },
  { value: 'angebot_versendet', label: 'Angebot Versendet', color: '#a78bfa' },
  { value: 'auftrag_erteilt', label: 'Auftrag Erteilt', color: '#3b82f6' },
  { value: 'bauantrag', label: 'Bauantrag', color: '#2563eb' },
  { value: 'anzahlung', label: 'Anzahlung Erhalten', color: '#06b6d4' },
  { value: 'bestellt', label: 'Bestellt/In Bearbeitung', color: '#f59e0b' },
  { value: 'montage_geplant', label: 'Montage Geplant', color: '#a855f7' },
  { value: 'montage_gestartet', label: 'Montage Gestartet', color: '#ec4899' },
  { value: 'abnahme', label: 'Abnahme', color: '#10b981' },
  { value: 'reklamation_eingegangen', label: 'Reklamation Eingegangen', color: '#ef4444' },
  { value: 'reklamation_bestellt', label: 'Reklamation Bestellt', color: '#dc2626' },
  { value: 'reklamation_abgelehnt', label: 'Reklamation Abgelehnt', color: '#b91c1c' },
  { value: 'papierkorb', label: 'Papierkorb', color: '#71717a' },
];

// Status order for edit lock check (after auftrag_erteilt, editing is locked for non-admins)
const STATUS_ORDER = [
  'entwurf',
  'auftrag_abgelehnt',
  'neu',
  'angebot_versendet',
  'auftrag_erteilt',  // lock starts AFTER this
  'bauantrag',
  'anzahlung',
  'bestellt',
  'montage_geplant',
  'montage_gestartet',
  'abnahme',
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
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('alle');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [formToDelete, setFormToDelete] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [, setMontageteamStats] = useState<MontageteamStats[]>([]);
  const [montageteams, setMontageteams] = useState<Montageteam[]>([]);

  // Email composer state
  const [emailComposer, setEmailComposer] = useState<{ to: string; subject: string; body: string; formId?: number; emailType?: string } | null>(null);
  const [teamDropdownOpen, setTeamDropdownOpen] = useState<number | null>(null);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState<number | null>(null);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [attachmentDropdownOpen, setAttachmentDropdownOpen] = useState<number | null>(null);
  // Lazy-loaded list of available PDF snapshots per form
  const [formSnapshots, setFormSnapshots] = useState<Record<number, FormPdfSnapshot[]>>({});
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
  const [angebotEditMode, setAngebotEditMode] = useState(false);

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

  const getStatusLabel = (status: string): string => {
    const option = STATUS_OPTIONS.find(o => o.value === status);
    return option?.label || 'Alle Aufmaße';
  };

  const getStatusColor = (status: string): string => {
    const option = STATUS_OPTIONS.find(o => o.value === status);
    return option?.color || '#7fa93d';
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

    // If selecting angebot_versendet status, open angebot modal
    if (newStatus === 'angebot_versendet') {
      setAngebotFormId(formId);
      setAngebotEditMode(false);
      // Load existing angebot data
      try {
        const [existingAngebot, sigStatus] = await Promise.all([
          getAngebot(formId),
          getEsignatureStatus(formId).catch(() => null)
        ]);
        if (existingAngebot?.items && existingAngebot.items.length > 0) {
          setAngebotItems(existingAngebot.items);
          setAngebotEditMode(true); // If data exists, we're editing
        } else {
          setAngebotItems([{ bezeichnung: '', menge: 1, einzelpreis: 0, gesamtpreis: 0 }]);
        }
        if (existingAngebot?.summary) {
          setAngebotDate(existingAngebot.summary.angebot_datum?.split('T')[0] || new Date().toISOString().split('T')[0]);
          setAngebotBemerkungen(existingAngebot.summary.bemerkungen || '');
        } else {
          setAngebotDate(new Date().toISOString().split('T')[0]);
          setAngebotBemerkungen('');
        }
        if (sigStatus) {
          setEsignatureStatuses(prev => ({ ...prev, [formId]: sigStatus }));
        }
      } catch {
        setAngebotItems([{ bezeichnung: '', menge: 1, einzelpreis: 0, gesamtpreis: 0 }]);
        setAngebotDate(new Date().toISOString().split('T')[0]);
        setAngebotBemerkungen('');
      }
      setAngebotModalOpen(true);
      setStatusDropdownOpen(null);
      return;
    }

    // If selecting abnahme status, open abnahme modal first
    if (newStatus === 'abnahme') {
      setAbnahmeFormId(formId);
      // Reset image states
      setMaengelImageFiles([]);
      // Load existing abnahme data, images, and signature status
      try {
        const [existingAbnahme, existingImages, sigStatus] = await Promise.all([
          getAbnahme(formId),
          getAbnahmeImages(formId),
          getEsignatureStatus(formId).catch(() => null)
        ]);
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

    // For all other status changes, open date picker modal
    setStatusDateFormId(formId);
    setPendingStatus(newStatus);
    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    setStatusDateValue(today);
    setStatusDateModalOpen(true);
    setStatusDropdownOpen(null);
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
        setEmailComposer({
          to: updatedForm.kundeEmail,
          subject: 'Bitte bestätigen Sie Ihre Abnahme',
          body: `Sehr geehrte/r ${kundenName},\n\nbitte bestätigen Sie die Abnahme über folgenden Link:\n${signRequest.signUrl}\n\nMit freundlichen Grüßen\nAylux Team`,
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
        // Just save and update status
        await updateForm(angebotFormId, { status: 'angebot_versendet', statusDate: angebotDate });
        setForms(forms.map(f => f.id === angebotFormId ? { ...f, status: 'angebot_versendet', statusDate: angebotDate } : f));
        // Freeze the Angebot-PDF so it survives later status changes
        void captureSnapshot(angebotFormId, 'angebot');
        setAngebotModalOpen(false);
        setAngebotFormId(null);
        refreshStats();
        toast.success('Gespeichert', 'Angebot wurde gespeichert.');
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
    if (docType === 'rechnung') return false; // placeholder — handled by Ezgi branch
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
    if (docType === 'rechnung') {
      toast.info('Demnächst', 'Rechnung-PDF wird durch ein separates Modul bereitgestellt.');
      return;
    }
    const existing = (formSnapshots[formId] || []).find((s) => s.document_type === docType);
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
      // Status transition still completes; snapshot can be taken later.
      return;
    }
    try {
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
      if (result?.blob) {
        await saveFormPdfSnapshot(formId, docType, result.blob);
        // Refresh the cached list so the dropdown immediately reflects the new snapshot
        setFormSnapshots((prev) => ({ ...prev, [formId]: [...(prev[formId] || []).filter(s => s.document_type !== docType), { document_type: docType, created_at: new Date().toISOString() }] }));
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
    return forms.filter(form => {
      const matchesSearch = !term ||
        form.kundeVorname?.toLowerCase().includes(term) ||
        form.kundeNachname?.toLowerCase().includes(term) ||
        form.kundenlokation?.toLowerCase().includes(term) ||
        form.category?.toLowerCase().includes(term) ||
        form.productType?.toLowerCase().includes(term);
      const matchesFilter = filterStatus === 'alle'
        ? form.status !== 'papierkorb'
        : form.status === filterStatus;
      return matchesSearch && matchesFilter;
    });
  }, [forms, searchTerm, filterStatus]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { alle: 0 };
    for (const form of forms) {
      if (form.status !== 'papierkorb') counts.alle++;
      const s = form.status || 'neu';
      counts[s] = (counts[s] || 0) + 1;
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
          <div className="view-toggle">
            <button className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
            </button>
            <button className={`view-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
            </button>
          </div>
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
                <motion.div key={form.id} className={`form-card-modern ${viewMode}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: index * 0.03 }} layout>
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
                                {STATUS_OPTIONS.filter(o => o.value !== 'alle').map((option) => (
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
                          if (willOpen) ensureSnapshotsLoaded(form.id!);
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
                            {/* PDF Vorschau list — frozen snapshots per document type */}
                            <div className="attachment-divider">PDF Vorschau</div>
                            {(() => {
                              const snapshots = formSnapshots[form.id!] || [];
                              const formStatus = getFormStatus(form);
                              const types: { type: FormPdfDocType; label: string }[] = [
                                { type: 'aufmass', label: 'Aufmaß-PDF' },
                                { type: 'angebot', label: 'Angebot-PDF' },
                                { type: 'abnahme', label: 'Abnahme-PDF' },
                                { type: 'rechnung', label: 'Rechnung-PDF' }
                              ];
                              return types.map(({ type, label }) => {
                                const snap = snapshots.find((s) => s.document_type === type);
                                const availableByStatus = isPdfTypeAvailableForStatus(formStatus, type);
                                const enabled = !!snap || availableByStatus;
                                const isRechnungPlaceholder = type === 'rechnung';

                                let titleText = '';
                                if (isRechnungPlaceholder) titleText = 'Rechnung-PDF wird durch ein separates Modul bereitgestellt';
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
                                    <span>{label}</span>
                                    {snap && (
                                      <span className="upload-hint">{new Date(snap.created_at).toLocaleDateString('de-DE')}</span>
                                    )}
                                    {!snap && isRechnungPlaceholder && <span className="upload-hint">demnächst</span>}
                                  </button>
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
                    {form.kundeEmail && (
                      <button
                        className="action-btn email"
                        title={`E-Mail an ${form.kundeEmail}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const template = getEmailTemplate(form);
                          setEmailComposer({
                            to: template.to || form.kundeEmail || '',
                            subject: template.subject || '',
                            body: template.body || '',
                            formId: form.id,
                            emailType: getFormStatus(form)
                          });
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
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
                      setStatusDateModalOpen(false);
                      setStatusDateFormId(null);
                      setStatusDateValue('');
                      setPendingStatus('');
                      refreshStats();
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
                            onChange={(e) => {
                              const files = Array.from(e.target.files || []);
                              setMaengelImageFiles([...maengelImageFiles, ...files]);
                              e.target.value = '';
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

                {/* E-Signature Section */}
                <div className="abnahme-row">
                  <label>E-Signatur Status</label>
                  {(() => {
                    const abnahmeSig = abnahmeFormId ? getSignatureByType(abnahmeFormId, 'abnahme') : null;
                    const aufmassSig = abnahmeFormId ? getSignatureByType(abnahmeFormId, 'aufmass') : null;

                    return (
                      <div className="esignature-status-section">
                        {/* Aufmass Signature Status */}
                        <div className="signature-item">
                          <span className="signature-label">Aufmaß:</span>
                          {aufmassSig ? (
                            <div className="signature-status-row">
                              <span
                                className="signature-status-badge"
                                style={{ backgroundColor: getSignatureStatusDisplay(aufmassSig.status).color }}
                              >
                                {getSignatureStatusDisplay(aufmassSig.status).label}
                              </span>
                              {aufmassSig.status === 'signed' && aufmassSig.boldsign_document_id && (
                                <button
                                  className="btn-download-signed"
                                  onClick={() => handleDownloadSignedDocument(aufmassSig.boldsign_document_id!, 'aufmass')}
                                >
                                  Download
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="signature-status-badge" style={{ backgroundColor: '#6b7280' }}>Nicht gesendet</span>
                          )}
                        </div>

                        {/* Abnahme Signature Status */}
                        <div className="signature-item">
                          <span className="signature-label">Abnahme:</span>
                          {abnahmeSig ? (
                            <div className="signature-status-row">
                              <span
                                className="signature-status-badge"
                                style={{ backgroundColor: getSignatureStatusDisplay(abnahmeSig.status).color }}
                              >
                                {getSignatureStatusDisplay(abnahmeSig.status).label}
                              </span>
                              {abnahmeSig.status === 'signed' && abnahmeSig.boldsign_document_id && (
                                <button
                                  className="btn-download-signed"
                                  onClick={() => handleDownloadSignedDocument(abnahmeSig.boldsign_document_id!, 'abnahme')}
                                >
                                  Download
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="signature-status-row">
                              <span className="signature-status-badge" style={{ backgroundColor: '#6b7280' }}>Nicht gesendet</span>
                              {branchFeatures?.esignature_enabled && (
                                <button
                                  className="btn-send-signature"
                                  onClick={handleSendAbnahmeSignature}
                                  disabled={abnahmeSignatureLoading}
                                >
                                  {abnahmeSignatureLoading ? 'Senden...' : 'Signatur anfordern'}
                                </button>
                              )}
                            </div>
                          )}
                          {abnahmeSig && ['declined', 'expired', 'failed'].includes(abnahmeSig.status) && branchFeatures?.esignature_enabled && (
                            <button
                              className="btn-send-signature"
                              onClick={handleSendAbnahmeSignature}
                              disabled={abnahmeSignatureLoading}
                              style={{ marginTop: '8px' }}
                            >
                              {abnahmeSignatureLoading ? 'Senden...' : 'Erneut senden'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}
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
            emailType={emailComposer.emailType}
            onClose={() => setEmailComposer(null)}
          />
        )}
      </AnimatePresence>

    </>
  );
};

export default Dashboard;

