import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './App.css';
import GrunddatenSection from './components/GrunddatenSection';
import ProductSelectionSection from './components/ProductSelectionSection';
import DynamicSpecificationForm from './components/DynamicSpecificationForm';
import MarkiseStep from './components/MarkiseStep';
import type { MarkiseData } from './components/MarkiseStep';
import UnterbauelementeStep from './components/UnterbauelementeStep';
import type { UnterbauelementData } from './components/UnterbauelementeStep';
import FinalSection from './components/FinalSection';
import StepIcon from './components/StepIcon';
import { FormData, ServerImage, WeiteresProdukt } from './types';
import { generatePDF } from './utils/pdfGenerator';
import productConfigData from './config/productConfig.json';
import { getStoredUser, getPdfBlob, getPdfStatus, getAbnahme, getAbnahmeImages, savePdf } from './services/api';

// Status options for breadcrumb - matches Dashboard STATUS_OPTIONS
const STATUS_STEPS = [
  { value: 'entwurf', label: 'Entwurf', color: '#f97316' },
  { value: 'neu', label: 'Aufmaß Genommen', color: '#8b5cf6' },
  { value: 'angebot_versendet', label: 'Angebot Versendet', color: '#a78bfa' },
  { value: 'auftrag_erteilt', label: 'Auftrag Erteilt', color: '#3b82f6' },
  { value: 'auftrag_abgelehnt', label: 'Auftrag Abgelehnt', color: '#6b7280' },
  { value: 'bauantrag', label: 'Bauantrag', color: '#2563eb' },
  { value: 'anzahlung', label: 'Anzahlung Erhalten', color: '#06b6d4' },
  { value: 'bestellt', label: 'Bestellt', color: '#f59e0b' },
  { value: 'montage_geplant', label: 'Montage Geplant', color: '#a855f7' },
  { value: 'montage_gestartet', label: 'Montage Gestartet', color: '#ec4899' },
  { value: 'abnahme', label: 'Abnahme', color: '#10b981' },
  { value: 'reklamation_eingegangen', label: 'Reklamation Eingegangen', color: '#ef4444' },
  { value: 'reklamation_bestellt', label: 'Reklamation Bestellt', color: '#dc2626' },
  { value: 'reklamation_abgelehnt', label: 'Reklamation Abgelehnt', color: '#b91c1c' },
];

const isAdminOrOffice = () => {
  const user = getStoredUser();
  return user?.role === 'admin' || user?.role === 'office';
};

interface AufmassFormProps {
  initialData?: FormData | null;
  onSave?: (data: FormData) => Promise<number | void> | void;
  onDraftSave?: (data: FormData) => Promise<void>;
  onSignaturePersist?: (signatureData: string, signatureName: string) => Promise<void> | void;
  onCancel?: () => void;
  onSendEmail?: () => void;
  formStatus?: string;
  onStatusChange?: (status: string) => void;
  isExistingForm?: boolean;
}

function AufmassForm({ initialData, onSave, onDraftSave, onSignaturePersist, onCancel, onSendEmail, formStatus, onStatusChange, isExistingForm }: AufmassFormProps) {
  const [formData, setFormData] = useState<FormData>(initialData || {
    datum: new Date().toISOString().split('T')[0],
    aufmasser: '',
    kundeVorname: '',
    kundeNachname: '',
    kundeEmail: '',
    kundeTelefon: '',
    kundenlokation: '',
    productSelection: {
      category: '',
      productType: '',
      model: []
    },
    specifications: {},
    weitereProdukte: [],
    bilder: [],
    bemerkungen: ''
  });
  const formDataRef = useRef(formData);

  const [currentStep, setCurrentStep] = useState(0);
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  // Sync initialData changes (e.g. when form is loaded for editing with signature)
  useEffect(() => {
    if (initialData) {
      setFormData(prev => ({
        ...prev,
        customerSignature: initialData.customerSignature ?? prev.customerSignature,
        signatureName: initialData.signatureName ?? prev.signatureName,
      }));
    }
  }, [initialData]);

  // Warn before leaving unsaved form
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (formData.kundeVorname || formData.kundeNachname || formData.kundenlokation) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [formData.kundeVorname, formData.kundeNachname, formData.kundenlokation]);

  // Status date modal state (for all status changes)
  const [statusDateModalOpen, setStatusDateModalOpen] = useState(false);
  const [statusDateValue, setStatusDateValue] = useState<string>('');
  const [pendingStatusValue, setPendingStatusValue] = useState<string>('');

  // Theme state
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem('aylux_theme');
    return savedTheme !== 'light';
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.remove('light-theme');
      localStorage.setItem('aylux_theme', 'dark');
    } else {
      document.documentElement.classList.add('light-theme');
      localStorage.setItem('aylux_theme', 'light');
    }
  }, [isDarkMode]);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  // Check if Markise is active
  const hasMarkise = formData.specifications?.markiseActive === true;

  // Check if category is UNTERBAUELEMENTE
  const isUnterbauelemente = formData.productSelection.category === 'UNTERBAUELEMENTE';

  // Check if category is ÜBERDACHUNG (markise is integrated in specs, not separate step)
  const isUeberdachung = formData.productSelection.category === 'ÜBERDACHUNG';

  // Type for product config
  interface ProductConfig {
    [category: string]: {
      [productType: string]: {
        models: string[];
        fields: { name: string; required: boolean; type: string; allowZero?: boolean }[];
      };
    };
  }
  const productConfig = productConfigData as ProductConfig;

  // Validate all Weitere Produkte fields
  const checkWeitereProdukteValid = useCallback((): boolean => {
    if (!formData.weitereProdukte || formData.weitereProdukte.length === 0) return true;

    const excludedFields = ['montageteam', 'bemerkungen'];

    interface ProductField {
      name: string;
      label?: string;
      type: string;
      required?: boolean;
      allowZero?: boolean;
      showWhen?: { field: string; value?: string; notEquals?: string };
      conditionalField?: { trigger: string; field: string; label?: string };
      options?: string[];
    }

    for (const wp of formData.weitereProdukte) {
      if (!wp.category) return false;
      if (!wp.productType) return false;
      // ARCHIVED: Model selection no longer required
      // if (!wp.model) return false;

      const wpConfig = productConfig[wp.category]?.[wp.productType];
      if (wpConfig?.fields) {
        for (const field of wpConfig.fields as ProductField[]) {
          if (excludedFields.includes(field.name)) continue;
          if (field.type === 'markise_trigger' || field.type === 'senkrecht_section' || field.type === 'festes_element_section' || field.type === 'schiebe_element_section' || field.type === 'keil_fenster_section') continue;

          if (field.showWhen) {
            const dependentValue = wp.specifications[field.showWhen.field];
            if (field.showWhen.value !== undefined && dependentValue !== field.showWhen.value) continue;
            if (field.showWhen.notEquals !== undefined && (dependentValue === field.showWhen.notEquals || !dependentValue)) continue;
          }

          const wpValue = wp.specifications[field.name];

          if (field.type === 'conditional') {
            const activeValue = wp.specifications[`${field.name}Active`];
            if (activeValue === undefined) return false;
            if (activeValue === true) {
              if (!wpValue || (typeof wpValue === 'number' && wpValue <= 0)) return false;
            }
            continue;
          }

          if (field.type === 'bauform') {
            if (!wp.specifications['bauformType']) return false;
            if (wp.specifications['bauformType'] === 'EINGERUCKT') {
              const wpLinksActive = wp.specifications['bauformLinksActive'];
              const wpRechtsActive = wp.specifications['bauformRechtsActive'];
              const wpLinksValue = wp.specifications['bauformLinksValue'];
              const wpRechtsValue = wp.specifications['bauformRechtsValue'];
              if (!wpLinksActive && !wpRechtsActive) return false;
              if (wpLinksActive && (wpLinksValue === undefined || wpLinksValue === null || wpLinksValue === '')) return false;
              if (wpRechtsActive && (wpRechtsValue === undefined || wpRechtsValue === null || wpRechtsValue === '')) return false;
            }
            continue;
          }

          if (field.type === 'fundament') {
            if (!wpValue) return false;
            continue;
          }

          if (field.type === 'multiselect') {
            if (!Array.isArray(wpValue) || wpValue.length === 0) return false;
            continue;
          }

          if (wpValue === undefined || wpValue === null || wpValue === '') return false;

          if (field.type === 'number' && (typeof wpValue !== 'number' || wpValue <= 0)) return false;
        }
      }
    }

    return true;
  }, [formData.weitereProdukte, productConfig]);

  // Check if all required specification fields are filled
  // Uses getMissingFields - if any fields are missing, validation fails
  const checkSpecificationsValid = useCallback(() => {
    const { category, productType } = formData.productSelection;
    if (!category || !productType) return false;

    const productTypeConfig = productConfig[category]?.[productType];
    if (!productTypeConfig?.fields) return true;

    // Excluded fields - only these are NOT required
    const excludedFields = ['montageteam', 'bemerkungen'];

    // Type for product config fields
    interface ProductField {
      name: string;
      label?: string;
      type: string;
      required?: boolean;
      allowZero?: boolean;
      showWhen?: { field: string; value?: string; notEquals?: string };
      conditionalField?: { trigger: string; field: string; label?: string };
      options?: string[];
    }

    // Process ALL fields (not just required ones) - except excluded
    for (const field of productTypeConfig.fields as ProductField[]) {
      const value = formData.specifications[field.name];

      // Skip excluded fields
      if (excludedFields.includes(field.name)) continue;

      // Skip markise_trigger and senkrecht_section (handled separately)
      if (field.type === 'markise_trigger' || field.type === 'senkrecht_section' || field.type === 'festes_element_section' || field.type === 'schiebe_element_section' || field.type === 'keil_fenster_section') continue;

      // Handle showWhen conditions - skip if condition not met
      if (field.showWhen) {
        const dependentValue = formData.specifications[field.showWhen.field];
        if (field.showWhen.value !== undefined && dependentValue !== field.showWhen.value) continue;
        if (field.showWhen.notEquals !== undefined && (dependentValue === field.showWhen.notEquals || !dependentValue)) continue;
      }

      // Handle conditional fields (ja_nein_with_value type like Überstand, Dämmung)
      if (field.type === 'conditional') {
        const activeValue = formData.specifications[`${field.name}Active`];
        // Must have selected Ja or Nein (activeValue must be boolean)
        if (activeValue === undefined) return false;
        // If Ja is selected, the value field must have a value
        if (activeValue === true) {
          // For fields that allow zero (like Dämmung), check if value is a number (including 0)
          const allowZero = field.allowZero === true;
          if (allowZero) {
            // Value must be a number (0 is allowed)
            if (value === undefined || value === null || value === '' || typeof value !== 'number') return false;
          } else {
            // Value must be > 0
            if (!value || (typeof value === 'number' && value <= 0)) return false;
          }
        }
        continue;
      }

      // Handle bauform field
      if (field.type === 'bauform') {
        const bauformType = formData.specifications['bauformType'];
        // Must have selected BUNDIG or EINGERUCKT
        if (!bauformType) return false;
        // If EINGERUCKT, at least one side must be active with value
        if (bauformType === 'EINGERUCKT') {
          const linksActive = formData.specifications['bauformLinksActive'];
          const rechtsActive = formData.specifications['bauformRechtsActive'];
          const linksValue = formData.specifications['bauformLinksValue'];
          const rechtsValue = formData.specifications['bauformRechtsValue'];
          // At least one side must be selected
          if (!linksActive && !rechtsActive) return false;
          // If a side is active, it must have a value (0 is valid)
          if (linksActive && (linksValue === undefined || linksValue === null || linksValue === '')) return false;
          if (rechtsActive && (rechtsValue === undefined || rechtsValue === null || rechtsValue === '')) return false;
        }
        continue;
      }

      // Handle fundament field
      if (field.type === 'fundament') {
        // Just need to have selected an option (Aylux or Kunde)
        if (!value) return false;
        continue;
      }

      // Handle multiselect fields (arrays)
      if (field.type === 'multiselect') {
        if (!Array.isArray(value) || value.length === 0) return false;
        continue;
      }

      // Handle select with conditionalField (like hoeheStuetzen with Sondermass)
      if (field.conditionalField && value === field.conditionalField.trigger) {
        const customValue = formData.specifications[field.conditionalField.field];
        if (!customValue || (typeof customValue === 'number' && customValue <= 0)) {
          return false;
        }
      }

      // Check if value exists and is not empty
      if (value === undefined || value === null || value === '') {
        return false;
      }

      // For number fields, check if it's a valid number > 0
      if (field.type === 'number' && (typeof value !== 'number' || value <= 0)) {
        return false;
      }
    }

    // ============ VALIDATE GLASMARKISE FIELDS ============
    // When glasMarkiseType is not "Keine", all related fields are required
    const glasMarkiseType = formData.specifications['glasMarkiseType'];
    if (glasMarkiseType && glasMarkiseType !== 'Keine') {
      const glasMarkiseRequiredFields = [
        'glasMarkiseAufteilung',
        'glasMarkiseStoffNummer',
        'glasMarkiseZip',
        'glasMarkiseAntrieb',
        'glasMarkiseAntriebseite'
      ];

      for (const fieldName of glasMarkiseRequiredFields) {
        const value = formData.specifications[fieldName];
        if (!value || value === '') {
          return false;
        }
      }
    }

    // ============ VALIDATE SENKRECHT MARKISE FIELDS ============
    // Check if this product has a senkrecht_section field
    const hasSenkrechtField = (productTypeConfig.fields as ProductField[]).some(f => f.type === 'senkrecht_section');
    if (hasSenkrechtField) {
      const senkrechtValue = formData.specifications['senkrechtMarkiseActive'];
      // Must select Ja or Keine (not empty/Bitte wählen)
      if (!senkrechtValue || (senkrechtValue !== 'Ja' && senkrechtValue !== 'Keine')) {
        return false;
      }
      // When "Ja", at least one position must be selected
      if (senkrechtValue === 'Ja') {
        let senkrechtPositions: string[] = [];
        try {
          const rawData = formData.specifications['senkrechtMarkiseData'];
          if (typeof rawData === 'string') {
            const parsed = JSON.parse(rawData);
            if (Array.isArray(parsed)) {
              if (parsed.length > 0 && typeof parsed[0] === 'string') {
                senkrechtPositions = parsed;
              } else if (parsed.length > 0 && typeof parsed[0] === 'object') {
                senkrechtPositions = parsed.map((item: Record<string, unknown>) => String(item.position)).filter(Boolean);
              }
            }
          }
        } catch { senkrechtPositions = []; }

        if (senkrechtPositions.length === 0) {
          return false;
        }
      }
    }

    // ============ VALIDATE FESTES ELEMENT FIELDS ============
    const hasFestesField = (productTypeConfig.fields as ProductField[]).some(f => f.type === 'festes_element_section');
    if (hasFestesField) {
      const festesValue = formData.specifications['festesElementActive'];
      if (!festesValue || (festesValue !== 'Ja' && festesValue !== 'Keine')) {
        return false;
      }
      if (festesValue === 'Ja') {
        let festesPositions: string[] = [];
        try {
          const rawData = formData.specifications['festesElementData'];
          if (typeof rawData === 'string') {
            const parsed = JSON.parse(rawData);
            if (Array.isArray(parsed)) festesPositions = parsed.filter((item): item is string => typeof item === 'string');
          }
        } catch { festesPositions = []; }

        if (festesPositions.length === 0) {
          return false;
        }
      }
    }

    // ============ VALIDATE SCHIEBE ELEMENT FIELDS ============
    const hasSchiebeField = (productTypeConfig.fields as ProductField[]).some(f => f.type === 'schiebe_element_section');
    if (hasSchiebeField) {
      const schiebeValue = formData.specifications['schiebeElementActive'];
      if (!schiebeValue || (schiebeValue !== 'Ja' && schiebeValue !== 'Keine')) {
        return false;
      }
      if (schiebeValue === 'Ja') {
        let schiebePositions: string[] = [];
        try {
          const rawData = formData.specifications['schiebeElementData'];
          if (typeof rawData === 'string') {
            const parsed = JSON.parse(rawData);
            if (Array.isArray(parsed)) schiebePositions = parsed.filter((item): item is string => typeof item === 'string');
          }
        } catch { schiebePositions = []; }

        if (schiebePositions.length === 0) {
          return false;
        }
      }
    }

    // ============ VALIDATE KEIL FENSTER FIELDS ============
    const hasKeilField = (productTypeConfig.fields as ProductField[]).some(f => f.type === 'keil_fenster_section');
    if (hasKeilField) {
      const keilValue = formData.specifications['keilFensterActive'];
      if (!keilValue || (keilValue !== 'Ja' && keilValue !== 'Keine')) {
        return false;
      }
      if (keilValue === 'Ja') {
        let keilPositions: string[] = [];
        try {
          const rawData = formData.specifications['keilFensterData'];
          if (typeof rawData === 'string') {
            const parsed = JSON.parse(rawData);
            if (Array.isArray(parsed)) keilPositions = parsed.filter((item): item is string => typeof item === 'string');
          }
        } catch { keilPositions = []; }

        if (keilPositions.length === 0) {
          return false;
        }
      }
    }

    // ============ VALIDATE WEITERE PRODUKTE ============
    if (!checkWeitereProdukteValid()) return false;

    return true;
  }, [formData.productSelection, formData.specifications, formData.weitereProdukte, productConfig, checkWeitereProdukteValid]);

  // Get list of missing required fields with their labels
  // ALL fields are required EXCEPT: montageteam, bemerkungen
  const getMissingFields = useCallback((): { name: string; label: string }[] => {
    const { category, productType } = formData.productSelection;
    if (!category || !productType) return [];

    const productTypeConfig = productConfig[category]?.[productType];
    if (!productTypeConfig?.fields) return [];

    const missingFields: { name: string; label: string }[] = [];

    // Excluded fields - only these are NOT required
    const excludedFields = ['montageteam', 'bemerkungen'];

    // Type for product config fields
    interface ProductField {
      name: string;
      label?: string;
      type: string;
      required?: boolean;
      allowZero?: boolean;
      showWhen?: { field: string; value?: string; notEquals?: string };
      conditionalField?: { trigger: string; field: string; label?: string };
      options?: string[];
    }

    // Process ALL fields (not just required ones)
    // Skip main field loop for UNTERBAUELEMENTE - those fields are validated per-element below
    const isUnterbauelementeCategory = category === 'UNTERBAUELEMENTE';
    for (const field of (isUnterbauelementeCategory ? [] : productTypeConfig.fields) as ProductField[]) {
      const value = formData.specifications[field.name];
      const fieldLabel = field.label || field.name;

      // Skip excluded fields
      if (excludedFields.includes(field.name)) continue;

      // Skip markise_trigger and senkrecht_section (handled separately)
      if (field.type === 'markise_trigger' || field.type === 'senkrecht_section' || field.type === 'festes_element_section' || field.type === 'schiebe_element_section' || field.type === 'keil_fenster_section') continue;

      // Handle showWhen conditions - skip if condition not met
      if (field.showWhen) {
        const dependentValue = formData.specifications[field.showWhen.field];
        if (field.showWhen.value !== undefined && dependentValue !== field.showWhen.value) continue;
        if (field.showWhen.notEquals !== undefined && (dependentValue === field.showWhen.notEquals || !dependentValue)) continue;
      }

      // Handle conditional fields (ja/nein with value)
      if (field.type === 'conditional') {
        const activeValue = formData.specifications[`${field.name}Active`];
        if (activeValue === undefined) {
          missingFields.push({ name: field.name, label: fieldLabel });
          continue;
        }
        if (activeValue === true) {
          const allowZero = field.allowZero === true;
          if (allowZero) {
            if (value === undefined || value === null || value === '' || typeof value !== 'number') {
              missingFields.push({ name: field.name, label: `${fieldLabel} (Wert)` });
            }
          } else {
            if (!value || (typeof value === 'number' && value <= 0)) {
              missingFields.push({ name: field.name, label: `${fieldLabel} (Wert)` });
            }
          }
        }
        continue;
      }

      // Handle bauform field
      if (field.type === 'bauform') {
        const bauformType = formData.specifications['bauformType'];
        if (!bauformType) {
          missingFields.push({ name: field.name, label: fieldLabel });
          continue;
        }
        if (bauformType === 'EINGERUCKT') {
          const linksActive = formData.specifications['bauformLinksActive'];
          const rechtsActive = formData.specifications['bauformRechtsActive'];
          const linksValue = formData.specifications['bauformLinksValue'];
          const rechtsValue = formData.specifications['bauformRechtsValue'];
          if (!linksActive && !rechtsActive) {
            missingFields.push({ name: field.name, label: `${fieldLabel} (mindestens eine Seite)` });
          } else {
            if (linksActive && (linksValue === undefined || linksValue === null || linksValue === '')) {
              missingFields.push({ name: 'bauformLinksValue', label: `${fieldLabel} Links (Wert)` });
            }
            if (rechtsActive && (rechtsValue === undefined || rechtsValue === null || rechtsValue === '')) {
              missingFields.push({ name: 'bauformRechtsValue', label: `${fieldLabel} Rechts (Wert)` });
            }
          }
        }
        continue;
      }

      // Handle fundament field
      if (field.type === 'fundament') {
        if (!value) {
          missingFields.push({ name: field.name, label: fieldLabel });
        }
        continue;
      }

      // Handle multiselect fields
      if (field.type === 'multiselect') {
        if (!Array.isArray(value) || value.length === 0) {
          missingFields.push({ name: field.name, label: fieldLabel });
        }
        continue;
      }

      // Handle select with conditionalField (like hoeheStuetzen with Sondermass)
      if (field.conditionalField && value === field.conditionalField.trigger) {
        const customValue = formData.specifications[field.conditionalField.field];
        if (!customValue || (typeof customValue === 'number' && customValue <= 0)) {
          missingFields.push({ name: field.conditionalField.field, label: field.conditionalField.label || `${fieldLabel} (Sondermass)` });
        }
      }

      // Check if value exists and is not empty
      if (value === undefined || value === null || value === '') {
        missingFields.push({ name: field.name, label: fieldLabel });
        continue;
      }

      // For number fields, check if it's a valid number > 0
      if (field.type === 'number' && (typeof value !== 'number' || value <= 0)) {
        missingFields.push({ name: field.name, label: fieldLabel });
      }
    }

    // ============ VALIDATE GLASMARKISE FIELDS ============
    // When glasMarkiseType is not "Keine", all related fields are required
    const glasMarkiseType = formData.specifications['glasMarkiseType'];
    if (glasMarkiseType && glasMarkiseType !== 'Keine') {
      const glasMarkiseRequiredFields = [
        { name: 'glasMarkiseAufteilung', label: 'Aufteilung' },
        { name: 'glasMarkiseStoffNummer', label: 'Stoff Nummer (Markise)' },
        { name: 'glasMarkiseZip', label: 'ZIP' },
        { name: 'glasMarkiseAntrieb', label: 'Antrieb' },
        { name: 'glasMarkiseAntriebseite', label: 'Antriebseite' }
      ];

      for (const field of glasMarkiseRequiredFields) {
        const value = formData.specifications[field.name];
        if (!value || value === '') {
          missingFields.push({ name: field.name, label: field.label });
        }
      }
    }

    // ============ VALIDATE SENKRECHT MARKISE FIELDS ============
    const hasSenkrechtFieldMissing = (productTypeConfig.fields as ProductField[]).some(f => f.type === 'senkrecht_section');
    if (hasSenkrechtFieldMissing) {
      const senkrechtValue = formData.specifications['senkrechtMarkiseActive'];
      if (!senkrechtValue || (senkrechtValue !== 'Ja' && senkrechtValue !== 'Keine')) {
        missingFields.push({ name: 'senkrechtMarkise', label: 'Senkrecht Markise' });
      } else if (senkrechtValue === 'Ja') {
        let senkrechtPositions: string[] = [];
        try {
          const rawData = formData.specifications['senkrechtMarkiseData'];
          if (typeof rawData === 'string') {
            const parsed = JSON.parse(rawData);
            if (Array.isArray(parsed)) {
              if (parsed.length > 0 && typeof parsed[0] === 'string') {
                senkrechtPositions = parsed;
              } else if (parsed.length > 0 && typeof parsed[0] === 'object') {
                senkrechtPositions = parsed.map((item: Record<string, unknown>) => String(item.position)).filter(Boolean);
              }
            }
          }
        } catch { senkrechtPositions = []; }

        if (senkrechtPositions.length === 0) {
          missingFields.push({ name: 'senkrechtMarkise', label: 'Senkrecht Markise Position(en)' });
        }
      }
    }

    // ============ VALIDATE FESTES ELEMENT FIELDS ============
    const hasFestesFieldMissing = (productTypeConfig.fields as ProductField[]).some(f => f.type === 'festes_element_section');
    if (hasFestesFieldMissing) {
      const festesValue = formData.specifications['festesElementActive'];
      if (!festesValue || (festesValue !== 'Ja' && festesValue !== 'Keine')) {
        missingFields.push({ name: 'festesElement', label: 'Festes Element' });
      } else if (festesValue === 'Ja') {
        let festesPositions: string[] = [];
        try {
          const rawData = formData.specifications['festesElementData'];
          if (typeof rawData === 'string') {
            const parsed = JSON.parse(rawData);
            if (Array.isArray(parsed)) festesPositions = parsed.filter((item): item is string => typeof item === 'string');
          }
        } catch { festesPositions = []; }

        if (festesPositions.length === 0) {
          missingFields.push({ name: 'festesElement', label: 'Festes Element Position(en)' });
        }
      }
    }

    // ============ VALIDATE SCHIEBE ELEMENT FIELDS ============
    const hasSchiebeFieldMissing = (productTypeConfig.fields as ProductField[]).some(f => f.type === 'schiebe_element_section');
    if (hasSchiebeFieldMissing) {
      const schiebeValue = formData.specifications['schiebeElementActive'];
      if (!schiebeValue || (schiebeValue !== 'Ja' && schiebeValue !== 'Keine')) {
        missingFields.push({ name: 'schiebeElement', label: 'Schiebe Element' });
      } else if (schiebeValue === 'Ja') {
        let schiebePositions: string[] = [];
        try {
          const rawData = formData.specifications['schiebeElementData'];
          if (typeof rawData === 'string') {
            const parsed = JSON.parse(rawData);
            if (Array.isArray(parsed)) schiebePositions = parsed.filter((item): item is string => typeof item === 'string');
          }
        } catch { schiebePositions = []; }

        if (schiebePositions.length === 0) {
          missingFields.push({ name: 'schiebeElement', label: 'Schiebe Element Position(en)' });
        }
      }
    }

    // ============ VALIDATE KEIL FENSTER FIELDS ============
    const hasKeilFieldMissing = (productTypeConfig.fields as ProductField[]).some(f => f.type === 'keil_fenster_section');
    if (hasKeilFieldMissing) {
      const keilValue = formData.specifications['keilFensterActive'];
      if (!keilValue || (keilValue !== 'Ja' && keilValue !== 'Keine')) {
        missingFields.push({ name: 'keilFenster', label: 'Keil Fenster' });
      } else if (keilValue === 'Ja') {
        let keilPositions: string[] = [];
        try {
          const rawData = formData.specifications['keilFensterData'];
          if (typeof rawData === 'string') {
            const parsed = JSON.parse(rawData);
            if (Array.isArray(parsed)) keilPositions = parsed.filter((item): item is string => typeof item === 'string');
          }
        } catch { keilPositions = []; }

        if (keilPositions.length === 0) {
          missingFields.push({ name: 'keilFenster', label: 'Keil Fenster Position(en)' });
        }
      }
    }

    // ============ VALIDATE UNTERBAUELEMENTE ============
    const unterbauelementeStr = formData.specifications?.unterbauelementeData as string;
    if (unterbauelementeStr) {
      try {
        const ubElements = JSON.parse(unterbauelementeStr) as UnterbauelementData[];
        if (Array.isArray(ubElements)) {
          ubElements.forEach((el, elIdx) => {
            const elPrefix = `Element ${elIdx + 1}`;
            if (!el.produktTyp) {
              missingFields.push({ name: `ub_${elIdx}_produktTyp`, label: `${elPrefix} Produkt Typ` });
              return; // Can't validate further without type
            }
            if (!el.modell) {
              missingFields.push({ name: `ub_${elIdx}_modell`, label: `${elPrefix} Modell` });
            }

            // Get fields from config for this product type
            const ubConfig = productConfig['UNTERBAUELEMENTE']?.[el.produktTyp];
            if (ubConfig?.fields) {
              for (const field of ubConfig.fields as ProductField[]) {
                if (excludedFields.includes(field.name)) continue;

                // Handle showWhen conditions
                if (field.showWhen) {
                  const depValue = el[field.showWhen.field as keyof UnterbauelementData];
                  if (field.showWhen.value !== undefined && depValue !== field.showWhen.value) continue;
                  if (field.showWhen.notEquals !== undefined && (depValue === field.showWhen.notEquals || !depValue)) continue;
                }

                const elValue = el[field.name as keyof UnterbauelementData];
                const elFieldLabel = field.label || field.name;

                // Handle fundament
                if (field.type === 'fundament') {
                  if (!elValue) {
                    missingFields.push({ name: `ub_${elIdx}_${field.name}`, label: `${elPrefix} ${elFieldLabel}` });
                  }
                  continue;
                }

                // Handle modelColorSelect and select
                if (field.type === 'modelColorSelect' || field.type === 'select') {
                  if (!elValue || elValue === '') {
                    missingFields.push({ name: `ub_${elIdx}_${field.name}`, label: `${elPrefix} ${elFieldLabel}` });
                  }
                  continue;
                }

                // Handle number fields
                if (field.type === 'number') {
                  if (!elValue || (typeof elValue === 'number' && elValue <= 0)) {
                    missingFields.push({ name: `ub_${elIdx}_${field.name}`, label: `${elPrefix} ${elFieldLabel}` });
                  }
                  continue;
                }

                // Default check
                if (elValue === undefined || elValue === null || elValue === '') {
                  missingFields.push({ name: `ub_${elIdx}_${field.name}`, label: `${elPrefix} ${elFieldLabel}` });
                }
              }
            }
          });
        }
      } catch { /* ignore parse errors */ }
    }

    // ============ VALIDATE WEITERE PRODUKTE ============
    // All fields in weitere produkte are required (except montageteam, bemerkungen)
    if (formData.weitereProdukte && formData.weitereProdukte.length > 0) {
      formData.weitereProdukte.forEach((wp, wpIdx) => {
        const wpPrefix = `Weiteres Produkt ${wpIdx + 1}`;
        const wpConfig = productConfig[wp.category]?.[wp.productType];

        if (!wp.category) {
          missingFields.push({ name: `wp_${wpIdx}_category`, label: `${wpPrefix} Kategorie` });
        }
        if (!wp.productType) {
          missingFields.push({ name: `wp_${wpIdx}_productType`, label: `${wpPrefix} Produkt Typ` });
        }
        // ARCHIVED: Model selection no longer required
        // if (!wp.model) {
        //   missingFields.push({ name: `wp_${wpIdx}_model`, label: `${wpPrefix} Modell` });
        // }

        if (wpConfig?.fields) {
          for (const field of wpConfig.fields as ProductField[]) {
            // Skip excluded fields
            if (excludedFields.includes(field.name)) continue;
            if (field.type === 'markise_trigger' || field.type === 'senkrecht_section' || field.type === 'festes_element_section' || field.type === 'schiebe_element_section' || field.type === 'keil_fenster_section') continue;

            // Handle showWhen conditions
            if (field.showWhen) {
              const dependentValue = wp.specifications[field.showWhen.field];
              if (field.showWhen.value !== undefined && dependentValue !== field.showWhen.value) continue;
              if (field.showWhen.notEquals !== undefined && (dependentValue === field.showWhen.notEquals || !dependentValue)) continue;
            }

            const wpValue = wp.specifications[field.name];
            const wpFieldLabel = field.label || field.name;

            // Handle conditional fields
            if (field.type === 'conditional') {
              const activeValue = wp.specifications[`${field.name}Active`];
              if (activeValue === undefined) {
                missingFields.push({ name: `wp_${wpIdx}_${field.name}`, label: `${wpPrefix} ${wpFieldLabel}` });
                continue;
              }
              if (activeValue === true) {
                if (!wpValue || (typeof wpValue === 'number' && wpValue <= 0)) {
                  missingFields.push({ name: `wp_${wpIdx}_${field.name}`, label: `${wpPrefix} ${wpFieldLabel} (Wert)` });
                }
              }
              continue;
            }

            // Handle bauform
            if (field.type === 'bauform') {
              const bauformType = wp.specifications['bauformType'];
              if (!bauformType) {
                missingFields.push({ name: `wp_${wpIdx}_${field.name}`, label: `${wpPrefix} ${wpFieldLabel}` });
              } else if (bauformType === 'EINGERUCKT') {
                const wpLinksActive = wp.specifications['bauformLinksActive'];
                const wpRechtsActive = wp.specifications['bauformRechtsActive'];
                const wpLinksValue = wp.specifications['bauformLinksValue'];
                const wpRechtsValue = wp.specifications['bauformRechtsValue'];
                if (!wpLinksActive && !wpRechtsActive) {
                  missingFields.push({ name: `wp_${wpIdx}_${field.name}`, label: `${wpPrefix} ${wpFieldLabel} (mindestens eine Seite)` });
                } else {
                  if (wpLinksActive && (wpLinksValue === undefined || wpLinksValue === null || wpLinksValue === '')) {
                    missingFields.push({ name: `wp_${wpIdx}_bauformLinksValue`, label: `${wpPrefix} ${wpFieldLabel} Links (Wert)` });
                  }
                  if (wpRechtsActive && (wpRechtsValue === undefined || wpRechtsValue === null || wpRechtsValue === '')) {
                    missingFields.push({ name: `wp_${wpIdx}_bauformRechtsValue`, label: `${wpPrefix} ${wpFieldLabel} Rechts (Wert)` });
                  }
                }
              }
              continue;
            }

            // Handle fundament
            if (field.type === 'fundament') {
              if (!wpValue) {
                missingFields.push({ name: `wp_${wpIdx}_${field.name}`, label: `${wpPrefix} ${wpFieldLabel}` });
              }
              continue;
            }

            // Handle multiselect
            if (field.type === 'multiselect') {
              if (!Array.isArray(wpValue) || wpValue.length === 0) {
                missingFields.push({ name: `wp_${wpIdx}_${field.name}`, label: `${wpPrefix} ${wpFieldLabel}` });
              }
              continue;
            }

            // Check value exists
            if (wpValue === undefined || wpValue === null || wpValue === '') {
              missingFields.push({ name: `wp_${wpIdx}_${field.name}`, label: `${wpPrefix} ${wpFieldLabel}` });
              continue;
            }

            // Number validation
            if (field.type === 'number' && (typeof wpValue !== 'number' || wpValue <= 0)) {
              missingFields.push({ name: `wp_${wpIdx}_${field.name}`, label: `${wpPrefix} ${wpFieldLabel}` });
            }
          }
        }
      });
    }

    return missingFields;
  }, [formData.productSelection, formData.specifications, formData.weitereProdukte, productConfig]);

  // Update grunddaten fields
  const updateGrunddatenField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Update product selection
  const updateProductSelection = (field: 'category' | 'productType' | 'model', value: string | string[]) => {
    setFormData(prev => ({
      ...prev,
      productSelection: {
        ...prev.productSelection,
        [field]: value
      },
      // Reset specifications when product changes
      specifications: field === 'productType' || field === 'category' ? {} : prev.specifications
    }));
  };

  // Update specification field
  const updateSpecificationField = (fieldName: string, value: string | number | boolean | string[]) => {
    setFormData(prev => ({
      ...prev,
      specifications: {
        ...prev.specifications,
        [fieldName]: value
      }
    }));
  };

  // Update markise data (supports both single and array)
  const updateMarkiseData = (data: MarkiseData | MarkiseData[]) => {
    setFormData(prev => ({
      ...prev,
      specifications: {
        ...prev.specifications,
        markiseData: JSON.stringify(data)
      }
    }));
  };

  // Update unterbauelemente data
  const updateUnterbauelemente = (data: UnterbauelementData[]) => {
    setFormData(prev => ({
      ...prev,
      specifications: {
        ...prev.specifications,
        unterbauelementeData: JSON.stringify(data)
      }
    }));
  };

  // Update weitere produkte
  const updateWeitereProdukte = (data: WeiteresProdukt[]) => {
    setFormData(prev => ({
      ...prev,
      weitereProdukte: data
    }));
  };

  // Update bemerkungen
  const updateBemerkungen = (value: string) => {
    setFormData(prev => ({ ...prev, bemerkungen: value }));
  };

  // Update bilder
  const updateBilder = (files: (File | ServerImage)[]) => {
    setFormData(prev => ({ ...prev, bilder: files }));
  };

  // Dynamic steps based on category and Markise selection
  const steps = useMemo(() => {
    const baseSteps: { id: string; title: string; icon: string; canProceed: () => boolean }[] = [
      {
        id: 'grunddaten',
        title: 'Grunddaten',
        icon: '1',
        canProceed: () => {
          return !!(formData.datum && formData.aufmasser &&
                 formData.kundeVorname && formData.kundeNachname && formData.kundeEmail && formData.kundenlokation);
        }
      },
      {
        id: 'produktauswahl',
        title: 'Produktauswahl',
        icon: '2',
        canProceed: () => {
          const { category, productType, model } = formData.productSelection;
          const requiresModel = category !== 'MARKISE';
          const hasModel = Array.isArray(model) ? model.length > 0 : !!model;
          return !!(category && productType && (!requiresModel || hasModel));
        }
      }
    ];

    // For UNTERBAUELEMENTE, add a special step for multi-element selection
    if (isUnterbauelemente) {
      baseSteps.push({
        id: 'unterbauelemente',
        title: 'Unterbauelemente',
        icon: '3',
        canProceed: () => {
          const dataStr = formData.specifications?.unterbauelementeData as string;
          if (!dataStr) return false;
          try {
            const elements = JSON.parse(dataStr) as UnterbauelementData[];
            if (!Array.isArray(elements) || elements.length === 0) return false;

            // Validate each element has required fields
            const allElementsValid = elements.every((el: UnterbauelementData) => {
              if (!el.produktTyp || !el.modell || !el.gestellfarbe || !el.position) return false;

              // Type-specific validation
              if (el.produktTyp === 'Keil') {
                if (!el.laenge || !el.hintenHoehe || !el.vorneHoehe) return false;
              } else if (el.produktTyp === 'Festes Element') {
                // Festes Element has conditional fields based on elementForm
                if (!el.breite || !el.elementForm) return false;
                if (el.elementForm === 'Rechteck' && !el.hoehe) return false;
                if (el.elementForm === 'Trapez' && (!el.hintenHoehe || !el.vorneHoehe)) return false;
              } else {
                if (!el.breite || !el.hoehe) return false;
              }

              // GG Schiebe and Rahmen Schiebe need extra fields
              if (el.produktTyp === 'GG Schiebe Element' || el.produktTyp === 'Rahmen Schiebe Element') {
                if (!el.oeffnungsrichtung || !el.anzahlFluegel) return false;
              }

              // Fundament check (except Keil which doesn't have it)
              if (el.produktTyp !== 'Keil' && !el.fundament) return false;

              return true;
            });

            if (!allElementsValid) return false;

            // Also validate Weitere Produkte on this step
            if (!checkWeitereProdukteValid()) return false;

            return true;
          } catch {
            return false;
          }
        }
      });
    } else {
      // Normal specification step for other categories
      baseSteps.push({
        id: 'spezifikationen',
        title: 'Spezifikationen',
        icon: '3',
        canProceed: () => checkSpecificationsValid()
      });
    }

    // Add Markise step if markiseActive is true (but NOT for ÜBERDACHUNG - markise is integrated there)
    if (hasMarkise && !isUeberdachung) {
      baseSteps.push({
        id: 'markise',
        title: 'Markise',
        icon: String(baseSteps.length + 1),
        canProceed: () => {
          const markiseDataStr = formData.specifications?.markiseData as string;
          if (!markiseDataStr) return false;
          try {
            const parsed = JSON.parse(markiseDataStr);
            // Support both single object (legacy) and array format
            const markisen = Array.isArray(parsed) ? parsed : [parsed];
            if (markisen.length === 0) return false;

            // Validate each markise has required fields
            return markisen.every((data: MarkiseData) => {
              // Base required fields
              if (!data.typ || !data.modell || !data.breite || !data.laenge ||
                  !data.stoffNummer || !data.gestellfarbe || !data.antrieb || !data.antriebsseite) {
                return false;
              }

              // Check type-specific fields
              const markiseTypes: Record<string, { showHeight?: boolean; showPosition?: boolean; showZip?: boolean; showVolanTyp?: boolean; befestigungsOptions: string[] }> = {
                'AUFGLAS': { showZip: true, befestigungsOptions: [] },
                'UNTERGLAS': { showZip: true, befestigungsOptions: ['Innen Sparren', 'Unten Sparren'] },
                // 'SENKRECHT': { showHeight: true, showZip: true, showPosition: true, befestigungsOptions: ['Zwischen Pfosten', 'Vor Pfosten'] }, // ARCHIVED: Senkrecht now handled as JA/KEINE module
                'VOLKASSETTE': { showVolanTyp: true, befestigungsOptions: ['Wand', 'Decke', 'Untenbalkon'] },
                'HALBEKASSETTE': { showVolanTyp: true, befestigungsOptions: ['Wand', 'Decke', 'Untenbalkon'] }
              };

              const typeConfig = markiseTypes[data.typ];
              if (!typeConfig) return false;

              // Height (Bodenhöhe) is optional for SENKRECHT - no validation needed

              // Position required for SENKRECHT
              if (typeConfig.showPosition && !data.position) return false;

              // ZIP required for types that show it
              if (typeConfig.showZip && !data.zip) return false;

              // Volan Typ required for Volkassette/Halbekassette
              if (typeConfig.showVolanTyp && !data.volanTyp) return false;

              // Befestigungsart required if there are options
              if (typeConfig.befestigungsOptions.length > 0 && !data.befestigungsart) return false;

              return true;
            });
          } catch {
            return false;
          }
        }
      });
    }

    // Add Abschluss step - icon depends on number of steps
    const abschlussIcon = String(baseSteps.length + 1);
    baseSteps.push({
      id: 'abschluss',
      title: 'Abschluss',
      icon: abschlussIcon,
      canProceed: () => (formData.bilder as File[]).length >= 2
    });

    return baseSteps;
  }, [formData, hasMarkise, isUnterbauelemente, isUeberdachung, checkSpecificationsValid, checkWeitereProdukteValid]);

  const currentStepInfo = steps[currentStep];

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      if (currentStepInfo.canProceed()) {
        setShowValidationErrors(false);
        setCurrentStep(currentStep + 1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        // Show validation errors when user tries to proceed with invalid form
        setShowValidationErrors(true);
        // Scroll to validation message
        const errorElement = document.querySelector('.validation-error-message');
        if (errorElement) {
          errorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // PDF indir - önce stored PDF'i dene, yoksa generate et
  const handleExport = async () => {
    const currentData = formDataRef.current;
    const formId = currentData.id ? parseInt(currentData.id) : null;

    // Eğer form ID varsa ve imza yoksa, stored PDF'i dene
    // İmza varsa her zaman yeniden generate et (imza güncel olmalı)
    if (formId && !currentData.customerSignature) {
      try {
        const pdfStatus = await getPdfStatus(formId);
        if (pdfStatus.hasPdf && !pdfStatus.isOutdated) {
          // Stored PDF var, indir
          const pdfBlob = await getPdfBlob(formId);
          const fileName = `Aufmass_${currentData.kundeNachname}_${currentData.kundeVorname}.pdf`;
          const link = document.createElement('a');
          link.href = URL.createObjectURL(pdfBlob);
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(link.href);
          return;
        }
      } catch (err) {
        console.log('Stored PDF not available, generating fresh:', err);
      }
    }

    // Stored PDF yoksa veya güncel değilse, generate et
    // Abnahme verilerini de çek
    let abnahmeData = null;
    let abnahmeImages: { id: number; file_name: string; file_type: string }[] = [];
    if (formId) {
      try {
        [abnahmeData, abnahmeImages] = await Promise.all([
          getAbnahme(formId),
          getAbnahmeImages(formId)
        ]);
      } catch (err) {
        console.log('Could not fetch abnahme data:', err);
      }
    }

    const pdfResult = await generatePDF({
      ...currentData,
      abnahme: abnahmeData ? {
        ...abnahmeData,
        maengelBilder: abnahmeImages || []
      } : undefined
    }, formId ? { returnBlob: true } : undefined);

    if (pdfResult?.blob) {
      if (formId) {
        await savePdf(formId, pdfResult.blob);
      }

      const link = document.createElement('a');
      link.href = URL.createObjectURL(pdfResult.blob);
      link.download = pdfResult.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    }
  };

  const handleSaveOnly = async () => {
    if (onSave) {
      const currentData = formDataRef.current;
      const savedFormId = await onSave(currentData);
      // Update formData with the returned form ID (for new forms)
      if (savedFormId && !currentData.id) {
        setFormData(prev => ({ ...prev, id: String(savedFormId) }));
        formDataRef.current = { ...currentData, id: String(savedFormId) };
      }
    }
  };

  const handleNewForm = () => {
    // Reset form to initial state
    const resetData = {
      datum: new Date().toISOString().split('T')[0],
      aufmasser: '',
      kundeVorname: '',
      kundeNachname: '',
      kundenlokation: '',
      productSelection: {
        category: '',
        productType: '',
        model: []
      },
      specifications: {},
      weitereProdukte: [],
      bilder: [],
      bemerkungen: ''
    };
    setFormData(resetData);
    formDataRef.current = resetData;
    setCurrentStep(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const renderStepContent = () => {
    const stepId = currentStepInfo.id;

    switch (stepId) {
      case 'grunddaten':
        return (
          <GrunddatenSection
            formData={{
              datum: formData.datum,
              aufmasser: formData.aufmasser,
              kundeVorname: formData.kundeVorname,
              kundeNachname: formData.kundeNachname,
              kundeEmail: formData.kundeEmail,
              kundeTelefon: formData.kundeTelefon,
              kundenlokation: formData.kundenlokation,
              marketingSource: formData.marketingSource
            }}
            updateField={updateGrunddatenField}
          />
        );
      case 'produktauswahl':
        return (
          <ProductSelectionSection
            selection={formData.productSelection}
            updateSelection={updateProductSelection}
          />
        );
      case 'spezifikationen':
        return (
          <DynamicSpecificationForm
            category={formData.productSelection.category}
            productType={formData.productSelection.productType}
            model={formData.productSelection.model}
            formData={formData.specifications}
            updateField={updateSpecificationField}
            weitereProdukte={formData.weitereProdukte || []}
            updateWeitereProdukte={updateWeitereProdukte}
            showValidationErrors={showValidationErrors}
            missingFields={getMissingFields()}
            bemerkungen={formData.bemerkungen}
            updateBemerkungen={updateBemerkungen}
          />
        );
      case 'unterbauelemente':
        const unterbauelementeDataStr = formData.specifications?.unterbauelementeData as string;
        let unterbauelementeData: UnterbauelementData[] = [];
        if (unterbauelementeDataStr) {
          try {
            unterbauelementeData = JSON.parse(unterbauelementeDataStr);
          } catch {
            unterbauelementeData = [];
          }
        }
        return (
          <UnterbauelementeStep
            unterbauelemente={unterbauelementeData}
            updateUnterbauelemente={updateUnterbauelemente}
            initialProduktTyp={formData.productSelection.productType}
            initialModell={Array.isArray(formData.productSelection.model) ? formData.productSelection.model[0] : formData.productSelection.model}
            weitereProdukte={formData.weitereProdukte || []}
            updateWeitereProdukte={updateWeitereProdukte}
            bemerkungen={formData.bemerkungen}
            updateBemerkungen={updateBemerkungen}
            missingFields={getMissingFields()}
            showValidationErrors={showValidationErrors}
          />
        );
      case 'markise':
        const markiseDataStr = formData.specifications?.markiseData as string;
        let markiseData: MarkiseData | MarkiseData[] | null = null;
        if (markiseDataStr) {
          try {
            markiseData = JSON.parse(markiseDataStr);
          } catch {
            markiseData = null;
          }
        }
        return (
          <MarkiseStep
            markiseData={markiseData}
            updateMarkiseData={updateMarkiseData}
            bemerkungen={formData.bemerkungen}
            updateBemerkungen={updateBemerkungen}
          />
        );
      case 'abschluss':
        return (
          <FinalSection
            bemerkungen={formData.bemerkungen}
            bilder={formData.bilder}
            updateBemerkungen={updateBemerkungen}
            updateBilder={updateBilder}
            onExport={handleExport}
            onSave={handleSaveOnly}
            onNewForm={handleNewForm}
            onSendEmail={onSendEmail}
            customerSignature={formData.customerSignature}
            signatureName={formData.signatureName}
            onSignatureSave={(sigData, sigName) => {
              console.log('=== SIGNATURE SAVE ===');
              console.log('sigData length:', sigData.length);
              console.log('sigName:', sigName);
              const nextData = {
                ...formDataRef.current,
                customerSignature: sigData,
                signatureName: sigName
              };
              formDataRef.current = nextData;
              setFormData(prev => ({
                ...prev,
                customerSignature: sigData,
                signatureName: sigName
              }));
              if (nextData.id && onSignaturePersist) {
                void onSignaturePersist(sigData, sigName);
              }
            }}
            kundeVorname={formData.kundeVorname}
            kundeNachname={formData.kundeNachname}
          />
        );
      default:
        return null;
    }
  };

  const canProceed = currentStepInfo.canProceed();

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-content">
          <div className="logo-section">
            <motion.div
              className="logo"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <span className="logo-text">AYLUX</span>
              <span className="logo-subtitle">SONNENSCHUTZSYSTEME</span>
            </motion.div>
          </div>
          <div className="header-actions">
            <button
              className="theme-toggle-form"
              onClick={toggleTheme}
              title={isDarkMode ? 'Light Mode aktivieren' : 'Dark Mode aktivieren'}
            >
              {isDarkMode ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>
              )}
            </button>
            <motion.h1
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              AUFMASS - DATENBLATT
            </motion.h1>
          </div>
        </div>
      </header>

      {/* Progress indicator */}
      <div className="progress-container">
        <div className="progress-steps">
          {steps.map((step, index) => {
            // Bearbeiten ("Aufmaß düzenleme") modunda her step'e direkt
            // zıplanabilir — form zaten dolu, validation gerekmez. Yeni
            // form akışında (isExistingForm=false) sequential davranış
            // korunur: sadece geri zıplama mümkün.
            const canJumpToStep = isExistingForm || index < currentStep;
            return (
            <motion.div
              key={step.id}
              className={`progress-step ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'completed' : ''}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, delay: index * 0.1 }}
              onClick={() => {
                if (canJumpToStep && index !== currentStep) {
                  setCurrentStep(index);
                }
              }}
              style={{ cursor: canJumpToStep ? 'pointer' : 'default' }}
            >
              <div className="step-number">
                <StepIcon step={index + 1} />
              </div>
              <div className="step-title">{step.title}</div>
            </motion.div>
            );
          })}
        </div>
        <div className="progress-bar">
          <motion.div
            className="progress-fill"
            initial={{ width: '0%' }}
            animate={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>

      <main className="main-content">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStepInfo.id}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.4 }}
            className="form-wrapper"
          >
            {/* Status Breadcrumb - inside form card, only for admin and existing forms */}
            {isAdminOrOffice() && isExistingForm && formStatus && onStatusChange && (
              <div className="status-breadcrumb-inner">
                {STATUS_STEPS.map((step) => {
                  const isActive = step.value === formStatus;
                  const currentIndex = STATUS_STEPS.findIndex(s => s.value === formStatus);
                  const stepIndex = STATUS_STEPS.findIndex(s => s.value === step.value);
                  const isPast = stepIndex < currentIndex;

                  return (
                    <button
                      key={step.value}
                      className={`breadcrumb-step-inner ${isActive ? 'active' : ''} ${isPast ? 'past' : ''}`}
                      style={{ '--step-color': step.color } as React.CSSProperties}
                      onClick={() => {
                        // MODÜL B: skip the date dialog for "angebot_versendet"
                        // — the parent intercepts onStatusChange and opens the
                        // LeadFormModal instead. Backend cross-sync sets the
                        // status_date automatically when the lead is saved.
                        if (step.value === 'angebot_versendet' && onStatusChange) {
                          onStatusChange(step.value);
                          return;
                        }
                        setPendingStatusValue(step.value);
                        setStatusDateValue(new Date().toISOString().split('T')[0]);
                        setStatusDateModalOpen(true);
                      }}
                    >
                      <span
                        className="step-dot-inner"
                        style={{
                          backgroundColor: isActive || isPast ? step.color : 'transparent',
                          borderColor: step.color
                        }}
                      />
                      <span className="step-text-inner">{step.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {renderStepContent()}

            {/* Powered by Conais - inside form card */}
            <div className="powered-by-form">
              <span>Powered by</span>
              <a href="https://conais.com" target="_blank" rel="noopener noreferrer">
                <img src="https://conais.in/dev/wp-content/uploads/2020/10/logo2.png" alt="Conais" className="conais-logo conais-logo-dark" />
                <img src="https://conais.com/wp-content/uploads/2025/10/Conais-new-Logo.png" alt="Conais" className="conais-logo conais-logo-light" />
              </a>
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="navigation-buttons">
          {onCancel && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="btn btn-secondary"
              onClick={() => {
                if (formData.kundeVorname || formData.kundeNachname || formData.kundenlokation) {
                  if (confirm('Möchten Sie wirklich abbrechen? Nicht gespeicherte Daten gehen verloren.')) {
                    onCancel();
                  }
                } else {
                  onCancel();
                }
              }}
            >
              Abbrechen
            </motion.button>
          )}

          {onDraftSave && currentStep === 0 && canProceed && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="btn btn-draft-save"
              onClick={async () => {
                await onDraftSave(formData);
              }}
            >
              Speichern & Schließen
            </motion.button>
          )}

          {(currentStep > 0 || !onCancel) && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="btn btn-secondary"
              onClick={prevStep}
              disabled={currentStep === 0}
            >
              Zurück
            </motion.button>
          )}

          {currentStep < steps.length - 1 && (
            <motion.button
              whileHover={canProceed ? { scale: 1.05 } : {}}
              whileTap={canProceed ? { scale: 0.95 } : {}}
              className={`btn btn-primary ${!canProceed ? 'disabled' : ''}`}
              onClick={nextStep}
              disabled={!canProceed}
            >
              Weiter
            </motion.button>
          )}
        </div>
      </main>

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
              <h3>{STATUS_STEPS.find(s => s.value === pendingStatusValue)?.label || 'Status ändern'}</h3>
              <p className="montage-modal-description">Datum für diese Statusänderung</p>
              <div className="montage-date-input">
                <input
                  type="date"
                  value={statusDateValue}
                  onChange={(e) => setStatusDateValue(e.target.value)}
                />
              </div>
              <div className="modal-actions-modern">
                <button
                  className="modal-btn secondary"
                  onClick={() => setStatusDateModalOpen(false)}
                >
                  Abbrechen
                </button>
                <button
                  className="modal-btn primary"
                  disabled={!statusDateValue}
                  onClick={() => {
                    if (onStatusChange && statusDateValue && pendingStatusValue) {
                      onStatusChange(`${pendingStatusValue}:${statusDateValue}`);
                      setStatusDateModalOpen(false);
                      setStatusDateValue('');
                      setPendingStatusValue('');
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
    </div>
  );
}

export default AufmassForm;
export { AufmassForm };
