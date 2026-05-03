import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getBranchCompanyInfo, saveBranchCompanyInfo } from '../services/api';
import type { BranchCompanyInfo } from '../services/api';
import { invalidateCompanyInfoCache } from '../utils/companyInfoCache';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';

// IMPORTANT: Field component MUST be outside Firmenangaben to prevent
// React from unmounting/remounting on every state change (which loses focus).
function FaField({
  label, field, required, placeholder, value, error, onChange, disabled
}: {
  label: string;
  field: keyof BranchCompanyInfo;
  required?: boolean;
  placeholder?: string;
  value: string;
  error?: string;
  onChange: (field: keyof BranchCompanyInfo, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="fa-field">
      <label>
        {label}{required && <span className="fa-required">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(field, e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={error ? 'fa-input fa-input-error' : 'fa-input'}
      />
      {error && <span className="fa-error-text">{error}</span>}
    </div>
  );
}

const emptyInfo: BranchCompanyInfo = {
  company_name: '',
  company_strasse: '',
  company_plz: '',
  company_ort: '',
  company_telefon: '',
  company_email: '',
  company_ust_id: '',
  company_web: '',
  company_steuernr: '',
  company_iban: '',
  company_bic: '',
  company_bank_name: '',
  company_geschaeftsfuehrer: '',
  company_handelsregister: ''
};

export default function Firmenangaben() {
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [info, setInfo] = useState<BranchCompanyInfo>(emptyInfo);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof BranchCompanyInfo, string>>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getBranchCompanyInfo();
        if (!cancelled) setInfo({ ...emptyInfo, ...data });
      } catch (err) {
        console.error('Error loading company info:', err);
        toast.error('Fehler', 'Firmenangaben konnten nicht geladen werden.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = (field: keyof BranchCompanyInfo, value: string) => {
    setInfo(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const validate = (): boolean => {
    const e: Partial<Record<keyof BranchCompanyInfo, string>> = {};
    if (!info.company_name) e.company_name = 'Pflichtfeld';
    if (!info.company_strasse) e.company_strasse = 'Pflichtfeld';
    if (!info.company_plz) e.company_plz = 'Pflichtfeld';
    else if (!/^\d{5}$/.test(info.company_plz)) e.company_plz = '5 Ziffern erforderlich';
    if (!info.company_ort) e.company_ort = 'Pflichtfeld';
    if (!info.company_telefon) e.company_telefon = 'Pflichtfeld';
    if (!info.company_email) e.company_email = 'Pflichtfeld';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.company_email)) e.company_email = 'Ungültige E-Mail';
    if (!info.company_ust_id) e.company_ust_id = 'Pflichtfeld';
    else if (!/^DE\d{9}$/.test(info.company_ust_id.replace(/\s/g, ''))) e.company_ust_id = 'Format: DE + 9 Ziffern';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      toast.warning('Pflichtfelder fehlen', 'Bitte überprüfen Sie die markierten Felder.');
      return;
    }
    setSaving(true);
    try {
      await saveBranchCompanyInfo(info);
      invalidateCompanyInfoCache();
      toast.success('Gespeichert', 'Neue PDFs verwenden diese Angaben.');
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fa-page">
        <div className="fa-loading">Wird geladen...</div>
      </div>
    );
  }

  return (
    <motion.div
      className="fa-page"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <style>{`
        .fa-page {
          padding: 18px 24px;
          max-width: 1500px;
          margin: 0 auto;
          color: var(--text-primary);
        }
        .fa-loading {
          padding: 60px;
          text-align: center;
          color: var(--text-secondary);
          font-size: 15px;
        }
        .fa-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 14px;
          gap: 16px;
          flex-wrap: wrap;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border-color);
          flex-shrink: 0;
        }
        .fa-header-text h1 {
          font-size: 22px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0 0 3px 0;
          letter-spacing: -0.3px;
        }
        .fa-header-text p {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0;
        }
        .fa-save-btn {
          padding: 9px 22px;
          font-size: 13px;
          font-weight: 600;
          border-radius: 8px;
          cursor: pointer;
          border: none;
          background: var(--primary-color);
          color: #fff;
          letter-spacing: 0.2px;
          box-shadow: 0 2px 6px rgba(127, 169, 61, 0.25);
          transition: all 0.15s;
          display: flex;
          align-items: center;
          gap: 7px;
        }
        .fa-save-btn:hover:not(:disabled) {
          background: var(--primary-hover);
          transform: translateY(-1px);
        }
        .fa-save-btn:active:not(:disabled) {
          transform: translateY(0);
        }
        .fa-save-btn:disabled {
          opacity: 0.6;
          cursor: wait;
        }
        .fa-grid {
          display: grid;
          grid-template-columns: 1.3fr 1fr;
          gap: 14px;
          align-items: start;
        }
        .fa-col-right {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        @media (max-width: 900px) {
          .fa-grid {
            grid-template-columns: 1fr;
          }
          .fa-page {
            padding: 14px;
          }
        }
        .fa-section {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 14px 16px;
          transition: border-color 0.15s;
        }
        .fa-section:hover {
          border-color: rgba(127, 169, 61, 0.35);
        }
        .fa-section-header {
          display: flex;
          align-items: center;
          gap: 9px;
          margin-bottom: 12px;
          padding-bottom: 9px;
          border-bottom: 1px solid var(--border-color);
        }
        .fa-section-icon {
          width: 26px;
          height: 26px;
          border-radius: 6px;
          background: rgba(127, 169, 61, 0.12);
          color: var(--primary-color);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .fa-section-icon svg {
          width: 14px;
          height: 14px;
        }
        .fa-section-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: 0.1px;
          margin: 0;
        }
        .fa-section-tag {
          margin-left: auto;
          font-size: 10px;
          font-weight: 600;
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .fa-section-body {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .fa-row-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .fa-row-plz {
          display: grid;
          grid-template-columns: 0.55fr 1fr;
          gap: 10px;
        }
        .fa-field {
          margin: 0;
        }
        .fa-field label {
          display: block;
          font-size: 10.5px;
          color: var(--text-secondary);
          margin-bottom: 4px;
          font-weight: 600;
          letter-spacing: 0.3px;
          text-transform: uppercase;
        }
        .fa-required {
          color: var(--error-color);
          margin-left: 3px;
          font-weight: 700;
        }
        .fa-input {
          width: 100%;
          padding: 8px 11px;
          font-size: 13px;
          font-weight: 500;
          background: var(--bg-primary);
          border: 1.5px solid var(--border-color);
          border-radius: 7px;
          color: var(--text-primary);
          outline: none;
          transition: all 0.15s;
          box-sizing: border-box;
          font-family: inherit;
        }
        .fa-input:hover {
          border-color: var(--text-tertiary);
        }
        .fa-input:focus {
          border-color: var(--primary-color);
          box-shadow: 0 0 0 3px rgba(127, 169, 61, 0.15);
        }
        .fa-input-error {
          border-color: var(--error-color);
        }
        .fa-input-error:focus {
          box-shadow: 0 0 0 3px rgba(248, 81, 73, 0.15);
        }
        .fa-input::placeholder {
          color: rgba(139, 148, 158, 0.7);
          font-weight: 400;
        }
        .light-theme .fa-input::placeholder {
          color: rgba(101, 109, 118, 0.55);
        }
        .fa-error-text {
          display: block;
          font-size: 10.5px;
          color: var(--error-color);
          margin-top: 3px;
          font-weight: 500;
        }
        /* Read-only banner (non-admin users) */
        .fa-readonly-banner {
          display: flex;
          align-items: center;
          gap: 9px;
          margin-bottom: 14px;
          padding: 10px 14px;
          background: rgba(210, 153, 34, 0.1);
          border: 1px solid rgba(210, 153, 34, 0.3);
          border-radius: 10px;
          font-size: 13px;
          color: var(--warning-color);
          font-weight: 500;
        }
        .fa-readonly-banner svg {
          flex-shrink: 0;
        }
        /* Disabled inputs for non-admin */
        .fa-input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          background: var(--bg-secondary);
        }
        /* Summary box */
        .fa-summary {
          margin-top: 16px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 14px 18px;
        }
        .fa-summary-top {
          margin-top: 0;
          margin-bottom: 14px;
          background: linear-gradient(135deg, rgba(127, 169, 61, 0.05) 0%, var(--bg-secondary) 100%);
          border-color: rgba(127, 169, 61, 0.25);
        }
        .fa-summary-head {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--border-color);
        }
        .fa-summary-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .fa-summary-progress {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
        }
        .fa-summary-progress-bar {
          width: 120px;
          height: 6px;
          background: var(--bg-primary);
          border-radius: 3px;
          overflow: hidden;
        }
        .fa-summary-progress-fill {
          height: 100%;
          background: var(--primary-color);
          transition: width 0.25s ease;
        }
        .fa-summary-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 6px 24px;
        }
        @media (max-width: 768px) {
          .fa-summary-grid {
            grid-template-columns: 1fr;
          }
        }
        .fa-summary-row {
          display: flex;
          align-items: center;
          gap: 9px;
          font-size: 13px;
          padding: 4px 0;
        }
        .fa-summary-icon {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 700;
        }
        .fa-summary-icon-ok {
          background: rgba(127, 169, 61, 0.18);
          color: var(--primary-color);
        }
        .fa-summary-icon-empty {
          background: rgba(248, 81, 73, 0.15);
          color: var(--error-color);
        }
        .fa-summary-icon-opt {
          background: var(--bg-tertiary);
          color: var(--text-tertiary);
        }
        .fa-summary-label {
          color: var(--text-secondary);
          font-weight: 600;
          min-width: 110px;
        }
        .fa-summary-value {
          color: var(--text-primary);
          font-weight: 500;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fa-summary-value-empty {
          color: var(--error-color);
          font-style: italic;
          font-weight: 400;
        }
        .fa-summary-value-opt {
          color: var(--text-tertiary);
          font-style: italic;
          font-weight: 400;
        }
      `}</style>

      <div className="fa-header">
        <div className="fa-header-text">
          <h1>Firmenangaben</h1>
          <p>Diese Angaben erscheinen automatisch auf allen PDFs Ihrer Filiale (Aufmaß, Angebot, Abnahme, Rechnung).</p>
        </div>
        {isAdmin && (
          <button onClick={handleSave} disabled={saving} className="fa-save-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" width="16" height="16">
              <path d="M5 13l4 4L19 7" />
            </svg>
            {saving ? 'Speichert...' : 'Speichern'}
          </button>
        )}
      </div>

      {/* SUMMARY first — overview at top */}
      {(() => {
        const requiredFields = [
          { label: 'Firmenname', value: info.company_name },
          { label: 'Adresse', value: [info.company_strasse, `${info.company_plz} ${info.company_ort}`.trim()].filter(Boolean).join(', ') },
          { label: 'Telefon', value: info.company_telefon },
          { label: 'E-Mail', value: info.company_email },
          { label: 'USt-IdNr.', value: info.company_ust_id }
        ];
        const optionalFields = [
          { label: 'Web', value: info.company_web },
          { label: 'Steuernummer', value: info.company_steuernr },
          { label: 'Bank', value: [info.company_bank_name, info.company_iban, info.company_bic].filter(Boolean).join(' · ') },
          { label: 'Geschäftsführer', value: info.company_geschaeftsfuehrer },
          { label: 'Handelsregister', value: info.company_handelsregister }
        ];
        const filledRequired = requiredFields.filter(f => f.value).length;
        const filledOptional = optionalFields.filter(f => f.value).length;
        const totalFilled = filledRequired + filledOptional;
        const total = requiredFields.length + optionalFields.length;
        const percent = Math.round((totalFilled / total) * 100);

        return (
          <div className="fa-summary fa-summary-top">
            <div className="fa-summary-head">
              <div className="fa-section-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                </svg>
              </div>
              <span className="fa-summary-title">
                Übersicht — {filledRequired}/{requiredFields.length} Pflichtfelder, {filledOptional}/{optionalFields.length} optional
              </span>
              <div className="fa-summary-progress">
                <div className="fa-summary-progress-bar">
                  <div className="fa-summary-progress-fill" style={{ width: `${percent}%` }} />
                </div>
                <span>{percent}%</span>
              </div>
            </div>

            <div className="fa-summary-grid">
              {requiredFields.map((f) => (
                <div key={f.label} className="fa-summary-row">
                  <div className={`fa-summary-icon ${f.value ? 'fa-summary-icon-ok' : 'fa-summary-icon-empty'}`}>
                    {f.value ? '✓' : '!'}
                  </div>
                  <span className="fa-summary-label">{f.label}:</span>
                  <span className={`fa-summary-value ${!f.value ? 'fa-summary-value-empty' : ''}`}>
                    {f.value || 'fehlt'}
                  </span>
                </div>
              ))}
              {optionalFields.map((f) => (
                <div key={f.label} className="fa-summary-row">
                  <div className={`fa-summary-icon ${f.value ? 'fa-summary-icon-ok' : 'fa-summary-icon-opt'}`}>
                    {f.value ? '✓' : '–'}
                  </div>
                  <span className="fa-summary-label">{f.label}:</span>
                  <span className={`fa-summary-value ${!f.value ? 'fa-summary-value-opt' : ''}`}>
                    {f.value || 'leer'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Read-only banner for non-admins */}
      {!isAdmin && (
        <div className="fa-readonly-banner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          <span>Nur Lesemodus — diese Angaben können nur von einem Administrator bearbeitet werden.</span>
        </div>
      )}

      {/* FORM at bottom — Left: Firmenangaben | Right: 3 sections stacked */}
      <div className="fa-grid fa-grid-bottom">
        <section className="fa-section">
          <div className="fa-section-header">
            <div className="fa-section-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />
                <path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01" />
              </svg>
            </div>
            <h2 className="fa-section-title">Firmenangaben</h2>
          </div>
          <div className="fa-section-body">
            <FaField label="Firmenname" field="company_name" required placeholder="AYLUX Berlin GmbH" value={info.company_name} error={errors.company_name} onChange={update} disabled={!isAdmin} />
            <FaField label="Strasse + Hausnr." field="company_strasse" required placeholder="Musterstraße 1" value={info.company_strasse} error={errors.company_strasse} onChange={update} disabled={!isAdmin} />
            <div className="fa-row-plz">
              <FaField label="PLZ" field="company_plz" required placeholder="12345" value={info.company_plz} error={errors.company_plz} onChange={update} disabled={!isAdmin} />
              <FaField label="Ort" field="company_ort" required placeholder="Berlin" value={info.company_ort} error={errors.company_ort} onChange={update} disabled={!isAdmin} />
            </div>
            <div className="fa-row-2">
              <FaField label="Telefon" field="company_telefon" required placeholder="+49 30 12345678" value={info.company_telefon} error={errors.company_telefon} onChange={update} disabled={!isAdmin} />
              <FaField label="E-Mail" field="company_email" required placeholder="info@beispiel.de" value={info.company_email} error={errors.company_email} onChange={update} disabled={!isAdmin} />
            </div>
            <FaField label="Web" field="company_web" placeholder="https://www.beispiel.de" value={info.company_web} onChange={update} disabled={!isAdmin} />
          </div>
        </section>

        <div className="fa-col-right">
          <section className="fa-section">
            <div className="fa-section-header">
              <div className="fa-section-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="6" width="18" height="13" rx="2" />
                  <path d="M3 10h18M7 15h4" />
                </svg>
              </div>
              <h2 className="fa-section-title">Steuer</h2>
            </div>
            <div className="fa-section-body">
              <div className="fa-row-2">
                <FaField label="USt-IdNr." field="company_ust_id" required placeholder="DE123456789" value={info.company_ust_id} error={errors.company_ust_id} onChange={update} disabled={!isAdmin} />
                <FaField label="Steuernummer" field="company_steuernr" placeholder="12/345/67890" value={info.company_steuernr} onChange={update} disabled={!isAdmin} />
              </div>
            </div>
          </section>

          <section className="fa-section">
            <div className="fa-section-header">
              <div className="fa-section-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 21h18M3 10l9-7 9 7M5 21V10M19 21V10M9 21v-7h6v7" />
                </svg>
              </div>
              <h2 className="fa-section-title">Bankverbindung</h2>
              <span className="fa-section-tag">optional</span>
            </div>
            <div className="fa-section-body">
              <FaField label="Bank" field="company_bank_name" placeholder="Deutsche Bank" value={info.company_bank_name} onChange={update} disabled={!isAdmin} />
              <div className="fa-row-2">
                <FaField label="IBAN" field="company_iban" placeholder="DE89 3704 0044 0532 0130 00" value={info.company_iban} onChange={update} disabled={!isAdmin} />
                <FaField label="BIC" field="company_bic" placeholder="COBADEFFXXX" value={info.company_bic} onChange={update} disabled={!isAdmin} />
              </div>
            </div>
          </section>

          <section className="fa-section">
            <div className="fa-section-header">
              <div className="fa-section-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                </svg>
              </div>
              <h2 className="fa-section-title">Vertretung</h2>
              <span className="fa-section-tag">optional</span>
            </div>
            <div className="fa-section-body">
              <div className="fa-row-2">
                <FaField label="Geschäftsführer" field="company_geschaeftsfuehrer" placeholder="Max Mustermann" value={info.company_geschaeftsfuehrer} onChange={update} disabled={!isAdmin} />
                <FaField label="Handelsregister" field="company_handelsregister" placeholder="HRB 12345 Berlin" value={info.company_handelsregister} onChange={update} disabled={!isAdmin} />
              </div>
            </div>
          </section>
        </div>
      </div>

    </motion.div>
  );
}
