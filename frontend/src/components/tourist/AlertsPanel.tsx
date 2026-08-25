import { useEffect, useState } from 'react';
import { AlertTriangle, Bell, Info, ShieldAlert, RefreshCw, Loader2, LogIn } from 'lucide-react';
import { listAlerts, ApiError } from '../../lib/api';

interface Props {
  darkMode: boolean;
  isAuthenticated: boolean;
  onSignIn: () => void;
}

interface AlertRow {
  alert_id: string;
  incident_id: string;
  channel: string;
  recipient: string;
  sent_at: string;
}

export default function AlertsPanel({ darkMode: dm, isAuthenticated, onSignIn }: Props) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [errMsg, setErrMsg] = useState('');

  const load = () => {
    if (!isAuthenticated) return;
    setState('loading'); setErrMsg('');
    listAlerts()
      .then((rows) => { setAlerts(rows as AlertRow[]); setState('ready'); })
      .catch((err) => {
        setErrMsg(err instanceof ApiError ? err.message : 'Could not load alerts. Check your connection.');
        setState('error');
      });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isAuthenticated]);

  const surface = dm ? '#18181b' : '#f4f6f9';
  const card = dm ? '#27272a' : '#ffffff';
  const border = dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const text = dm ? '#f1f5f9' : '#0c2340';
  const subtle = dm ? 'rgba(255,255,255,0.44)' : 'rgba(12,35,64,0.44)';
  const divider = dm ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: surface, fontFamily: 'Inter, sans-serif' }}>
      <div className="px-5 pt-5 pb-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${divider}` }}>
        <div>
          <h1 className="text-xl font-bold leading-none" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>Alerts</h1>
          <p className="text-sm mt-1" style={{ color: subtle }}>Safety alerts for your area</p>
        </div>
        {isAuthenticated && (
          <button onClick={load} aria-label="Refresh" className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: card, border: `1px solid ${border}` }}>
            <RefreshCw size={14} style={{ color: subtle }} className={state === 'loading' ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      <div className="px-5 py-5">
        {!isAuthenticated && (
          <EmptyState
            icon={<LogIn size={26} style={{ color: '#FF9933' }} />}
            title="Sign in to view alerts"
            body="Personalized safety alerts for your itinerary and location require a signed-in Tourist ID."
            action={<button onClick={onSignIn} className="h-10 px-6 rounded-xl text-sm font-bold text-white" style={{ background: '#FF9933' }}>Sign in</button>}
            dm={dm} text={text} subtle={subtle}
          />
        )}

        {isAuthenticated && state === 'loading' && (
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`h-16 rounded-xl ${dm ? 'skeleton' : 'skeleton-light'}`} />
            ))}
          </div>
        )}

        {isAuthenticated && state === 'error' && (
          <EmptyState
            icon={<AlertTriangle size={26} style={{ color: '#dc2626' }} />}
            title="Couldn't load alerts"
            body={errMsg}
            action={<button onClick={load} className="h-10 px-6 rounded-xl text-sm font-bold text-white" style={{ background: '#dc2626' }}>Retry</button>}
            dm={dm} text={text} subtle={subtle}
          />
        )}

        {isAuthenticated && state === 'ready' && alerts.length === 0 && (
          <EmptyState
            icon={<Bell size={26} style={{ color: '#138808' }} />}
            title="No active alerts"
            body="You're all clear. We'll notify you here if a safety alert is issued near you."
            dm={dm} text={text} subtle={subtle}
          />
        )}

        {isAuthenticated && state === 'ready' && alerts.length > 0 && (
          <div className="space-y-2.5">
            {alerts.map((a) => (
              <div key={a.alert_id} className="flex items-start gap-3 p-3.5 rounded-xl" style={{ background: card, border: `1px solid ${border}` }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(220,38,38,0.1)' }}>
                  <ShieldAlert size={16} style={{ color: '#dc2626' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: text }}>Alert · {a.channel}</p>
                  <p className="text-xs mt-0.5" style={{ color: subtle }}>To {a.recipient}</p>
                  <p className="text-[11px] mt-1" style={{ color: subtle }}>{new Date(a.sent_at).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon, title, body, action, dm, text, subtle }: {
  icon: React.ReactNode; title: string; body: string; action?: React.ReactNode;
  dm: boolean; text: string; subtle: string;
}) {
  return (
    <div className="flex flex-col items-center text-center py-10 gap-3">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}>
        {icon}
      </div>
      <p className="text-base font-semibold" style={{ color: text }}>{title}</p>
      <p className="text-sm max-w-[280px] leading-relaxed" style={{ color: subtle }}>{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
