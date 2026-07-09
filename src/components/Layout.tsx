import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
// import { isAdminBranch } from '../hooks/useBranchMeta';
import type { Stats } from '../services/api';

interface LayoutProps {
  children: React.ReactNode;
  stats: Stats;
  onOpenAdminPanel?: () => void;
  onOpenEsignatureAdmin?: () => void;
}

const Layout = ({ children, stats, onOpenAdminPanel, onOpenEsignatureAdmin: _onOpenEsignatureAdmin }: LayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, isAdmin } = useAuth();

  // Theme state
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem('aylux_theme');
    return savedTheme !== 'light';
  });

  // Apply theme on mount and change
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

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="dashboard">
      {/* Sidebar */}
      <aside className="dashboard-sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <img src="/aylux-sidebar-logo.png" alt="AYLUX Aufmaß System" className="sidebar-brand-logo" />
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
          <button
            className="theme-toggle-sidebar"
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
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">
            <span className="nav-section-title">Hauptmenü</span>
            <a href="#" className={`nav-item ${isActive('/') ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); navigate('/'); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="9" rx="2" />
                <rect x="14" y="3" width="7" height="5" rx="2" />
                <rect x="14" y="12" width="7" height="9" rx="2" />
                <rect x="3" y="16" width="7" height="5" rx="2" />
              </svg>
              <span>Dashboard</span>
            </a>
            <a href="#" className={`nav-item ${isActive('/angebote') ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); navigate('/angebote'); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              <span>Angebote</span>
            </a>
            <a href="#" className={`nav-item ${isActive('/aufmasse') ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); navigate('/aufmasse'); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              <span>Aufmaße</span>
            </a>
          </div>

          <div className="nav-section">
            <span className="nav-section-title">Statistiken</span>
            <div className="sidebar-stats">
              <div className="sidebar-stat">
                <span className="stat-number">{stats.total}</span>
                <span className="stat-text">Gesamt</span>
              </div>
              <div className="sidebar-stat">
                <span className="stat-number completed">{stats.completed}</span>
                <span className="stat-text">Fertig</span>
              </div>
              <div className="sidebar-stat">
                <span className="stat-number draft">{stats.draft}</span>
                <span className="stat-text">Entwurf</span>
              </div>
            </div>
          </div>

          <div className="nav-section">
            <span className="nav-section-title">Teams</span>
            <a href="#" className={`nav-item ${isActive('/montageteam') ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); navigate('/montageteam'); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87" />
                <path d="M16 3.13a4 4 0 010 7.75" />
              </svg>
              <span>Montageteams</span>
            </a>
          </div>

          {isAdmin && (
            <div className="nav-section">
              <span className="nav-section-title">Administration</span>
              <a href="#" className="nav-item" onClick={(e) => { e.preventDefault(); onOpenAdminPanel?.(); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87" />
                  <path d="M16 3.13a4 4 0 010 7.75" />
                </svg>
                <span>Benutzer verwalten</span>
              </a>
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

      {/* Main Content */}
      <main className="dashboard-content">
        {children}
      </main>
    </div>
  );
};

export default Layout;
