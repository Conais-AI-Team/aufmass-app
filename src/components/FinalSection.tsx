import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ServerImage } from '../types';
import { deleteImage, getImageUrl } from '../services/api';
import { useToast } from './Toast';
import { compressImages } from '../utils/imageCompress';
import SignatureCanvas from './SignatureCanvas';
import './FinalSection.css';
import './SectionStyles.css';

type ImageItem = File | ServerImage;

interface FinalSectionProps {
  bemerkungen: string;
  bilder: ImageItem[];
  updateBemerkungen: (value: string) => void;
  updateBilder: (files: ImageItem[]) => void;
  onExport: () => Promise<void> | void;
  onSave: () => Promise<void> | void;
  onNewForm: () => void;
  onSendEmail?: () => void;
  customerSignature?: string | null;
  signatureName?: string | null;
  onSignatureSave?: (signatureData: string, signerName: string) => void;
  kundeVorname?: string;
  kundeNachname?: string;
}

const FinalSection = ({
  bemerkungen,
  bilder,
  updateBemerkungen,
  updateBilder,
  onExport,
  onSave,
  onNewForm,
  onSendEmail,
  customerSignature,
  signatureName,
  onSignatureSave,
  kundeVorname,
  kundeNachname
}: FinalSectionProps) => {
  const toast = useToast();
  const [dragActive, setDragActive] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [pdfExported, setPdfExported] = useState(false);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addMoreInputRef = useRef<HTMLInputElement>(null);
  const bemerkungenRef = useRef<HTMLTextAreaElement>(null);

  // Ensure textarea value is synced before export/save
  const syncBemerkungen = useCallback(() => {
    if (bemerkungenRef.current) {
      const currentValue = bemerkungenRef.current.value;
      if (currentValue !== bemerkungen) {
        updateBemerkungen(currentValue);
      }
    }
  }, [bemerkungen, updateBemerkungen]);

  // PDF sadece indirir, kaydetmez
  const handleExport = async () => {
    // Sync bemerkungen before export
    syncBemerkungen();
    // Small delay to ensure state is updated
    await new Promise(resolve => setTimeout(resolve, 50));

    setIsExporting(true);
    try {
      await onExport();
      setPdfExported(true);
    } finally {
      setIsExporting(false);
    }
  };

  // Önce kaydet, sonra PDF butonu aktif kalır
  const handleSave = async () => {
    // Sync bemerkungen before save
    syncBemerkungen();
    // Small delay to ensure state is updated
    await new Promise(resolve => setTimeout(resolve, 50));

    setIsSaving(true);
    try {
      await onSave();
      setIsSaved(true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files).filter(file =>
      file.type.startsWith('image/') || file.type === 'application/pdf'
    );

    if (files.length > 0) {
      const newFiles = [...bilder, ...files].slice(0, 10); // Max 10 files
      updateBilder(newFiles);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    // Reset input immediately so the same file can be re-selected after a removal.
    e.target.value = '';
    // Compress images client-side before they enter form state — drops phone
    // photos from 3-8 MB to ~500 KB. Non-image files (PDFs) pass through.
    const processed = await compressImages(picked);
    const newFiles = [...bilder, ...processed].slice(0, 10); // Max 10 files
    updateBilder(newFiles);
  };

  const removeImage = async (index: number) => {
    const fileToRemove = bilder[index];

    // If it's a server image, delete from database
    if (isServerFile(fileToRemove)) {
      try {
        await deleteImage(fileToRemove.id);
      } catch (err) {
        console.error('Error deleting image from server:', err);
        toast.error('Fehler', 'Bild konnte nicht gelöscht werden.');
        return; // Don't remove from UI if server delete failed
      }
    }

    // Remove from local state
    const newFiles = bilder.filter((_, i) => i !== index);
    updateBilder(newFiles);
  };

  // Type guard to check if file is from server
  const isServerFile = (file: ImageItem): file is ServerImage => {
    return typeof file === 'object' && file !== null && 'id' in file && typeof (file as ServerImage).id === 'number';
  };

  const getFilePreview = (file: ImageItem) => {
    // If it's a server-loaded image (has id), use API URL with full base URL
    if (isServerFile(file)) {
      return getImageUrl(file.id);
    }
    // If it's a local File object, create blob URL
    return URL.createObjectURL(file);
  };

  const isPdf = (file: ImageItem) => {
    if (isServerFile(file)) {
      return file.file_type === 'application/pdf';
    }
    return file.type === 'application/pdf';
  };

  const getFileName = (file: ImageItem) => {
    if (isServerFile(file)) {
      return file.file_name;
    }
    return file.name;
  };

  const isValid = bilder.length >= 2;
  const canAddMore = bilder.length < 10;

  return (
    <div className="final-section">
      <motion.div
        className="section-header"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <h2>Abschluss</h2>
        <p className="section-description">Bilder und Bemerkungen</p>
      </motion.div>

      <div className="final-content">
        {/* Bilder Upload Section */}
        <motion.div
          className="form-field full-width bilder-section"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <div className="bilder-header">
            <label>
              Bilder hochladen <span className="required">*</span>
              <span className="label-hint">(Mindestens 2 Bilder erforderlich)</span>
            </label>
            {bilder.length > 0 && canAddMore && (
              <button
                type="button"
                className="add-more-btn"
                onClick={() => addMoreInputRef.current?.click()}
              >
                <span className="add-icon">+</span>
                Weitere Bilder hinzufügen
              </button>
            )}
          </div>

          <input
            ref={addMoreInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          {/* Image Preview Grid */}
          <div className="image-preview-grid">
            <AnimatePresence>
              {bilder.map((file, index) => (
                <motion.div
                  key={`${getFileName(file)}-${index}`}
                  className={`image-preview-item ${isPdf(file) ? 'pdf-item' : ''}`}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                >
                  {isPdf(file) ? (
                    <a
                      href={getFilePreview(file)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pdf-preview"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="pdf-icon">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                        <polyline points="14,2 14,8 20,8" />
                        <path d="M9 13h6M9 17h6M9 9h1" />
                      </svg>
                      <span className="pdf-name">{getFileName(file)}</span>
                    </a>
                  ) : (
                    <img src={getFilePreview(file)} alt={`Bild ${index + 1}`} />
                  )}
                  <button
                    type="button"
                    className="remove-image-btn"
                    onClick={() => removeImage(index)}
                    title={isPdf(file) ? 'PDF entfernen' : 'Bild entfernen'}
                  >
                    ×
                  </button>
                  <span className="image-label">{isPdf(file) ? 'PDF' : 'Bild'} {index + 1}</span>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Upload placeholder - only show when no images or less than 2 */}
            {bilder.length < 2 && (
              <motion.div
                className={`image-upload-slot ${dragActive ? 'drag-active' : ''}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                <span className="upload-icon">+</span>
                <span className="upload-text">
                  {bilder.length === 0
                    ? 'Klicken oder Dateien hierher ziehen'
                    : 'Noch 1 Datei erforderlich'
                  }
                </span>
              </motion.div>
            )}
          </div>

          {/* Image count indicator */}
          <div className="image-count">
            <span className={bilder.length >= 2 ? 'count-valid' : 'count-invalid'}>
              {bilder.length} von mindestens 2 Bildern
            </span>
            {bilder.length >= 2 && (
              <span className="check-icon">✓</span>
            )}
          </div>

          {/* Validation message */}
          {bilder.length < 2 && (
            <motion.div
              className="validation-message"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              Bitte laden Sie mindestens 2 Bilder hoch
            </motion.div>
          )}
        </motion.div>

        {/* Bemerkungen Section */}
        <motion.div
          className="form-field full-width"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <label htmlFor="bemerkungen">
            Bemerkungen
          </label>
          <textarea
            ref={bemerkungenRef}
            id="bemerkungen"
            value={bemerkungen}
            onChange={(e) => updateBemerkungen(e.target.value)}
            placeholder="Zusätzliche Notizen oder Bemerkungen..."
            rows={6}
          />
        </motion.div>

        {/* Signature Section */}
        {onSignatureSave && (
          <motion.div
            className="form-field full-width signature-section"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.25 }}
          >
            <label>
              Kundenunterschrift
            </label>
            {customerSignature ? (
              <div className="signature-preview">
                <img src={customerSignature} alt="Unterschrift" className="signature-image" />
                <div className="signature-info">
                  <span className="signature-signer">{signatureName}</span>
                  <span className="signature-date-label">{new Date().toLocaleDateString('de-DE')}</span>
                </div>
                <button
                  type="button"
                  className="signature-change-btn"
                  onClick={() => setSignatureModalOpen(true)}
                >
                  Unterschrift ändern
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="signature-add-btn"
                onClick={() => setSignatureModalOpen(true)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
                Unterschrift hinzufügen
              </button>
            )}
          </motion.div>
        )}

        <SignatureCanvas
          isOpen={signatureModalOpen}
          onCancel={() => setSignatureModalOpen(false)}
          onSave={(data, name) => {
            if (onSignatureSave) onSignatureSave(data, name);
            setSignatureModalOpen(false);
            toast.success('Unterschrift', 'Unterschrift wurde erfolgreich gespeichert.');
          }}
          title="Kundenunterschrift"
          signerNameLabel="Name des Kunden"
          initialName={`${kundeVorname || ''} ${kundeNachname || ''}`.trim()}
        />

        {/* Action Section */}
        <motion.div
          className="export-section"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          {/* Durum 1: Henüz kaydedilmedi */}
          {!isSaved && (
            <>
              <div className="export-info">
                <h3>Aufmaß speichern</h3>
                <p>
                  {isValid
                    ? 'Alle Daten wurden erfasst. Speichern Sie das Aufmaß, um fortzufahren.'
                    : 'Bitte laden Sie mindestens 2 Bilder hoch, um fortzufahren.'}
                </p>
              </div>
              <div className="action-buttons">
                <motion.button
                  className={`save-button primary ${!isValid || isSaving ? 'disabled' : ''}`}
                  onClick={handleSave}
                  disabled={!isValid || isSaving}
                  whileHover={isValid && !isSaving ? { scale: 1.02 } : {}}
                  whileTap={isValid && !isSaving ? { scale: 0.98 } : {}}
                >
                  {isSaving ? (
                    <span className="button-content-loading">
                      <span className="button-spinner"></span>
                      <span className="button-text">Wird gespeichert...</span>
                    </span>
                  ) : (
                    <span className="button-text">Aufmaß speichern</span>
                  )}
                </motion.button>
              </div>
            </>
          )}

          {/* Durum 2: Kaydedildi */}
          {isSaved && !pdfExported && (
            <>
              <div className="export-info success">
                <h3>Erfolgreich gespeichert!</h3>
                <p>Das Aufmaß wurde gespeichert. Möchten Sie eine E-Mail an den Kunden senden?</p>
              </div>
              <div className="action-buttons three-buttons">
                {onSendEmail && (
                  <motion.button
                    className="save-button primary"
                    onClick={onSendEmail}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <span className="button-text">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{ marginRight: 6, verticalAlign: 'middle' }}>
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                      E-Mail senden
                    </span>
                  </motion.button>
                )}
                <motion.button
                  className={`export-button ${isExporting ? 'disabled' : ''}`}
                  onClick={handleExport}
                  disabled={isExporting}
                  whileHover={!isExporting ? { scale: 1.02 } : {}}
                  whileTap={!isExporting ? { scale: 0.98 } : {}}
                >
                  <span className="button-text">
                    {isExporting ? 'PDF wird erstellt...' : 'PDF Exportieren'}
                  </span>
                </motion.button>
                <motion.button
                  className="new-form-button secondary"
                  onClick={onNewForm}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span className="button-text">Neues Aufmaß erstellen</span>
                </motion.button>
                <motion.button
                  className="back-button secondary"
                  onClick={() => window.location.href = '/'}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span className="button-text">Zur Übersicht</span>
                </motion.button>
              </div>
            </>
          )}

          {/* Durum 3: Hem kaydedildi hem PDF indirildi */}
          {isSaved && pdfExported && (
            <>
              <div className="export-info success">
                <h3>Alles erledigt!</h3>
                <p>Das Aufmaß wurde gespeichert und das PDF wurde exportiert.</p>
              </div>
              <div className="action-buttons">
                <motion.button
                  className="new-form-button"
                  onClick={onNewForm}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span className="button-text">Neues Aufmaß erstellen</span>
                </motion.button>
                <motion.button
                  className="back-button"
                  onClick={() => window.location.href = '/'}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span className="button-text">Zur Übersicht</span>
                </motion.button>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default FinalSection;
