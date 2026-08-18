import { useState } from 'react'
import { Shield, AlertTriangle, X, ChevronRight } from 'lucide-react'

type SafetyLevel = 'safe' | 'caution' | 'alert'

const LEVELS: Record<SafetyLevel, {
  label: string; body: string; color: string; bg: string; icon: typeof Shield
}> = {
  safe:    { label: 'Safe area',          body: 'You are within a registered tourism safety zone. Police on patrol.',                   color: '#138808', bg: 'rgba(19,136,8,0.12)',  icon: Shield        },
  caution: { label: 'Caution advised',    body: 'Elevated crowd levels detected nearby. Keep belongings secure.',                        color: '#d97706', bg: 'rgba(217,119,6,0.12)', icon: AlertTriangle },
  alert:   { label: 'Active safety alert',body: 'A safety alert is active in this area. Tap for details and recommended actions.',      color: '#dc2626', bg: 'rgba(220,38,38,0.12)', icon: AlertTriangle },
}

interface Props {
  darkMode: boolean
  level?: SafetyLevel
  onAlertsTap: () => void
}

export default function SafetyBanner({ darkMode: dm, level = 'safe', onAlertsTap }: Props) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const cfg = LEVELS[level]
  const Icon = cfg.icon

  return (
    <div
      className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl animate-fade-in"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.color}30`,
        backdropFilter: 'blur(12px)',
      }}
    >
      <Icon size={15} style={{ color: cfg.color, flexShrink: 0 }} strokeWidth={2.5} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold" style={{ color: cfg.color }}>{cfg.label}</span>
        </div>
        <p className="text-[11px] leading-snug mt-0.5 line-clamp-1" style={{ color: cfg.color, opacity: 0.8 }}>
          {cfg.body}
        </p>
      </div>

      <button
        onClick={onAlertsTap}
        className="flex items-center gap-0.5 flex-shrink-0 transition-opacity hover:opacity-70"
        aria-label="View alerts"
      >
        <span className="text-xs font-semibold" style={{ color: cfg.color }}>Details</span>
        <ChevronRight size={12} style={{ color: cfg.color }} />
      </button>

      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 transition-opacity hover:opacity-60"
        aria-label="Dismiss"
      >
        <X size={13} style={{ color: cfg.color }} />
      </button>
    </div>
  )
}
