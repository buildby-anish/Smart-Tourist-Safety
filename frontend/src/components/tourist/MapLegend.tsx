import { useState } from 'react';
import { Layers, X } from 'lucide-react';

const ITEMS = [
  { color: '#FF9933', label: 'Tourist attractions' },
  { color: '#f97316', label: 'Restaurants' },
  { color: '#6366f1', label: 'Hotels' },
  { color: '#2563eb', label: 'Police stations' },
  { color: '#16a34a', label: 'Hospitals' },
  { color: '#dc2626', label: 'Safety alerts' },
  { color: '#d97706', label: 'Crowd areas' },
  { color: '#0b2447', label: 'Your location' },
];

interface Props { darkMode: boolean }

export default function MapLegend({ darkMode: dm }: Props) {
  const [open, setOpen] = useState(false);

  const surface = dm ? '#27272a' : '#ffffff';
  const border = dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)';
  const text = dm ? '#f1f5f9' : '#0c2340';
  const subtle = dm ? 'rgba(255,255,255,0.44)' : 'rgba(12,35,64,0.44)';

  return (
    <div className="relative">
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

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute bottom-full right-0 mb-2 w-56 rounded-2xl overflow-hidden z-50 animate-modal-in"
            style={{ background: surface, border: `1px solid ${border}`, boxShadow: '0 8px 40px rgba(0,0,0,0.35)' }}
          >
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${border}` }}>
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: text }}>Map legend</p>
              <button onClick={() => setOpen(false)} aria-label="Close"><X size={13} style={{ color: subtle }} /></button>
            </div>
            <div className="py-2">
              {ITEMS.map((item) => (
                <div key={item.label} className="flex items-center gap-2.5 px-4 py-1.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
                  <span className="text-xs" style={{ color: text }}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
