import { useState, ReactNode } from 'react';
import { X, Phone, ShieldAlert, MapPin, Battery, Globe, IdCard, Users, Clock, Radio, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Language, SOSIncident, TouristProfile, PatrollingUnit } from '../../types';
import { i18n } from '../../data/i18n';

interface Props {
  language: Language;
  darkMode: boolean;
  queue: SOSIncident[];
  activeIndex: number;
  onSwitchIndex: (i: number) => void;
  tourist: TouristProfile | null;
  units: PatrollingUnit[];
  onDispatchUnit: (incidentId: string, unitId: string) => void;
  onResolveIncident: (incidentId: string) => void;
  onSendBroadcastForIncident: (incident: SOSIncident) => void;
  onClose: () => void;
}

export default function SOSTakeover({
  language, darkMode: dm, queue, activeIndex, onSwitchIndex, tourist, units,
  onDispatchUnit, onResolveIncident, onSendBroadcastForIncident, onClose,
}: Props) {
  const t = i18n[language];
  const incident = queue[activeIndex];
  const [showUnitPicker, setShowUnitPicker] = useState(false);

  if (!incident) return null;

  const availableUnits = units.filter((u) => u.status === 'Patrolling' || u.status === 'Standby');
  const text = '#f1f5f9';
  const subtle = 'rgba(255,255,255,0.55)';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6" style={{ background: 'rgba(9,9,11,0.85)', backdropFilter: 'blur(4px)' }}>
      <div
        className="w-full max-w-2xl max-h-[92vh] rounded-3xl overflow-hidden flex flex-col animate-modal-in"
        style={{ background: '#18181b', border: '1px solid rgba(220,38,38,0.4)', boxShadow: '0 0 0 4px rgba(220,38,38,0.15), 0 24px 80px rgba(0,0,0,0.6)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ background: 'rgba(220,38,38,0.15)', borderBottom: '1px solid rgba(220,38,38,0.3)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center animate-pulse-glow" style={{ background: '#dc2626' }}>
              <ShieldAlert size={18} style={{ color: '#fff' }} />
            </div>
            <div>
              <p className="text-sm font-black tracking-wide" style={{ color: text }}>{t.sosTakeoverTitle}</p>
              <p className="text-[11px] font-mono" style={{ color: subtle }}>{incident.id} · {incident.hazardType}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {queue.length > 1 && (
              <div className="flex items-center gap-1 mr-1">
                <button onClick={() => onSwitchIndex((activeIndex - 1 + queue.length) % queue.length)} className="w-7 h-7 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20">
                  <ChevronLeft size={14} style={{ color: text }} />
                </button>
                <span className="text-[10px] font-bold px-1" style={{ color: subtle }}>{activeIndex + 1}/{queue.length}</span>
                <button onClick={() => onSwitchIndex((activeIndex + 1) % queue.length)} className="w-7 h-7 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20">
                  <ChevronRight size={14} style={{ color: text }} />
                </button>
              </div>
            )}
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20">
              <X size={15} style={{ color: text }} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Tourist identity */}
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 font-black text-lg" style={{ background: 'rgba(255,255,255,0.08)', color: text }}>
              {(tourist?.full_name || incident.touristName || 'T').substring(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-black" style={{ color: text }}>{tourist?.full_name || incident.touristName}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px]" style={{ color: subtle }}>
                {tourist?.tourist_id && <span className="flex items-center gap-1"><IdCard size={11} />{tourist.tourist_id}</span>}
                {tourist?.nationality && <span className="flex items-center gap-1"><Globe size={11} />{tourist.nationality}</span>}
                {tourist?.preferred_language && <span>{tourist.preferred_language}</span>}
              </div>
            </div>
          </div>

          {/* Key facts grid */}
          <div className="grid grid-cols-2 gap-2.5">
            <InfoTile icon={<MapPin size={13} />} label="Location" value={`${incident.location.lat.toFixed(4)}, ${incident.location.lng.toFixed(4)}`} />
            <InfoTile icon={<Clock size={13} />} label="Triggered" value={incident.timestamp} />
            {tourist?.batteryLevel != null && <InfoTile icon={<Battery size={13} />} label="Battery" value={`${tourist.batteryLevel}%`} />}
            {incident.aiRiskScore != null && <InfoTile icon={<ShieldAlert size={13} />} label="AI Risk Score" value={`${incident.aiRiskScore}/100`} />}
            {tourist?.kyc_verified != null && <InfoTile icon={<CheckCircle2 size={13} />} label="KYC" value={tourist.kyc_verified ? 'Verified' : 'Pending'} />}
            {tourist?.hotel && <InfoTile icon={<MapPin size={13} />} label="Hotel" value={tourist.hotel} />}
          </div>

          {/* Emergency contact */}
          {(tourist?.emergencyContact || tourist?.emergency_contact) && (
            <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-[10px] font-extrabold uppercase tracking-wider mb-1.5 flex items-center gap-1.5" style={{ color: subtle }}>
                <Users size={11} /> {t.emergencyContactsLabel}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold" style={{ color: text }}>
                  {tourist?.emergencyContact || tourist?.emergency_contact} {tourist?.emergencyRelation && `(${tourist.emergencyRelation})`}
                </span>
              </div>
            </div>
          )}

          {incident.notes && (
            <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-[10px] font-extrabold uppercase tracking-wider mb-1" style={{ color: subtle }}>Notes</p>
              <p className="text-xs" style={{ color: text }}>{incident.notes}</p>
            </div>
          )}

          {/* Unit picker (shown inline when Dispatch is tapped) */}
          {showUnitPicker && (
            <div className="rounded-xl p-3 space-y-1.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-[10px] font-extrabold uppercase tracking-wider mb-1" style={{ color: subtle }}>Select unit to dispatch</p>
              {availableUnits.length === 0 ? (
                <p className="text-xs" style={{ color: subtle }}>No available units right now.</p>
              ) : (
                availableUnits.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => { onDispatchUnit(incident.id, u.id); setShowUnitPicker(false); }}
                    className="w-full text-left flex items-center justify-between px-3 py-2 rounded-lg transition-colors hover:bg-white/10"
                    style={{ background: 'rgba(255,255,255,0.03)' }}
                  >
                    <span className="text-xs font-bold" style={{ color: text }}>{u.unitName}</span>
                    <span className="text-[10px]" style={{ color: subtle }}>{u.type}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* One-tap response actions */}
        <div className="grid grid-cols-2 gap-2 p-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <a
            href={`tel:${tourist?.phone || incident.touristPhone}`}
            className="h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 text-white transition-opacity hover:opacity-90"
            style={{ background: '#138808' }}
          >
            <Phone size={14} /> {t.callTouristBtn}
          </a>
          <button
            onClick={() => setShowUnitPicker((v) => !v)}
            className="h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 text-white transition-opacity hover:opacity-90"
            style={{ background: '#0B2447' }}
          >
            <Radio size={14} /> {t.dispatchUnitBtn}
          </button>
          <button
            onClick={() => onSendBroadcastForIncident(incident)}
            className="h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 text-white transition-opacity hover:opacity-90"
            style={{ background: '#FF9933' }}
          >
            <ShieldAlert size={14} /> {t.sendBroadcastBtn}
          </button>
          <button
            onClick={() => onResolveIncident(incident.id)}
            className="h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 text-white transition-opacity hover:opacity-90"
            style={{ background: '#475569' }}
          >
            <CheckCircle2 size={14} /> {t.resolveBtn}
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl p-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <p className="text-[9px] font-extrabold uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
        {icon} {label}
      </p>
      <p className="text-xs font-bold truncate" style={{ color: '#f1f5f9' }}>{value}</p>
    </div>
  );
}
