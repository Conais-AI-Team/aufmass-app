import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { verifyInvitation, register } from '../services/api';
import './Login.css';

const Register = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [invitation, setInvitation] = useState<{ email: string; role: string } | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const checkInvitation = async () => {
      if (!token) {
        setError('Kein Einladungstoken vorhanden');
        setLoading(false);
        return;
      }

      try {
        const invite = await verifyInvitation(token);
        setInvitation(invite);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ungültige oder abgelaufene Einladung');
      } finally {
        setLoading(false);
      }
    };

    checkInvitation();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwörter stimmen nicht überein');
      return;
    }

    if (password.length < 6) {
      setError('Passwort muss mindestens 6 Zeichen lang sein');
      return;
    }

    setSubmitting(true);

    try {
      await register(token!, name, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registrierung fehlgeschlagen');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-header">
            <div className="login-logo">
              <img src="/aylux-sidebar-logo.png" alt="AYLUX Sonnenschutzsysteme" />
              <div className="logo-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '2rem' }}>
              <span className="spinner" style={{ width: '32px', height: '32px', border: '3px solid var(--border-color)', borderTopColor: 'var(--primary-color)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></span>
            </div>
            <p style={{ marginTop: '1rem' }}>Einladung wird überprüft...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!invitation) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-header">
            <div className="login-logo">
              <img src="/aylux-sidebar-logo.png" alt="AYLUX Sonnenschutzsysteme" />
              <div className="logo-icon" style={{ background: 'rgba(239, 68, 68, 0.2)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
            </div>
            <h1 style={{ color: '#ef4444' }}>Ungültige Einladung</h1>
            <p>{error}</p>
          </div>
          <button
            onClick={() => navigate('/login')}
            className="login-button"
            style={{ marginTop: '1.5rem' }}
          >
            Zur Anmeldung
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-header">
          <div className="login-logo">
            <img src="/aylux-sidebar-logo.png" alt="AYLUX Sonnenschutzsysteme" />
            <div className="logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <div className="logo-text">
              <span className="logo-name">AYLUX</span>
              <span className="logo-tagline">Aufmaß System</span>
            </div>
          </div>
          <h1>Konto erstellen</h1>
          <p>Sie wurden eingeladen als <strong>{invitation.role === 'admin' ? 'Administrator' : invitation.role === 'office' ? 'Office' : 'Benutzer'}</strong></p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="login-error">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">E-Mail</label>
            <input
              type="email"
              id="email"
              value={invitation.email}
              disabled
              style={{ opacity: 0.7, cursor: 'not-allowed' }}
            />
          </div>

          <div className="form-group">
            <label htmlFor="name">Name</label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ihr vollständiger Name"
              required
              autoComplete="name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Passwort</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mindestens 6 Zeichen"
              required
              autoComplete="new-password"
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Passwort bestätigen</label>
            <input
              type="password"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Passwort wiederholen"
              required
              autoComplete="new-password"
            />
          </div>

          <button type="submit" className="login-button" disabled={submitting}>
            {submitting ? (
              <>
                <span className="spinner"></span>
                Registrierung...
              </>
            ) : (
              'Konto erstellen'
            )}
          </button>
        </form>

        <div className="login-footer">
          <p>Haben Sie bereits ein Konto?</p>
          <button
            onClick={() => navigate('/login')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--primary-color)',
              cursor: 'pointer',
              fontSize: '0.875rem',
              marginTop: '0.25rem'
            }}
          >
            Zur Anmeldung
          </button>
        </div>
      </div>
    </div>
  );
};

export default Register;
