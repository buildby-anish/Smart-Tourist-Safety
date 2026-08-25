import { useState } from 'react';
import { ShieldAlert, Radio, Building2, HeartPulse, Flame, Layers, MapPin, ChevronLeft, ChevronRight } from 'lucide-react';
import { Language, TouristProfile } from '../../types';
import { i18n } from '../../data/i18n';

export interface LayerToggles {
  showSosLayer: boolean;
  showRespondersLayer: boolean;
  showStationsLayer: boolean;
  showHospitalsLayer: boolean;
  showHeatmapLayer: boolean;
}

interface Props {
  language: Language;
  darkMode: boolean;
  tourists: TouristProfile[];
  layers: LayerToggles;
  onToggleLayer: (key: keyof LayerToggles) => void;
  onFlyToTourist: (tourist: TouristProfile) => void;
}

type StatusFilter = 'All' | 'SOS Active' | 'Watch' | 'Safe';

const STATUS_PILL: Record<TouristProfile['safetyStatus'], string> = {
  'SOS Active': 'bg-red-100 text-red-800 border-red-300',
  Watch: 'bg-amber-100 text-amber-800 border-amber-300',
  Safe: 'bg-emerald-100 text-emerald-800 border-emerald-300',
};

export default function AuthorityLeftRail({ language, darkMode: dm, tourists, layers, onToggleLayer, onFlyToTourist }: Props) {
  const t = i18n[language];
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('All');

  const filtered = tourists.filter((tr) => filter === 'All' || tr.safetyStatus === filter);

  const surface = dm ? 'rgba(10,20,40,0.94)' : 'rgba(255,255,255,0.96)';
  const text = dm ? '#f1f5f9' : '#0c2340';
  const subtle = dm ? 'rgba(255,255,255,0.5)' : 'rgba(12,35,64,0.5)';
  const border = dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  const LAYER_BUTTONS: { key: keyof LayerToggles; label: string; icon: typeof ShieldAlert; activeCls: string }[] = [
    { key: 'showSosLayer', label: t.layerSosBeacons, icon: ShieldAlert, activeCls: 'bg-red-50 border-red-300 text-red-800' },
    { key: 'showRespondersLayer', label: t.layerResponders, icon: Radio, activeCls: 'bg-blue-50 border-blue-300 text-blue-800' },
    { key: 'showStationsLayer', label: t.layerStations, icon: Building2, activeCls: 'bg-emerald-50 border-emerald-300 text-[#138808]' },
    { key: 'showHospitalsLayer', label: t.layerHospitals, icon: HeartPulse, activeCls: 'bg-rose-50 border-rose-300 text-rose-800' },
    { key: 'showHeatmapLayer', label: t.layerHeatmap, icon: Flame, activeCls: 'bg-amber-50 border-amber-300 text-amber-900' },
  ];

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-8 h-16 rounded-r-xl flex items-center justify-center shadow-lg"
        style={{ background: surface, border: `1px solid ${border}` }}
        aria-label="Expand tourist tracking panel"
      >
        <ChevronRight size={16} style={{ color: subtle }} />
      </button>
    );
  }

  return (
    <div
      className="absolute left-3 z-20 w-[280px] rounded-2xl shadow-xl flex flex-col overflow-hidden"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 68px)', bottom: '76px', background: surface, border: `1px solid ${border}`, backdropFilter: 'blur(16px)' }}
    >
      <button
        onClick={() => setCollapsed(true)}
        className="absolute -right-3 top-3 w-6 h-6 rounded-full flex items-center justify-center shadow-md z-10"
        style={{ background: surface, border: `1px solid ${border}` }}
        aria-label="Collapse panel"
      >
        <ChevronLeft size={13} style={{ color: subtle }} />
      </button>

      {/* Layer toggles */}
      <div className="p-3 flex flex-col gap-1.5" style={{ borderBottom: `1px solid ${border}` }}>
        <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider mb-1" style={{ color: subtle }}>
          <Layers size={12} className="text-[#FF9933]" />
          {t.layersLabel}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {LAYER_BUTTONS.map(({ key, label, icon: Icon, activeCls }) => (
            <button
              key={key}
              onClick={() => onToggleLayer(key)}
              className={`px-2 py-1 rounded-lg border text-[10px] font-bold transition flex items-center gap-1 ${
                layers[key] ? activeCls : dm ? 'bg-white/5 border-white/10 text-white/40' : 'bg-slate-100 border-slate-200 text-slate-500'
              }`}
            >
              <Icon size={11} />
              <span className="truncate max-w-[90px]">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Filter chips */}
      <div className="px-3 pt-2.5 pb-1.5 flex gap-1.5">
        {(['All', 'SOS Active', 'Watch', 'Safe'] as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition ${
              filter === f
                ? 'bg-[#0B2447] text-white'
                : dm ? 'bg-white/5 text-white/50 hover:bg-white/10' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {f === 'All' ? t.filterAll : f === 'SOS Active' ? t.filterSosActive : f === 'Watch' ? t.filterWatch : t.filterSafe}
          </button>
        ))}
      </div>

      {/* Tourist list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-xs" style={{ color: subtle }}>{t.noTouristsTracked}</div>
        ) : (
          filtered.map((tr) => (
            <button
              key={tr.id}
              onClick={() => onFlyToTourist(tr)}
              className="w-full text-left p-2.5 rounded-xl transition-colors hover:bg-black/5 dark:hover:bg-white/5 flex items-start gap-2"
              style={{ border: `1px solid ${border}` }}
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-[11px]" style={{ background: dm ? 'rgba(255,255,255,0.08)' : 'rgba(11,36,71,0.08)', color: text }}>
                {(tr.full_name || tr.name || 'T').substring(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-xs font-bold truncate" style={{ color: text }}>{tr.full_name || tr.name}</span>
                  <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${STATUS_PILL[tr.safetyStatus]}`}>
                    {tr.safetyStatus}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5 text-[10px]" style={{ color: subtle }}>
                  <MapPin size={10} />
                  <span className="truncate">{t.lastSeenLabel}: {tr.lastSeenTime}</span>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
