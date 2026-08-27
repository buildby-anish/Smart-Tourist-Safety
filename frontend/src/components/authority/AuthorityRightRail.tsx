import { useState } from 'react';
import { Radio, ChevronLeft, ChevronRight, Clock, AlertTriangle, X, Send, CheckSquare, Square, Trash2 } from 'lucide-react';
import { Language, SOSIncident, AlertSeverity, BroadcastAlert } from '../../types';
import { i18n } from '../../data/i18n';

interface Props {
  language: Language;
  darkMode: boolean;
  incidents: SOSIncident[];
  onResolveIncident: (incidentId: string) => void;
  onDeleteIncidents: (incidentIds: string[]) => void;
  onSendBroadcast: (newAlert: Omit<BroadcastAlert, 'id' | 'timestamp' | 'deliveredCount' | 'status'>) => void;
  onIncidentClick: (incident: SOSIncident) => void;
}

const SEVERITY_STYLE: Record<AlertSeverity, string> = {
  Critical: 'bg-red-100 text-red-800 border-red-300',
  Warning: 'bg-amber-100 text-amber-800 border-amber-300',
  Advisory: 'bg-slate-100 text-slate-600 border-slate-300',
};

export default function AuthorityRightRail({
  language, darkMode: dm, incidents, onResolveIncident, onDeleteIncidents, onSendBroadcast, onIncidentClick,
}: Props) {
  const t = i18n[language];
  const [collapsed, setCollapsed] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const surface = dm ? 'rgba(10,20,40,0.94)' : 'rgba(255,255,255,0.96)';
  const text = dm ? '#f1f5f9' : '#0c2340';
  const subtle = dm ? 'rgba(255,255,255,0.5)' : 'rgba(12,35,64,0.5)';
  const border = dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  // SOS incidents pinned to top, then sorted by severity/AI risk/recency —
  // matches the existing ModuleSOSMap ordering intent (new/unresolved
  // first, ranked by ai_risk_score where available).
  const sorted = [...incidents]
    .filter((i) => i.status !== 'Resolved')
    .sort((a, b) => {
      if (a.severity === 'Critical' && b.severity !== 'Critical') return -1;
      if (b.severity === 'Critical' && a.severity !== 'Critical') return 1;
      return (b.aiRiskScore ?? -1) - (a.aiRiskScore ?? -1);
    });

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-8 h-16 rounded-l-xl flex items-center justify-center shadow-lg"
        style={{ background: surface, border: `1px solid ${border}` }}
        aria-label="Expand incidents panel"
      >
        <ChevronLeft size={16} style={{ color: subtle }} />
      </button>
    );
  }

  return (
    <div
      className="absolute right-3 z-20 w-[300px] rounded-2xl shadow-xl flex flex-col overflow-hidden"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 68px)', bottom: '76px', background: surface, border: `1px solid ${border}`, backdropFilter: 'blur(16px)' }}
    >
      <button
        onClick={() => setCollapsed(true)}
        className="absolute -left-3 top-3 w-6 h-6 rounded-full flex items-center justify-center shadow-md z-10"
        style={{ background: surface, border: `1px solid ${border}` }}
        aria-label="Collapse panel"
      >
        <ChevronRight size={13} style={{ color: subtle }} />
      </button>

      <div className="p-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${border}` }}>
        <span className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider" style={{ color: text }}>
          <Radio size={13} className="text-[#FF9933]" />
          {t.activeIncidentsLabel}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded" style={{ background: dm ? 'rgba(255,255,255,0.08)' : 'rgba(11,36,71,0.08)', color: subtle }}>
            {sorted.length}
          </span>
          {sorted.length > 0 && (
            <button
              onClick={() => {
                setSelectMode((prev) => !prev);
                setSelectedIds(new Set());
              }}
              className="text-[9px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded transition-colors"
              style={{
                background: selectMode ? '#dc2626' : (dm ? 'rgba(255,255,255,0.08)' : 'rgba(11,36,71,0.08)'),
                color: selectMode ? '#fff' : subtle,
              }}
            >
              {selectMode ? 'Cancel' : 'Select'}
            </button>
          )}
        </div>
      </div>

      {selectMode && sorted.length > 0 && (
        <div className="px-3 py-2 flex items-center justify-between gap-2" style={{ borderBottom: `1px solid ${border}`, background: dm ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
          <button
            onClick={() => {
              const allIds = sorted.map((i) => i.id);
              const allSelected = allIds.every((id) => selectedIds.has(id));
              setSelectedIds(allSelected ? new Set() : new Set(allIds));
            }}
            className="flex items-center gap-1.5 text-[10px] font-bold"
            style={{ color: text }}
          >
            {sorted.every((i) => selectedIds.has(i.id)) ? (
              <CheckSquare size={14} style={{ color: '#FF9933' }} />
            ) : (
              <Square size={14} style={{ color: subtle }} />
            )}
            Select all ({selectedIds.size}/{sorted.length})
          </button>
          <button
            onClick={() => {
              if (selectedIds.size === 0) return;
              if (!window.confirm(`Delete ${selectedIds.size} selected SOS incident${selectedIds.size > 1 ? 's' : ''}? This cannot be undone.`)) return;
              onDeleteIncidents(Array.from(selectedIds));
              setSelectedIds(new Set());
              setSelectMode(false);
            }}
            disabled={selectedIds.size === 0}
            className="flex items-center gap-1 h-7 px-2.5 rounded-lg text-[10px] font-bold text-white transition-opacity disabled:opacity-40"
            style={{ background: '#dc2626' }}
          >
            <Trash2 size={12} />
            Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {sorted.length === 0 ? (
          <div className="text-center py-8 text-xs" style={{ color: subtle }}>{t.noActiveIncidents}</div>
        ) : (
          sorted.map((inc) => {
            const isSelected = selectedIds.has(inc.id);
            const toggleSelected = () => {
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(inc.id)) next.delete(inc.id); else next.add(inc.id);
                return next;
              });
            };
            return (
            <div
              key={inc.id}
              className={`rounded-xl flex items-stretch ${inc.severity === 'Critical' ? 'animate-pulse-glow' : ''}`}
              style={{
                background: inc.severity === 'Critical' ? 'rgba(220,38,38,0.08)' : dm ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                border: `1px solid ${isSelected ? '#FF9933' : (inc.severity === 'Critical' ? 'rgba(220,38,38,0.35)' : border)}`,
              }}
            >
              {selectMode && (
                <button
                  onClick={toggleSelected}
                  aria-label={isSelected ? 'Deselect incident' : 'Select incident'}
                  className="flex items-start justify-center pt-2.5 pl-2.5 pr-1"
                >
                  {isSelected ? (
                    <CheckSquare size={16} style={{ color: '#FF9933' }} />
                  ) : (
                    <Square size={16} style={{ color: subtle }} />
                  )}
                </button>
              )}
              <div className="flex-1 min-w-0">
                <button onClick={() => (selectMode ? toggleSelected() : onIncidentClick(inc))} className="w-full text-left p-2.5">
                  <div className="flex items-center justify-between gap-1.5 mb-1">
                    <span className="text-[10px] font-mono font-bold" style={{ color: subtle }}>{inc.id}</span>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full border ${SEVERITY_STYLE[inc.severity]}`}>
                      {inc.severity}
                    </span>
                  </div>
                  <div className="text-xs font-bold truncate" style={{ color: text }}>{inc.touristName}</div>
                  <div className="text-[10px] truncate mt-0.5" style={{ color: subtle }}>{inc.hazardType}</div>
                  <div className="flex items-center gap-1 mt-1 text-[9px]" style={{ color: subtle }}>
                    <Clock size={9} />
                    <span>{inc.timestamp.split(' ')[1] || inc.timestamp}</span>
                    {inc.status === 'Units Dispatched' && (
                      <span className="ml-auto px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[9px] font-extrabold">DISPATCHED</span>
                    )}
                    {inc.status === 'New' && (
                      <span className="ml-auto px-1.5 py-0.5 rounded bg-red-100 text-red-800 text-[9px] font-extrabold">NEW</span>
                    )}
                  </div>
                </button>
                {inc.status === 'Units Dispatched' && (
                  <div className="px-2.5 pb-2.5">
                    <button
                      onClick={() => onResolveIncident(inc.id)}
                      className="w-full h-7 rounded-lg text-[10px] font-bold text-white transition-opacity hover:opacity-90"
                      style={{ background: '#138808' }}
                    >
                      {t.resolveBtn}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );})
        )}
      </div>

      <div className="p-2.5" style={{ borderTop: `1px solid ${border}` }}>
        <button
          onClick={() => setShowBroadcast(true)}
          className="w-full h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
          style={{ background: '#0B2447', color: '#fff' }}
        >
          <AlertTriangle size={13} />
          {t.sendBroadcastBtn}
        </button>
      </div>

      {showBroadcast && (
        <BroadcastComposer
          language={language}
          darkMode={dm}
          onClose={() => setShowBroadcast(false)}
          onSendBroadcast={(alert) => { onSendBroadcast(alert); setShowBroadcast(false); }}
        />
      )}
    </div>
  );
}

function BroadcastComposer({
  language, darkMode: dm, onClose, onSendBroadcast,
}: {
  language: Language;
  darkMode: boolean;
  onClose: () => void;
  onSendBroadcast: (newAlert: Omit<BroadcastAlert, 'id' | 'timestamp' | 'deliveredCount' | 'status'>) => void;
}) {
  const t = i18n[language];
  const [region, setRegion] = useState('All');
  const [radiusKm, setRadiusKm] = useState(10);
  const [severity, setSeverity] = useState<AlertSeverity>('Critical');
  const [titleEn, setTitleEn] = useState('');
  const [bodyEn, setBodyEn] = useState('');

  const estimatedRecipients = Math.round(1800 * (radiusKm / 5));
  const text = dm ? '#f1f5f9' : '#0c2340';
  const subtle = dm ? 'rgba(255,255,255,0.5)' : 'rgba(12,35,64,0.5)';
  const surface = dm ? '#18181b' : '#ffffff';
  const border = dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  const handlePublish = () => {
    if (!titleEn.trim() || !bodyEn.trim()) return;
    onSendBroadcast({
      senderBadge: 'Officer',
      region, radiusKm, titleEn, titleHi: titleEn, bodyEn, bodyHi: bodyEn, severity,
      recipientCount: estimatedRecipients,
    });
  };

  return (
    <>
      <div className="fixed inset-0 z-[90]" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
      <div
        className="fixed inset-x-0 bottom-0 z-[95] rounded-t-3xl p-4 space-y-3 animate-slide-up"
        style={{ background: surface, boxShadow: '0 -8px 40px rgba(0,0,0,0.35)', maxHeight: '70vh', overflowY: 'auto' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold" style={{ color: text }}>{t.broadcastAlertTitle}</span>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
            <X size={13} style={{ color: subtle }} />
          </button>
        </div>
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="w-full h-10 rounded-xl px-3 text-xs"
          style={{ background: dm ? 'rgba(255,255,255,0.06)' : 'rgba(12,35,64,0.05)', color: text }}
        >
          <option value="All">All States / Regions</option>
          <option value="Himachal Pradesh">Himachal Pradesh</option>
          <option value="Maharashtra">Maharashtra</option>
        </select>
        <div className="flex items-center gap-2">
          <input type="number" value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} className="w-20 h-10 rounded-xl px-3 text-xs" style={{ background: dm ? 'rgba(255,255,255,0.06)' : 'rgba(12,35,64,0.05)', color: text }} />
          <span className="text-xs" style={{ color: subtle }}>km radius · ~{estimatedRecipients.toLocaleString()} devices</span>
        </div>
        <select value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)} className="w-full h-10 rounded-xl px-3 text-xs" style={{ background: dm ? 'rgba(255,255,255,0.06)' : 'rgba(12,35,64,0.05)', color: text }}>
          <option value="Critical">Critical</option>
          <option value="Warning">Warning</option>
          <option value="Advisory">Advisory</option>
        </select>
        <input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} placeholder="Alert title" className="w-full h-10 rounded-xl px-3 text-xs" style={{ background: dm ? 'rgba(255,255,255,0.06)' : 'rgba(12,35,64,0.05)', color: text }} />
        <textarea value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} placeholder="Alert message" rows={3} className="w-full rounded-xl px-3 py-2 text-xs" style={{ background: dm ? 'rgba(255,255,255,0.06)' : 'rgba(12,35,64,0.05)', color: text }} />
        <button
          onClick={handlePublish}
          disabled={!titleEn.trim() || !bodyEn.trim()}
          className="w-full h-11 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
          style={{ background: '#FF9933' }}
        >
          <Send size={15} /> {t.sendBroadcastBtn}
        </button>
      </div>
    </>
  );
}
