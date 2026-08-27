import { Circle, Hexagon, Send, CheckCircle2, FileText, Settings } from 'lucide-react';
import { Language, PatrollingUnit } from '../../types';
import { i18n } from '../../data/i18n';

interface Props {
  language: Language;
  darkMode: boolean;
  units: PatrollingUnit[];
  // Dispatch Unit used to live here as a shortcut that just opened the SOS
  // takeover modal (dispatching itself always happened inside that modal,
  // not this bar) — removed per request. Dispatching a unit to an incident
  // is still available from the SOS takeover / incident click flow.
  onMarkCircleZoneClick: () => void;
  onMarkPolygonZoneClick: () => void;
  onBroadcastClick: () => void;
  onMarkSafeClick: () => void;
  onAuditLogsClick: () => void;
  onGeofenceManagerClick: () => void;
}

const UNIT_STATUS_COLOR: Record<PatrollingUnit['status'], string> = {
  Patrolling: '#138808',
  Dispatched: '#FF9933',
  'On Scene': '#dc2626',
  Standby: '#64748b',
};

export default function AuthorityBottomBar({
  language, darkMode: dm, units, onMarkCircleZoneClick, onMarkPolygonZoneClick, onBroadcastClick, onMarkSafeClick, onAuditLogsClick, onGeofenceManagerClick,
}: Props) {
  const t = i18n[language];
  const surface = dm ? 'rgba(10,20,40,0.94)' : 'rgba(255,255,255,0.96)';
  const text = dm ? '#f1f5f9' : '#0c2340';
  const subtle = dm ? 'rgba(255,255,255,0.5)' : 'rgba(12,35,64,0.5)';
  const border = dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  const QUICK_ACTIONS = [
    { label: 'Mark Circle Zone', icon: Circle, onClick: onMarkCircleZoneClick, color: '#0B2447' },
    { label: 'Mark Polygon Zone', icon: Hexagon, onClick: onMarkPolygonZoneClick, color: '#0B2447' },
    { label: t.sendBroadcastBtn, icon: Send, onClick: onBroadcastClick, color: '#FF9933' },
    { label: t.markSafeBtn, icon: CheckCircle2, onClick: onMarkSafeClick, color: '#138808' },
    { label: t.viewAuditLogsBtn, icon: FileText, onClick: onAuditLogsClick, color: '#64748b' },
    { label: 'Manage Geofences', icon: Settings, onClick: onGeofenceManagerClick, color: '#EC4899' },
  ];

  return (
    <div
      className="absolute bottom-3 inset-x-3 z-20 rounded-2xl shadow-xl overflow-hidden"
      style={{ background: surface, border: `1px solid ${border}`, backdropFilter: 'blur(16px)' }}
    >
      {/* Unit status ticker */}
      {units.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 overflow-x-auto no-scrollbar" style={{ borderBottom: `1px solid ${border}` }}>
          {units.map((u) => (
            <div key={u.id} className="flex items-center gap-1.5 flex-shrink-0 text-[10px] font-bold whitespace-nowrap" style={{ color: subtle }}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: UNIT_STATUS_COLOR[u.status] }} />
              <span style={{ color: text }}>{u.unitName}</span>
              <span>· {u.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* Quick action strip */}
      <div className="flex items-stretch">
        {QUICK_ACTIONS.map(({ label, icon: Icon, onClick, color }) => (
          <button
            key={label}
            onClick={onClick}
            className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Icon size={16} style={{ color }} />
            <span className="text-[9px] font-bold text-center leading-tight px-1" style={{ color: text }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
