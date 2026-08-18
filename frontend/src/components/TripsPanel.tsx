import { useState, useEffect } from 'react'
import { Plus, Trash2, Calendar, MapPin, Loader2, ArrowLeft } from 'lucide-react'
import { api, ItineraryEntry } from '../lib/api'

interface Props {
  darkMode: boolean
  isAuthenticated: boolean
  onLogin: () => void
}

export default function TripsPanel({ darkMode: dm, isAuthenticated, onLogin }: Props) {
  const [trips, setTrips] = useState<ItineraryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)

  // Form fields
  const [dest, setDest] = useState('')
  const [arrival, setArrival] = useState('')
  const [departure, setDeparture] = useState('')
  const [formLoading, setFormLoading] = useState(false)

  const surface = dm ? '#091222' : '#f4f6f9'
  const card = dm ? '#0c1d33' : '#ffffff'
  const border = dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
  const text = dm ? '#f1f5f9' : '#0c2340'
  const subtle = dm ? 'rgba(255,255,255,0.44)' : 'rgba(12,35,64,0.44)'
  const shadow = dm ? '0 1px 8px rgba(0,0,0,0.35)' : '0 1px 8px rgba(0,0,0,0.06)'

  const fetchTrips = async () => {
    if (!isAuthenticated) return
    setLoading(true)
    try {
      const data = await api.listItinerary()
      setTrips(data)
    } catch (e) {
      console.error("Failed to fetch itineraries:", e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTrips()
  }, [isAuthenticated])

  const handleAddTrip = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dest.trim()) return
    setFormLoading(true)
    try {
      await api.createItinerary({
        destination_name: dest.trim(),
        planned_arrival: arrival ? new Date(arrival).toISOString() : null,
        planned_departure: departure ? new Date(departure).toISOString() : null,
      })
      setDest('')
      setArrival('')
      setDeparture('')
      setShowAddForm(false)
      fetchTrips()
    } catch (e) {
      console.error("Failed to create itinerary entry:", e)
      alert("Failed to add itinerary destination. Please try again.")
    } finally {
      setFormLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this trip destination?")) return
    try {
      await api.deleteItinerary(id)
      setTrips(prev => prev.filter(t => t.itinerary_id !== id))
    } catch (e) {
      console.error("Failed to delete itinerary:", e)
      alert("Failed to delete. Please try again.")
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-5 text-center" style={{ background: surface }}>
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center animate-bounce" style={{ background: dm ? 'rgba(255,153,51,0.1)' : 'rgba(255,153,51,0.08)' }}>
          <span style={{ fontSize: 36 }}>🗺</span>
        </div>
        <div>
          <h2 className="text-xl font-bold mb-2 animate-fade-in" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>
            Sign in to view trips
          </h2>
          <p className="text-sm max-w-xs mx-auto mb-6" style={{ color: subtle }}>
            Keep track of your destinations, check safety ratings, and share itineraries with emergency responders.
          </p>
          <button
            onClick={onLogin}
            className="h-11 px-8 rounded-xl text-sm font-bold text-white transition-all hover:scale-105 active:scale-95 shadow-md"
            style={{ background: '#FF9933', boxShadow: '0 4px 16px rgba(255,153,51,0.35)' }}
          >
            Sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: surface, fontFamily: 'Inter, sans-serif' }}>
      
      {/* Header */}
      <div className="px-5 pt-6 pb-4 flex items-center justify-between border-b" style={{ borderBottomColor: border }}>
        <div>
          <h1 className="text-xl font-bold" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>My Itinerary</h1>
          <p className="text-xs mt-0.5" style={{ color: subtle }}>Manage your travel destinations and safety checks</p>
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white transition-all hover:scale-105 active:scale-95"
            style={{ background: 'linear-gradient(135deg, #FF9933, #e67a0f)', boxShadow: '0 2px 10px rgba(255,153,51,0.3)' }}
          >
            <Plus size={20} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {showAddForm ? (
          <form onSubmit={handleAddTrip} className="space-y-4 p-4 rounded-2xl animate-fade-in border" style={{ background: card, borderColor: border, boxShadow: shadow }}>
            <div className="flex items-center justify-between border-b pb-2" style={{ borderBottomColor: border }}>
              <span className="text-sm font-bold" style={{ color: text }}>Add Destination</span>
              <button 
                type="button" 
                onClick={() => setShowAddForm(false)}
                className="p-1 rounded-lg hover:bg-slate-500/10"
                style={{ color: subtle }}
              >
                <ArrowLeft size={16} />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold" style={{ color: subtle }}>Destination name</label>
              <input
                type="text"
                required
                placeholder="e.g. Colaba, Mumbai"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm border focus:outline-none focus:ring-1 focus:ring-[#FF9933]"
                style={{ background: surface, borderColor: border, color: text }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold" style={{ color: subtle }}>Planned arrival</label>
                <input
                  type="date"
                  value={arrival}
                  onChange={(e) => setArrival(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm border focus:outline-none focus:ring-1 focus:ring-[#FF9933]"
                  style={{ background: surface, borderColor: border, color: text }}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold" style={{ color: subtle }}>Planned departure</label>
                <input
                  type="date"
                  value={departure}
                  onChange={(e) => setDeparture(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm border focus:outline-none focus:ring-1 focus:ring-[#FF9933]"
                  style={{ background: surface, borderColor: border, color: text }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={formLoading}
              className="w-full h-10 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:opacity-95"
              style={{ background: '#FF9933', boxShadow: '0 2px 10px rgba(255,153,51,0.2)' }}
            >
              {formLoading ? <Loader2 size={16} className="animate-spin" /> : 'Add Destination'}
            </button>
          </form>
        ) : loading ? (
          <div className="h-40 flex items-center justify-center" style={{ color: subtle }}>
            <Loader2 className="animate-spin" size={24} />
          </div>
        ) : trips.length === 0 ? (
          <div className="h-40 flex flex-col items-center justify-center text-center gap-2" style={{ color: subtle }}>
            <Calendar size={32} style={{ opacity: 0.5 }} />
            <p className="text-sm font-semibold">No planned destinations yet</p>
            <p className="text-xs max-w-xs">Tap the plus button above to add your first travel destination.</p>
          </div>
        ) : (
          <div className="space-y-3.5">
            {trips.map((trip) => (
              <div
                key={trip.itinerary_id}
                className="p-4 rounded-xl flex items-center justify-between border transition-all hover:scale-[1.01]"
                style={{ background: card, borderColor: border, boxShadow: shadow }}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: dm ? 'rgba(255,153,51,0.1)' : 'rgba(255,153,51,0.06)' }}>
                    <MapPin size={18} style={{ color: '#FF9933' }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold" style={{ color: text }}>{trip.location_name}</h3>
                    <p className="text-xs mt-0.5" style={{ color: subtle }}>
                      {trip.planned_arrival ? new Date(trip.planned_arrival).toLocaleDateString() : 'TBD'} - {trip.planned_departure ? new Date(trip.planned_departure).toLocaleDateString() : 'TBD'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(trip.itinerary_id)}
                  className="p-2 rounded-lg hover:bg-red-500/10 transition-colors"
                  style={{ color: dm ? 'rgba(239,68,68,0.7)' : '#ef4444' }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
