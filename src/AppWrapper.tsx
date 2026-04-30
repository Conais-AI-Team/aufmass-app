import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import DashboardStats from './pages/DashboardStats';
import Dashboard from './pages/Dashboard';
import Angebote from './pages/Angebote';
import FormPage from './pages/FormPage';
import Montageteam from './pages/Montageteam';
import Login from './pages/Login';
import Register from './pages/Register';
import AbnahmeSignPage from './pages/AbnahmeSignPage';
import EsignatureAdmin from './components/EsignatureAdmin';
import EmailSettings from './components/EmailSettings';
import Firmenangaben from './pages/Firmenangaben';
import Agb from './pages/Agb';
import ProductPricing from './pages/ProductPricing';
import BranchUebersicht from './pages/BranchUebersicht';
import { isAdminBranch } from './hooks/useBranchMeta';
import { getStats, getUsers, getInvitations, createInvitation, deleteInvitation, deleteUser, updateUser } from './services/api';
import type { Stats, User, Invitation } from './services/api';
import { AnimatePresence, motion } from 'framer-motion';
import { useToast } from './components/Toast';
import './pages/Dashboard.css';

// Stats Context
interface StatsContextType {
  stats: Stats;
  refreshStats: () => void;
}

const StatsContext = createContext<StatsContextType>({ stats: { total: 0, completed: 0, draft: 0 }, refreshStats: () => {} });
export const useStats = () => useContext(StatsContext);

// Admin Panel Context
interface AdminPanelContextType {
  openAdminPanel: () => void;
  openEsignatureAdmin: () => void;
  openEmailSettings: () => void;
}

const AdminPanelContext = createContext<AdminPanelContextType>({ openAdminPanel: () => {}, openEsignatureAdmin: () => {}, openEmailSettings: () => {} });
export const useAdminPanel = () => useContext(AdminPanelContext);

function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, isAdmin } = useAuth();
  const { openAdminPanel, openEmailSettings } = useAdminPanel();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  const toggleTheme = useCallback(() => {
    setIsDarkMode(prev => !prev);
  }, []);

  const isActive = (path: string) => location.pathname === path;

  const handleNavClick = (path: string) => {
    navigate(path);
    setMobileMenuOpen(false);
  };

  return (
    <div className="dashboard">
      {/* Mobile Header */}
      <header className="mobile-header">
        <button className="hamburger-btn" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {mobileMenuOpen ? (
              <path d="M18 6L6 18M6 6l12 12" />
            ) : (
              <>
                <path d="M3 12h18M3 6h18M3 18h18" />
              </>
            )}
          </svg>
        </button>
        <div className="mobile-logo">
          <span className="logo-name">AYLUX</span>
          <span className="logo-tagline">Aufmaß</span>
        </div>
        <button className="mobile-new-btn" onClick={() => handleNavClick('/form/new')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="mobile-menu-overlay" onClick={() => setMobileMenuOpen(false)} />
      )}

      <aside className={`dashboard-sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
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
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">
            <span className="nav-section-title">Hauptmenü</span>
            <a href="#" className={`nav-item ${isActive('/') ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); handleNavClick('/'); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="9" rx="2" />
                <rect x="14" y="3" width="7" height="5" rx="2" />
                <rect x="14" y="12" width="7" height="9" rx="2" />
                <rect x="3" y="16" width="7" height="5" rx="2" />
              </svg>
              <span>Dashboard</span>
            </a>
            <a href="#" className={`nav-item ${isActive('/angebote') ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); handleNavClick('/angebote'); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              <span>Angebote</span>
            </a>
            <a href="#" className={`nav-item ${isActive('/aufmasse') ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); handleNavClick('/aufmasse'); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              <span>Aufmaße</span>
            </a>
          </div>

          <div className="nav-section">
            <span className="nav-section-title">Aufträge</span>
            <a href="#" className="nav-item" onClick={(e) => { e.preventDefault(); handleNavClick('/form/new'); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>Neues Aufmaß</span>
            </a>
            <a href="#" className="nav-item" onClick={(e) => { e.preventDefault(); handleNavClick('/angebot/new'); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              <span>Neues Angebot</span>
            </a>
          </div>

          <div className="nav-section">
            <span className="nav-section-title">Firma</span>
            <a href="#" className={`nav-item ${isActive('/firmenangaben') ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); handleNavClick('/firmenangaben'); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />
                <path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01" />
              </svg>
              <span>Firmenangaben</span>
            </a>
            <a href="#" className={`nav-item ${isActive('/agb') ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); handleNavClick('/agb'); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              <span>AGB</span>
            </a>
          </div>

          <div className="nav-section">
            <span className="nav-section-title">Teams</span>
            <a href="#" className={`nav-item ${isActive('/montageteam') ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); handleNavClick('/montageteam'); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87" />
                <path d="M16 3.13a4 4 0 010 7.75" />
              </svg>
              <span>Montageteams</span>
            </a>
          </div>

          {(user?.role === 'admin' || user?.role === 'office') && (
            <div className="nav-section">
              <span className="nav-section-title">Administration</span>
              <a href="#" className={`nav-item ${isActive('/produkte') ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); handleNavClick('/produkte'); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <span>Produkte & Preise</span>
              </a>
              <a href="#" className="nav-item" onClick={(e) => { e.preventDefault(); openEmailSettings(); setMobileMenuOpen(false); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                <span>E-Mail Einstellungen</span>
              </a>
              {isAdminBranch() && (
                <a href="#" className={`nav-item ${isActive('/filialen') ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); handleNavClick('/filialen'); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                  <span>Filialübersicht</span>
                </a>
              )}
              {isAdmin && (
                <a href="#" className="nav-item" onClick={(e) => { e.preventDefault(); openAdminPanel(); setMobileMenuOpen(false); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 00-3-3.87" />
                    <path d="M16 3.13a4 4 0 010 7.75" />
                  </svg>
                  <span>Benutzer verwalten</span>
                </a>
              )}
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="powered-by-sidebar">
            <span>Powered by</span>
            <a href="https://conais.com" target="_blank" rel="noopener noreferrer">
              <img src="https://conais.in/dev/wp-content/uploads/2020/10/logo2.png" alt="Conais" className="conais-logo conais-logo-dark" />
              <img src="https://conais.com/wp-content/uploads/2025/10/Conais-new-Logo.png" alt="Conais" className="conais-logo conais-logo-light" />
            </a>
          </div>
          <div className="sidebar-user">
            <div className="user-avatar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <div className="user-info">
              <span className="user-name">{user?.name || 'Benutzer'}</span>
              <span className="user-role">{user?.role === 'admin' ? 'Administrator' : user?.role === 'office' ? 'Office' : 'Benutzer'}</span>
            </div>
            <button
              className="theme-toggle-sidebar"
              onClick={toggleTheme}
              title={isDarkMode ? 'Light Mode' : 'Dark Mode'}
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
            <button
              className="logout-btn"
              onClick={() => { logout(); navigate('/login'); }}
              title="Abmelden"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <main className="dashboard-content">
        {children}
      </main>
    </div>
  );
}

function ProtectedContent() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const [stats, setStats] = useState<Stats>({ total: 0, completed: 0, draft: 0 });
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showEsignatureAdmin, setShowEsignatureAdmin] = useState(false);
  const [showEmailSettings, setShowEmailSettings] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'user' | 'office' | 'admin'>('user');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string>(''); // Store the email after success

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const data = await getStats();
      setStats(data);
    } catch (err) {
      console.error('Error loading stats:', err);
    }
  };

  const loadAdminData = async () => {
    if (!isAdmin) return;
    try {
      const [usersData, invitesData] = await Promise.all([getUsers(), getInvitations()]);
      setUsers(usersData);
      setInvitations(invitesData);
    } catch (err) {
      console.error('Error loading admin data:', err);
    }
  };

  const openAdminPanel = () => {
    setShowAdminPanel(true);
    loadAdminData();
  };

  const openEsignatureAdmin = () => {
    setShowEsignatureAdmin(true);
  };

  const openEmailSettings = () => {
    setShowEmailSettings(true);
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviteLoading(true);
    setInviteSuccess(null);
    const emailToInvite = inviteEmail; // Store before clearing
    try {
      const result = await createInvitation(inviteEmail, inviteRole);
      setInviteSuccess(`${window.location.origin}${result.inviteLink}`);
      setInvitedEmail(emailToInvite); // Save for mailto
      setInviteEmail('');
      loadAdminData();
    } catch (err) {
      toast.error('Fehler', err instanceof Error ? err.message : 'Einladung konnte nicht erstellt werden.');
    } finally {
      setInviteLoading(false);
    }
  };

  return (
    <StatsContext.Provider value={{ stats, refreshStats: loadStats }}>
      <AdminPanelContext.Provider value={{ openAdminPanel, openEsignatureAdmin, openEmailSettings }}>
        <Routes>
          {/* Form sayfası sidebar olmadan */}
          <Route path="/form/:id" element={<FormPage />} />

          {/* Diğer sayfalar Layout içinde (sidebar ile) */}
          <Route path="/*" element={
            <Layout>
              <Routes>
                <Route path="/" element={<DashboardStats />} />
                <Route path="/aufmasse" element={<Dashboard />} />
                <Route path="/angebote" element={<Angebote />} />
                <Route path="/angebot/new" element={<Angebote />} />
                <Route path="/montageteam" element={<Montageteam />} />
                <Route path="/produkte" element={<ProductPricing />} />
                <Route path="/firmenangaben" element={<Firmenangaben />} />
                <Route path="/agb" element={<Agb />} />
                <Route path="/filialen" element={isAdminBranch() ? <BranchUebersicht /> : <Navigate to="/" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          } />
        </Routes>

        {/* Admin Panel Modal */}
        <AnimatePresence>
          {showAdminPanel && (
            <motion.div
              className="modal-overlay-modern"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAdminPanel(false)}
            >
              <motion.div
                className="admin-panel-modal"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="admin-panel-header">
                  <h2>Benutzerverwaltung</h2>
                  <button className="close-btn" onClick={() => setShowAdminPanel(false)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="admin-section">
                  <h3>Neuen Benutzer einladen</h3>
                  <form onSubmit={handleInviteUser} className="invite-form">
                    <input type="email" placeholder="E-Mail-Adresse" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
                    <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'user' | 'office' | 'admin')}>
                      <option value="user">Benutzer</option>
                      <option value="office">Office</option>
                      <option value="admin">Administrator</option>
                    </select>
                    <button type="submit" disabled={inviteLoading}>{inviteLoading ? 'Lädt...' : 'Einladen'}</button>
                  </form>
                  {inviteSuccess && (
                    <div className="invite-success">
                      <p>Einladungslink für <strong>{invitedEmail}</strong> erstellt!</p>
                      <div className="invite-link-box">
                        <input type="text" value={inviteSuccess} readOnly />
                        <div className="invite-link-buttons">
                          <button type="button" className="copy-btn" onClick={() => { navigator.clipboard.writeText(inviteSuccess); toast.success('Kopiert', 'Link wurde in die Zwischenablage kopiert.'); }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="9" y="9" width="13" height="13" rx="2" />
                              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                            </svg>
                            Link kopieren
                          </button>
                          <a
                            href={`mailto:${invitedEmail}?subject=${encodeURIComponent('Einladung zur AYLUX Aufmaß App')}&body=${encodeURIComponent(`Hallo,\n\nSie wurden eingeladen, die AYLUX Aufmaß App zu nutzen.\n\nBitte registrieren Sie sich über folgenden Link:\n${inviteSuccess}\n\nDer Link ist 7 Tage gültig.\n\nMit freundlichen Grüßen\nIhr AYLUX Team`)}`}
                            className="mail-btn"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                              <polyline points="22,6 12,13 2,6" />
                            </svg>
                            E-Mail senden
                          </a>
                        </div>
                      </div>
                      <small>7 Tage gültig</small>
                    </div>
                  )}
                </div>

                {invitations.filter(i => !i.used_at).length > 0 && (
                  <div className="admin-section">
                    <h3>Offene Einladungen</h3>
                    <div className="admin-list">
                      {invitations.filter(i => !i.used_at).map((inv) => (
                        <div key={inv.id} className="admin-list-item">
                          <div className="item-info">
                            <span className="item-email">{inv.email}</span>
                            <span className="item-role">{inv.role}</span>
                          </div>
                          <button className="item-delete" onClick={async () => { if (confirm('Löschen?')) { await deleteInvitation(inv.id); loadAdminData(); } }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="admin-section">
                  <h3>Benutzer ({users.length})</h3>
                  <div className="admin-list">
                    {users.map((u) => (
                      <div key={u.id} className={`admin-list-item ${!u.is_active ? 'inactive' : ''}`}>
                        <div className="item-info">
                          <span className="item-name">{u.name}</span>
                          <span className="item-email">{u.email}</span>
                          <span className={`item-role ${u.role}`}>{u.role}</span>
                        </div>
                        <div className="item-actions">
                          {u.id !== user?.id ? (
                            <>
                              <button className={`item-toggle ${u.is_active ? 'active' : ''}`} onClick={async () => { await updateUser(u.id, { is_active: !u.is_active }); loadAdminData(); }}>
                                {u.is_active ? 'Aktiv' : 'Inaktiv'}
                              </button>
                              <button className="item-delete" onClick={async () => { if (confirm('Löschen?')) { await deleteUser(u.id); loadAdminData(); } }}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            </>
                          ) : <span className="item-current">Sie</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* E-Signatur Admin Modal */}
        <AnimatePresence>
          {showEsignatureAdmin && (
            <EsignatureAdmin onClose={() => setShowEsignatureAdmin(false)} />
          )}
        </AnimatePresence>

        {/* Email Settings Modal */}
        <AnimatePresence>
          {showEmailSettings && (
            <EmailSettings onClose={() => setShowEmailSettings(false)} />
          )}
        </AnimatePresence>
      </AdminPanelContext.Provider>
    </StatsContext.Provider>
  );
}

function AppWrapper() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="dashboard">
        <div className="dashboard-loading">
          <div className="loading-spinner"></div>
          <p>Laden...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/abnahme/sign/:token" element={<AbnahmeSignPage />} />
      {!isAuthenticated ? (
        <>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      ) : (
        <Route path="/*" element={<ProtectedContent />} />
      )}
    </Routes>
  );
}

export default AppWrapper;
