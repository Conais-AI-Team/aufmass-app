import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getBranchStats, getBranchDetails } from '../services/api';
import type { BranchStat, BranchStatsResponse, BranchUserStat, BranchDetailsResponse, ActivityEvent } from '../services/api';
import './BranchUebersicht.css';

const fmt = (v: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

const fmtNum = (v: number) => new Intl.NumberFormat('de-DE').format(v);

// Display name mapping - DB names stay untouched
const BRANCH_DISPLAY_NAMES: Record<string, string> = {
  'koblenz': 'AYLUX Koblenz',
  'aylux': 'AYLUX Sonnenschutzsysteme GmbH',
  'ayluxa': 'AYLUX Andernach GmbH',
  'ayluxb': 'AYLUX Berlin GmbH',
  'ayluxbr': 'AYLUX Bremen GmbH',
  'ayluxd': 'AYLUX Düsseldorf GmbH',
  'ayluxf': 'AYLUX Frankfurt GmbH',
  'ayluxgkmu': 'AYLUX Gelsenkirchen & Münster',
  'ayluxhh': 'AYLUX Hamburg GmbH',
  'ayluxha': 'AYLUX Hannover GmbH',
  'ayluxl': 'AYLUX Leipzig',
  'ayluxma': 'AYLUX Mannheim GmbH',
  'ayluxmau': 'AYLUX München & Augsburg',
  'ayluxs': 'AYLUX Stuttgart GmbH',
  'ayluxtr': 'AYLUX Trier',
  'ayluxus': 'AYLUX Ulm & Stuttgart',
};
const getBranchDisplayName = (slug: string, dbName: string) => BRANCH_DISPLAY_NAMES[slug] || dbName;

// SVG donut ring
function DonutRing({ value, max, size = 80, stroke = 6, color, label, children }: {
  value: number; max: number; size?: number; stroke?: number; color: string; label: string; children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const offset = circ * (1 - pct);

  return (
    <div className="bu-donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-color)" strokeWidth={stroke} opacity={0.4} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: 'easeOut', delay: 0.3 }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="bu-donut-inner">
        {children || (
          <>
            <span className="bu-donut-value" style={{ color }}>{fmtNum(value)}</span>
            <span className="bu-donut-label">{label}</span>
          </>
        )}
      </div>
    </div>
  );
}

// Mini sparkline SVG
function Sparkline({ data, color, width = 80, height = 24 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(1, ...data);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.8" />
      {/* Dot on last point */}
      {(() => {
        const lastX = width;
        const lastY = height - (data[data.length - 1] / max) * (height - 4) - 2;
        return <circle cx={lastX} cy={lastY} r="2" fill={color} />;
      })()}
    </svg>
  );
}

// Funnel step bar
function FunnelBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="bu-funnel-step">
      <div className="bu-funnel-info">
        <span className="bu-funnel-label">{label}</span>
        <span className="bu-funnel-val" style={{ color }}>{value} <small>({Math.round(pct)}%)</small></span>
      </div>
      <div className="bu-funnel-track">
        <motion.div
          className="bu-funnel-fill"
          style={{ background: color }}
          initial={{ width: '0%' }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

// Horizontal bar
function HBar({ value, max, color, height = 6 }: { value: number; max: number; color: string; height?: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="bu-hbar" style={{ height }}>
      <motion.div
        className="bu-hbar-fill"
        style={{ background: color, height }}
        initial={{ width: '0%' }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
      />
    </div>
  );
}

const BranchUebersicht = () => {
  const [data, setData] = useState<BranchStatsResponse | null>(null);
  const [details, setDetails] = useState<BranchDetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<'this_month' | 'this_year' | 'all' | 'custom'>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const getDateRange = (): { from?: string; to?: string } => {
    const now = new Date();
    switch (timeFilter) {
      case 'this_month':
        return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: now.toISOString().split('T')[0] };
      case 'this_year':
        return { from: `${now.getFullYear()}-01-01`, to: now.toISOString().split('T')[0] };
      case 'custom':
        return { from: customFrom || undefined, to: customTo || undefined };
      default:
        return {};
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const range = getDateRange();
      const [result, detailsResult] = await Promise.all([
        getBranchStats(range.from, range.to),
        getBranchDetails(range.from, range.to)
      ]);
      setData(result);
      setDetails(detailsResult);
    } catch (err) {
      console.error('Failed to load branch stats:', err);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [timeFilter]);

  const handleCustomDateApply = () => { if (customFrom || customTo) loadData(); };

  const activeBranches = useMemo(() =>
    data?.branches.filter(b => b.aufmass_count > 0 || b.angebot_count > 0) || [], [data]);
  const inactiveBranches = useMemo(() =>
    data?.branches.filter(b => b.aufmass_count === 0 && b.angebot_count === 0) || [], [data]);

  const maxAufmass = useMemo(() => Math.max(1, ...activeBranches.map(b => b.aufmass_count)), [activeBranches]);
  const maxAngebot = useMemo(() => Math.max(1, ...activeBranches.map(b => b.angebot_count)), [activeBranches]);
  const maxRevenue = useMemo(() => Math.max(1, ...activeBranches.map(b => b.total_revenue)), [activeBranches]);

  const selectedData = useMemo(() =>
    data?.branches.find(b => b.slug === selectedBranch) || null, [data, selectedBranch]);

  return (
    <div className="bu-page">
      {/* Header */}
      <div className="bu-header">
        <div>
          <h1 className="bu-title">Filialübersicht</h1>
          <p className="bu-subtitle">{activeBranches.length} aktive Filialen · {inactiveBranches.length} inaktiv</p>
        </div>
        <div className="bu-time-filters">
          {[
            { key: 'all', label: 'Gesamt' },
            { key: 'this_year', label: String(new Date().getFullYear()) },
            { key: 'this_month', label: new Date().toLocaleString('de-DE', { month: 'short' }) },
            { key: 'custom', label: 'Zeitraum' },
          ].map(f => (
            <button
              key={f.key}
              className={`bu-time-btn ${timeFilter === f.key ? 'active' : ''}`}
              onClick={() => setTimeFilter(f.key as typeof timeFilter)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom date range */}
      <AnimatePresence>
        {timeFilter === 'custom' && (
          <motion.div
            className="bu-custom-dates"
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          >
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="bu-date-input" />
            <span className="bu-date-sep">bis</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="bu-date-input" />
            <button className="bu-date-apply" onClick={handleCustomDateApply}>Anwenden</button>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="bu-loading">
          <div className="bu-spinner" />
          <span>Daten werden geladen...</span>
        </div>
      ) : data ? (
        <>
          {/* KPI Row */}
          <div className="bu-kpi-row">
            <motion.div className="bu-kpi" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <DonutRing value={data.totals.aufmass_count} max={data.totals.aufmass_count + data.totals.angebot_count} size={88} color="#8b5cf6" label="Aufmaße">
                <span className="bu-donut-value" style={{ color: '#8b5cf6' }}>{fmtNum(data.totals.aufmass_count)}</span>
                <span className="bu-donut-label">Aufmaße</span>
              </DonutRing>
              <div className="bu-kpi-meta">
                <span className="bu-kpi-title">Aufmaße gesamt</span>
                <span className="bu-kpi-desc">{activeBranches.length} Filialen aktiv</span>
              </div>
            </motion.div>

            <motion.div className="bu-kpi" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <DonutRing value={data.totals.angebot_count} max={data.totals.aufmass_count + data.totals.angebot_count} size={88} color="#3b82f6" label="Angebote">
                <span className="bu-donut-value" style={{ color: '#3b82f6' }}>{fmtNum(data.totals.angebot_count)}</span>
                <span className="bu-donut-label">Angebote</span>
              </DonutRing>
              <div className="bu-kpi-meta">
                <span className="bu-kpi-title">Angebote gesamt</span>
                <span className="bu-kpi-desc">{activeBranches.filter(b => b.angebot_count > 0).length} mit Angeboten</span>
              </div>
            </motion.div>

            <motion.div className="bu-kpi bu-kpi-currency" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              <div className="bu-kpi-icon" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>
              </div>
              <div className="bu-kpi-meta">
                <span className="bu-kpi-big" style={{ color: '#f59e0b' }}>{fmt(data.totals.highest_invoice)}</span>
                <span className="bu-kpi-desc">Höchste Rechnung</span>
              </div>
            </motion.div>

            <motion.div className="bu-kpi bu-kpi-currency" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
              <div className="bu-kpi-icon" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
              </div>
              <div className="bu-kpi-meta">
                <span className="bu-kpi-big" style={{ color: '#10b981' }}>{fmt(data.totals.total_revenue)}</span>
                <span className="bu-kpi-desc">Gesamtumsatz</span>
              </div>
            </motion.div>
          </div>

          {/* Pipeline + Activity row */}
          {details && (
            <div className="bu-insights-row">
              {/* Status Pipeline */}
              {details.pipeline.length > 0 && (
                <motion.div className="bu-pipeline-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
                  <span className="bu-section-label">Status Pipeline</span>
                  <div className="bu-pipeline-bars">
                    {details.pipeline.slice(0, 8).map(p => {
                      const maxP = details.pipeline[0]?.count || 1;
                      const STATUS_COLORS: Record<string, string> = {
                        'neu': '#8b5cf6', 'angebot_ausstehend': '#a78bfa', 'angebot_versendet': '#a78bfa', 'auftrag_erteilt': '#3b82f6',
                        'anzahlung': '#06b6d4', 'bestellt': '#f59e0b', 'montage_geplant': '#a855f7',
                        'abnahme': '#10b981', 'reklamation_eingegangen': '#ef4444', 'bauantrag': '#2563eb',
                        'montage_gestartet': '#ec4899', 'auftrag_abgelehnt': '#6b7280',
                      };
                      const STATUS_LABELS: Record<string, string> = {
                        'neu': 'Aufmaß Genommen', 'angebot_ausstehend': 'Aufmaß versenden', 'angebot_versendet': 'Aufmaß versendet',
                        'auftrag_erteilt': 'Auftrag Erteilt', 'anzahlung': 'Anzahlung',
                        'bestellt': 'Bestellt', 'montage_geplant': 'Montage Geplant',
                        'abnahme': 'Abnahme', 'reklamation_eingegangen': 'Reklamation',
                        'bauantrag': 'Bauantrag', 'montage_gestartet': 'Montage Gestartet',
                        'auftrag_abgelehnt': 'Abgelehnt',
                      };
                      return (
                        <div key={p.status} className="bu-pipeline-item">
                          <div className="bu-pipeline-item-head">
                            <span className="bu-pipeline-dot" style={{ background: STATUS_COLORS[p.status] || '#6b7280' }} />
                            <span className="bu-pipeline-name">{STATUS_LABELS[p.status] || p.status}</span>
                            <span className="bu-pipeline-count">{p.count}</span>
                          </div>
                          <HBar value={p.count} max={maxP} color={STATUS_COLORS[p.status] || '#6b7280'} height={4} />
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* Activity Feed */}
              {details.activity.length > 0 && (
                <motion.div className="bu-activity-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
                  <span className="bu-section-label">Letzte Aktivitäten</span>
                  <div className="bu-activity-list">
                    {details.activity.slice(0, 8).map((evt, i) => (
                      <ActivityRow key={`${evt.type}-${evt.id}-${i}`} event={evt} />
                    ))}
                  </div>
                </motion.div>
              )}
            </div>
          )}

          {/* Main content: cards + detail panel */}
          <div className={`bu-main ${selectedBranch ? 'has-detail' : ''}`}>
            {/* Branch cards grid */}
            <div className="bu-cards-section">
              <div className="bu-section-head">
                <span className="bu-section-label">Aktive Filialen</span>
                <span className="bu-section-count">{activeBranches.length}</span>
              </div>
              <div className="bu-cards-grid">
                {activeBranches.map((branch, i) => (
                  <BranchCard
                    key={branch.slug}
                    branch={branch}
                    index={i}
                    trendData={details?.trends[branch.slug]}
                    months={details?.months}
                    maxAufmass={maxAufmass}
                    maxAngebot={maxAngebot}
                    maxRevenue={maxRevenue}
                    isSelected={selectedBranch === branch.slug}
                    onSelect={() => setSelectedBranch(selectedBranch === branch.slug ? null : branch.slug)}
                  />
                ))}
              </div>

              {/* Inactive branches */}
              {inactiveBranches.length > 0 && (
                <div className="bu-inactive-section">
                  <button className="bu-inactive-toggle" onClick={() => setShowInactive(!showInactive)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"
                      style={{ transform: showInactive ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    {inactiveBranches.length} inaktive Filialen
                  </button>
                  <AnimatePresence>
                    {showInactive && (
                      <motion.div
                        className="bu-inactive-list"
                        initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      >
                        {inactiveBranches.map(b => (
                          <span key={b.slug} className="bu-inactive-chip">{getBranchDisplayName(b.slug, b.name)}</span>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Detail panel (slides in when a branch is selected) */}
            <AnimatePresence>
              {selectedBranch && selectedData && (
                <motion.div
                  className="bu-detail-panel"
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                >
                  <div className="bu-detail-header">
                    <h2>{getBranchDisplayName(selectedData.slug, selectedData.name)}</h2>
                    <button className="bu-detail-close" onClick={() => setSelectedBranch(null)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                  </div>

                  {/* Detail KPIs */}
                  <div className="bu-detail-kpis">
                    <div className="bu-detail-kpi">
                      <span className="bu-detail-kpi-val" style={{ color: '#8b5cf6' }}>{selectedData.aufmass_count}</span>
                      <span className="bu-detail-kpi-lbl">Aufmaße</span>
                    </div>
                    <div className="bu-detail-kpi">
                      <span className="bu-detail-kpi-val" style={{ color: '#3b82f6' }}>{selectedData.angebot_count}</span>
                      <span className="bu-detail-kpi-lbl">Angebote</span>
                    </div>
                    <div className="bu-detail-kpi">
                      <span className="bu-detail-kpi-val" style={{ color: '#10b981' }}>{fmt(selectedData.total_revenue)}</span>
                      <span className="bu-detail-kpi-lbl">Umsatz</span>
                    </div>
                  </div>

                  {selectedData.highest_invoice > 0 && (
                    <div className="bu-detail-highlight">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" width="16" height="16"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>
                      <span>Höchste Rechnung: <strong style={{ color: '#f59e0b' }}>{fmt(selectedData.highest_invoice)}</strong></span>
                    </div>
                  )}

                  {/* Conversion Funnel */}
                  {details?.funnel[selectedBranch] && (() => {
                    const f = details.funnel[selectedBranch];
                    return (
                      <div className="bu-detail-funnel">
                        <span className="bu-detail-section-title">Conversion Funnel</span>
                        <FunnelBar label="Aufmaß" value={f.aufmass} total={f.aufmass} color="#8b5cf6" />
                        <FunnelBar label="→ Angebot" value={f.angebot} total={f.aufmass} color="#3b82f6" />
                        <FunnelBar label="→ Auftrag" value={f.auftrag} total={f.aufmass} color="#f59e0b" />
                        <FunnelBar label="→ Abnahme" value={f.completed} total={f.aufmass} color="#10b981" />
                      </div>
                    );
                  })()}

                  {/* Processing Speed */}
                  {details?.speed[selectedBranch] !== undefined && (
                    <div className="bu-detail-highlight" style={{ marginTop: '8px' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                      <span>Ø Bearbeitungszeit: <strong style={{ color: '#a78bfa' }}>{details.speed[selectedBranch]} Tage</strong> bis Angebot</span>
                    </div>
                  )}

                  {/* Trend Chart */}
                  {details?.trends[selectedBranch] && details.months && (
                    <div className="bu-detail-trend">
                      <span className="bu-detail-section-title">12-Monats-Trend</span>
                      <div className="bu-mini-chart">
                        {details.months.map((m, i) => {
                          const val = details.trends[selectedBranch]?.[m] || 0;
                          const maxVal = Math.max(1, ...details.months.map(mo => details.trends[selectedBranch]?.[mo] || 0));
                          const h = val > 0 ? Math.max(4, (val / maxVal) * 48) : 0;
                          return (
                            <div key={m} className="bu-mini-bar-col" title={`${m}: ${val}`}>
                              <motion.div
                                className="bu-mini-bar"
                                style={{ background: i === details.months.length - 1 ? 'var(--primary-color)' : '#8b5cf6' }}
                                initial={{ height: 0 }}
                                animate={{ height: h }}
                                transition={{ duration: 0.4, delay: i * 0.03 }}
                              />
                              <span className="bu-mini-bar-label">{m.slice(5)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Users */}
                  {selectedData.users.length > 0 ? (
                    <div className="bu-detail-users">
                      <span className="bu-detail-section-title">Mitarbeiter</span>
                      {selectedData.users.map((user, i) => (
                        <UserRow key={user.id} user={user} index={i} maxAufmass={Math.max(1, ...selectedData.users.map(u => u.aufmass_count))} />
                      ))}
                    </div>
                  ) : (
                    <div className="bu-detail-empty">Keine Nutzer-Aktivität in diesem Zeitraum</div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      ) : null}
    </div>
  );
};

function BranchCard({ branch, index, maxAufmass, maxAngebot, maxRevenue, isSelected, onSelect, trendData, months }: {
  branch: BranchStat; index: number; maxAufmass: number; maxAngebot: number; maxRevenue: number;
  isSelected: boolean; onSelect: () => void;
  trendData?: Record<string, number>; months?: string[];
}) {
  const total = branch.aufmass_count + branch.angebot_count;
  const sparkData = months ? months.map(m => trendData?.[m] || 0) : [];

  return (
    <motion.div
      className={`bu-card ${isSelected ? 'selected' : ''}`}
      onClick={onSelect}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04 }}
      whileHover={{ y: -2 }}
    >
      <div className="bu-card-head">
        <div>
          <span className="bu-card-name">{getBranchDisplayName(branch.slug, branch.name)}</span>
          {sparkData.length > 1 && (
            <div style={{ marginTop: '4px' }}>
              <Sparkline data={sparkData} color="var(--primary-color)" width={70} height={18} />
            </div>
          )}
        </div>
        <span className="bu-card-total">{total}</span>
      </div>

      <div className="bu-card-bars">
        <div className="bu-card-bar-row">
          <span className="bu-card-bar-label">Aufm.</span>
          <HBar value={branch.aufmass_count} max={maxAufmass} color="#8b5cf6" />
          <span className="bu-card-bar-val">{branch.aufmass_count}</span>
        </div>
        <div className="bu-card-bar-row">
          <span className="bu-card-bar-label">Ang.</span>
          <HBar value={branch.angebot_count} max={maxAngebot} color="#3b82f6" />
          <span className="bu-card-bar-val">{branch.angebot_count}</span>
        </div>
      </div>

      {branch.total_revenue > 0 && (
        <div className="bu-card-revenue">
          <HBar value={branch.total_revenue} max={maxRevenue} color="rgba(16,185,129,0.4)" height={3} />
          <div className="bu-card-revenue-text">
            <span style={{ color: '#10b981' }}>{fmt(branch.total_revenue)}</span>
            {branch.highest_invoice > 0 && <span className="bu-card-highest">max {fmt(branch.highest_invoice)}</span>}
          </div>
        </div>
      )}

      <div className="bu-card-footer">
        <span className="bu-card-users-count">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
          {branch.users.length}
        </span>
        <span className="bu-card-detail-hint">Details →</span>
      </div>
    </motion.div>
  );
}

function UserRow({ user, index, maxAufmass }: { user: BranchUserStat; index: number; maxAufmass: number }) {
  const initials = (user.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const hue = (user.id * 47) % 360;

  return (
    <motion.div
      className="bu-user-row"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <div className="bu-user-avatar" style={{ background: `hsl(${hue}, 40%, 25%)`, color: `hsl(${hue}, 60%, 70%)` }}>
        {initials}
      </div>
      <div className="bu-user-info">
        <span className="bu-user-name">{user.name}</span>
        <div className="bu-user-bars">
          <HBar value={user.aufmass_count} max={maxAufmass} color="#8b5cf6" height={4} />
        </div>
      </div>
      <div className="bu-user-stats">
        <span className="bu-user-stat"><em style={{ color: '#8b5cf6' }}>{user.aufmass_count}</em> Aufm.</span>
        <span className="bu-user-stat"><em style={{ color: '#3b82f6' }}>{user.angebot_count}</em> Ang.</span>
      </div>
    </motion.div>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const timeAgo = (() => {
    const diff = Date.now() - new Date(event.event_time).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `vor ${mins} Min.`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `vor ${hours} Std.`;
    const days = Math.floor(hours / 24);
    return `vor ${days} T.`;
  })();

  const branchName = BRANCH_DISPLAY_NAMES[event.branch_id] || event.branch_id || '–';
  const shortBranch = branchName.replace('AYLUX ', '').replace(' GmbH', '');

  return (
    <div className="bu-activity-item">
      <div className={`bu-activity-dot ${event.type}`} />
      <div className="bu-activity-content">
        <span className="bu-activity-text">
          <strong>{event.user_name || 'System'}</strong>
          {event.type === 'aufmass' ? ' — neues Aufmaß' : ` — Angebot ${event.status || ''}`}
          {event.detail?.trim() ? ` (${event.detail.trim()})` : ''}
        </span>
        <div className="bu-activity-meta">
          <span className="bu-activity-branch">{shortBranch}</span>
          <span className="bu-activity-time">{timeAgo}</span>
        </div>
      </div>
    </div>
  );
}

export default BranchUebersicht;
