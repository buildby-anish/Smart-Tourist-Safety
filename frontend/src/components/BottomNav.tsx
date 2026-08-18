import { Map, Compass, Route, Bell, User } from 'lucide-react'

const TABS = [
  { id: 'map',     label: 'Map',     Icon: Map,     protected: false },
  { id: 'explore', label: 'Explore', Icon: Compass,  protected: false },
  { id: 'trips',   label: 'Trips',   Icon: Route,    protected: true  },
  { id: 'alerts',  label: 'Alerts',  Icon: Bell,     protected: false },
  { id: 'profile', label: 'Profile', Icon: User,     protected: true  },
]

interface Props {
  active: string
  darkMode: boolean
  onChange: (id: string) => void
  onProtected: (id: string) => void
  isAuthenticated: boolean
  alertCount?: number
}

export default function BottomNav({ active, darkMode: dm, onChange, onProtected, isAuthenticated, alertCount = 2 }: Props) {
  const bg     = dm ? '#0a1628' : '#ffffff'
  const border = dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)'

  const handle = (id: string, prot: boolean) => {
    if (prot && !isAuthenticated) { onProtected(id); return }
    onChange(id)
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex items-stretch"
      style={{
        background: bg,
        borderTop: `1px solid ${border}`,
        boxShadow: `0 -4px 24px rgba(0,0,0,${dm ? '0.45' : '0.08'})`,
        paddingBottom: 'env(safe-area-inset-bottom, 6px)',
        minHeight: 60,
      }}
      aria-label="Main navigation"
    >
      {TABS.map(({ id, label, Icon, protected: prot }) => {
        const on   = active === id
        const iconC = on ? '#FF9933' : dm ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.38)'
        const textC = on ? '#FF9933' : dm ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.35)'

        return (
          <button
            key={id}
            onClick={() => handle(id, prot)}
            aria-label={label}
            aria-current={on ? 'page' : undefined}
            className="flex-1 flex flex-col items-center justify-center gap-[5px] pt-2 pb-1.5 relative transition-all duration-100 active:scale-95"
          >
            {/* Top indicator */}
            <div
              className="absolute top-0 left-1/2 -translate-x-1/2 rounded-full transition-all duration-200"
              style={{
                width: on ? 28 : 0,
                height: 2.5,
                background: '#FF9933',
                opacity: on ? 1 : 0,
              }}
            />

            <div className="relative">
              <Icon size={20} strokeWidth={on ? 2.5 : 1.8} style={{ color: iconC, transition: 'color 0.15s, stroke-width 0.15s' }} />
              {id === 'alerts' && alertCount > 0 && (
                <span
                  className="absolute -top-1 -right-2 min-w-[16px] h-4 flex items-center justify-center rounded-full text-white font-bold"
                  style={{ background: '#dc2626', fontSize: 9, padding: '0 3px' }}
                >
                  {alertCount}
                </span>
              )}
              {prot && !isAuthenticated && id !== 'alerts' && (
                <span
                  className="absolute -top-0.5 -right-1.5 w-2 h-2 rounded-full"
                  style={{ background: dm ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)', border: `1.5px solid ${bg}` }}
                />
              )}
            </div>

            <span className="text-[10px] font-medium leading-none" style={{ color: textC, transition: 'color 0.15s' }}>
              {label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
