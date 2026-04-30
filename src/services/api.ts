const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// ============ TYPES ============
export interface User {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user' | 'office';
  is_active?: boolean;
  last_login?: string;
  created_at?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Invitation {
  id: number;
  token: string;
  email: string;
  role: string;
  invited_by: number;
  invited_by_name?: string;
  expires_at: string;
  used_at?: string;
  created_at: string;
}

export interface WeiteresProdukt {
  id: string;
  category: string;
  productType: string;
  model: string;
  specifications: Record<string, string | number | boolean | string[]>;
}

export interface FormData {
  id?: number;
  datum: string;
  aufmasser: string;
  kundeVorname: string;
  kundeNachname: string;
  kundeEmail?: string;
  kundeTelefon?: string;
  kundenlokation: string;
  category: string;
  productType: string;
  model: string;
  specifications: Record<string, unknown>;
  markiseData?: unknown;
  weitereProdukte?: WeiteresProdukt[];
  bemerkungen: string;
  status?: string;
  statusDate?: string;
  montageDatum?: string;
  papierkorbDate?: string;
  created_at?: string;
  updated_at?: string;
  image_count?: number;
  pdf_count?: number;
  pdf_files?: { id: number; file_name: string; file_type: string }[];
  media_files?: { id: number; file_name: string; file_type: string }[];
  lead_id?: number;
  customerSignature?: string | null;
  signatureName?: string | null;
  abnahmeSignPending?: boolean;
}

export interface ApiForm {
  id: number;
  datum: string;
  aufmasser: string;
  kunde_vorname: string;
  kunde_nachname: string;
  kunde_email?: string;
  kunde_telefon?: string;
  kundenlokation: string;
  category: string;
  product_type: string;
  model: string;
  specifications: string;
  markise_data: string | null;
  bemerkungen: string;
  status: string;
  status_date?: string;
  montage_datum?: string;
  papierkorb_date?: string;
  created_at: string;
  updated_at: string;
  bilder?: { id: number; file_name: string; file_type: string }[];
  weitereProdukte?: WeiteresProdukt[];
  image_count?: number;
  pdf_count?: number;
  pdf_files?: { id: number; file_name: string; file_type: string }[];
  media_files?: { id: number; file_name: string; file_type: string }[];
  lead_id?: number;
  customer_signature?: string | null;
  signature_name?: string | null;
  abnahme_sign_pending?: boolean;
}

export interface Stats {
  total: number;
  completed: number;
  draft: number;
}

// ============ AUTH HELPERS ============
const TOKEN_KEY = 'aylux_auth_token';
const USER_KEY = 'aylux_auth_user';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  const user = localStorage.getItem(USER_KEY);
  return user ? JSON.parse(user) : null;
}

export function setAuthData(token: string, user: User): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuthData(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// Helper to get auth headers
function getAuthHeaders(): HeadersInit {
  const token = getStoredToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
}

// Helper for authenticated fetch
async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options.headers
    }
  });

  // If unauthorized, clear auth data
  if (response.status === 401 || response.status === 403) {
    clearAuthData();
  }

  return response;
}

// ============ AUTH API ============

// Login
export async function login(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Login failed');
  }

  const data = await response.json();
  setAuthData(data.token, data.user);
  return data;
}

// Register with invitation token
export async function register(token: string, name: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, name, password })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Registration failed');
  }

  const data = await response.json();
  setAuthData(data.token, data.user);
  return data;
}

// Verify invitation token
export async function verifyInvitation(token: string): Promise<{ email: string; role: string; expires_at: string }> {
  const response = await fetch(`${API_BASE_URL}/auth/verify-invite/${token}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Invalid invitation');
  }

  return response.json();
}

// Get current user
export async function getCurrentUser(): Promise<User> {
  const response = await authFetch(`${API_BASE_URL}/auth/me`);

  if (!response.ok) {
    throw new Error('Failed to get user');
  }

  return response.json();
}

// Change password
export async function changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
  const response = await authFetch(`${API_BASE_URL}/auth/change-password`, {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to change password');
  }

  return response.json();
}

// Logout
export function logout(): void {
  clearAuthData();
}

// ============ USER MANAGEMENT (Admin) ============

// Get all users
export async function getUsers(): Promise<User[]> {
  const response = await authFetch(`${API_BASE_URL}/users`);
  if (!response.ok) throw new Error('Failed to fetch users');
  return response.json();
}

// Update user
export async function updateUser(id: number, data: Partial<User>): Promise<{ message: string }> {
  const response = await authFetch(`${API_BASE_URL}/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update user');
  }
  return response.json();
}

// Delete user
export async function deleteUser(id: number): Promise<{ message: string }> {
  const response = await authFetch(`${API_BASE_URL}/users/${id}`, {
    method: 'DELETE'
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete user');
  }
  return response.json();
}

// ============ INVITATIONS (Admin) ============

// Create invitation
export async function createInvitation(email: string, role: string = 'user'): Promise<{ inviteLink: string; token: string; expiresAt: string }> {
  const response = await authFetch(`${API_BASE_URL}/invitations`, {
    method: 'POST',
    body: JSON.stringify({ email, role })
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create invitation');
  }
  return response.json();
}

// Get all invitations
export async function getInvitations(): Promise<Invitation[]> {
  const response = await authFetch(`${API_BASE_URL}/invitations`);
  if (!response.ok) throw new Error('Failed to fetch invitations');
  return response.json();
}

// Delete invitation
export async function deleteInvitation(id: number): Promise<{ message: string }> {
  const response = await authFetch(`${API_BASE_URL}/invitations/${id}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to delete invitation');
  return response.json();
}

// ============ FORMS API ============

// Transform API response to frontend format
function transformApiToFrontend(apiForm: ApiForm): FormData {
  return {
    id: apiForm.id,
    datum: apiForm.datum?.split('T')[0] || '',
    aufmasser: apiForm.aufmasser,
    kundeVorname: apiForm.kunde_vorname,
    kundeNachname: apiForm.kunde_nachname,
    kundeEmail: apiForm.kunde_email || '',
    kundeTelefon: apiForm.kunde_telefon || '',
    kundenlokation: apiForm.kundenlokation,
    category: apiForm.category,
    productType: apiForm.product_type,
    model: apiForm.model,
    specifications: apiForm.specifications ? JSON.parse(apiForm.specifications) : {},
    markiseData: apiForm.markise_data ? JSON.parse(apiForm.markise_data) : null,
    weitereProdukte: apiForm.weitereProdukte || [],
    bemerkungen: apiForm.bemerkungen || '',
    status: apiForm.status,
    statusDate: apiForm.status_date?.split('T')[0] || '',
    montageDatum: apiForm.montage_datum?.split('T')[0] || '',
    papierkorbDate: apiForm.papierkorb_date?.split('T')[0] || '',
    created_at: apiForm.created_at,
    updated_at: apiForm.updated_at,
    image_count: apiForm.image_count,
    pdf_count: apiForm.pdf_count,
    pdf_files: apiForm.pdf_files,
    media_files: apiForm.media_files,
    lead_id: apiForm.lead_id,
    customerSignature: apiForm.customer_signature || null,
    signatureName: apiForm.signature_name || null,
    abnahmeSignPending: Boolean(apiForm.abnahme_sign_pending)
  };
}

// Health check
export async function checkHealth(): Promise<{ status: string; message: string }> {
  const response = await fetch(`${API_BASE_URL}/health`);
  return response.json();
}

// Get all forms
export async function getForms(): Promise<FormData[]> {
  const response = await authFetch(`${API_BASE_URL}/forms`);
  if (!response.ok) throw new Error('Failed to fetch forms');
  const data: ApiForm[] = await response.json();
  return data.map(transformApiToFrontend);
}

// Get single form
export async function getForm(id: number): Promise<FormData & { bilder?: { id: number; file_name: string; file_type: string }[] }> {
  const response = await authFetch(`${API_BASE_URL}/forms/${id}`);
  if (!response.ok) throw new Error('Failed to fetch form');
  const data: ApiForm = await response.json();
  return {
    ...transformApiToFrontend(data),
    bilder: data.bilder
  };
}

// Create form
export async function createForm(formData: Omit<FormData, 'id'>): Promise<{ id: number; message: string }> {
  const response = await authFetch(`${API_BASE_URL}/forms`, {
    method: 'POST',
    body: JSON.stringify(formData)
  });
  if (!response.ok) throw new Error('Failed to create form');
  return response.json();
}

// Update form
export async function updateForm(id: number, formData: Partial<FormData>): Promise<{ message: string }> {
  const response = await authFetch(`${API_BASE_URL}/forms/${id}`, {
    method: 'PUT',
    body: JSON.stringify(formData)
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update form');
  }
  return response.json();
}

// Delete form
export async function deleteForm(id: number): Promise<{ message: string }> {
  const response = await authFetch(`${API_BASE_URL}/forms/${id}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to delete form');
  return response.json();
}

// ============ STATUS HISTORY ============

export interface StatusHistoryEntry {
  id: number;
  form_id: number;
  status: string;
  changed_by: number | null;
  changed_by_name: string | null;
  changed_at: string;
  status_date: string | null;
  notes: string | null;
}

export async function getStatusHistory(formId: number): Promise<StatusHistoryEntry[]> {
  const response = await authFetch(`${API_BASE_URL}/forms/${formId}/status-history`);
  if (!response.ok) throw new Error('Failed to fetch status history');
  return response.json();
}

// ============ ABNAHME ============

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

export async function getAbnahme(formId: number): Promise<AbnahmeData | null> {
  const response = await authFetch(`${API_BASE_URL}/forms/${formId}/abnahme`);
  if (!response.ok) throw new Error('Failed to fetch abnahme');
  return response.json();
}

export async function saveAbnahme(formId: number, data: Partial<AbnahmeData>): Promise<{ message: string }> {
  const response = await authFetch(`${API_BASE_URL}/forms/${formId}/abnahme`, {
    method: 'POST',
    body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error('Failed to save abnahme');
  return response.json();
}

export interface AbnahmeSignSnapshot {
  form: {
    id: number;
    datum: string;
    aufmasser: string;
    kundeVorname: string;
    kundeNachname: string;
    kundeEmail?: string;
    kundeTelefon?: string;
    kundenlokation: string;
    category: string;
    productType: string;
    model: string;
    bemerkungen?: string;
  };
  abnahme: {
    istFertig: boolean;
    hatProbleme: boolean;
    problemBeschreibung?: string;
    maengelListe?: string[];
    baustelleSauber?: 'ja' | 'nein' | null;
    monteurNote?: number | null;
    kundeName?: string;
    kundeUnterschrift: boolean;
    abnahmeDatum?: string;
    bemerkungen?: string;
    signatureData?: string | null;
  };
  photos?: { id: number; fileName: string; fileType: string; base64: string }[];
}

export interface AbnahmeSignRequestResponse {
  id: number;
  signUrl: string;
  expiresAt: string;
}

export interface PublicAbnahmeSignRequest {
  id: number;
  formId: number;
  status: 'pending' | 'signed' | 'expired' | 'replaced';
  signerName?: string | null;
  signedAt?: string | null;
  expiresAt: string;
  snapshot: AbnahmeSignSnapshot;
}

export async function createAbnahmeSignRequest(formId: number): Promise<AbnahmeSignRequestResponse> {
  const response = await authFetch(`${API_BASE_URL}/forms/${formId}/abnahme/sign-request`, {
    method: 'POST'
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create sign link' }));
    throw new Error(error.error || 'Failed to create sign link');
  }
  return response.json();
}

export async function getPublicAbnahmeSignRequest(token: string): Promise<PublicAbnahmeSignRequest> {
  const response = await fetch(`${API_BASE_URL}/public/abnahme-sign/${token}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to load sign request' }));
    throw new Error(error.error || 'Failed to load sign request');
  }
  return response.json();
}

export async function submitPublicAbnahmeSignature(
  token: string,
  payload: { signerName: string; signatureData: string }
): Promise<{ success: boolean; formId: number; status: string }> {
  const response = await fetch(`${API_BASE_URL}/public/abnahme-sign/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to submit signature' }));
    throw new Error(error.error || 'Failed to submit signature');
  }
  return response.json();
}

export function getPublicAbnahmePdfUrl(token: string): string {
  return `${API_BASE_URL}/public/abnahme-sign/${token}/pdf`;
}

// Upload images
export async function uploadImages(formId: number, files: File[]): Promise<{ message: string }> {
  const formData = new window.FormData();
  files.forEach(file => {
    formData.append('images', file);
  });

  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}/forms/${formId}/images`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData
  });
  if (!response.ok) throw new Error('Failed to upload images');
  return response.json();
}

// Get image URL (with token for direct browser access)
export function getImageUrl(imageId: number): string {
  const token = getStoredToken();
  return `${API_BASE_URL}/images/${imageId}${token ? `?token=${token}` : ''}`;
}

// Get stored PDF URL (for direct browser opening with token)
export function getPdfUrl(formId: number): string {
  const token = getStoredToken();
  return `${API_BASE_URL}/forms/${formId}/pdf${token ? `?token=${token}` : ''}`;
}

// Upload temporary file (returns URL for PDF linking)
export async function uploadTempFile(file: File): Promise<{ id: number; url: string; fileName: string }> {
  const formData = new window.FormData();
  formData.append('file', file);

  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}/upload-temp`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData
  });

  if (!response.ok) throw new Error('Failed to upload file');
  return response.json();
}

// Delete image
export async function deleteImage(imageId: number): Promise<{ message: string }> {
  const response = await authFetch(`${API_BASE_URL}/images/${imageId}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to delete image');
  return response.json();
}

// ============ ABNAHME/MÄNGEL IMAGES ============

export interface AbnahmeImage {
  id: number;
  file_name: string;
  file_type: string;
  created_at: string;
}

// Upload Mängel/Abnahme images
export async function uploadAbnahmeImages(formId: number, files: File[]): Promise<{ message: string }> {
  const formData = new window.FormData();
  files.forEach(file => {
    formData.append('images', file);
  });

  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}/forms/${formId}/abnahme-images`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData
  });
  if (!response.ok) throw new Error('Failed to upload Mängel images');
  return response.json();
}

// Get Abnahme images list
export async function getAbnahmeImages(formId: number): Promise<AbnahmeImage[]> {
  const response = await authFetch(`${API_BASE_URL}/forms/${formId}/abnahme-images`);
  if (!response.ok) throw new Error('Failed to get Mängel images');
  return response.json();
}

// Get Abnahme image URL
export function getAbnahmeImageUrl(imageId: number): string {
  const token = getStoredToken();
  return `${API_BASE_URL}/abnahme-images/${imageId}${token ? `?token=${token}` : ''}`;
}

// Delete Abnahme image
export async function deleteAbnahmeImage(imageId: number): Promise<{ message: string }> {
  const response = await authFetch(`${API_BASE_URL}/abnahme-images/${imageId}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to delete Mängel image');
  return response.json();
}

// Get stats
export async function getStats(): Promise<Stats> {
  const response = await authFetch(`${API_BASE_URL}/stats`);
  if (!response.ok) throw new Error('Failed to fetch stats');
  return response.json();
}

// ============ MONTAGETEAM API ============

export interface Montageteam {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface MontageteamStats {
  id: number;
  montageteam: string;
  is_active: boolean;
  created_at: string;
  count: number;
  completed: number;
  draft: number;
}

// Get Montageteam stats (with project counts)
export async function getMontageteamStats(): Promise<MontageteamStats[]> {
  const response = await authFetch(`${API_BASE_URL}/stats/montageteam`);
  if (!response.ok) throw new Error('Failed to fetch montageteam stats');
  return response.json();
}

// Get all montageteams
export async function getMontageteams(): Promise<Montageteam[]> {
  const response = await authFetch(`${API_BASE_URL}/montageteams`);
  if (!response.ok) throw new Error('Failed to fetch montageteams');
  return response.json();
}

// Create montageteam
export async function createMontageteam(name: string): Promise<Montageteam> {
  const response = await authFetch(`${API_BASE_URL}/montageteams`, {
    method: 'POST',
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create montageteam');
  }
  return response.json();
}

// Update montageteam
export async function updateMontageteam(id: number, data: { name?: string; is_active?: boolean }): Promise<{ message: string }> {
  const response = await authFetch(`${API_BASE_URL}/montageteams/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update montageteam');
  }
  return response.json();
}

// Delete montageteam
export async function deleteMontageteam(id: number): Promise<{ message: string }> {
  const response = await authFetch(`${API_BASE_URL}/montageteams/${id}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to delete montageteam');
  return response.json();
}

// ============ PDF STORAGE ============

export interface PdfStatus {
  hasPdf: boolean;
  pdfGeneratedAt: string | null;
  isOutdated: boolean;
  needsRegeneration: boolean;
}

// Save generated PDF for a form
export async function savePdf(formId: number, pdfBlob: Blob): Promise<{ message: string }> {
  const formData = new window.FormData();
  formData.append('pdf', pdfBlob, `aufmass_${formId}.pdf`);

  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}/forms/${formId}/pdf`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData
  });
  if (!response.ok) throw new Error('Failed to save PDF');
  return response.json();
}

// Get PDF blob for a form
export async function getPdfBlob(formId: number): Promise<Blob> {
  const response = await authFetch(`${API_BASE_URL}/forms/${formId}/pdf`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to get PDF' }));
    throw new Error(error.error || 'Failed to get PDF');
  }
  return response.blob();
}

// Check PDF status for a form
export async function getPdfStatus(formId: number): Promise<PdfStatus> {
  const response = await authFetch(`${API_BASE_URL}/forms/${formId}/pdf/status`);
  if (!response.ok) throw new Error('Failed to check PDF status');
  return response.json();
}

// ============ FORM PDF SNAPSHOTS — frozen historic copies per document type ============

export type FormPdfDocType = 'aufmass' | 'angebot' | 'abnahme' | 'rechnung';

export interface FormPdfSnapshot {
  document_type: FormPdfDocType;
  created_at: string;
}

export async function saveFormPdfSnapshot(
  formId: number,
  docType: FormPdfDocType,
  pdfBlob: Blob
): Promise<{ success: boolean; document_type: FormPdfDocType; created_at: string }> {
  const formData = new window.FormData();
  formData.append('pdf', pdfBlob, `form_${formId}_${docType}.pdf`);
  formData.append('document_type', docType);

  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}/forms/${formId}/pdf-snapshot`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to save snapshot');
  }
  return response.json();
}

export async function getFormPdfSnapshots(formId: number): Promise<FormPdfSnapshot[]> {
  const response = await authFetch(`${API_BASE_URL}/forms/${formId}/pdf-snapshots`);
  if (!response.ok) return [];
  return response.json();
}

// URL-with-token for opening a snapshot in a new tab
export function getFormPdfSnapshotUrl(formId: number, docType: FormPdfDocType): string {
  const token = getStoredToken();
  return `${API_BASE_URL}/forms/${formId}/pdf-snapshot/${docType}${token ? `?token=${token}` : ''}`;
}

// ============ E-SIGNATURE API ============

export interface BranchFeatures {
  isAdminBranch: boolean;
  branchSlug?: string;
  esignature_enabled: boolean;
  esignature_sandbox?: boolean;
  esignature_management: boolean;
}

export type EsignatureProvider = 'boldsign'; // BoldSign AES only

export interface BranchSettings {
  slug: string;
  name: string;
  is_active: boolean;
  esignature_enabled: boolean;
  esignature_sandbox: boolean;
  esignature_provider: EsignatureProvider;
}

export interface EsignatureRequest {
  id: number;
  signature_type: 'AES';
  boldsign_document_id: string | null;
  status: 'pending' | 'sent' | 'signed' | 'failed' | 'expired' | 'viewed' | 'signing' | 'declined';
  signer_email: string;
  signer_name: string;
  signing_url: string | null;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  document_type: 'aufmass' | 'abnahme' | 'angebot';
  provider: 'boldsign';
}

export interface EsignatureStatus {
  form_id: number;
  signatures: EsignatureRequest[];
}

export interface SendSignatureResponse {
  success: boolean;
  request_id: number;
  boldsign_document_id: string;
  signing_url: string | null;
  message: string;
  provider: 'boldsign';
}

// Get branch features (for frontend to check e-signature availability)
export async function getBranchFeatures(): Promise<BranchFeatures> {
  const response = await authFetch(`${API_BASE_URL}/branch/features`);
  if (!response.ok) throw new Error('Failed to fetch branch features');
  return response.json();
}

// Get all branch settings (admin only)
export async function getBranchSettings(): Promise<BranchSettings[]> {
  const response = await authFetch(`${API_BASE_URL}/esignature/branch-settings`);
  if (!response.ok) throw new Error('Failed to fetch branch settings');
  return response.json();
}

// Update branch e-signature settings (admin only)
export async function updateBranchSettings(
  slug: string,
  settings: { esignature_enabled: boolean; esignature_sandbox: boolean; esignature_provider?: EsignatureProvider }
): Promise<{ message: string }> {
  const response = await authFetch(`${API_BASE_URL}/esignature/branch-settings/${slug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  });
  if (!response.ok) throw new Error('Failed to update branch settings');
  return response.json();
}

// Send AES signature request via BoldSign (Advanced Electronic Signature with Email OTP)
// Uses stored PDF from database
export async function sendAesSignature(formId: number): Promise<SendSignatureResponse> {
  const response = await authFetch(`${API_BASE_URL}/boldsign/send-aes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ form_id: formId })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to send AES signature' }));
    throw new Error(error.error || error.details || 'Failed to send AES signature');
  }
  return response.json();
}

// Send Abnahme AES signature request via BoldSign
export async function sendAbnahmeAesSignature(formId: number): Promise<SendSignatureResponse> {
  const response = await authFetch(`${API_BASE_URL}/boldsign/send-abnahme-aes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ form_id: formId })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to send Abnahme AES signature' }));
    throw new Error(error.error || error.details || 'Failed to send Abnahme AES signature');
  }
  return response.json();
}

// Download signed document from BoldSign
export async function downloadBoldSignDocument(documentId: string): Promise<Blob> {
  const response = await authFetch(`${API_BASE_URL}/esignature/boldsign/download/${documentId}`);
  if (!response.ok) throw new Error('Failed to download signed document');
  return response.blob();
}

// Get signature status for a form
export async function getEsignatureStatus(formId: number): Promise<EsignatureStatus> {
  const response = await authFetch(`${API_BASE_URL}/esignature/status/${formId}`);
  if (!response.ok) throw new Error('Failed to fetch signature status');
  return response.json();
}

// Download signed document
export async function downloadSignedDocument(requestId: number): Promise<Blob> {
  const response = await authFetch(`${API_BASE_URL}/esignature/download/${requestId}`);
  if (!response.ok) throw new Error('Failed to download signed document');
  return response.blob();
}

// Refresh signature status from BoldSign API directly (for polling/manual refresh)
export interface RefreshStatusResponse {
  request_id: number;
  previous_status: string;
  current_status: string;
  boldsign_status: string;
  updated: boolean;
}

export async function refreshSignatureStatus(requestId: number): Promise<RefreshStatusResponse> {
  const response = await authFetch(`${API_BASE_URL}/esignature/boldsign/refresh-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: requestId })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to refresh signature status' }));
    throw new Error(error.error || error.details || 'Failed to refresh signature status');
  }
  return response.json();
}

// Poll for new signature notifications
export interface SignatureNotification {
  id: number;
  form_id: number;
  signature_type: string;
  document_type: string;
  status: string;
  signer_name: string;
  signed_at: string;
  kunde_vorname: string;
  kunde_nachname: string;
}

export interface NotificationResponse {
  notifications: SignatureNotification[];
  checked_at: string;
}

export async function getSignatureNotifications(since?: string): Promise<NotificationResponse> {
  const url = since
    ? `${API_BASE_URL}/esignature/notifications?since=${encodeURIComponent(since)}`
    : `${API_BASE_URL}/esignature/notifications`;
  const response = await authFetch(url);
  if (!response.ok) throw new Error('Failed to fetch notifications');
  return response.json();
}

// ============ ANGEBOT (QUOTE) API ============

export interface AngebotItem {
  id?: number;
  bezeichnung: string;
  menge: number;
  einzelpreis: number;
  gesamtpreis: number;
  sort_order?: number;
}

export interface AngebotSummary {
  id?: number;
  form_id?: number;
  netto_summe: number;
  mwst_satz: number;
  mwst_betrag: number;
  brutto_summe: number;
  angebot_datum?: string;
  bemerkungen?: string;
}

export interface AngebotData {
  summary: AngebotSummary | null;
  items: AngebotItem[];
}

// Get Angebot data for a form
export async function getAngebot(formId: number): Promise<AngebotData> {
  const response = await authFetch(`${API_BASE_URL}/forms/${formId}/angebot`);
  if (!response.ok) throw new Error('Failed to fetch Angebot data');
  return response.json();
}

// Save Angebot data
export interface SaveAngebotRequest {
  items: AngebotItem[];
  angebot_datum?: string;
  bemerkungen?: string;
  mwst_satz?: number;
}

export async function saveAngebot(formId: number, data: SaveAngebotRequest): Promise<{ message: string; summary: AngebotSummary }> {
  const response = await authFetch(`${API_BASE_URL}/forms/${formId}/angebot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to save Angebot' }));
    throw new Error(error.error || 'Failed to save Angebot');
  }
  return response.json();
}

// Send Angebot AES signature request via BoldSign
export async function sendAngebotAesSignature(formId: number): Promise<SendSignatureResponse> {
  const response = await authFetch(`${API_BASE_URL}/boldsign/send-angebot-aes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ form_id: formId })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to send Angebot AES signature' }));
    throw new Error(error.error || error.details || 'Failed to send Angebot AES signature');
  }
  return response.json();
}

// ============ LEAD STATUS ============

export async function updateLeadStatus(leadId: number, status: string): Promise<{ message: string }> {
  const response = await authFetch(`${API_BASE_URL}/leads/${leadId}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status })
  });
  if (!response.ok) throw new Error('Failed to update lead status');
  return response.json();
}

// ============ LEAD PDF ============

// Save generated PDF for a lead
export async function saveLeadPdf(leadId: number, pdfBlob: Blob): Promise<{ message: string }> {
  const formData = new window.FormData();
  formData.append('pdf', pdfBlob, `angebot_${leadId}.pdf`);

  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}/leads/${leadId}/pdf`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData
  });
  if (!response.ok) throw new Error('Failed to save lead PDF');
  return response.json();
}

// Get lead PDF URL
export function getLeadPdfUrl(leadId: number): string {
  const token = getStoredToken();
  return `${API_BASE_URL}/leads/${leadId}/pdf${token ? `?token=${token}` : ''}`;
}

// Get angebot-specific PDF URL
export function getAngebotPdfUrl(leadId: number, angebotId: number): string {
  const token = getStoredToken();
  return `${API_BASE_URL}/leads/${leadId}/angebote/${angebotId}/pdf${token ? `?token=${token}` : ''}`;
}

// Save angebot-specific PDF
export async function saveAngebotPdf(leadId: number, angebotId: number, pdfBlob: Blob): Promise<{ message: string }> {
  const formData = new window.FormData();
  formData.append('pdf', pdfBlob, `angebot_${leadId}_${angebotId}.pdf`);

  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}/leads/${leadId}/angebote/${angebotId}/pdf`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData
  });
  if (!response.ok) throw new Error('Failed to save angebot PDF');
  return response.json();
}

// ============ GENERIC API HELPER ============
export const api = {
  async get<T = unknown>(endpoint: string): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }
    return response.json();
  },

  async post<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }
    return response.json();
  },

  async put<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }
    return response.json();
  },

  async delete<T = unknown>(endpoint: string): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }
    return response.json();
  }
};

// ============ EMAIL / SMTP ============
export interface SmtpSettings {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_from_name: string;
  smtp_from_email: string;
  smtp_secure: boolean;
  smtp_enabled: boolean;
}

export interface EmailLogEntry {
  id: number;
  form_id: number | null;
  lead_id: number | null;
  branch_id: string;
  email_type: string;
  recipient_email: string;
  subject: string;
  status: 'sent' | 'failed' | 'pending';
  error_message: string | null;
  sent_by_name: string | null;
  sent_at: string;
}

// Branch-level (admin only)
export const getEmailSettings = (): Promise<SmtpSettings> => api.get('/email/settings');
export const saveEmailSettings = (settings: SmtpSettings & { smtp_pass?: string }): Promise<{ success: boolean }> =>
  api.put('/email/settings', settings);

// User-level (any user)
export interface UserSmtpSettings {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_from_name: string;
  smtp_from_email: string;
  smtp_secure: boolean;
  smtp_configured: boolean;
}

export const getMyEmailSettings = (): Promise<UserSmtpSettings> => api.get('/email/my-settings');
export const saveMyEmailSettings = (settings: UserSmtpSettings & { smtp_pass?: string }): Promise<{ success: boolean }> =>
  api.put('/email/my-settings', settings);

// Status check (hybrid: user > branch)
export interface EmailStatus {
  configured: boolean;
  source: 'user' | 'branch' | null;
  from_email: string | null;
  from_name: string | null;
}
export const getEmailStatus = (): Promise<EmailStatus> => api.get('/email/status');

// Shared
export const testEmailConnection = (settings: {
  smtp_host: string; smtp_port: number; smtp_user: string; smtp_pass: string;
  smtp_from_email?: string; smtp_secure?: boolean;
}): Promise<{ success: boolean; message: string }> => api.post('/email/test', settings);

export const sendEmail = (data: {
  to: string; subject: string; body: string; body_html?: string;
  form_id?: number; lead_id?: number; angebot_ids?: number[];
  email_type?: string; attachment_name?: string;
  /** When true, attaches the branch's uploaded AGB-PDF as a separate file */
  attach_agb?: boolean;
  /** Client-generated PDFs to attach (e.g. one per product). Each entry: { filename, base64 } */
  extra_pdfs?: { filename: string; base64: string }[];
  /** When true, server skips attaching the consolidated form/lead PDF
   *  (used when the client uploads per-product split PDFs via extra_pdfs) */
  suppress_main_pdf?: boolean;
}): Promise<{ success: boolean; message: string }> => api.post('/email/send', data);

export const getEmailLog = (): Promise<EmailLogEntry[]> => api.get('/email/log');

// ============ BRANCH COMPANY INFO (Firmenangaben) ============
export interface BranchCompanyInfo {
  company_name: string;
  company_strasse: string;
  company_plz: string;
  company_ort: string;
  company_telefon: string;
  company_email: string;
  company_ust_id: string;
  company_web: string;
  company_steuernr: string;
  company_iban: string;
  company_bic: string;
  company_bank_name: string;
  company_geschaeftsfuehrer: string;
  company_handelsregister: string;
}

export const getBranchCompanyInfo = (): Promise<BranchCompanyInfo> =>
  api.get('/branch/company-info');

export const saveBranchCompanyInfo = (info: BranchCompanyInfo): Promise<{ success: boolean }> =>
  api.put('/branch/company-info', info);

// Public read for PDF generation (any authenticated user)
export const getBranchCompanyInfoPublic = (): Promise<BranchCompanyInfo> =>
  api.get('/branch/company-info-public');

// ============ MODÜL F: PRODUCT IMAGES ============
export interface ProductImage {
  id: number;
  image_path: string;
  image_order: number;
  show_on_cover: boolean;
  uploaded_at?: string;
}

export const getProductImages = (productId: number): Promise<ProductImage[]> =>
  api.get(`/products/${productId}/images`);

export const uploadProductImage = async (productId: number, file: File): Promise<ProductImage> => {
  const formData = new FormData();
  formData.append('image', file);
  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}/products/${productId}/images`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }
  return response.json();
};

export const deleteProductImage = (productId: number, imageId: number): Promise<{ success: boolean }> =>
  api.delete(`/products/${productId}/images/${imageId}`);

export const setProductImageCoverFlag = (
  productId: number,
  imageId: number,
  show_on_cover: boolean
): Promise<{ success: boolean }> =>
  api.put(`/products/${productId}/images/${imageId}/cover-flag`, { show_on_cover });

// ============ MODÜL F: BRANCH TERMS (AGB) ============
export interface BranchTerms {
  content: string;
  show_on_aufmass: boolean;
  show_on_angebot: boolean;
  show_on_abnahme: boolean;
  show_on_rechnung: boolean;
  agb_pdf_path?: string | null;
  agb_pdf_pages?: number[] | null;
  /** When true, AGB is sent as a separate email attachment (rather than embedded in the main PDF) */
  attach_separately?: boolean;
}

export const getBranchTerms = (): Promise<BranchTerms> => api.get('/branch/terms');

export const saveBranchTerms = (terms: BranchTerms): Promise<{ success: boolean }> =>
  api.put('/branch/terms', terms);

// ============ MODÜL F2: PDF Cover/AGB Override ============
export interface ProductCoverPdf {
  id: number;
  file_path: string;
  selected_pages: number[];
  page_count: number;
  uploaded_at: string;
}

export interface BranchAgbPdf {
  file_path: string;
  selected_pages: number[];
  page_count: number;
}

export const getProductCoverPdf = (productId: number): Promise<ProductCoverPdf | null> =>
  api.get(`/products/${productId}/cover-pdf`);

export const uploadProductCoverPdf = async (productId: number, file: File): Promise<ProductCoverPdf> => {
  const formData = new FormData();
  formData.append('pdf', file);
  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}/products/${productId}/cover-pdf`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }
  return response.json();
};

export const setCoverPdfPages = (productId: number, selected_pages: number[]): Promise<{ success: boolean }> =>
  api.put(`/products/${productId}/cover-pdf/pages`, { selected_pages });

export const deleteProductCoverPdf = (productId: number): Promise<{ success: boolean }> =>
  api.delete(`/products/${productId}/cover-pdf`);

export const uploadAgbPdf = async (file: File): Promise<BranchAgbPdf> => {
  const formData = new FormData();
  formData.append('pdf', file);
  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}/branch/agb-pdf`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }
  return response.json();
};

export const setAgbPdfPages = (selected_pages: number[]): Promise<{ success: boolean }> =>
  api.put('/branch/agb-pdf/pages', { selected_pages });

export const deleteAgbPdf = (): Promise<{ success: boolean }> =>
  api.delete('/branch/agb-pdf');

// Returns absolute URL with auth token for fetching uploaded PDFs
export const getBranchPdfUrl = (filename: string): string =>
  `${API_BASE_URL}/branch-pdf/${filename}`;

// Cache branch-uploaded PDF bytes per filename — same AGB/cover PDF is loaded once
// for split-per-product flows that call fetchBranchPdfBytes once per item.
// Returns a fresh Uint8Array slice each time so consumers (pdf-lib, pdfjs) can transfer
// the buffer without invalidating the cache.
const branchPdfBytesCache = new Map<string, Uint8Array>();
const branchPdfInFlight = new Map<string, Promise<Uint8Array | null>>();

export const fetchBranchPdfBytes = async (filename: string): Promise<Uint8Array | null> => {
  const cached = branchPdfBytesCache.get(filename);
  if (cached) return new Uint8Array(cached); // copy so callers can transfer

  const pending = branchPdfInFlight.get(filename);
  if (pending) return pending.then((b) => (b ? new Uint8Array(b) : null));

  const token = getStoredToken();
  const promise = (async (): Promise<Uint8Array | null> => {
    try {
      const response = await fetch(getBranchPdfUrl(filename), {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!response.ok) return null;
      const buf = await response.arrayBuffer();
      const bytes = new Uint8Array(buf);
      branchPdfBytesCache.set(filename, bytes);
      return bytes;
    } catch {
      return null;
    } finally {
      branchPdfInFlight.delete(filename);
    }
  })();

  branchPdfInFlight.set(filename, promise);
  const result = await promise;
  return result ? new Uint8Array(result) : null;
};

export const invalidateBranchPdfBytesCache = (filename?: string) => {
  if (filename !== undefined) branchPdfBytesCache.delete(filename);
  else branchPdfBytesCache.clear();
};

// ============ LEAD PDF CACHE ============
export const fetchCachedLeadPdf = async (
  leadId: number,
  angebotId: number | null,
  documentType: 'angebot' | 'aufmass' | 'abnahme' | 'rechnung'
): Promise<Blob | null> => {
  const token = getStoredToken();
  const params = new URLSearchParams();
  if (angebotId !== null) params.set('angebot_id', String(angebotId));
  params.set('document_type', documentType);
  try {
    const response = await fetch(`${API_BASE_URL}/lead-pdf-cache/${leadId}?${params}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!response.ok) return null;
    const ct = response.headers.get('content-type') || '';
    if (!ct.includes('pdf')) return null; // null JSON response means no cache
    return await response.blob();
  } catch {
    return null;
  }
};

export const storeCachedLeadPdf = async (
  leadId: number,
  angebotId: number | null,
  documentType: 'angebot' | 'aufmass' | 'abnahme' | 'rechnung',
  pdfBlob: Blob
): Promise<void> => {
  const formData = new FormData();
  formData.append('pdf', pdfBlob, 'cached.pdf');
  if (angebotId !== null) formData.append('angebot_id', String(angebotId));
  formData.append('document_type', documentType);
  const token = getStoredToken();
  await fetch(`${API_BASE_URL}/lead-pdf-cache/${leadId}`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData
  });
};

// ============ BRANCH USAGE DASHBOARD ============
export interface BranchUserStat {
  id: number;
  name: string;
  aufmass_count: number;
  angebot_count: number;
}

export interface BranchStat {
  slug: string;
  name: string;
  aufmass_count: number;
  angebot_count: number;
  highest_invoice: number;
  total_revenue: number;
  users: BranchUserStat[];
}

export interface BranchStatsResponse {
  branches: BranchStat[];
  totals: {
    aufmass_count: number;
    angebot_count: number;
    highest_invoice: number;
    total_revenue: number;
  };
}

export interface BranchFunnel {
  aufmass: number;
  angebot: number;
  auftrag: number;
  completed: number;
}

export interface ActivityEvent {
  type: 'aufmass' | 'angebot';
  id: number;
  branch_id: string;
  detail: string;
  user_name: string | null;
  event_time: string;
  status: string;
}

export interface BranchDetailsResponse {
  funnel: Record<string, BranchFunnel>;
  trends: Record<string, Record<string, number>>;
  angebotTrends: Record<string, Record<string, number>>;
  months: string[];
  pipeline: { status: string; count: number }[];
  activity: ActivityEvent[];
  speed: Record<string, number>;
}

export const getBranchDetails = (from?: string, to?: string): Promise<BranchDetailsResponse> => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return api.get(`/admin/branch-details${qs ? `?${qs}` : ''}`);
};

export const getBranchStats = (from?: string, to?: string): Promise<BranchStatsResponse> => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return api.get(`/admin/branch-stats${qs ? `?${qs}` : ''}`);
};

