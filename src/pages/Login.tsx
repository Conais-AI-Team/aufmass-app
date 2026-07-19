import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Login.css';

const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-visual" aria-hidden="true">
        <div className="login-visual-panel">
          <span>Aufmaß System</span>
          <strong>Digital. Klar. Filialfähig.</strong>
        </div>
      </section>

      <main className="login-container">
        <div className="login-header">
          <div className="login-logo">
            <img src="/aylux-sidebar-logo.png" alt="AYLUX Sonnenschutzsysteme" />
          </div>
          <h1>Willkommen zurück</h1>
          <p>Melden Sie sich an, um fortzufahren</p>
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ihre@email.de"
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Passwort</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Ihr Passwort"
              required
              autoComplete="current-password"
            />
          </div>

          <button type="submit" className="login-button" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner"></span>
                Anmeldung...
              </>
            ) : (
              'Anmelden'
            )}
          </button>
        </form>

        <div className="login-footer">
          <p>Haben Sie noch keinen Zugang?</p>
          <p className="contact-admin">Kontaktieren Sie Ihren Administrator</p>
        </div>

        <div className="login-powered">
          <span>Powered by</span>
          <a href="https://conais.com" target="_blank" rel="noopener noreferrer" aria-label="Powered by Conais">
            <img src="https://conais.com/wp-content/uploads/2025/10/Conais-new-Logo.png" alt="Conais" />
          </a>
        </div>
      </main>
    </div>
  );
};

export default Login;
