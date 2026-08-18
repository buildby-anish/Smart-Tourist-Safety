import { useState } from 'react'
import { Star, MapPin, Clock, ChevronRight, TrendingUp, Shield, Camera, Compass } from 'lucide-react'

// ─── Data ────────────────────────────────────────────────
const FEATURED = [
  {
    id: 'gate',
    name: 'Gateway of India',
    type: 'Tourist Attraction',
    dist: '0.8 km',
    rating: 4.7,
    open: true,
    img: 'https://images.unsplash.com/photo-1529253355930-ddbe423a2ac7?w=480&h=280&fit=crop&auto=format&q=80',
    badge: 'Top Pick',
    badgeColor: '#FF9933',
  },
  {
    id: 'ele',
    name: 'Elephanta Caves',
    type: 'UNESCO Heritage',
    dist: '11 km',
    rating: 4.5,
    open: true,
    img: 'https://images.unsplash.com/photo-1600516196699-cf8e1f9e8478?w=480&h=280&fit=crop&auto=format&q=80',
    badge: 'Must Visit',
    badgeColor: '#138808',
  },
  {
    id: 'marine',
    name: 'Marine Drive',
    type: 'Promenade',
    dist: '3.6 km',
    rating: 4.6,
    open: true,
    img: 'https://images.unsplash.com/photo-1567157577867-05ccb1388e66?w=480&h=280&fit=crop&auto=format&q=80',
    badge: 'Popular',
    badgeColor: '#6366f1',
  },
]

const CATEGORIES = [
  { id: 'heritage',    label: 'Heritage',     icon: Camera,    count: 12, color: '#FF9933' },
  { id: 'nature',      label: 'Nature',       icon: Compass,   count: 8,  color: '#138808' },
  { id: 'food',        label: 'Food & Drink', icon: TrendingUp, count: 34, color: '#f97316' },
  { id: 'safe',        label: 'Safe Zones',   icon: Shield,    count: 6,  color: '#2563eb' },
]

const NEARBY = [
  { id: 'taj_m',  name: 'Taj Mahal Palace Hotel', sub: 'Luxury · 1.2 km',   rating: 4.8, open: true,  img: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=120&h=80&fit=crop&auto=format&q=75' },
  { id: 'cafe1',  name: 'Café Mondegar',           sub: 'Restaurant · 1.5 km', rating: 4.4, open: true,  img: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=120&h=80&fit=crop&auto=format&q=75' },
  { id: 'rest2',  name: 'Leopold Café',            sub: 'Restaurant · 1.0 km', rating: 4.2, open: true,  img: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=120&h=80&fit=crop&auto=format&q=75' },
  { id: 'colaba', name: 'Colaba Causeway',         sub: 'Market · 1.9 km',   rating: 4.3, open: true,  img: 'https://images.unsplash.com/photo-1596422846543-75c6fc197f07?w=120&h=80&fit=crop&auto=format&q=75' },
  { id: 'hotel2', name: 'Trident Nariman Point',   sub: 'Hotel · 3.1 km',    rating: 4.5, open: true,  img: 'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=120&h=80&fit=crop&auto=format&q=75' },
  { id: 'cst',    name: 'CST Heritage Station',    sub: 'Heritage · 4.2 km', rating: 4.8, open: true,  img: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?w=120&h=80&fit=crop&auto=format&q=75' },
]

const SAFETY_TIPS = [
  { tip: 'Keep a copy of your Tourist ID in your phone gallery.' },
  { tip: 'Register your stay with local tourism police for assistance.' },
  { tip: 'Use Suraksha Setu\'s SOS button if you feel unsafe — authorities are alerted instantly.' },
  { tip: 'Share your live location with a trusted contact when exploring solo.' },
]

interface Props {
  darkMode: boolean
  isMobile: boolean
  onPlaceSelect: (id: string) => void
}

export default function ExplorePanel({ darkMode: dm, isMobile, onPlaceSelect }: Props) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  const surface  = dm ? '#091222' : '#f4f6f9'
  const card     = dm ? '#0c1d33' : '#ffffff'
  const border   = dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
  const text     = dm ? '#f1f5f9' : '#0c2340'
  const subtle   = dm ? 'rgba(255,255,255,0.44)' : 'rgba(12,35,64,0.44)'
  const divider  = dm ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  const shadow   = dm ? '0 2px 12px rgba(0,0,0,0.4)' : '0 2px 12px rgba(0,0,0,0.07)'

  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ background: surface, fontFamily: 'Inter, sans-serif' }}
    >
      {/* ── Header ── */}
      <div className="px-5 pt-5 pb-4" style={{ borderBottom: `1px solid ${divider}` }}>
        <h1 className="text-xl font-bold leading-none" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>
          Explore
        </h1>
        <p className="text-sm mt-1" style={{ color: subtle }}>
          Discover places, plan your itinerary, stay safe
        </p>
      </div>

      <div className="px-5 py-5 space-y-7">

        {/* ── Categories ── */}
        <section>
          <SectionHeader label="Browse by category" subtle={subtle} />
          <div className="grid grid-cols-2 gap-3">
            {CATEGORIES.map(({ id, label, icon: Icon, count, color }) => {
              const on = activeCategory === id
              return (
                <button
                  key={id}
                  onClick={() => setActiveCategory(on ? null : id)}
                  className="flex items-center gap-3 p-3.5 rounded-xl text-left transition-all duration-150 active:scale-[0.98]"
                  style={{
                    background: on ? color : card,
                    border: `1px solid ${on ? color : border}`,
                    boxShadow: on ? `0 2px 16px ${color}33` : shadow,
                  }}
                  aria-pressed={on}
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: on ? 'rgba(255,255,255,0.2)' : `${color}15` }}
                  >
                    <Icon size={17} style={{ color: on ? '#fff' : color }} strokeWidth={2} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: on ? '#fff' : text }}>{label}</p>
                    <p className="text-xs mt-0.5" style={{ color: on ? 'rgba(255,255,255,0.65)' : subtle }}>{count} places</p>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        {/* ── Featured ── */}
        <section>
          <SectionHeader label="Featured in Mumbai" subtle={subtle} action="See all" />
          <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-5 px-5">
            {FEATURED.map((f) => (
              <button
                key={f.id}
                onClick={() => onPlaceSelect(f.id)}
                className="flex-shrink-0 rounded-2xl overflow-hidden text-left transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]"
                style={{ width: isMobile ? 220 : 260, background: card, border: `1px solid ${border}`, boxShadow: shadow }}
              >
                <div className="relative">
                  <img src={f.img} alt={f.name} className="w-full object-cover" style={{ height: 140 }} />
                  <div
                    className="absolute inset-0"
                    style={{ background: 'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.5))' }}
                  />
                  {/* Badge */}
                  <span
                    className="absolute top-2.5 left-2.5 text-[10px] font-bold text-white px-2 py-1 rounded-full"
                    style={{ background: f.badgeColor }}
                  >
                    {f.badge}
                  </span>
                </div>
                <div className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>{f.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: subtle }}>{f.type}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Star size={11} style={{ color: '#FF9933', fill: '#FF9933' }} />
                      <span className="text-xs font-semibold" style={{ color: '#FF9933' }}>{f.rating}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <div className="flex items-center gap-1" style={{ color: subtle }}>
                      <MapPin size={11} />
                      <span className="text-xs">{f.dist}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock size={11} style={{ color: f.open ? '#138808' : '#dc2626' }} />
                      <span className="text-xs font-medium" style={{ color: f.open ? '#138808' : '#dc2626' }}>
                        {f.open ? 'Open' : 'Closed'}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* ── Nearby ── */}
        <section>
          <SectionHeader label="Nearby places" subtle={subtle} action="Map view" />
          <div className="space-y-2">
            {NEARBY.map((n) => (
              <button
                key={n.id}
                onClick={() => onPlaceSelect(n.id)}
                className="w-full flex items-center gap-3.5 p-3 rounded-xl text-left transition-all duration-150 active:scale-[0.98]"
                style={{ background: card, border: `1px solid ${border}`, boxShadow: shadow }}
              >
                <img
                  src={n.img}
                  alt={n.name}
                  className="w-14 h-12 rounded-xl object-cover flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: text }}>{n.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: subtle }}>{n.sub}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <div className="flex items-center gap-1">
                    <Star size={11} style={{ color: '#FF9933', fill: '#FF9933' }} />
                    <span className="text-xs font-semibold" style={{ color: text }}>{n.rating}</span>
                  </div>
                  <ChevronRight size={14} style={{ color: subtle }} />
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* ── Safety tips ── */}
        <section>
          <SectionHeader label="Safety tips" subtle={subtle} />
          <div className="space-y-2.5">
            {SAFETY_TIPS.map((s, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3.5 rounded-xl"
                style={{ background: dm ? 'rgba(19,136,8,0.07)' : 'rgba(19,136,8,0.05)', border: '1px solid rgba(19,136,8,0.15)' }}
              >
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: '#138808', fontSize: 10, color: '#fff', fontWeight: 700 }}
                >
                  {i + 1}
                </div>
                <p className="text-sm leading-relaxed" style={{ color: text }}>{s.tip}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom padding for nav */}
        <div className="h-4" />
      </div>
    </div>
  )
}

function SectionHeader({ label, subtle, action }: { label: string; subtle: string; action?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-bold" style={{ color: subtle === 'rgba(255,255,255,0.44)' ? '#f1f5f9' : '#0c2340', fontFamily: 'Outfit, sans-serif' }}>
        {label}
      </h2>
      {action && (
        <button className="text-xs font-semibold text-[#FF9933] hover:underline transition-opacity hover:opacity-80">
          {action}
        </button>
      )}
    </div>
  )
}
