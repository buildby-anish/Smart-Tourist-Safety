import { useState, useRef, useEffect } from 'react';
import { Search, X, MapPin, Navigation, Loader2 } from 'lucide-react';

// Real place search via OpenStreetMap's Nominatim geocoding API — no API
// key required, consistent with the rest of this app's map stack (Leaflet
// + OpenStreetMap tiles + OSRM routing all being free/keyless already).
// Restricted to India (countrycodes=in) to match the rest of the app.
interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  class?: string;
}

export interface SearchedPlace {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface Props {
  darkMode: boolean;
  onSelect: (place: SearchedPlace) => void;
}

export default function SearchBar({ darkMode: dm, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (query.trim().length < 3) {
      setResults([]);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    debounceRef.current = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=in&limit=8&addressdetails=0`;
        const resp = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!resp.ok) throw new Error(`Nominatim returned ${resp.status}`);
        const data: NominatimResult[] = await resp.json();
        setResults(data);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.warn('Place search failed:', err);
          setError(true);
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [query]);

  const showPanel = focused && query.trim().length > 0;

  const surface = dm ? 'rgba(10,20,40,0.95)' : 'rgba(255,255,255,0.97)';
  const text = dm ? '#f1f5f9' : '#0c2340';
  const subtle = dm ? 'rgba(255,255,255,0.42)' : 'rgba(12,35,64,0.45)';
  const divider = dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const hoverBg = dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const borderC = focused ? '#FF9933' : dm ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

  const handlePick = (r: NominatimResult) => {
    const parts = r.display_name.split(',').map((p) => p.trim());
    onSelect({
      name: parts[0] || r.display_name,
      address: r.display_name,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
    });
    setQuery('');
    setFocused(false);
  };

  return (
    <div className="relative w-full">
      <div
        className="flex items-center gap-3 px-4 h-12 rounded-full transition-all duration-150"
        style={{
          background: surface,
          border: `1.5px solid ${borderC}`,
          boxShadow: focused
            ? `0 0 0 3px rgba(255,153,51,0.15), 0 4px 24px rgba(0,0,0,${dm ? '0.5' : '0.12'})`
            : `0 2px 16px rgba(0,0,0,${dm ? '0.45' : '0.10'})`,
          backdropFilter: 'blur(16px)',
        }}
      >
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 180)}
          placeholder="Search places in India..."
          className="flex-1 bg-transparent text-base leading-none outline-none pl-1"
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
            className="transition-opacity hover:opacity-70 mr-1"
          >
            <X size={15} />
          </button>
        )}
        {loading ? (
          <Loader2 size={17} className="animate-spin" style={{ color: '#FF9933', flexShrink: 0 }} />
        ) : (
          <Search size={17} strokeWidth={2.2} style={{ color: focused ? '#FF9933' : subtle, flexShrink: 0, transition: 'color 0.15s' }} />
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
          {loading && results.length === 0 ? (
            <div className="py-10 text-center" style={{ color: subtle, fontSize: 14 }}>Searching...</div>
          ) : error ? (
            <div className="py-10 text-center" style={{ color: subtle, fontSize: 14 }}>Couldn't reach place search. Try again.</div>
          ) : results.length > 0 ? (
            <div className="py-2">
              {results.map((r) => (
                <SuggestionRow key={r.place_id} result={r} text={text} subtle={subtle} hover={hoverBg} onSelect={() => handlePick(r)} />
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

function SuggestionRow({ result, text, subtle, hover, onSelect }: {
  result: NominatimResult; text: string; subtle: string; hover: string; onSelect: () => void;
}) {
  const parts = result.display_name.split(',').map((p) => p.trim());
  const label = parts[0] || result.display_name;
  const sub = parts.slice(1, 4).join(', ');
  return (
    <button
      onMouseDown={onSelect}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100"
      style={{ background: 'transparent' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = hover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,153,51,0.1)' }}>
        <MapPin size={13} style={{ color: '#FF9933' }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: text }}>{label}</p>
        <p className="text-xs truncate mt-0.5" style={{ color: subtle }}>{sub}</p>
      </div>
    </button>
  );
}
