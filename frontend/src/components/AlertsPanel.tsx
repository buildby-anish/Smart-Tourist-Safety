import { useState } from 'react'
import { AlertTriangle, Users, Shield, Bell, ChevronRight, X, CheckCircle2, Clock, MapPin } from 'lucide-react'

type Severity = 'high' | 'medium' | 'low' | 'info'

interface Alert {
  id: string
  title: string
  body: string
  location: string
  dist: string
  time: string
  severity: Severity
  read: boolean
  type: 'crowd' | 'safety' | 'police' | 'info'
}

const ALERTS: Alert[] = [
  {
    id: 'a1',
    title: 'High crowd density — Colaba Causeway',
    body: 'Significant crowd buildup near the Apollo Bunder junction. Keep valuables secure and stay alert.',
    location: 'Colaba Causeway',
    dist: '0.5 km',
    time: '5 min ago',
    severity: 'high',
    read: false,
    type: 'crowd',
  },
  {
    id: 'a2',
    title: 'Safe zone registered — Gateway precinct',
    body: 'You are within a registered tourism safety zone. Tourism police are on patrol nearby.',
    location: 'Apollo Bandar',
    dist: '0.2 km',
    time: '12 min ago',
    severity: 'info',
    read: false,
    type: 'safety',
  },
  {
    id: 'a3',
    title: 'Police assistance available',
    body: 'Colaba Tourism Police station is 2.3 km away. Tourist helpline: 1363.',
    location: 'Colaba Police Station',
    dist: '2.3 km',
    time: '22 min ago',
    severity: 'low',
    read: true,
    type: 'police',
  },
  {
    id: 'a4',
    title: 'Weather advisory — strong coastal winds',
    body: 'Marine Drive and Gateway area may experience strong sea winds. Exercise caution near waterfront.',
    location: 'Mumbai Coastline',
    dist: '—',
    time: '1 hr ago',
    severity: 'medium',
    read: true,
    type: 'info',
  },
  {
    id: 'a5',
    title: 'Peak tourist hours — expect delays',
    body: 'Elephanta Caves ferry service is experiencing high demand. Book tickets in advance at the jetty.',
    location: 'Apollo Bunder Jetty',
    dist: '0.9 km',
    time: '2 hr ago',
    severity: 'low',
    read: true,
    type: 'crowd',
  },
]

const SEV: Record<Severity, { color: string; bg: string; label: string; icon: typeof AlertTriangle }> = {
  high:   { color: '#dc2626', bg: 'rgba(220,38,38,0.1)',   label: 'High',   icon: AlertTriangle },
  medium: { color: '#d97706', bg: 'rgba(217,119,6,0.1)',   label: 'Medium', icon: AlertTriangle },
  low:    { color: '#2563eb', bg: 'rgba(37,99,235,0.08)',  label: 'Low',    icon: Bell         },
  info:   { color: '#138808', bg: 'rgba(19,136,8,0.08)',   label: 'Info',   icon: CheckCircle2 },
}

const TYPE_ICON: Record<Alert['type'], typeof AlertTriangle> = {
  crowd:  Users,
  safety: Shield,
  police: Shield,
  info:   Bell,
}

interface Props {
  darkMode: boolean
}

export default function AlertsPanel({ darkMode: dm }: Props) {
  const [alerts, setAlerts] = useState(ALERTS)
  const [filter, setFilter] = useState<Severity | 'all'>('all')

  const markRead = (id: string) =>
    setAlerts((a) => a.map((x) => (x.id === id ? { ...x, read: true } : x)))

  const dismiss = (id: string) =>
    setAlerts((a) => a.filter((x) => x.id !== id))

  const visible = filter === 'all' ? alerts : alerts.filter((a) => a.severity === filter)
  const unread  = alerts.filter((a) => !a.read).length

  const surface = dm ? '#091222' : '#f4f6f9'
  const card    = dm ? '#0c1d33' : '#ffffff'
  const border  = dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
  const text    = dm ? '#f1f5f9' : '#0c2340'
  const subtle  = dm ? 'rgba(255,255,255,0.44)' : 'rgba(12,35,64,0.44)'
  const shadow  = dm ? '0 1px 8px rgba(0,0,0,0.4)' : '0 1px 8px rgba(0,0,0,0.06)'

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: surface, fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex-shrink-0" style={{ borderBottom: `1px solid ${dm ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-xl font-bold" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>Alerts</h1>
          {unread > 0 && (
            <span className="text-xs font-bold text-white px-2 py-0.5 rounded-full" style={{ background: '#dc2626' }}>
              {unread} new
            </span>
          )}
        </div>
        <p className="text-sm mt-0.5" style={{ color: subtle }}>Safety notifications for your area</p>

        {/* Filter chips */}
        <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">
          {(['all', 'high', 'medium', 'low', 'info'] as const).map((f) => {
            const on = filter === f
            const s  = f === 'all' ? null : SEV[f]
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 transition-all duration-100 capitalize"
                style={{
                  background: on ? (s?.color || '#0c2340') : dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
                  color: on ? '#fff' : subtle,
                  border: `1px solid ${on ? (s?.color || '#0c2340') : 'transparent'}`,
                }}
              >
                {f === 'all' ? 'All alerts' : SEV[f].label}
              </button>
            )
          })}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}>
              <CheckCircle2 size={24} style={{ color: subtle }} />
            </div>
            <p className="text-sm text-center" style={{ color: subtle }}>No alerts for this filter</p>
          </div>
        ) : (
          visible.map((alert) => {
            const sev = SEV[alert.severity]
            const SevIcon = sev.icon
            const TypeIcon = TYPE_ICON[alert.type]

            return (
              <div
                key={alert.id}
                className="rounded-xl overflow-hidden transition-all duration-150"
                style={{
                  background: card,
                  border: `1px solid ${alert.read ? border : sev.color + '40'}`,
                  boxShadow: alert.read ? shadow : `0 2px 16px ${sev.color}20`,
                  opacity: alert.read ? 0.75 : 1,
                }}
                onClick={() => markRead(alert.id)}
              >
                {/* Severity strip */}
                <div className="h-0.5" style={{ background: alert.read ? 'transparent' : sev.color }} />

                <div className="p-3.5">
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: sev.bg }}
                    >
                      <TypeIcon size={17} style={{ color: sev.color }} strokeWidth={2} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold leading-snug" style={{ color: text }}>
                          {alert.title}
                          {!alert.read && (
                            <span className="inline-block w-1.5 h-1.5 rounded-full ml-2 align-middle" style={{ background: sev.color }} />
                          )}
                        </p>
                        <button
                          onClick={(e) => { e.stopPropagation(); dismiss(alert.id) }}
                          className="flex-shrink-0 mt-0.5 opacity-40 hover:opacity-70 transition-opacity"
                          aria-label="Dismiss alert"
                        >
                          <X size={14} style={{ color: text }} />
                        </button>
                      </div>

                      <p className="text-xs mt-1.5 leading-relaxed" style={{ color: subtle }}>
                        {alert.body}
                      </p>

                      <div className="flex items-center gap-4 mt-2.5">
                        <div className="flex items-center gap-1" style={{ color: subtle }}>
                          <MapPin size={11} />
                          <span className="text-xs">{alert.location}</span>
                          {alert.dist !== '—' && <span className="text-xs">· {alert.dist}</span>}
                        </div>
                        <div className="flex items-center gap-1 ml-auto" style={{ color: subtle }}>
                          <Clock size={11} />
                          <span className="text-xs">{alert.time}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div className="h-4" />
      </div>
    </div>
  )
}
