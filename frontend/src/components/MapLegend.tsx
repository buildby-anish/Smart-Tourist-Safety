import { useState } from 'react'
import { Layers, ChevronDown, X } from 'lucide-react'

const ITEMS = [
  { color: '#FF9933', label: 'Tourist attractions',    shape: 'pin' },
  { color: '#f97316', label: 'Restaurants',            shape: 'pin' },
  { color: '#6366f1', label: 'Hotels',                 shape: 'pin' },
  { color: '#2563eb', label: 'Police stations',        shape: 'pin' },
  { color: '#16a34a', label: 'Hospitals',              shape: 'pin' },
  { color: '#dc2626', label: 'Safety alerts',          shape: 'circle' },
  { color: '#138808', label: 'Safe zone boundary',     shape: 'dashed' },
  { color: '#0b2447', label: 'Your location',          shape: 'user' },
  { color: '#FF9933', label: 'Suggested route',        shape: 'route' },
]

interface Props { darkMode: boolean }

export default function MapLegend({ darkMode: dm }: Props) {
  const [open, setOpen] = useState(false)

  const surface = dm ? '#0c1d33' : '#ffffff'
  const border  = dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)'
  const text    = dm ? '#f1f5f9' : '#0c2340'
  const subtle  = dm ? 'rgba(255,255,255,0.44)' : 'rgba(12,35,64,0.44)'

  return (
    <div className="relative">
      {/* Toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-95"
        style={{
          background: open ? '#FF9933' : surface,
          border: `1px solid ${open ? '#FF9933' : border}`,
          boxShadow: open ? '0 2px 12px rgba(255,153,51,0.35)' : '0 2px 12px rgba(0,0,0,0.25)',
        }}
        aria-label="Map legend"
        aria-expanded={open}
      >
        <Layers size={16} style={{ color: open ? '#fff' : text }} />
      </button>

      {/* Legend panel */}
      {open && (
        <div
          className="absolute bottom-full right-0 mb-2 w-52 rounded-xl overflow-hidden animate-modal-in"
          style={{
            background: surface,
            border: `1px solid ${border}`,
            boxShadow: dm ? '0 8px 32px rgba(0,0,0,0.6)' : '0 8px 32px rgba(0,0,0,0.15)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${border}` }}>
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: subtle, letterSpacing: '0.07em' }}>
              Map Legend
            </span>
            <button onClick={() => setOpen(false)} aria-label="Close legend">
              <X size={14} style={{ color: subtle }} />
            </button>
          </div>

          {/* Items */}
          <div className="px-3 py-2.5 space-y-2">
            {ITEMS.map(({ color, label, shape }) => (
              <div key={label} className="flex items-center gap-3">
                <LegendSymbol color={color} shape={shape as any} />
                <span className="text-xs" style={{ color: text }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function LegendSymbol({ color, shape }: { color: string; shape: 'pin' | 'circle' | 'dashed' | 'user' | 'route' }) {
  const size = 16

  if (shape === 'pin') {
    return (
      <div className="flex flex-col items-center flex-shrink-0" style={{ width: 14 }}>
        <div className="rounded-full" style={{ width: 10, height: 10, background: color, border: `2px solid ${color}` }} />
        <div style={{ width: 0, height: 0, borderLeft: '3px solid transparent', borderRight: '3px solid transparent', borderTop: `5px solid ${color}` }} />
      </div>
    )
  }

  if (shape === 'circle') {
    return (
      <div className="rounded-full flex-shrink-0" style={{ width: 14, height: 14, background: color + '20', border: `1.5px solid ${color}` }} />
    )
  }

  if (shape === 'dashed') {
    return (
      <div className="flex-shrink-0" style={{ width: 14, height: 2, borderTop: `1.5px dashed ${color}` }} />
    )
  }

  if (shape === 'user') {
    return (
      <div
        className="rounded-full flex-shrink-0 flex items-center justify-center"
        style={{ width: 14, height: 14, background: color, border: '2px solid #FF9933' }}
      >
        <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#FF9933' }} />
      </div>
    )
  }

  // route
  return (
    <div className="flex-shrink-0" style={{ width: 14, height: 2, borderTop: `2px dashed ${color}` }} />
  )
}
