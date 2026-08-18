import { MapPin, Utensils, Hotel, ShieldCheck, Building2, HeartPulse, Navigation, Flame, Users } from 'lucide-react'

const CHIPS = [
  { id: null,          label: 'Nearby',      Icon: Navigation  },
  { id: 'attraction',  label: 'Attractions', Icon: MapPin      },
  { id: 'restaurant',  label: 'Restaurants', Icon: Utensils    },
  { id: 'hotel',       label: 'Hotels',      Icon: Hotel       },
  { id: 'safe',        label: 'Safe Places', Icon: ShieldCheck },
  { id: 'police',      label: 'Police',      Icon: Building2   },
  { id: 'hospital',    label: 'Hospitals',   Icon: HeartPulse  },
  { id: 'crowd',       label: 'Crowd',       Icon: Users       },
  { id: 'alert',       label: 'Alerts',      Icon: Flame       },
]

interface Props {
  darkMode: boolean
  active: string | null
  onChange: (id: string | null) => void
}

export default function QuickActions({ darkMode: dm, active, onChange }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar">
      {CHIPS.map(({ id, label, Icon }) => {
        const on = active === id

        return (
          <button
            key={label}
            onClick={() => onChange(on ? null : id)}
            aria-pressed={on}
            className="flex items-center gap-1.5 px-3.5 py-[7px] rounded-full border text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all duration-150 active:scale-95"
            style={{
              background: on
                ? '#FF9933'
                : dm ? 'rgba(10,20,40,0.88)' : 'rgba(255,255,255,0.94)',
              borderColor: on
                ? '#FF9933'
                : dm ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
              color: on ? '#ffffff' : dm ? 'rgba(255,255,255,0.8)' : '#0c2340',
              backdropFilter: 'blur(12px)',
              boxShadow: on
                ? '0 2px 12px rgba(255,153,51,0.35)'
                : `0 1px 6px rgba(0,0,0,${dm ? '0.4' : '0.08'})`,
            }}
          >
            <Icon size={12} strokeWidth={on ? 2.5 : 2} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
