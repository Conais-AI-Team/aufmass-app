import { ProductSelection, DynamicFormData } from './productConfig';

// Server image object type
export interface ServerImage {
  id: number;
  file_name: string;
  file_type: string;
}

// Abnahme/Mängel image type
export interface AbnahmeImage {
  id: number;
  file_name: string;
  file_type: string;
  created_at?: string;
}

// Abnahme (acceptance) data type
export interface AbnahmeData {
  id?: number;
  formId: number;
  istFertig: boolean;
  hatProbleme: boolean;
  problemBeschreibung?: string;
  maengelListe?: string[]; // Numbered list of defects (1, 2, 3, ...)
  maengelBilder?: AbnahmeImage[]; // Mängel photos
  maengelBilderBase64?: { id: number; fileName: string; fileType: string; base64: string }[]; // Inline base64 photos for public PDF
  baustelleSauber?: 'ja' | 'nein' | null; // Baustelle wurde sauber und aufgeräumt gelassen
  monteurNote?: number | null; // Schulnote 1-6
  kundeName?: string;
  kundeUnterschrift: boolean;
  signatureData?: string | null;
  abnahmeDatum?: string;
  bemerkungen?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Weiteres Produkt type for multiple products per form
export interface WeiteresProdukt {
  id: string;
  category: string;
  productType: string;
  model: string;
  specifications: Record<string, string | number | boolean | string[]>;
}

export interface FormData {
  // Grunddaten (Common data for all products)
  id?: string; // For database
  datum: string;
  aufmasser: string;
  kundeVorname: string;
  kundeNachname: string;
  kundeEmail?: string;
  kundeTelefon?: string;
  kundenlokation: string;
  // Marketing source slug (Wie sind Sie auf uns aufmerksam geworden?)
  marketingSource?: string | null;

  // Product Selection
  productSelection: ProductSelection;

  // Dynamic product-specific fields
  specifications: DynamicFormData;

  // Weitere Produkte (additional products for same customer)
  weitereProdukte?: WeiteresProdukt[];

  // Additional data
  bilder: (File | ServerImage)[]; // Image files or server image objects
  bemerkungen: string; // Notes/remarks

  // Metadata
  createdAt?: string;
  updatedAt?: string;
  status?: 'neu' | 'auftrag_erteilt' | 'bestellt' | 'abgeschlossen' | 'reklamation' | 'draft' | 'completed' | 'archived';

  // Customer signature
  customerSignature?: string | null;
  signatureName?: string | null;
  abnahmeSignPending?: boolean;

  // Abnahme (acceptance) data - optional, only when status is 'abnahme'
  abnahme?: AbnahmeData;

  // Angebot (quote) data - optional, only when status is 'angebot_versendet'
  angebot?: AngebotPdfData;
}

// Angebot (Quote) data for PDF
export interface AngebotPdfItem {
  bezeichnung: string;
  menge: number;
  einzelpreis: number;
  gesamtpreis: number;
}

export interface AngebotPdfSummary {
  netto_summe: number;
  mwst_satz: number;
  mwst_betrag: number;
  brutto_summe: number;
  angebot_datum?: string;
  bemerkungen?: string;
}

export interface AngebotPdfData {
  items: AngebotPdfItem[];
  summary: AngebotPdfSummary | null;
}

// Legacy interfaces (keeping for backward compatibility during migration)
export interface ExtrasData {
  statiktrager: string;
  freistehend: string;
  ledBeleuchtung: string;
  fundament: string;
  wasserablauf: string[];
  bauform: string;
  stutzen: string;
}

export interface BeschattungData {
  ancUnterglas: boolean;
  ancAufglas: boolean;
  capri: boolean;
  markise: string;
  breite: string;
  tiefe: string;
  volanTyp: string;
  antrieb: string;
  antriebsseite: string;
}
