import { X, Star, Navigation2, Bookmark, Clock, MapPin, Phone, ExternalLink } from 'lucide-react';

const DB: Record<string, {
  name: string; type: string; rating: number | null; dist: string; open: boolean;
  address: string; desc: string; tags: string[]; phone?: string;
  lat: number; lng: number;
}> = {
  gate: {
    name: 'Gateway of India',
    type: 'Tourist Attraction',
    rating: 4.7,
    dist: '0.8 km',
    open: true,
    address: 'Apollo Bandar, Colaba, Mumbai',
    desc: 'Iconic basalt arch monument on the Mumbai waterfront, built in 1924 to commemorate the visit of King George V and Queen Mary.',
    tags: ['Heritage', 'Photography', 'Waterfront', 'Free entry'],
    phone: '+91 22 2204 4040',
    lat: 18.9220,
    lng: 72.8347
  },
  taj_m: {
    name: 'Taj Mahal Palace',
    type: 'Luxury Hotel',
    rating: 4.8,
    dist: '1.2 km',
    open: true,
    address: 'Apollo Bandar, Colaba, Mumbai 400 001',
    desc: "Legendary 5-star hotel opened in 1903, a landmark of Mumbai's heritage waterfront. Stunning sea views and iconic architecture.",
    tags: ['Heritage', 'Luxury', 'Sea view', '5-star'],
    phone: '+91 22 6665 3366',
    lat: 18.9256,
    lng: 72.8242
  },
  cafe1: {
    name: 'Café Mondegar',
    type: 'Restaurant · Bar',
    rating: 4.4,
    dist: '1.5 km',
    open: true,
    address: '5A Merewether Road, Colaba, Mumbai',
    desc: "Mumbai's beloved jukebox café since 1932, known for its lively atmosphere and hearty continental food.",
    tags: ['Café', 'Heritage', 'Continental', 'Bar'],
    phone: '+91 22 2202 0591',
    lat: 18.9280,
    lng: 72.8300
  },
  colaba: {
    name: 'Colaba Causeway',
    type: 'Market · Shopping',
    rating: 4.3,
    dist: '1.9 km',
    open: true,
    address: 'Shahid Bhagat Singh Rd, Colaba, Mumbai',
    desc: 'Famous street market stretching from the Gateway of India, selling antiques, textiles, jewellery, and street food.',
    tags: ['Shopping', 'Market', 'Street food'],
    lat: 18.9150,
    lng: 72.8280
  },
  hosp1: {
    name: 'St. George Hospital',
    type: 'Government Hospital',
    rating: null,
    dist: '2.1 km',
    open: true,
    address: "P.D'Mello Road, Fort, Mumbai 400 001",
    desc: "One of Mumbai's oldest government hospitals, offering emergency and speciality medical care to residents and tourists.",
    tags: ['Emergency', '24×7', 'Government'],
    phone: '022 2262 3311',
    lat: 18.9300,
    lng: 72.8350
  },
  pol1: {
    name: 'Colaba Police Station',
    type: 'Police Station',
    rating: null,
    dist: '2.3 km',
    open: true,
    address: 'Colaba Causeway, Colaba, Mumbai',
    desc: 'Mumbai Police station serving the Colaba and tourist precinct area. Tourist assistance available around the clock.',
    tags: ['Police', 'Tourist help', '24×7'],
    phone: '100',
    lat: 18.9190,
    lng: 72.8270
  },
  alert1: {
    name: 'Crowd Alert — Colaba Causeway',
    type: 'Safety Alert',
    rating: null,
    dist: '0.5 km',
    open: false,
    address: 'Near Apollo Bandar Junction',
    desc: 'High crowd density detected near Colaba Causeway junction. Exercise caution and keep your belongings secure.',
    tags: ['Alert', 'High crowd', 'Caution'],
    lat: 18.9200,
    lng: 72.8380
  },
  hotel2: {
    name: 'Trident Nariman Point',
    type: 'Luxury Hotel',
    rating: 4.5,
    dist: '3.1 km',
    open: true,
    address: 'Nariman Point, Mumbai 400 021',
    desc: 'Elegant 5-star hotel with panoramic views of Marine Drive and the Arabian Sea.',
    tags: ['Luxury', 'Sea view', '5-star', 'Business'],
    phone: '+91 22 6632 4343',
    lat: 18.9340,
    lng: 72.8260
  },
  rest2: {
    name: 'Leopold Café',
    type: 'Restaurant · Café',
    rating: 4.2,
    dist: '1.0 km',
    open: true,
    address: 'S.B. Singh Road, Colaba, Mumbai',
    desc: 'Mumbai institution since 1871 — one of the oldest and most popular restaurants in the city.',
    tags: ['Historic', 'Multi-cuisine', 'Landmark'],
    phone: '+91 22 2202 0131',
    lat: 18.9240,
    lng: 72.8400
  },
};

const TYPE_COLOR: Record<string, string> = {
  'Tourist Attraction': '#FF9933',
  'Luxury Hotel': '#6366f1',
  'Restaurant · Bar': '#f97316',
  'Restaurant · Café': '#f97316',
  'Market · Shopping': '#0ea5e9',
  'Government Hospital': '#16a34a',
  'Police Station': '#2563eb',
  'Safety Alert': '#dc2626',
};

interface Props {
  placeId: string | null;
  isMobile: boolean;
  darkMode: boolean;
  onClose: () => void;
  onStartDirections?: (lat: number, lng: number, name: string, address: string) => void;
}

export default function PlaceCard({ placeId, isMobile, darkMode: dm, onClose, onStartDirections }: Props) {
  const place = placeId ? (DB[placeId] || DB.gate) : DB.gate;

  const surface = dm ? '#18181b' : '#ffffff';
  const border = dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const text = dm ? '#f1f5f9' : '#0c2340';
  const subtle = dm ? 'rgba(255,255,255,0.48)' : 'rgba(12,35,64,0.48)';
  const tagBg = dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
  const typeColor = TYPE_COLOR[place.type] || '#FF9933';
  const isAlert = place.type === 'Safety Alert';

  const Content = () => (
    <>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: typeColor }}>
          {place.type}
        </span>
        {place.rating !== null && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg" style={{ background: 'rgba(255,153,51,0.1)' }}>
            <Star size={11} style={{ color: '#FF9933', fill: '#FF9933' }} />
            <span className="text-xs font-bold" style={{ color: '#FF9933' }}>{place.rating}</span>
          </div>
        )}
      </div>

      <h3 className="text-[17px] font-bold leading-snug mb-2" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>
        {place.name}
      </h3>

      <div className="flex items-center gap-4 mb-3">
        <div className="flex items-center gap-1.5" style={{ color: subtle }}>
          <MapPin size={12} />
          <span className="text-xs">{place.dist}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock size={12} style={{ color: isAlert ? '#dc2626' : place.open ? '#138808' : '#dc2626' }} />
          <span className="text-xs font-medium" style={{ color: isAlert ? '#dc2626' : place.open ? '#138808' : '#dc2626' }}>
            {isAlert ? 'Active alert' : place.open ? 'Open now' : 'Closed'}
          </span>
        </div>
        {place.phone && (
          <div className="flex items-center gap-1.5 ml-auto" style={{ color: subtle }}>
            <Phone size={12} />
            <span className="text-xs">{place.phone}</span>
          </div>
        )}
      </div>

      <p className="text-sm leading-relaxed mb-3" style={{ color: subtle }}>{place.desc}</p>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {place.tags.map((t) => (
          <span key={t} className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: tagBg, color: subtle }}>
            {t}
          </span>
        ))}
      </div>

      <div className="flex gap-2 pt-3" style={{ borderTop: `1px solid ${border}` }}>
        {!isAlert ? (
          <>
            <button
              onClick={() => {
                if (onStartDirections) {
                  onStartDirections(place.lat, place.lng, place.name, place.address);
                }
              }}
              className="flex-1 h-10 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all hover:opacity-92 active:scale-95 cursor-pointer"
              style={{ background: '#FF9933', boxShadow: '0 2px 12px rgba(255,153,51,0.3)' }}
            >
              <Navigation2 size={14} />
              Directions
            </button>
            <button
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:opacity-75 active:scale-95"
              style={{ background: tagBg, border: `1px solid ${border}` }}
              aria-label="Save"
            >
              <Bookmark size={15} style={{ color: text }} />
            </button>
            {place.phone && (
              <a
                href={`tel:${place.phone.replace(/\s/g, '')}`}
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:opacity-75 active:scale-95"
                style={{ background: tagBg, border: `1px solid ${border}` }}
                aria-label="Call"
              >
                <ExternalLink size={15} style={{ color: text }} />
              </a>
            )}
          </>
        ) : (
          <button
            className="flex-1 h-10 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all hover:opacity-92 active:scale-95"
            style={{ background: '#dc2626', boxShadow: '0 2px 12px rgba(220,38,38,0.3)' }}
          >
            View alert details
          </button>
        )}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div
        className="fixed inset-x-0 bottom-0 z-30 rounded-t-2xl overflow-hidden animate-sheet-up"
        style={{ background: surface, boxShadow: '0 -6px 40px rgba(0,0,0,0.3)', paddingBottom: 'env(safe-area-inset-bottom,16px)' }}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-9 h-1 rounded-full" style={{ background: dm ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }} />
        </div>
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: dm ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)' }}
          aria-label="Close"
        >
          <X size={15} style={{ color: text }} />
        </button>

        <div className="px-5 py-4 pt-6">
          <Content />
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute bottom-6 left-5 w-[340px] rounded-2xl overflow-hidden z-20 animate-modal-in"
      style={{ background: surface, border: `1px solid ${border}`, boxShadow: `0 8px 48px rgba(0,0,0,${dm ? '0.6' : '0.16'})` }}
    >
      <div className="relative flex items-center justify-end px-3 pt-3">
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: tagBg }}
          aria-label="Close"
        >
          <X size={14} style={{ color: text }} />
        </button>
      </div>
      <div className="px-4 pt-1 pb-4">
        <Content />
      </div>
    </div>
  );
}
