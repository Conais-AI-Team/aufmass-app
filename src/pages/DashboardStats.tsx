import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getForms, getMontageteams } from '../services/api';
import { api } from '../services/api';
import type { FormData, Montageteam } from '../services/api';
import './DashboardStats.css';

interface StatusCount {
  status: string;
  label: string;
  count: number;
  color: string;
}

interface Lead {
  id: number;
  total_price: number;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  'neu': { label: 'Aufmaß Genommen', color: '#8b5cf6' },
  'angebot_versendet': { label: 'Angebot Versendet', color: '#a78bfa' },
  'auftrag_erteilt': { label: 'Auftrag Erteilt', color: '#3b82f6' },
  'auftrag_abgelehnt': { label: 'Auftrag Abgelehnt', color: '#6b7280' },
  'anzahlung': { label: 'Anzahlung Erhalten', color: '#06b6d4' },
  'bestellt': { label: 'Bestellt', color: '#f59e0b' },
  'montage_geplant': { label: 'Montage Geplant', color: '#a855f7' },
  'montage_gestartet': { label: 'Montage Gestartet', color: '#ec4899' },
  'abnahme': { label: 'Abnahme', color: '#10b981' },
  'reklamation_eingegangen': { label: 'Reklamation', color: '#ef4444' },
  'reklamation_abgelehnt': { label: 'Reklamation Abgelehnt', color: '#b91c1c' },
};

export default function DashboardStats() {
  const navigate = useNavigate();
  const [forms, setForms] = useState<FormData[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [teams, setTeams] = useState<Montageteam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [formsData, teamsData, leadsData] = await Promise.all([
        getForms(),
        getMontageteams(),
        api.get<Lead[]>('/leads').catch(() => [])
      ]);
      setForms(formsData);
      setTeams(teamsData);
      setLeads(leadsData);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Calculate statistics
  const totalAufmasse = forms.length;
  const totalAngebote = leads.length;

  // Status breakdown
  const statusCounts: StatusCount[] = Object.entries(
    forms.reduce((acc, form) => {
      const status = form.status || 'neu';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([status, count]) => ({
    status,
    label: STATUS_CONFIG[status]?.label || status,
    count,
    color: STATUS_CONFIG[status]?.color || '#6b7280'
  })).sort((a, b) => b.count - a.count);

  // This month
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonthForms = forms.filter(f => new Date(f.created_at || '') >= thisMonthStart).length;

  // Pending montage
  const pendingMontage = forms.filter(f =>
    f.status === 'montage_geplant' || f.status === 'auftrag_erteilt' || f.status === 'bestellt'
  ).length;

  // Active reklamationen
  const activeReklamationen = forms.filter(f => f.status === 'reklamation_eingegangen').length;

  // Total lead value
  const totalLeadValue = leads.reduce((sum, l) => sum + (l.total_price || 0), 0);

  // Recent activities (last 5 forms)
  const recentForms = [...forms]
    .sort((a, b) => new Date(b.updated_at || b.created_at || '').getTime() - new Date(a.updated_at || a.created_at || '').getTime())
    .slice(0, 5);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(price);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="dashboard-stats loading">
        <div className="spinner"></div>
        <p>Lade Dashboard...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-stats">
      <header className="stats-header">
        <div>
          <h1>Dashboard</h1>
          <p className="header-subtitle">Übersicht Ihres Aufmaß-Systems</p>
        </div>
      </header>

      {/* Quick Stats Cards — clickable, navigate to filtered targets */}
      <div className="stats-grid">
        <motion.div
          className="stat-card stat-card-clickable"
          role="button"
          tabIndex={0}
          onClick={() => navigate('/aufmasse')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/aufmasse'); }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          whileHover={{ y: -2 }}
        >
          <div className="stat-icon aufmasse">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
            </svg>
          </div>
          <div className="stat-content">
            <span className="stat-value">{totalAufmasse}</span>
            <span className="stat-label">Aufmaße Gesamt</span>
          </div>
          <div className="stat-footer">
            <span className="stat-change positive">+{thisMonthForms} diesen Monat</span>
          </div>
        </motion.div>

        <motion.div
          className="stat-card stat-card-clickable"
          role="button"
          tabIndex={0}
          onClick={() => navigate('/angebote')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/angebote'); }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          whileHover={{ y: -2 }}
        >
          <div className="stat-icon angebote">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div className="stat-content">
            <span className="stat-value">{totalAngebote}</span>
            <span className="stat-label">Offene Angebote</span>
          </div>
          <div className="stat-footer">
            <span className="stat-change">{formatPrice(totalLeadValue)} Wert</span>
          </div>
        </motion.div>

        <motion.div
          className="stat-card stat-card-clickable"
          role="button"
          tabIndex={0}
          onClick={() => navigate('/aufmasse?status=montage_geplant')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/aufmasse?status=montage_geplant'); }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          whileHover={{ y: -2 }}
        >
          <div className="stat-icon montage">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
          <div className="stat-content">
            <span className="stat-value">{pendingMontage}</span>
            <span className="stat-label">Montage ausstehend</span>
          </div>
          <div className="stat-footer">
            <span className="stat-change">{teams.length} Teams verfügbar</span>
          </div>
        </motion.div>

        <motion.div
          className="stat-card stat-card-clickable"
          role="button"
          tabIndex={0}
          onClick={() => navigate('/aufmasse?status=reklamation_eingegangen')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/aufmasse?status=reklamation_eingegangen'); }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          whileHover={{ y: -2 }}
        >
          <div className="stat-icon reklamation">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="stat-content">
            <span className="stat-value">{activeReklamationen}</span>
            <span className="stat-label">Offene Reklamationen</span>
          </div>
          <div className="stat-footer">
            <span className={`stat-change ${activeReklamationen > 0 ? 'warning' : 'positive'}`}>
              {activeReklamationen > 0 ? 'Aktion erforderlich' : 'Keine offenen'}
            </span>
          </div>
        </motion.div>
      </div>

      <div className="stats-row">
        {/* Status Breakdown */}
        <motion.div
          className="stats-panel"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <h2>Status Übersicht</h2>
          <div className="status-list">
            {statusCounts.map(({ status, label, count, color }) => (
              <div key={status} className="status-item" onClick={() => navigate(`/aufmasse?status=${status}`)}>
                <div className="status-bar" style={{ '--status-color': color } as React.CSSProperties}>
                  <div
                    className="status-fill"
                    style={{ width: `${Math.max(5, (count / totalAufmasse) * 100)}%` }}
                  />
                </div>
                <div className="status-info">
                  <span className="status-label">{label}</span>
                  <span className="status-count">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Recent Activity */}
        <motion.div
          className="stats-panel"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          <h2>Letzte Aktivitäten</h2>
          <div className="activity-list">
            {recentForms.length === 0 ? (
              <p className="empty-text">Keine Aktivitäten</p>
            ) : (
              recentForms.map(form => (
                <div
                  key={form.id}
                  className="activity-item"
                  onClick={() => navigate(`/form/${form.id}`)}
                >
                  <div className="activity-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                    </svg>
                  </div>
                  <div className="activity-content">
                    <span className="activity-title">
                      {form.kundeVorname} {form.kundeNachname}
                    </span>
                    <span className="activity-meta">
                      {form.kundenlokation} • {formatDate(form.updated_at || form.created_at || '')}
                    </span>
                  </div>
                  <div
                    className="activity-status"
                    style={{ backgroundColor: STATUS_CONFIG[form.status || 'neu']?.color || '#6b7280' }}
                  >
                    {STATUS_CONFIG[form.status || 'neu']?.label || form.status}
                  </div>
                </div>
              ))
            )}
          </div>
          <button className="view-all-btn" onClick={() => navigate('/aufmasse')}>
            Alle Aufmaße anzeigen
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </motion.div>
      </div>

      {/* Quick Actions */}
      <motion.div
        className="quick-actions"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <h2>Schnellzugriff</h2>
        <div className="actions-grid">
          <button className="action-card" onClick={() => navigate('/form/new')}>
            <div className="action-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </div>
            <span>Neues Aufmaß</span>
          </button>
          <button className="action-card" onClick={() => navigate('/angebot/new')}>
            <div className="action-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <span>Neues Angebot</span>
          </button>
          <button className="action-card" onClick={() => navigate('/angebote')}>
            <div className="action-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
              </svg>
            </div>
            <span>Angebote</span>
          </button>
          <button className="action-card" onClick={() => navigate('/aufmasse')}>
            <div className="action-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
              </svg>
            </div>
            <span>Aufmaße</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
