import { useEffect, useState, useCallback } from 'react';
import { Plus, Minus, Navigation, Bell } from 'lucide-react';

import MapCanvas from './MapCanvas';
import SearchBar from './SearchBar';
import QuickActions from './QuickActions';
import SOSButton from './SOSButton';
import PlaceCard from './PlaceCard';
import BottomNav from './BottomNav';
import ExplorePanel from './ExplorePanel';
import AlertsPanel from './AlertsPanel';
import TripsPanel from './TripsPanel';
import ProfilePanel from './ProfilePanel';
import MapLegend from './MapLegend';
import SafetyBanner from './SafetyBanner';
import BrandMark from '../BrandMark';

import { getSOSLocation } from '../../lib/location';
import { queueSOSRecord } from '../../lib/db';
import {
  submitSOSOnline, syncQueuedSOS, getTouristProfile, getTouristId,
  getAuthToken, clearSession, logoutUser, ApiError, connectTouristFeed,
} from '../../lib/api';
import { TouristUser, Language } from '../../types';

type Tab = 'map' | 'explore' | 'trips' | 'alerts' | 'profile';

interface Props {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  /** Mirrors the previous TouristPortal contract so the authority console's
   * SOS map/tracking modules keep updating immediately when a tourist
   * triggers an SOS in the same browser session. */
  onTriggerSos: (touristName: string, locationStr: string, touristId?: string, touristPhone?: string) => void;
  onReturnToGateway: () => void;
  user: TouristUser | null;
  setUser: React.Dispatch<React.SetStateAction<TouristUser | null>>;
  showLogin: boolean;
  setShowLogin: (show: boolean) => void;
  onLogout: () => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
}

export default function TouristApp({
  darkMode: dm,
  onToggleDarkMode,
  onTriggerSos,
  onReturnToGateway,
  user,
  setUser,
  showLogin,
  setShowLogin,
  onLogout,
  language,
  onLanguageChange
}: Props) {
  const [tab, setTab] = useState<Tab>('map');
  const isAuthenticated = !!user;

  const [selectedPlace, setSelectedPlace] = useState<string | null>(null);
  const [mapFilter, setMapFilter] = useState<string | null>(null);
  const [recenterTrigger, setRecenterTrigger] = useState(0);
  const [zoomAction, setZoomAction] = useState<{ type: 'in' | 'out'; ts: number } | undefined>(undefined);
  const [geofenceAlert, setGeofenceAlert] = useState<string | null>(null);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // ── Realtime geofence alerts (directive §A.3: immediate in-app modal
  // popup on entering a restricted zone) — pushed by the backend's
  // /ws/tourist/{id} feed the moment a GPS ping trips a RESTRICTED geofence. ──
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    const socket = connectTouristFeed(user.id, (event) => {
      if (event.type === 'geofence.alert') {
        setGeofenceAlert(event.data?.message || 'You have entered a restricted zone. Please proceed with caution.');
      }
    });
    return () => socket?.close();
  }, [isAuthenticated, user?.id]);

  // ── Offline SOS queue auto-sync ─────────────────────────────────────────
  useEffect(() => {
    const trySync = () => { syncQueuedSOS().catch(() => {}); };
    if (navigator.onLine) trySync();
    window.addEventListener('online', trySync);
    return () => window.removeEventListener('online', trySync);
  }, []);

  // ── Auth gate: the tourist portal (map/explore/trips/alerts/profile) is
  // never shown until sign-in completes. Existing auth logic/backend flow is
  // untouched — this only opens the existing LoginModal (rendered by App.tsx)
  // automatically and keeps it open while unauthenticated. ──
  useEffect(() => {
    if (!isAuthenticated && !showLogin) {
      setShowLogin(true);
    }
  }, [isAuthenticated, showLogin, setShowLogin]);

  const handleProtectedTab = useCallback(() => { setShowLogin(true); }, [setShowLogin]);

  const handleMarkerClick = useCallback((id: string) => { setSelectedPlace(id); }, []);
  const handleSearchSelect = useCallback((id: string) => { setSelectedPlace(id); setTab('map'); }, []);

  const handleLocateMe = useCallback(() => { setRecenterTrigger((t) => t + 1); }, []);
  const handleZoom = useCallback((type: 'in' | 'out') => { setZoomAction({ type, ts: Date.now() }); }, []);

  // ── Real SOS submission (location capture → offline queue → backend) ───
  const handleSOS = useCallback(async (): Promise<string> => {
    if (!isAuthenticated || !user) {
      throw new Error('Please sign in first, then send your SOS again — or call 100 directly for immediate help.');
    }

    const loc = await getSOSLocation();
    let batteryLevel: number | null = null;
    try {
      const battery = await (navigator as any).getBattery?.();
      if (battery) batteryLevel = Math.round(battery.level * 100);
    } catch { /* Battery Status API unavailable — omit, not fatal */ }

    const localRecord = {
      local_sos_id: crypto.randomUUID(),
      tourist_id: user.id,
      triggered_at: new Date().toISOString(),
      latitude: loc.latitude,
      longitude: loc.longitude,
      accuracy: loc.accuracy,
      location_source: loc.location_source,
      description: `Emergency SOS Alert (${loc.location_source})`,
      severity: 'HIGH',
      battery_status: batteryLevel,
      status: 'QUEUED_OFFLINE',
    };
    await queueSOSRecord(localRecord);

    const locStr = `${loc.latitude?.toFixed(4) ?? '—'}, ${loc.longitude?.toFixed(4) ?? '—'}`;

    if (!navigator.onLine) {
      onTriggerSos(user.full_name || 'Tourist', `${locStr} (Queued Offline)`, user.id, user.phone_number || undefined);
      return "No connection — your SOS is saved and will send automatically the moment you're back online.";
    }

    try {
      const res = await submitSOSOnline(localRecord);
      onTriggerSos(user.full_name || 'Tourist', locStr, user.id, user.phone_number || undefined);
      return `Authorities have been alerted with your location. Reference: ${res.incident_id || res.sos_id || 'pending'}.`;
    } catch (err: any) {
      if (err instanceof ApiError && [400, 401, 404].includes(err.status)) {
        throw new Error(err.message || 'Your session was rejected by the server. Please sign in again.');
      }
      onTriggerSos(user.full_name || 'Tourist', `${locStr} (Queued Offline)`, user.id, user.phone_number || undefined);
      return "Couldn't reach the server — your SOS is queued and will send automatically once you're back online.";
    }
  }, [isAuthenticated, user, onTriggerSos]);

  const bg = dm ? '#070f1f' : '#e8eaed';

  // ── Auth gate screen: rendered instead of any tourist feature until the
  // existing LoginModal (opened above via showLogin/setShowLogin, and
  // rendered by App.tsx) completes sign-in. ──
  if (!isAuthenticated) {
    return (
      <div
        className="relative flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ background: bg, fontFamily: 'Inter, sans-serif' }}
      >
        <BrandMark size={56} />
        <div className="space-y-1.5">
          <p className="text-lg font-bold" style={{ color: dm ? '#f1f5f9' : '#0c2340', fontFamily: 'Outfit, sans-serif' }}>
            Sign in to continue
          </p>
          <p className="text-sm max-w-xs" style={{ color: dm ? 'rgba(255,255,255,0.5)' : 'rgba(12,35,64,0.55)' }}>
            The map, alerts, trips and profile are available once you're signed in to Suraksha Setu.
          </p>
        </div>
        <button
          onClick={() => setShowLogin(true)}
          className="h-11 px-7 rounded-xl text-sm font-bold text-white transition-transform active:scale-95"
          style={{ background: '#FF9933', boxShadow: '0 4px 20px rgba(255,153,51,0.35)' }}
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden" style={{ background: bg, fontFamily: 'Inter, sans-serif' }}>

      {/* ── Geofence breach alert (directive §A.3: immediate in-app modal
          popup) — pushed over the tourist's realtime WebSocket feed the
          moment a GPS ping trips a RESTRICTED zone. ── */}
      {geofenceAlert && (
        <div className="absolute inset-0 z-50 flex items-center justify-center px-6" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div className="w-full max-w-sm rounded-2xl p-5 space-y-3" style={{ background: dm ? '#0c1d33' : '#ffffff', boxShadow: '0 10px 40px rgba(0,0,0,0.4)' }}>
            <p className="text-sm font-bold" style={{ color: '#dc2626' }}>⚠ Restricted zone alert</p>
            <p className="text-sm" style={{ color: dm ? '#f1f5f9' : '#0c2340' }}>{geofenceAlert}</p>
            <button
              onClick={() => setGeofenceAlert(null)}
              className="w-full h-10 rounded-lg text-sm font-bold text-white"
              style={{ background: '#dc2626' }}
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}

      {/* ── Persistent top-area alerts entry point (moved out of bottom nav) ── */}
      <button
        onClick={() => setTab('alerts')}
        aria-label="Alerts"
        aria-current={tab === 'alerts' ? 'page' : undefined}
        className="absolute z-30 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-95"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          right: 14,
          background: dm ? 'rgba(10,20,40,0.92)' : 'rgba(255,255,255,0.95)',
          border: `1.5px solid ${tab === 'alerts' ? '#FF9933' : dm ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
          boxShadow: '0 2px 14px rgba(0,0,0,0.25)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <Bell size={17} strokeWidth={2.2} style={{ color: tab === 'alerts' ? '#FF9933' : dm ? '#f1f5f9' : '#0c2340' }} />
      </button>

      {/* ── Top chrome: search + quick actions (mobile & desktop) ── */}
      {tab === 'map' && (
        <div className="absolute top-0 left-0 right-0 z-20 px-4 pt-4 pb-3 space-y-2.5 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), transparent)' }}>
          <div className="max-w-xl mx-auto md:mx-0 md:max-w-2xl pointer-events-auto pr-14">
            <SearchBar darkMode={dm} onSelect={handleSearchSelect} />
          </div>
          <div className="max-w-xl mx-auto md:mx-0 md:max-w-2xl space-y-2.5 pointer-events-auto">
            <QuickActions darkMode={dm} active={mapFilter} onChange={setMapFilter} />
            <SafetyBanner darkMode={dm} onAlertsTap={() => setTab('alerts')} />
          </div>
        </div>
      )}

      {/* ── Main content area ── */}
      <div className="flex-1 relative overflow-hidden" style={{ marginBottom: 64 }}>
        {tab === 'map' && (
          <>
            <div className="absolute inset-0 z-0" style={{ isolation: 'isolate' }}>
              <MapCanvas
                activeFilter={mapFilter}
                recenterTrigger={recenterTrigger}
                zoomAction={zoomAction}
                onMarkerClick={handleMarkerClick}
              />
            </div>

            {/* Right-side map controls */}
            <div className="absolute right-4 z-20 flex flex-col gap-2.5 pointer-events-none" style={{ top: 132 }}>
              <div className="pointer-events-auto flex flex-col gap-2.5">
                <MapControlBtn dm={dm} onClick={() => handleZoom('in')} label="Zoom in"><Plus size={16} /></MapControlBtn>
                <MapControlBtn dm={dm} onClick={() => handleZoom('out')} label="Zoom out"><Minus size={16} /></MapControlBtn>
                <MapControlBtn dm={dm} onClick={handleLocateMe} label="Locate me"><Navigation size={15} /></MapControlBtn>
              </div>
              <div className="pointer-events-auto">
                <MapLegend darkMode={dm} />
              </div>
            </div>

            {selectedPlace && (
              <PlaceCard placeId={selectedPlace} isMobile={isMobile} darkMode={dm} onClose={() => setSelectedPlace(null)} />
            )}
          </>
        )}

        {tab === 'explore' && <ExplorePanel darkMode={dm} onPlaceSelect={(id) => { setSelectedPlace(id); setTab('map'); }} />}
        {tab === 'trips' && <TripsPanel darkMode={dm} isAuthenticated={isAuthenticated} onSignIn={() => setShowLogin(true)} />}
        {tab === 'alerts' && <AlertsPanel darkMode={dm} isAuthenticated={isAuthenticated} onSignIn={() => setShowLogin(true)} />}
        {tab === 'profile' && (
          <ProfilePanel
            darkMode={dm}
            toggleDark={onToggleDarkMode}
            isAuthenticated={isAuthenticated}
            user={user}
            onLogin={() => setShowLogin(true)}
            onLogout={onLogout}
            onOpenAuthorityAccess={onReturnToGateway}
            language={language}
            onLanguageChange={onLanguageChange}
          />
        )}
      </div>

      <BottomNav
        active={tab}
        darkMode={dm}
        onChange={(id) => setTab(id as Tab)}
        onProtected={handleProtectedTab}
        isAuthenticated={isAuthenticated}
        sosButton={<SOSButton onTrigger={handleSOS} />}
      />
    </div>
  );
}

function MapControlBtn({ children, onClick, label, dm }: { children: React.ReactNode; onClick: () => void; label: string; dm: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-95"
      style={{
        background: dm ? '#0c1d33' : '#ffffff',
        border: `1px solid ${dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)'}`,
        boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
        color: dm ? '#f1f5f9' : '#0c2340',
      }}
    >
      {children}
    </button>
  );
}
