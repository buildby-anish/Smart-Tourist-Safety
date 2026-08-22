import { useEffect, useState } from 'react';
import { Route, Plus, Trash2, MapPin, Calendar, Loader2, AlertTriangle, X, LogIn } from 'lucide-react';
import { createItinerary, listItineraries, deleteItinerary, ApiError, ItineraryDestination } from '../../lib/api';

// The backend's itineraries are one row per TRIP with an array of
// destinations (directive §4: itineraries.destinations JSONB), not one row
// per destination. This panel keeps its existing "add a destination" UX by
// treating each trip as holding exactly one destination — simplest mapping
// onto the new shape without redesigning the screen. A future pass could
// let one trip hold several destinations.
interface Entry {
  id: string;
  title: string;
  destinations: ItineraryDestination[];
}

interface Props {
  darkMode: boolean;
  isAuthenticated: boolean;
  onSignIn: () => void;
}

export default function TripsPanel({ darkMode: dm, isAuthenticated, onSignIn }: Props) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [errMsg, setErrMsg] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [destName, setDestName] = useState('');
  const [arrival, setArrival] = useState('');
  const [departure, setDeparture] = useState('');
  const [saving, setSaving] = useState(false);
  const [addErr, setAddErr] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = () => {
    if (!isAuthenticated) return;
    setState('loading'); setErrMsg('');
    listItineraries()
      .then((rows) => { setEntries(rows as Entry[]); setState('ready'); })
      .catch((err) => { setErrMsg(err instanceof ApiError ? err.message : 'Could not load your trips.'); setState('error'); });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isAuthenticated]);

  const handleAdd = async () => {
    if (!destName.trim()) { setAddErr('Destination name is required'); return; }
    setSaving(true); setAddErr('');
    try {
      await createItinerary({
        title: destName.trim(),
        destinations: [{
          name: destName.trim(),
          planned_arrival: arrival ? new Date(arrival).toISOString() : undefined,
          planned_departure: departure ? new Date(departure).toISOString() : undefined,
        }],
        start_date: arrival || undefined,
        end_date: departure || undefined,
      });
      setDestName(''); setArrival(''); setDeparture(''); setShowAdd(false);
      load();
    } catch (err: any) {
      setAddErr(err instanceof ApiError ? err.message : 'Could not add this destination. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteItinerary(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      /* leave the entry in place; the next manual refresh will reconcile */
    } finally {
      setDeletingId(null);
    }
  };

  const surface = dm ? '#091222' : '#f4f6f9';
  const card = dm ? '#0c1d33' : '#ffffff';
  const border = dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const text = dm ? '#f1f5f9' : '#0c2340';
  const subtle = dm ? 'rgba(255,255,255,0.44)' : 'rgba(12,35,64,0.44)';
  const divider = dm ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const fieldBg = dm ? 'rgba(255,255,255,0.05)' : '#f8fafc';
  const fieldBd = dm ? 'rgba(255,255,255,0.11)' : '#e2e8f0';

  if (!isAuthenticated) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-3" style={{ background: surface }}>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}>
          <LogIn size={26} style={{ color: '#FF9933' }} />
        </div>
        <p className="text-base font-semibold" style={{ color: text }}>Sign in to plan your trip</p>
        <p className="text-sm max-w-[280px] leading-relaxed" style={{ color: subtle }}>Save destinations to your itinerary and we'll help authorities assist you faster in an emergency.</p>
        <button onClick={onSignIn} className="h-10 px-6 rounded-xl text-sm font-bold text-white mt-2" style={{ background: '#FF9933' }}>Sign in</button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: surface, fontFamily: 'Inter, sans-serif' }}>
      <div className="px-5 pt-5 pb-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${divider}` }}>
        <div>
          <h1 className="text-xl font-bold leading-none" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>Trips</h1>
          <p className="text-sm mt-1" style={{ color: subtle }}>Your planned itinerary</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white"
          style={{ background: '#FF9933' }}
          aria-label="Add destination"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="px-5 py-5">
        {state === 'loading' && (
          <div className="space-y-2.5">
            {[0, 1].map((i) => <div key={i} className={`h-20 rounded-xl ${dm ? 'skeleton' : 'skeleton-light'}`} />)}
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center text-center py-10 gap-3">
            <AlertTriangle size={26} style={{ color: '#dc2626' }} />
            <p className="text-sm" style={{ color: subtle }}>{errMsg}</p>
            <button onClick={load} className="h-9 px-5 rounded-xl text-xs font-bold text-white" style={{ background: '#dc2626' }}>Retry</button>
          </div>
        )}

        {state === 'ready' && entries.length === 0 && (
          <div className="flex flex-col items-center text-center py-10 gap-3">
            <Route size={26} style={{ color: subtle }} />
            <p className="text-sm font-medium" style={{ color: text }}>No trips planned yet</p>
            <p className="text-xs max-w-[240px]" style={{ color: subtle }}>Add a destination to start building your itinerary.</p>
            <button onClick={() => setShowAdd(true)} className="h-9 px-5 rounded-xl text-xs font-bold text-white" style={{ background: '#FF9933' }}>Add destination</button>
          </div>
        )}

        {state === 'ready' && entries.length > 0 && (
          <div className="space-y-2.5">
            {entries.map((e) => {
              const dest = e.destinations?.[0];
              return (
                <div key={e.id} className="flex items-start gap-3 p-3.5 rounded-xl" style={{ background: card, border: `1px solid ${border}` }}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,153,51,0.1)' }}>
                    <MapPin size={16} style={{ color: '#FF9933' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: text }}>{e.title || dest?.name || 'Destination'}</p>
                    {(dest?.planned_arrival || dest?.planned_departure) && (
                      <div className="flex items-center gap-1.5 mt-1" style={{ color: subtle }}>
                        <Calendar size={11} />
                        <span className="text-xs">
                          {dest?.planned_arrival ? new Date(dest.planned_arrival).toLocaleDateString() : '—'}
                          {' → '}
                          {dest?.planned_departure ? new Date(dest.planned_departure).toLocaleDateString() : '—'}
                        </span>
                      </div>
                    )}
                  </div>
                  <button onClick={() => handleDelete(e.id)} disabled={deletingId === e.id} aria-label="Delete" style={{ color: subtle }}>
                    {deletingId === e.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showAdd && (
        <>
          <div className="fixed inset-0 z-[55]" style={{ background: 'rgba(7,15,31,0.7)', backdropFilter: 'blur(6px)' }} onClick={() => setShowAdd(false)} />
          <div className="fixed inset-0 z-[56] flex items-end sm:items-center justify-center sm:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-6 animate-sheet-up sm:animate-modal-in" style={{ background: card, border: `1px solid ${border}` }}>
              <div className="flex items-center justify-between mb-4">
                <p className="text-[15px] font-bold" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>Add destination</p>
                <button onClick={() => setShowAdd(false)} aria-label="Close"><X size={16} style={{ color: subtle }} /></button>
              </div>

              <div className="space-y-3">
                <input
                  value={destName}
                  onChange={(e) => setDestName(e.target.value)}
                  placeholder="Destination name"
                  className="w-full h-11 px-3.5 rounded-xl text-sm outline-none"
                  style={{ background: fieldBg, border: `1.5px solid ${fieldBd}`, color: text }}
                />
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={arrival}
                    onChange={(e) => setArrival(e.target.value)}
                    className="flex-1 h-11 px-3 rounded-xl text-sm outline-none"
                    style={{ background: fieldBg, border: `1.5px solid ${fieldBd}`, color: text }}
                  />
                  <input
                    type="date"
                    value={departure}
                    onChange={(e) => setDeparture(e.target.value)}
                    className="flex-1 h-11 px-3 rounded-xl text-sm outline-none"
                    style={{ background: fieldBg, border: `1.5px solid ${fieldBd}`, color: text }}
                  />
                </div>
                {addErr && <p className="text-xs" style={{ color: '#ef4444' }}>{addErr}</p>}
                <button
                  onClick={handleAdd}
                  disabled={saving}
                  className="w-full h-11 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2"
                  style={{ background: '#FF9933' }}
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add to itinerary
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
