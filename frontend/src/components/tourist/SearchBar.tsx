import { useState, useRef } from 'react';
import { Search, X, MapPin, Star, ChevronRight } from 'lucide-react';

// No backend "places search" endpoint exists in this project — these
// suggestions mirror the same static POI set used on the map (see
// MapCanvas.tsx POIS) rather than a fabricated search backend.
const SUGGESTIONS = [
  { id: 'gate', label: 'Gateway of India', sub: 'Tourist attraction · Colaba', dist: '0.8 km', rating: 4.7 },
  { id: 'colaba', label: 'Colaba Causeway', sub: 'Market · Shopping', dist: '1.9 km', rating: 4.3 },
  { id: 'taj_m', label: 'Taj Mahal Palace', sub: 'Luxury hotel · Colaba', dist: '1.2 km', rating: 4.8 },
  { id: 'cafe1', label: 'Café Mondegar', sub: 'Restaurant · Colaba', dist: '1.5 km', rating: 4.4 },
  { id: 'rest2', label: 'Leopold Café', sub: 'Restaurant · Colaba', dist: '1.0 km', rating: 4.2 },
];

interface Props {
  darkMode: boolean;
  onSelect: (id: string, label: string) => void;
}

export default function SearchBar({ darkMode: dm, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = query.length > 0
    ? SUGGESTIONS.filter((s) => s.label.toLowerCase().includes(query.toLowerCase()))
    : [];

  const showPanel = focused;

  const surface = dm ? 'rgba(10,20,40,0.95)' : 'rgba(255,255,255,0.97)';
  const text = dm ? '#f1f5f9' : '#0c2340';
  const subtle = dm ? 'rgba(255,255,255,0.42)' : 'rgba(12,35,64,0.45)';
  const divider = dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const hoverBg = dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const borderC = focused ? '#FF9933' : dm ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

  return (
    <div className="relative w-full">
      <div
        className="flex items-center gap-3 px-4 h-12 rounded-xl transition-all duration-150"
        style={{
          background: surface,
          border: `1.5px solid ${borderC}`,
          boxShadow: focused
            ? `0 0 0 3px rgba(255,153,51,0.15), 0 4px 24px rgba(0,0,0,${dm ? '0.5' : '0.12'})`
            : `0 2px 16px rgba(0,0,0,${dm ? '0.45' : '0.10'})`,
          backdropFilter: 'blur(16px)',
        }}
      >
        <Search size={17} strokeWidth={2.2} style={{ color: focused ? '#FF9933' : subtle, flexShrink: 0, transition: 'color 0.15s' }} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 180)}
          placeholder="Search places, attractions, hotels..."
          className="flex-1 bg-transparent text-[15px] leading-none outline-none"
          style={{ color: text, fontFamily: 'Inter, sans-serif' }}
          aria-label="Search places"
          autoComplete="off"
          autoCorrect="off"
        />
        {query && (
          <button
            onMouseDown={(e) => { e.preventDefault(); setQuery(''); inputRef.current?.focus(); }}
            aria-label="Clear"
            style={{ color: subtle, flexShrink: 0 }}
            className="transition-opacity hover:opacity-70"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {showPanel && (
        <div
          className="absolute left-0 right-0 top-full mt-2 rounded-xl overflow-hidden z-50 animate-fade-in"
          style={{
            background: surface,
            border: `1px solid ${divider}`,
            backdropFilter: 'blur(20px)',
            boxShadow: `0 12px 48px rgba(0,0,0,${dm ? '0.65' : '0.18'})`,
          }}
        >
          {query.length === 0 ? (
            <div className="py-2">
              <SectionLabel label="Places on the map" color={subtle} />
              {SUGGESTIONS.map((s) => (
                <SuggestionRow key={s.id} item={s} text={text} subtle={subtle} hover={hoverBg} onSelect={onSelect} />
              ))}
            </div>
          ) : results.length > 0 ? (
            <div className="py-2">
              {results.map((s) => (
                <SuggestionRow key={s.id} item={s} text={text} subtle={subtle} hover={hoverBg} onSelect={onSelect} />
              ))}
            </div>
          ) : (
            <div className="py-10 text-center" style={{ color: subtle, fontSize: 14 }}>
              No places found for "{query}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ label, color }: { label: string; color: string }) {
  return (
    <p className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest" style={{ color, letterSpacing: '0.08em' }}>
      {label}
    </p>
  );
}

function SuggestionRow({ item, text, subtle, hover, onSelect }: {
  item: (typeof SUGGESTIONS)[0]; text: string; subtle: string; hover: string; onSelect: (id: string, label: string) => void;
}) {
  return (
    <button
      onMouseDown={() => onSelect(item.id, item.label)}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100"
      style={{ background: 'transparent' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = hover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,153,51,0.1)' }}>
        <MapPin size={13} style={{ color: '#FF9933' }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: text }}>{item.label}</p>
        <p className="text-xs truncate mt-0.5" style={{ color: subtle }}>{item.sub} · {item.dist}</p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <Star size={11} style={{ color: '#FF9933', fill: '#FF9933' }} />
        <span className="text-xs font-medium" style={{ color: subtle }}>{item.rating}</span>
      </div>
    </button>
  );
}
