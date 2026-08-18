import { useState, useEffect, useCallback, Suspense } from 'react'
import {
  Moon, Sun, User, LogOut, Shield,
  Navigation2, Bell, ChevronDown, Layers, Plus, Minus,
} from 'lucide-react'
import MapCanvas from './components/MapCanvas'
import SearchBar from './components/SearchBar'
import QuickActions from './components/QuickActions'
import SOSButton from './components/SOSButton'
import PlaceCard from './components/PlaceCard'
import LoginModal from './components/LoginModal'
import BottomNav from './components/BottomNav'
import ExplorePanel from './components/ExplorePanel'
import AlertsPanel from './components/AlertsPanel'
import ProfilePanel from './components/ProfilePanel'
import TripsPanel from './components/TripsPanel'
import MapLegend from './components/MapLegend'
import SafetyBanner from './components/SafetyBanner'
import { SkeletonMap } from './components/SkeletonLoader'
import { api } from './lib/api'

type Tab = 'map' | 'explore' | 'trips' | 'alerts' | 'profile'
interface AuthUser {
  id: string;
  fullName?: string;
  phone?: string;
  email?: string;
  preferredLanguage?: string;
  emergencyContact?: string;
  kycVerified?: boolean;
}

// ─── Toast ──────────────────────────────────────────────────────────────────
function Toast({ msg, color }: { msg: string; color?: string }) {
  return (
    <div
      className="fixed top-20 left-1/2 z-[70] px-5 py-3 rounded-2xl text-sm font-medium text-white animate-toast-in pointer-events-none"
      style={{
        transform: 'translateX(-50%)',
        background: color || '#0c2340',
        boxShadow: '0 4px 28px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(8px)',
        whiteSpace: 'nowrap',
      }}
    >
      {msg}
    </div>
  )
}

// ─── Slide panel wrapper ─────────────────────────────────────────────────────
function SlidePanel({ visible, children, surface }: { visible: boolean; children: React.ReactNode; surface: string }) {
  if (!visible) return null
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col animate-fade-in"
      style={{ background: surface }}
    >
      {children}
    </div>
  )
}

// ─── Map control button ──────────────────────────────────────────────────────
function MapBtn({ onClick, label, children, surface, border, active = false }: {
  onClick: () => void; label: string; children: React.ReactNode;
  surface: string; border: string; active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-95"
      style={{
        background: active ? '#FF9933' : surface,
        border: `1px solid ${active ? '#FF9933' : border}`,
        boxShadow: active ? '0 2px 12px rgba(255,153,51,0.35)' : '0 2px 12px rgba(0,0,0,0.25)',
      }}
    >
      {children}
    </button>
  )
}

// ─── Profile dropdown menu ────────────────────────────────────────────────────
function ProfileMenu({ user, surfaceS, border, text, subtle, dm, onClose, onLogout }: {
  user: AuthUser; surfaceS: string; border: string; text: string; subtle: string; dm: boolean;
  onClose: () => void; onLogout: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute top-full right-0 mt-2 w-56 rounded-2xl overflow-hidden z-50 animate-modal-in"
        style={{ background: surfaceS, border: `1px solid ${border}`, boxShadow: '0 8px 40px rgba(0,0,0,0.35)' }}
      >
        {/* User row */}
        <div className="flex items-center gap-3 px-4 py-4" style={{ borderBottom: `1px solid ${border}` }}>
          <div className="w-10 h-10 rounded-2xl bg-[#FF9933] flex items-center justify-center text-white font-bold flex-shrink-0">T</div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: text }}>Traveller</p>
            <p className="text-xs mt-0.5 truncate font-mono" style={{ color: subtle }}>ID: {user.id}</p>
          </div>
        </div>
        {/* Actions */}
        <div className="py-1">
          {[
            { label: 'Saved places',  sub: 'Your bookmarked spots' },
            { label: 'My trips',      sub: 'Itinerary & history'   },
            { label: 'Alert settings',sub: 'Notification preferences' },
          ].map(({ label, sub }) => (
            <button
              key={label}
              onClick={onClose}
              className="w-full px-4 py-2.5 text-left transition-colors"
              onMouseEnter={(e) => (e.currentTarget.style.background = dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <p className="text-sm" style={{ color: text }}>{label}</p>
              <p className="text-xs mt-0.5" style={{ color: subtle }}>{sub}</p>
            </button>
          ))}
          <div style={{ height: 1, background: border, margin: '4px 12px' }} />
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[#ef4444] transition-colors"
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(220,38,38,0.07)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [dm, setDm]                   = useState(true)
  const [booting, setBooting]         = useState(true)
  const [auth, setAuth]               = useState(false)
  const [user, setUser]               = useState<AuthUser | null>(null)
  const [showLogin, setShowLogin]     = useState(false)
  const [tab, setTab]                 = useState<Tab>('map')
  const [filter, setFilter]           = useState<string | null>(null)
  const [place, setPlace]             = useState<string | null>(null)
  const [isMobile, setIsMobile]       = useState(false)
  const [recenter, setRecenter]       = useState(0)
  const [profileOpen, setProfileOpen] = useState(false)
  const [legendOpen, setLegendOpen]   = useState(false)
  const [toast, setToast]             = useState<{ msg: string; color?: string } | null>(null)
  const [zoom, setZoom]               = useState(14)

  const [activeIncidentId, setActiveIncidentId] = useState<string | null>(null)

  useEffect(() => {
    const initSession = async () => {
      const token = localStorage.getItem('suraksha_setu_token')
      if (token) {
        try {
          const session = await api.getSession()
          if (session && session.tourist_id) {
            const profile = await api.getProfile(session.tourist_id)
            setUser({
              id: session.tourist_id,
              fullName: profile.full_name,
              phone: profile.phone || undefined,
              email: profile.email || undefined,
              preferredLanguage: profile.preferred_language || undefined,
              emergencyContact: profile.emergency_contact || undefined,
              kycVerified: profile.kyc_verified,
            })
            setAuth(true)
          }
        } catch (e) {
          console.error("Session restoration failed:", e)
          localStorage.removeItem('suraksha_setu_token')
          localStorage.removeItem('suraksha_setu_tourist_id')
        }
      }
      setBooting(false)
    }
    initSession()
  }, [])

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const showToast = (msg: string, color?: string, ms = 2800) => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), ms)
  }

  const handleAuth = async (id: string) => {
    try {
      const profile = await api.getProfile(id)
      setUser({
        id: profile.tourist_id,
        fullName: profile.full_name,
        phone: profile.phone || undefined,
        email: profile.email || undefined,
        preferredLanguage: profile.preferred_language || undefined,
        emergencyContact: profile.emergency_contact || undefined,
        kycVerified: profile.kyc_verified,
      })
      setAuth(true)
      setShowLogin(false)
      showToast('✓ Signed in successfully', '#138808')
    } catch (e) {
      console.error("Failed to load profile:", e)
      setUser({ id })
      setAuth(true)
      setShowLogin(false)
      showToast('✓ Signed in successfully', '#138808')
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('suraksha_setu_token')
    localStorage.removeItem('suraksha_setu_tourist_id')
    setAuth(false); setUser(null); setProfileOpen(false); setTab('map')
    showToast('Signed out')
  }

  const handleProfileUpdate = (updatedUser: Partial<AuthUser>) => {
    setUser((prev) => prev ? { ...prev, ...updatedUser } : null)
    showToast('✓ Profile updated', '#138808')
  }

  const handleProtected = useCallback((t: string) => {
    if (!auth) { setShowLogin(true); return }
    setTab(t as Tab)
  }, [auth])

  const handleSOS = async () => {
    if (!auth || !user) {
      showToast('⚠️ Please sign in to trigger SOS', '#d97706')
      setShowLogin(true)
      return
    }
    showToast('🚨 Triggering SOS...', '#dc2626', 1500)
    let lat = 18.9220
    let lon = 72.8347
    if (navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 })
        })
        lat = pos.coords.latitude
        lon = pos.coords.longitude
      } catch (err) {
        console.warn("Geolocation failed, using fallback:", err)
      }
    }
    try {
      const res = await api.triggerSOS({
        tourist_id: user.id,
        latitude: lat,
        longitude: lon,
        description: 'SOS active from tourist mobile portal',
      })
      if (res && res.incident_id) {
        setActiveIncidentId(res.incident_id)
        showToast('🚨 EMERGENCY SOS ACTIVE — Responders Alerted', '#dc2626', 5000)
      }
    } catch (e: any) {
      console.error("SOS failed:", e)
      showToast(`❌ SOS Alert Failed: ${e.message}`, '#dc2626', 4000)
    }
  }

  const handleLocate  = () => { setRecenter((n) => n + 1); showToast('📍 Centring on your location') }
  const handleZoomIn  = () => setZoom((z) => Math.min(z + 1, 18))
  const handleZoomOut = () => setZoom((z) => Math.max(z - 1, 8))

  // ── Design tokens ────────────────────────────────────────────────────────
  const surfaceS   = dm ? '#091222' : '#ffffff'
  const surface    = dm ? 'rgba(9,18,34,0.93)'     : 'rgba(255,255,255,0.95)'
  const border     = dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)'
  const text       = dm ? '#f1f5f9'                : '#0c2340'
  const subtle     = dm ? 'rgba(255,255,255,0.42)' : 'rgba(12,35,64,0.42)'
  const iconC      = dm ? 'rgba(255,255,255,0.75)' : '#0c2340'

  const panelBg    = dm ? '#091222' : '#f4f6f9'
  const isMapTab   = tab === 'map'

  if (booting) return <SkeletonMap darkMode={dm} />

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ═══════════ DESKTOP HEADER ════════════════════════════════════════ */}
      <header
        className="hidden md:flex items-center gap-4 px-5 h-14 z-30 flex-shrink-0"
        style={{ background: surfaceS, borderBottom: `1px solid ${border}` }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 mr-2 flex-shrink-0 cursor-default select-none">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#0c2340' }}>
            <Shield size={15} style={{ color: '#FF9933' }} strokeWidth={2.5} />
          </div>
          <div>
            <span className="text-sm font-bold block leading-none" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>
              Suraksha Setu
            </span>
            <span className="text-[9px] block mt-0.5 font-semibold tracking-widest uppercase" style={{ color: subtle }}>
              Tourist Safety
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="flex-1 max-w-[500px]">
          <SearchBar darkMode={dm} onSelect={(l) => showToast(`🔍 Searching: ${l}`)} />
        </div>

        {/* Desktop tab bar */}
        <nav className="hidden lg:flex items-center gap-1 ml-2">
          {(['map', 'explore', 'alerts'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all duration-150"
              style={{
                background: tab === t ? (dm ? 'rgba(255,153,51,0.12)' : 'rgba(255,153,51,0.1)') : 'transparent',
                color: tab === t ? '#FF9933' : subtle,
              }}
            >
              {t}
            </button>
          ))}
        </nav>

        {/* Right controls */}
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {/* Alerts bell */}
          <button
            onClick={() => setTab('alerts')}
            className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:opacity-75"
            style={{ background: tab === 'alerts' ? 'rgba(255,153,51,0.1)' : dm ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }}
            aria-label="Alerts"
          >
            <Bell size={16} style={{ color: tab === 'alerts' ? '#FF9933' : iconC }} />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
          </button>

          {/* Theme */}
          <button
            onClick={() => setDm((d) => !d)}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:opacity-75"
            style={{ background: dm ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }}
            aria-label={dm ? 'Light mode' : 'Dark mode'}
          >
            {dm ? <Sun size={16} style={{ color: iconC }} /> : <Moon size={16} style={{ color: iconC }} />}
          </button>

          {/* Profile */}
          <div className="relative">
            {auth && user ? (
              <>
                <button
                  onClick={() => setProfileOpen((o) => !o)}
                  className="flex items-center gap-2 h-9 pl-2.5 pr-3 rounded-xl transition-all hover:opacity-80"
                  style={{ background: dm ? 'rgba(255,153,51,0.1)' : 'rgba(255,153,51,0.08)', border: '1px solid rgba(255,153,51,0.22)' }}
                >
                  <div className="w-6 h-6 rounded-full bg-[#FF9933] flex items-center justify-center text-white text-xs font-bold">T</div>
                  <span className="text-xs font-medium truncate max-w-[80px]" style={{ color: text }}>{user.id.slice(0, 10)}</span>
                  <ChevronDown size={12} style={{ color: subtle }} />
                </button>
                {profileOpen && (
                  <ProfileMenu user={user} surfaceS={surfaceS} border={border} text={text} subtle={subtle} dm={dm} onClose={() => setProfileOpen(false)} onLogout={handleLogout} />
                )}
              </>
            ) : (
              <button
                onClick={() => setShowLogin(true)}
                className="flex items-center gap-2 h-9 px-4 rounded-xl text-xs font-bold text-white transition-all hover:opacity-90 active:scale-95"
                style={{ background: '#FF9933', boxShadow: '0 2px 12px rgba(255,153,51,0.3)' }}
              >
                <User size={13} /> Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ═══════════ MOBILE HEADER ═════════════════════════════════════════ */}
      <div
        className="md:hidden flex items-center gap-3 px-4 pb-2 z-30 flex-shrink-0"
        style={{ paddingTop: 'max(14px, env(safe-area-inset-top, 14px))' }}
      >
        <div className="flex items-center gap-2.5 select-none">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#0c2340' }}>
            <Shield size={14} style={{ color: '#FF9933' }} strokeWidth={2.5} />
          </div>
          <span className="text-sm font-bold" style={{ color: dm ? '#f1f5f9' : '#0c2340', fontFamily: 'Outfit, sans-serif' }}>
            Suraksha Setu
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Alert badge */}
          <button
            onClick={() => setTab('alerts')}
            className="relative w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: surface, border: `1px solid ${border}`, backdropFilter: 'blur(12px)' }}
            aria-label="Alerts"
          >
            <Bell size={15} style={{ color: tab === 'alerts' ? '#FF9933' : iconC }} />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
          </button>
          <button
            onClick={() => setDm((d) => !d)}
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: surface, border: `1px solid ${border}`, backdropFilter: 'blur(12px)' }}
            aria-label="Toggle theme"
          >
            {dm ? <Sun size={15} style={{ color: iconC }} /> : <Moon size={15} style={{ color: iconC }} />}
          </button>
          {auth ? (
            <button onClick={() => setTab('profile')} className="w-9 h-9 rounded-full bg-[#FF9933] flex items-center justify-center text-white text-xs font-bold" aria-label="Profile">T</button>
          ) : (
            <button
              onClick={() => setShowLogin(true)}
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(255,153,51,0.15)', border: '1px solid rgba(255,153,51,0.3)' }}
              aria-label="Sign in"
            >
              <User size={15} style={{ color: '#FF9933' }} />
            </button>
          )}
        </div>
      </div>

      {/* ═══════════ MOBILE SEARCH + CHIPS (map tab only) ══════════════════ */}
      {isMapTab && (
        <div className="md:hidden px-4 pb-3 z-20 flex-shrink-0 space-y-2.5">
          <SearchBar darkMode={dm} onSelect={(l) => showToast(`🔍 ${l}`)} />
          <QuickActions darkMode={dm} active={filter} onChange={setFilter} />
        </div>
      )}

      {/* ═══════════ MAIN CONTENT AREA ══════════════════════════════════════ */}
      <div className="flex-1 relative overflow-hidden">

        {/* ── Map (always rendered, hidden behind panels) ── */}
        <div className="absolute inset-0" style={{ zIndex: isMapTab ? 1 : 0 }}>
          <Suspense fallback={<div style={{ background: dm ? '#0a1628' : '#e8eaed', width: '100%', height: '100%' }} />}>
            <MapCanvas
              darkMode={dm}
              activeFilter={filter}
              recenterTrigger={recenter}
              onMarkerClick={(id) => { setTab('map'); setPlace(id) }}
            />
          </Suspense>

          {/* Desktop: chips float over map */}
          {isMapTab && (
            <div className="hidden md:block absolute top-4 left-5 right-80 z-10">
              <div className="max-w-xl space-y-2.5">
                <QuickActions darkMode={dm} active={filter} onChange={setFilter} />
                <SafetyBanner darkMode={dm} level="caution" onAlertsTap={() => setTab('alerts')} />
              </div>
            </div>
          )}

          {/* Mobile: safety banner above chips */}
          {isMapTab && (
            <div className="md:hidden absolute top-0 left-0 right-0 z-10 px-4 pt-2">
              <SafetyBanner darkMode={dm} level="caution" onAlertsTap={() => setTab('alerts')} />
            </div>
          )}

          {/* Active SOS Banner */}
          {activeIncidentId && (
            <div 
              className="absolute left-4 right-4 md:left-5 md:right-80 px-4 py-3 rounded-xl flex items-center justify-between shadow-lg z-30 transition-all duration-300"
              style={{
                top: isMapTab ? (isMobile ? '70px' : '90px') : '16px',
                background: 'rgba(220,38,38,0.95)',
                border: '1px solid rgba(255,255,255,0.2)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                </span>
                <span className="text-xs font-extrabold uppercase tracking-wider text-white">Emergency SOS Active</span>
              </div>
              <button
                onClick={async () => {
                  try {
                    await api.resolveIncident(activeIncidentId)
                    setActiveIncidentId(null)
                    showToast('✓ Emergency SOS resolved', '#138808')
                  } catch (e: any) {
                    showToast(`Error: ${e.message}`, '#dc2626')
                  }
                }}
                className="px-3 py-1 bg-white text-red-600 rounded-lg text-xs font-bold transition-all hover:bg-red-50 active:scale-95 shadow-sm"
              >
                Resolve
              </button>
            </div>
          )}

          {/* Desktop: right-side controls column */}
          <div className="hidden md:flex absolute right-5 top-4 bottom-4 flex-col items-end justify-between z-10">
            {/* Top: SOS */}
            <div className="flex flex-col items-end gap-3">
              <SOSButton onTrigger={handleSOS} />
            </div>
            {/* Bottom: zoom + legend + locate */}
            <div className="flex flex-col gap-2">
              <MapLegend darkMode={dm} />
              <div style={{ height: 1, background: border }} />
              <MapBtn onClick={handleZoomIn}  label="Zoom in"  surface={surfaceS} border={border}><Plus  size={16} style={{ color: iconC }} /></MapBtn>
              <MapBtn onClick={handleZoomOut} label="Zoom out" surface={surfaceS} border={border}><Minus size={16} style={{ color: iconC }} /></MapBtn>
              <div style={{ height: 1, background: border }} />
              <MapBtn onClick={handleLocate}  label="Locate me" surface={surfaceS} border={border}>
                <Navigation2 size={17} style={{ color: '#FF9933' }} />
              </MapBtn>
            </div>
          </div>

          {/* Mobile floating controls */}
          <div
            className="md:hidden absolute right-4 z-20 flex flex-col gap-3 items-end"
            style={{ bottom: 'calc(64px + env(safe-area-inset-bottom, 0px) + 16px)' }}
          >
            <SOSButton onTrigger={handleSOS} />
            <button
              onClick={handleLocate}
              className="w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95"
              style={{ background: surfaceS, border: `1px solid ${border}`, boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}
              aria-label="Locate me"
            >
              <Navigation2 size={20} style={{ color: '#FF9933' }} />
            </button>
          </div>

          {/* Desktop: place card */}
          {place && !isMobile && (
            <PlaceCard placeId={place} isMobile={false} darkMode={dm} onClose={() => setPlace(null)} />
          )}
        </div>

        {/* ── Explore panel ── */}
        <SlidePanel visible={tab === 'explore'} surface={panelBg}>
          <ExplorePanel
            darkMode={dm}
            isMobile={isMobile}
            onPlaceSelect={(id) => { setPlace(id); setTab('map') }}
          />
        </SlidePanel>

        {/* ── Alerts panel ── */}
        <SlidePanel visible={tab === 'alerts'} surface={panelBg}>
          <AlertsPanel darkMode={dm} isAuthenticated={auth} />
        </SlidePanel>

        {/* ── Trips panel ── */}
        <SlidePanel visible={tab === 'trips'} surface={panelBg}>
          <TripsPanel darkMode={dm} isAuthenticated={auth} onLogin={() => setShowLogin(true)} />
        </SlidePanel>

        {/* ── Profile panel ── */}
        <SlidePanel visible={tab === 'profile'} surface={panelBg}>
          <ProfilePanel
            darkMode={dm}
            toggleDark={() => setDm((d) => !d)}
            isAuthenticated={auth}
            user={user}
            onLogin={() => setShowLogin(true)}
            onLogout={handleLogout}
            onProfileUpdate={handleProfileUpdate}
          />
        </SlidePanel>
      </div>

      {/* ═══════════ MOBILE PLACE BOTTOM SHEET ════════════════════════════ */}
      {place && isMobile && (
        <>
          <div
            className="fixed inset-0 z-[25] animate-fade-in"
            style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(2px)' }}
            onClick={() => setPlace(null)}
          />
          <PlaceCard placeId={place} isMobile={true} darkMode={dm} onClose={() => setPlace(null)} />
        </>
      )}

      {/* ═══════════ DESKTOP STATUS BAR ════════════════════════════════════ */}
      <div
        className="hidden md:flex items-center justify-between px-5 h-8 z-20 flex-shrink-0"
        style={{ background: surfaceS, borderTop: `1px solid ${border}` }}
      >
        <div className="flex items-center gap-5">
          <StatusDot color="#d97706" label="Crowd alert · Colaba 0.5 km"    subtle={subtle} />
          <StatusDot color="#138808" label="Safe zone active · Apollo Bandar" subtle={subtle} />
          <StatusDot color="#2563eb" label="Tourism police on patrol"         subtle={subtle} />
        </div>
        <div className="flex items-center gap-4">
          {!auth && (
            <button onClick={() => setShowLogin(true)} className="text-xs hover:text-[#FF9933] transition-colors" style={{ color: subtle }}>
              Sign in for full access →
            </button>
          )}
          <span className="text-[11px]" style={{ color: dm ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.2)' }}>
            Suraksha Setu v2.0 · India Tourism Safety
          </span>
        </div>
      </div>

      {/* ═══════════ MOBILE BOTTOM NAV ══════════════════════════════════════ */}
      <div className="md:hidden">
        <BottomNav
          active={tab}
          darkMode={dm}
          onChange={(id) => setTab(id as Tab)}
          onProtected={handleProtected}
          isAuthenticated={auth}
          alertCount={2}
        />
      </div>

      {/* ═══════════ AUTH MODAL ═════════════════════════════════════════════ */}
      {showLogin && (
        <LoginModal darkMode={dm} onClose={() => setShowLogin(false)} onAuthenticated={handleAuth} />
      )}

      {/* ═══════════ TOAST ══════════════════════════════════════════════════ */}
      {toast && <Toast msg={toast.msg} color={toast.color} />}
    </div>
  )
}

// ── Status dot ──────────────────────────────────────────────────────────────
function StatusDot({ color, label, subtle }: { color: string; label: string; subtle: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color }} />
      <span className="text-[11px]" style={{ color: subtle }}>{label}</span>
    </div>
  )
}

// ── Trips placeholder ────────────────────────────────────────────────────────
function TripsPlaceholder({ darkMode: dm, onLogin, isAuth }: { darkMode: boolean; onLogin: () => void; isAuth: boolean }) {
  const text   = dm ? '#f1f5f9' : '#0c2340'
  const subtle = dm ? 'rgba(255,255,255,0.44)' : 'rgba(12,35,64,0.44)'

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 gap-5 text-center">
      <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: dm ? 'rgba(255,153,51,0.1)' : 'rgba(255,153,51,0.08)' }}>
        <span style={{ fontSize: 36 }}>🗺</span>
      </div>
      <div>
        <h2 className="text-xl font-bold mb-2" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>
          {isAuth ? 'No trips yet' : 'Sign in to view trips'}
        </h2>
        <p className="text-sm leading-relaxed max-w-xs" style={{ color: subtle }}>
          {isAuth
            ? 'Start exploring and save places to build your itinerary.'
            : 'Your saved itineraries, trip history, and planned routes will appear here once you sign in.'}
        </p>
      </div>
      {!isAuth && (
        <button
          onClick={onLogin}
          className="h-11 px-8 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-95"
          style={{ background: '#FF9933', boxShadow: '0 3px 16px rgba(255,153,51,0.35)' }}
        >
          Sign in
        </button>
      )}
    </div>
  )
}
