import { useEffect, useState, useCallback } from 'react';
import { Plus, Minus, Navigation } from 'lucide-react';

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
import { SkeletonMap } from './SkeletonLoader';

import { getSOSLocation } from '../../lib/location';
import { queueSOSRecord } from '../../lib/db';
import {
  submitSOSOnline, syncQueuedSOS, getTouristProfile, getTouristId,
  getAuthToken, clearSession, logoutUser, ApiError,
} from '../../lib/api';

type Tab = 'map' | 'explore' | 'trips' | 'alerts' | 'profile';

interface TouristUser {
  tourist_id: string;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  emergency_contact?: string | null;
  preferred_language?: string | null;
  digital_id?: string | null;
  kyc_verified?: boolean | null;
}

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
  onLogout
}: Props) {
  const [tab, setTab] = useState<Tab>('map');
  const isAuthenticated = !!user;

  const [selectedPlace, setSelectedPlace] = useState<string | null>(null);
  const [mapFilter, setMapFilter] = useState<string | null>(null);
  const [recenterTrigger, setRecenterTrigger] = useState(0);
  const [zoomAction, setZoomAction] = useState<{ type: 'in' | 'out'; ts: number } | undefined>(undefined);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // ── Offline SOS queue auto-sync ─────────────────────────────────────────
  useEffect(() => {
    const trySync = () => { syncQueuedSOS().catch(() => {}); };
    if (navigator.onLine) trySync();
    window.addEventListener('online', trySync);
    return () => window.removeEventListener('online', trySync);
  }, []);

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
    const localRecord = {
      local_sos_id: crypto.randomUUID(),
      tourist_id: user.tourist_id,
      triggered_at: new Date().toISOString(),
      latitude: loc.latitude,
      longitude: loc.longitude,
      accuracy: loc.accuracy,
      location_source: loc.location_source,
      description: `Emergency SOS Alert (${loc.location_source})`,
      severity: 'HIGH',
      status: 'QUEUED_OFFLINE',
    };
    await queueSOSRecord(localRecord);

    const locStr = `${loc.latitude?.toFixed(4) ?? '—'}, ${loc.longitude?.toFixed(4) ?? '—'}`;

    if (!navigator.onLine) {
      onTriggerSos(user.full_name || 'Tourist', `${locStr} (Queued Offline)`, user.tourist_id, user.phone || undefined);
      return "No connection — your SOS is saved and will send automatically the moment you're back online.";
    }

    try {
      const res = await submitSOSOnline(localRecord);
      onTriggerSos(user.full_name || 'Tourist', locStr, user.tourist_id, user.phone || undefined);
      return `Authorities have been alerted with your location. Reference: ${res.incident_id || res.sos_id || 'pending'}.`;
    } catch (err: any) {
      if (err instanceof ApiError && [400, 401, 404].includes(err.status)) {
        throw new Error(err.message || 'Your session was rejected by the server. Please sign in again.');
      }
      onTriggerSos(user.full_name || 'Tourist', `${locStr} (Queued Offline)`, user.tourist_id, user.phone || undefined);
      return "Couldn't reach the server — your SOS is queued and will send automatically once you're back online.";
    }
  }, [isAuthenticated, user, onTriggerSos]);

  const bg = dm ? '#070f1f' : '#e8eaed';

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden" style={{ background: bg, fontFamily: 'Inter, sans-serif' }}>

      {/* ── Top chrome: search + quick actions (mobile & desktop) ── */}
      {tab === 'map' && (
        <div className="absolute top-0 left-0 right-0 z-20 px-4 pt-4 pb-3 space-y-2.5 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), transparent)' }}>
          <div className="max-w-xl mx-auto md:mx-0 md:max-w-2xl pointer-events-auto">
            <SearchBar darkMode={dm} onSelect={handleSearchSelect} />
          </div>
          <div className="max-w-xl mx-auto md:mx-0 md:max-w-2xl space-y-2.5 pointer-events-auto">
            <QuickActions darkMode={dm} active={mapFilter} onChange={setMapFilter} />
            <SafetyBanner darkMode={dm} onAlertsTap={() => setTab('alerts')} />
          </div>
        </div>
      )}

      {/* ── Main content area ── */}
      <div className="flex-1 relative overflow-hidden" style={{ marginBottom: 60 }}>
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

            {/* SOS button, bottom-right above nav */}
            <div className="absolute right-4 z-20" style={{ bottom: 16 }}>
              <SOSButton onTrigger={handleSOS} />
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
          />
        )}
      </div>

      <BottomNav
        active={tab}
        darkMode={dm}
        onChange={(id) => setTab(id as Tab)}
        onProtected={handleProtectedTab}
        isAuthenticated={isAuthenticated}
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
