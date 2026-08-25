import { useEffect, useMemo, useState } from 'react';
import { ActualGoogleMap, MapClusterMarker } from '../ActualGoogleMap';
import AuthorityHeader from './AuthorityHeader';
import AuthorityLeftRail, { LayerToggles } from './AuthorityLeftRail';
import AuthorityRightRail from './AuthorityRightRail';
import AuthorityBottomBar from './AuthorityBottomBar';
import SOSTakeover from './SOSTakeover';
import { ModuleAnalyticsAudit } from '../ModuleAnalyticsAudit';
import { X } from 'lucide-react';
import { getLiveTouristLocations } from '../../lib/api';
import {
  Language, TouristProfile, SOSIncident, PatrollingUnit, PoliceStation,
  Hospital, AnomalyCluster, BroadcastAlert, AuditLog, LiveLocationPing, GeoFenceZone,
} from '../../types';

interface Props {
  language: Language;
  onLanguageChange: (lang: Language) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onLogout: () => void;
  officerName: string;

  tourists: TouristProfile[];
  incidents: SOSIncident[];
  units: PatrollingUnit[];
  stations: PoliceStation[];
  hospitals: Hospital[];
  clusters: AnomalyCluster[];
  auditLogs: AuditLog[];
  liveLocations: Record<string, LiveLocationPing>;

  onDispatchUnit: (incidentId: string, unitId: string) => void;
  onResolveIncident: (incidentId: string) => void;
  onMarkTouristSafe: (touristId: string) => void;
  onSendBroadcast: (newAlert: Omit<BroadcastAlert, 'id' | 'timestamp' | 'deliveredCount' | 'status'>) => void;
}

const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 }; // India centroid

// AnomalyCluster risk zones reuse ActualGoogleMap's existing GeoFenceZone
// circle-rendering path (already draws Safe/Caution/Unsafe colored
// circles) rather than introducing a new heatmap primitive/map library.
function clustersToZones(clusters: AnomalyCluster[]): GeoFenceZone[] {
  return clusters.map((c) => ({
    id: c.id,
    name: c.regionName,
    riskLevel: c.riskScore >= 70 ? 'Unsafe' : c.riskScore >= 40 ? 'Caution' : 'Safe',
    description: c.descriptionEn,
    center: c.coordinates,
    radiusKm: 1 + c.touristDensity / 40,
  }));
}

export default function AuthorityMapApp({
  language, onLanguageChange, darkMode: dm, onToggleDarkMode, onLogout, officerName,
  tourists, incidents, units, stations, hospitals, clusters, auditLogs, liveLocations,
  onDispatchUnit, onResolveIncident, onMarkTouristSafe, onSendBroadcast,
}: Props) {
  const [layers, setLayers] = useState<LayerToggles>({
    showSosLayer: true,
    showRespondersLayer: true,
    showStationsLayer: true,
    showHospitalsLayer: true,
    showHeatmapLayer: false,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | undefined>();
  const [recenter, setRecenter] = useState<{ trigger: number; target: { lat: number; lng: number } } | undefined>();
  const [showAuditDrawer, setShowAuditDrawer] = useState(false);

  // One-time REST hydration on mount — after this, positions update
  // incrementally via the `liveLocations` prop (fed by App.tsx's existing
  // authority socket connection's location.ping handler). Not polled.
  const [hydratedLocations, setHydratedLocations] = useState<Record<string, LiveLocationPing>>({});
  useEffect(() => {
    getLiveTouristLocations()
      .then((rows) => {
        const map: Record<string, LiveLocationPing> = {};
        for (const r of rows) {
          map[r.tourist_id] = {
            tourist_id: r.tourist_id, latitude: r.latitude, longitude: r.longitude,
            speed: r.speed, heading: r.heading, recorded_at: r.recorded_at,
          };
        }
        setHydratedLocations(map);
      })
      .catch((err) => console.warn('Failed to hydrate live tourist locations:', err));
  }, []);

  // Socket updates layer on top of (never behind) the initial hydration.
  const mergedLive = useMemo(() => ({ ...hydratedLocations, ...liveLocations }), [hydratedLocations, liveLocations]);

  // SOS takeover queue — every non-resolved Critical incident queues here;
  // multiple simultaneous SOS events stack rather than overwrite each other.
  const sosQueue = useMemo(
    () => incidents.filter((i) => i.severity === 'Critical' && i.status !== 'Resolved'),
    [incidents]
  );
  const [takeoverIndex, setTakeoverIndex] = useState(0);
  const [takeoverDismissed, setTakeoverDismissed] = useState<Set<string>>(new Set());
  const [manualTakeoverIncident, setManualTakeoverIncident] = useState<SOSIncident | null>(null);

  const visibleQueue = sosQueue.filter((i) => !takeoverDismissed.has(i.id));
  const activeTakeoverIncident = manualTakeoverIncident || visibleQueue[Math.min(takeoverIndex, visibleQueue.length - 1)] || null;

  useEffect(() => {
    // New SOS arriving auto-flies the map to it immediately, per spec —
    // using the incident's own lat/lng from the socket-driven state
    // update, not waiting on a poll.
    if (activeTakeoverIncident) {
      setRecenter({ trigger: Date.now(), target: { lat: activeTakeoverIncident.location.lat, lng: activeTakeoverIncident.location.lng } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTakeoverIncident?.id]);

  const takeoverTourist = useMemo(() => {
    if (!activeTakeoverIncident) return null;
    return tourists.find((t) => t.tourist_id === activeTakeoverIncident.touristId || t.id === activeTakeoverIncident.touristId) || null;
  }, [activeTakeoverIncident, tourists]);

  const closeTakeover = () => {
    if (manualTakeoverIncident) { setManualTakeoverIncident(null); return; }
    if (activeTakeoverIncident) {
      setTakeoverDismissed((prev) => new Set(prev).add(activeTakeoverIncident.id));
      setTakeoverIndex(0);
    }
  };

  const flyTo = (lat: number, lng: number) => setRecenter({ trigger: Date.now(), target: { lat, lng } });

  const markers: MapClusterMarker[] = useMemo(() => {
    const list: MapClusterMarker[] = [];

    // Demo/known tourist profiles — colored by safetyStatus, position
    // overridden by a live ping when one exists for that tourist.
    for (const tr of tourists) {
      const live = mergedLive[tr.tourist_id || ''] || mergedLive[tr.id];
      const lat = live?.latitude ?? tr.currentLocation.lat;
      const lng = live?.longitude ?? tr.currentLocation.lng;
      const color = tr.safetyStatus === 'SOS Active' ? '#dc2626' : tr.safetyStatus === 'Watch' ? '#f59e0b' : '#138808';
      list.push({ id: `tourist-${tr.id}`, lat, lng, title: tr.full_name || tr.name, subtitle: tr.safetyStatus, type: 'user', pinColor: color });
    }

    // Any live-pinging tourist not already represented by a demo profile
    // above (matched by tourist_id) — real backend tourists with no local
    // demo counterpart still show up, just without the richer profile card.
    const knownIds = new Set(tourists.map((t) => t.tourist_id).filter(Boolean));
    for (const [touristId, loc] of Object.entries(mergedLive)) {
      if (knownIds.has(touristId)) continue;
      list.push({ id: `live-${touristId}`, lat: loc.latitude, lng: loc.longitude, title: 'Tourist', type: 'user', pinColor: '#138808' });
    }

    if (layers.showRespondersLayer) {
      for (const u of units) {
        list.push({ id: `unit-${u.id}`, lat: u.location.lat, lng: u.location.lng, title: u.unitName, subtitle: u.status, type: 'police', pinColor: '#0B2447' });
      }
    }
    if (layers.showStationsLayer) {
      for (const s of stations) {
        list.push({ id: `station-${s.id}`, lat: s.location.lat, lng: s.location.lng, title: s.name, subtitle: `${s.activeOfficers} officers on duty`, type: 'police', pinColor: '#138808' });
      }
    }
    if (layers.showHospitalsLayer) {
      for (const h of hospitals) {
        list.push({ id: `hospital-${h.id}`, lat: h.location.lat, lng: h.location.lng, title: h.name, subtitle: `${h.icuBedsAvailable} ICU beds free`, type: 'hotel', pinColor: '#dc2626' });
      }
    }
    if (layers.showSosLayer) {
      for (const inc of incidents.filter((i) => i.status !== 'Resolved')) {
        list.push({ id: `incident-${inc.id}`, lat: inc.location.lat, lng: inc.location.lng, title: inc.touristName, subtitle: inc.hazardType, type: 'alert', pinColor: inc.severity === 'Critical' ? '#dc2626' : '#f59e0b' });
      }
    }

    return list;
  }, [tourists, units, stations, hospitals, incidents, layers, mergedLive]);

  const handleMarkerClick = (m: MapClusterMarker) => {
    setSelectedMarkerId(m.id);
    if (m.id.startsWith('incident-')) {
      const inc = incidents.find((i) => `incident-${i.id}` === m.id);
      if (inc) setManualTakeoverIncident(inc);
    }
  };

  const handleExecuteSearch = () => {
    const q = searchQuery.trim();
    if (!q) return;
    const tr = tourists.find((t) => t.tourist_id === q || t.id === q || (t.full_name || t.name).toLowerCase().includes(q.toLowerCase()));
    if (tr) { flyTo(tr.currentLocation.lat, tr.currentLocation.lng); setSelectedMarkerId(`tourist-${tr.id}`); return; }
    const inc = incidents.find((i) => i.id === q);
    if (inc) { flyTo(inc.location.lat, inc.location.lng); setSelectedMarkerId(`incident-${inc.id}`); }
  };

  const activeSosCount = incidents.filter((i) => i.status !== 'Resolved' && i.severity === 'Critical').length;
  const patrolUnitsOnline = units.filter((u) => u.status !== 'Standby').length;

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: '#0a1428' }}>
      <ActualGoogleMap
        center={DEFAULT_CENTER}
        zoom={5}
        markers={markers}
        geofenceZones={layers.showHeatmapLayer ? clustersToZones(clusters) : []}
        onMarkerClick={handleMarkerClick}
        selectedMarkerId={selectedMarkerId}
        fullBleed
        chrome={false}
        recenter={recenter}
        height="100%"
      />

      <AuthorityHeader
        language={language} onLanguageChange={onLanguageChange}
        darkMode={dm} onToggleDarkMode={onToggleDarkMode} onLogout={onLogout}
        officerName={officerName}
        activeSosCount={activeSosCount}
        touristsTrackedCount={tourists.length}
        patrolUnitsOnlineCount={patrolUnitsOnline}
        searchQuery={searchQuery} onSearchChange={setSearchQuery} onExecuteSearch={handleExecuteSearch}
        onSosCounterClick={() => { if (visibleQueue[0]) setManualTakeoverIncident(visibleQueue[0]); }}
      />

      <AuthorityLeftRail
        language={language} darkMode={dm} tourists={tourists} layers={layers}
        onToggleLayer={(key) => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
        onFlyToTourist={(tr) => { flyTo(tr.currentLocation.lat, tr.currentLocation.lng); setSelectedMarkerId(`tourist-${tr.id}`); }}
      />

      <AuthorityRightRail
        language={language} darkMode={dm} incidents={incidents}
        onResolveIncident={onResolveIncident}
        onSendBroadcast={onSendBroadcast}
        onIncidentClick={(inc) => { flyTo(inc.location.lat, inc.location.lng); setManualTakeoverIncident(inc); }}
      />

      <AuthorityBottomBar
        language={language} darkMode={dm} units={units}
        onDispatchClick={() => { if (visibleQueue[0]) setManualTakeoverIncident(visibleQueue[0]); }}
        onBroadcastClick={() => { if (visibleQueue[0]) setManualTakeoverIncident(visibleQueue[0]); }}
        onMarkSafeClick={() => { if (activeTakeoverIncident) onMarkTouristSafe(activeTakeoverIncident.touristId); }}
        onAuditLogsClick={() => setShowAuditDrawer(true)}
      />

      {activeTakeoverIncident && (
        <SOSTakeover
          language={language} darkMode={dm}
          queue={visibleQueue.length > 0 ? visibleQueue : [activeTakeoverIncident]}
          activeIndex={Math.max(0, visibleQueue.findIndex((i) => i.id === activeTakeoverIncident.id))}
          onSwitchIndex={setTakeoverIndex}
          tourist={takeoverTourist}
          units={units}
          onDispatchUnit={onDispatchUnit}
          onResolveIncident={(id) => { onResolveIncident(id); closeTakeover(); }}
          onSendBroadcastForIncident={() => { closeTakeover(); }}
          onClose={closeTakeover}
        />
      )}

      {showAuditDrawer && (
        <>
          <div className="fixed inset-0 z-[90]" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowAuditDrawer(false)} />
          <div
            className="fixed inset-x-0 bottom-0 z-[95] rounded-t-3xl flex flex-col animate-slide-up"
            style={{ height: '80vh', background: '#fff', boxShadow: '0 -8px 40px rgba(0,0,0,0.35)' }}
          >
            <div className="flex items-center justify-between px-5 py-3 flex-shrink-0 border-b border-slate-200">
              <span className="text-sm font-bold text-[#0C2340]">Audit Logs</span>
              <button onClick={() => setShowAuditDrawer(false)} className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200">
                <X size={15} className="text-slate-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <ModuleAnalyticsAudit language={language} auditLogs={auditLogs} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
