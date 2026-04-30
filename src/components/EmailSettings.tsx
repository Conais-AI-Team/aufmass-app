import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getEmailSettings, saveEmailSettings, getMyEmailSettings, saveMyEmailSettings, testEmailConnection, getEmailLog, getEmailStatus } from '../services/api';
import type { SmtpSettings, UserSmtpSettings, EmailLogEntry, EmailStatus } from '../services/api';
import { useToast } from './Toast';
import { useAuth } from '../contexts/AuthContext';

interface EmailSettingsProps {
  onClose: () => void;
}

// SMTP presets
const presets: Record<string, { host: string; port: number; secure: boolean }> = {
  'Gmail': { host: 'smtp.gmail.com', port: 587, secure: false },
  'Outlook 365': { host: 'smtp.office365.com', port: 587, secure: false },
  'IONOS': { host: 'smtp.ionos.de', port: 587, secure: false },
  'Strato': { host: 'smtp.strato.de', port: 465, secure: true },
  'Hetzner': { host: 'mail.your-server.de', port: 587, secure: false },
};

// Returns true when the user has typed a host that matches none of the known presets
function isCustomHost(host: string): boolean {
  if (!host) return false;
  return !Object.values(presets).some((p) => p.host === host);
}

// Reusable SMTP form
function SmtpForm({ values, onChange, onTest, onSave, testing, saving, testResult, passwordPlaceholder }: {
  values: { smtp_host: string; smtp_port: number; smtp_user: string; smtp_pass: string; smtp_from_name: string; smtp_from_email: string; smtp_secure: boolean };
  onChange: (field: string, value: string | number | boolean) => void;
  onTest: () => void;
  onSave: () => void;
  testing: boolean;
  saving: boolean;
  testResult: { success: boolean; message: string } | null;
  passwordPlaceholder: string;
}) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <>
      {/* Quick presets */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Schnellauswahl
        </label>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {Object.entries(presets).map(([name, preset]) => (
            <button
              key={name}
              onClick={() => { onChange('smtp_host', preset.host); onChange('smtp_port', preset.port); onChange('smtp_secure', preset.secure); }}
              style={{
                padding: '4px 10px', fontSize: '12px', borderRadius: '4px', cursor: 'pointer',
                border: values.smtp_host === preset.host ? '1px solid var(--accent-green)' : '1px solid var(--border-primary)',
                background: values.smtp_host === preset.host ? 'var(--accent-green)' : 'var(--bg-secondary)',
                color: values.smtp_host === preset.host ? '#fff' : 'var(--text-secondary)'
              }}
            >
              {name}
            </button>
          ))}
          <button
            key="custom"
            onClick={() => { onChange('smtp_host', ''); onChange('smtp_port', 587); onChange('smtp_secure', false); }}
            title="Eigener SMTP-Server (z.B. mailbox.org, web.de oder eigenes Hosting)"
            style={{
              padding: '4px 10px', fontSize: '12px', borderRadius: '4px', cursor: 'pointer',
              border: isCustomHost(values.smtp_host) ? '1px solid var(--accent-green)' : '1px solid var(--border-primary)',
              background: isCustomHost(values.smtp_host) ? 'var(--accent-green)' : 'var(--bg-secondary)',
              color: isCustomHost(values.smtp_host) ? '#fff' : 'var(--text-secondary)'
            }}
          >
            Andere
          </button>
        </div>
        {isCustomHost(values.smtp_host) && (
          <div style={{ marginTop: '8px', padding: '8px 10px', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.25)', borderRadius: '6px', fontSize: '12px', color: '#60a5fa' }}>
            Eigener SMTP-Server: Host, Port und SSL/TLS bitte manuell konfigurieren.
          </div>
        )}
      </div>

      {/* Host + Port */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '12px', marginBottom: '12px' }}>
        <div>
          <label style={labelStyle}>SMTP Host *</label>
          <input type="text" value={values.smtp_host} onChange={(e) => onChange('smtp_host', e.target.value)} placeholder="smtp.gmail.com" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Port</label>
          <input type="number" value={values.smtp_port} onChange={(e) => onChange('smtp_port', Number(e.target.value))} style={inputStyle} />
        </div>
      </div>

      {/* User + Pass */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
        <div>
          <label style={labelStyle}>SMTP Benutzer *</label>
          <input type="text" value={values.smtp_user} onChange={(e) => onChange('smtp_user', e.target.value)} placeholder="info@firma.de" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>SMTP Passwort</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={values.smtp_pass}
              onChange={(e) => onChange('smtp_pass', e.target.value)}
              placeholder={passwordPlaceholder}
              style={{ ...inputStyle, paddingRight: '36px' }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '2px' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                {showPassword
                  ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></>
                  : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
                }
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* From name + From email */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
        <div>
          <label style={labelStyle}>Absendername</label>
          <input type="text" value={values.smtp_from_name} onChange={(e) => onChange('smtp_from_name', e.target.value)} placeholder="AYLUX Koblenz" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Absender-E-Mail</label>
          <input type="email" value={values.smtp_from_email} onChange={(e) => onChange('smtp_from_email', e.target.value)} placeholder="info@aylux.de" style={inputStyle} />
        </div>
      </div>

      {/* SSL toggle */}
      <div style={{ display: 'flex', gap: '24px', marginBottom: '20px', marginTop: '8px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={values.smtp_secure} onChange={(e) => onChange('smtp_secure', e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-green)' }} />
          SSL/TLS (Port 465)
        </label>
      </div>

      {/* Info */}
      <div style={{ padding: '12px 16px', borderRadius: '8px', marginBottom: '16px', background: 'rgba(127, 169, 61, 0.08)', border: '1px solid rgba(127, 169, 61, 0.2)' }}>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
          <strong>Gmail:</strong> App-Passwort unter myaccount.google.com/apppasswords erstellen.<br />
          <strong>Outlook 365:</strong> App-Passwort oder reguläres Passwort verwenden.<br />
          <strong>IONOS/Strato:</strong> E-Mail-Passwort aus dem Hosting-Panel verwenden.<br />
          <strong>Andere:</strong> SMTP-Daten Ihres Anbieters manuell eintragen — Standard ist Port 587 (STARTTLS); für Port 465 SSL/TLS aktivieren.
        </p>
      </div>

      {/* Test result */}
      {testResult && (
        <div style={{
          padding: '12px 16px', borderRadius: '8px', marginBottom: '16px',
          background: testResult.success ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          border: `1px solid ${testResult.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
        }}>
          <p style={{ margin: 0, fontSize: '13px', color: testResult.success ? '#10b981' : '#ef4444' }}>
            {testResult.success ? '✓ ' : '✗ '}{testResult.message}
          </p>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <button onClick={onTest} disabled={testing} style={{ ...btnSecondary, cursor: testing ? 'wait' : 'pointer' }}>
          {testing ? 'Teste...' : 'Verbindung testen'}
        </button>
        <button onClick={onSave} disabled={saving} style={{ ...btnPrimary, cursor: saving ? 'wait' : 'pointer' }}>
          {saving ? 'Speichern...' : 'Speichern'}
        </button>
      </div>
    </>
  );
}

// Shared styles
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box' };
const btnSecondary: React.CSSProperties = { padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 500 };
const btnPrimary: React.CSSProperties = { padding: '8px 20px', borderRadius: '6px', border: 'none', background: 'var(--accent-green)', color: '#fff', fontSize: '13px', fontWeight: 600 };

const EmailSettings = ({ onClose }: EmailSettingsProps) => {
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<'my' | 'branch' | 'log'>('my');
  const [loading, setLoading] = useState(true);

  // Status
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);

  // User settings
  const [mySettings, setMySettings] = useState({ smtp_host: '', smtp_port: 587, smtp_user: '', smtp_pass: '', smtp_from_name: '', smtp_from_email: '', smtp_secure: false, smtp_configured: false });
  const [mySaving, setMySaving] = useState(false);
  const [myTesting, setMyTesting] = useState(false);
  const [myTestResult, setMyTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Branch settings (admin only)
  const [branchSettings, setBranchSettings] = useState({ smtp_host: '', smtp_port: 587, smtp_user: '', smtp_pass: '', smtp_from_name: '', smtp_from_email: '', smtp_secure: false, smtp_enabled: false });
  const [branchSaving, setBranchSaving] = useState(false);
  const [branchTesting, setBranchTesting] = useState(false);
  const [branchTestResult, setBranchTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Log
  const [emailLog, setEmailLog] = useState<EmailLogEntry[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [myData, status] = await Promise.all([
        getMyEmailSettings(),
        getEmailStatus()
      ]);
      setMySettings(prev => ({ ...prev, ...myData, smtp_pass: '' }));
      setEmailStatus(status);

      if (isAdmin) {
        const branchData = await getEmailSettings();
        setBranchSettings(prev => ({ ...prev, ...branchData, smtp_pass: '' }));
      }
    } catch (err) {
      console.error('Error loading email data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveMy = async () => {
    if (!mySettings.smtp_host || !mySettings.smtp_user) {
      toast.warning('Fehlende Felder', 'SMTP Host und Benutzer sind erforderlich.');
      return;
    }
    setMySaving(true);
    try {
      await saveMyEmailSettings(mySettings as UserSmtpSettings & { smtp_pass?: string });
      toast.success('Gespeichert', 'Ihre E-Mail-Einstellungen wurden gespeichert.');
      setMySettings(prev => ({ ...prev, smtp_pass: '' }));
      const status = await getEmailStatus();
      setEmailStatus(status);
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setMySaving(false);
    }
  };

  const handleSaveBranch = async () => {
    if (!branchSettings.smtp_host || !branchSettings.smtp_user) {
      toast.warning('Fehlende Felder', 'SMTP Host und Benutzer sind erforderlich.');
      return;
    }
    setBranchSaving(true);
    try {
      await saveEmailSettings(branchSettings as SmtpSettings & { smtp_pass?: string });
      toast.success('Gespeichert', 'Filial-E-Mail-Einstellungen wurden gespeichert.');
      setBranchSettings(prev => ({ ...prev, smtp_pass: '' }));
      const status = await getEmailStatus();
      setEmailStatus(status);
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setBranchSaving(false);
    }
  };

  const handleTest = async (settings: { smtp_host: string; smtp_port: number; smtp_user: string; smtp_pass: string; smtp_from_email: string; smtp_secure: boolean }, target: 'my' | 'branch') => {
    if (!settings.smtp_host || !settings.smtp_user || !settings.smtp_pass) {
      toast.warning('Passwort erforderlich', 'Bitte geben Sie das SMTP-Passwort ein.');
      return;
    }
    const setTesting = target === 'my' ? setMyTesting : setBranchTesting;
    const setResult = target === 'my' ? setMyTestResult : setBranchTestResult;
    setTesting(true);
    setResult(null);
    try {
      const result = await testEmailConnection(settings);
      setResult({ success: true, message: result.message });
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : 'Test fehlgeschlagen' });
    } finally {
      setTesting(false);
    }
  };

  const handleTabChange = (tab: 'my' | 'branch' | 'log') => {
    setActiveTab(tab);
    if (tab === 'log') {
      getEmailLog().then(setEmailLog).catch(console.error);
    }
  };

  return (
    <motion.div
      className="modal-overlay-modern"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="admin-panel-modal"
        style={{ maxWidth: '640px' }}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-panel-header">
          <h2>E-Mail Einstellungen</h2>
          <button className="close-btn" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Status banner */}
        {emailStatus && (
          <div style={{
            padding: '10px 16px', borderRadius: '8px', marginBottom: '16px',
            background: emailStatus.configured ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
            border: `1px solid ${emailStatus.configured ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`
          }}>
            <p style={{ margin: 0, fontSize: '13px', color: emailStatus.configured ? '#10b981' : '#ef4444' }}>
              {emailStatus.configured
                ? `✓ E-Mail aktiv · ${emailStatus.from_email} (${emailStatus.source === 'user' ? 'Persönlich' : 'Filiale'})`
                : '✗ E-Mail nicht konfiguriert · Bitte SMTP-Daten eingeben'
              }
            </p>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border-primary)', marginBottom: '20px' }}>
          <button onClick={() => handleTabChange('my')} style={tabStyle(activeTab === 'my')}>
            Mein E-Mail
          </button>
          {isAdmin && (
            <button onClick={() => handleTabChange('branch')} style={tabStyle(activeTab === 'branch')}>
              Filial-E-Mail
            </button>
          )}
          {isAdmin && (
            <button onClick={() => handleTabChange('log')} style={tabStyle(activeTab === 'log')}>
              Protokoll
            </button>
          )}
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>Laden...</p>
        ) : (
          <>
            {/* MY SMTP TAB */}
            {activeTab === 'my' && (
              <div style={{ padding: '0 4px' }}>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: 0, marginBottom: '16px' }}>
                  Konfigurieren Sie Ihr persönliches E-Mail-Konto. E-Mails werden direkt von Ihrer Adresse versendet.
                </p>

                {/* Enable toggle for user */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: 'var(--text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={mySettings.smtp_configured}
                      onChange={(e) => setMySettings(prev => ({ ...prev, smtp_configured: e.target.checked }))}
                      style={{ width: '16px', height: '16px', accentColor: 'var(--accent-green)' }}
                    />
                    Persönliches E-Mail-Konto verwenden
                  </label>
                </div>

                {mySettings.smtp_configured && (
                  <SmtpForm
                    values={mySettings}
                    onChange={(field, value) => setMySettings(prev => ({ ...prev, [field]: value }))}
                    onTest={() => handleTest(mySettings, 'my')}
                    onSave={handleSaveMy}
                    testing={myTesting}
                    saving={mySaving}
                    testResult={myTestResult}
                    passwordPlaceholder="Neues Passwort eingeben"
                  />
                )}

                {!mySettings.smtp_configured && emailStatus?.configured && emailStatus.source === 'branch' && (
                  <div style={{ padding: '16px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', marginTop: '8px' }}>
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                      E-Mails werden über das Filial-Konto versendet: <strong>{emailStatus.from_email}</strong>
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* BRANCH SMTP TAB (admin only) */}
            {activeTab === 'branch' && isAdmin && (
              <div style={{ padding: '0 4px' }}>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: 0, marginBottom: '16px' }}>
                  Standard-E-Mail für alle Benutzer dieser Filiale. Wird verwendet, wenn ein Benutzer kein eigenes Konto eingerichtet hat.
                </p>

                {/* Enable toggle for branch */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: 'var(--text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={branchSettings.smtp_enabled}
                      onChange={(e) => setBranchSettings(prev => ({ ...prev, smtp_enabled: e.target.checked }))}
                      style={{ width: '16px', height: '16px', accentColor: 'var(--accent-green)' }}
                    />
                    Filial-E-Mail aktivieren
                  </label>
                </div>

                {branchSettings.smtp_enabled && (
                  <SmtpForm
                    values={branchSettings}
                    onChange={(field, value) => setBranchSettings(prev => ({ ...prev, [field]: value }))}
                    onTest={() => handleTest(branchSettings, 'branch')}
                    onSave={handleSaveBranch}
                    testing={branchTesting}
                    saving={branchSaving}
                    testResult={branchTestResult}
                    passwordPlaceholder="Neues Passwort eingeben"
                  />
                )}
              </div>
            )}

            {/* LOG TAB */}
            {activeTab === 'log' && (
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {emailLog.length === 0 ? (
                  <p style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: '40px 0', fontSize: '14px' }}>
                    Noch keine E-Mails versendet.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {emailLog.map((entry) => (
                      <div key={entry.id} style={{ padding: '10px 14px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <span style={{
                            fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px',
                            color: entry.status === 'sent' ? '#10b981' : '#ef4444',
                            padding: '2px 6px', borderRadius: '4px',
                            background: entry.status === 'sent' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'
                          }}>
                            {entry.status === 'sent' ? '✓ Gesendet' : '✗ Fehlgeschlagen'}
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                            {new Date(entry.sent_at).toLocaleString('de-DE')}
                          </span>
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>{entry.subject}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          An: {entry.recipient_email}
                          {entry.sent_by_name && <span> · von {entry.sent_by_name}</span>}
                          {entry.email_type && <span> · {entry.email_type}</span>}
                        </div>
                        {entry.error_message && (
                          <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>{entry.error_message}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  );
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '10px 20px', border: 'none', cursor: 'pointer',
    background: active ? 'var(--bg-secondary)' : 'transparent',
    color: active ? 'var(--accent-green)' : 'var(--text-secondary)',
    borderBottom: active ? '2px solid var(--accent-green)' : '2px solid transparent',
    fontWeight: active ? 600 : 400, fontSize: '14px'
  };
}

export default EmailSettings;
