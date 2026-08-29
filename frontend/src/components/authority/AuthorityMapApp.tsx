import { useEffect, useMemo, useState } from 'react';
import { ActualGoogleMap, MapClusterMarker } from '../ActualGoogleMap';
import AuthorityHeader from './AuthorityHeader';
import AuthorityLeftRail, { LayerToggles } from './AuthorityLeftRail';
import AuthorityRightRail from './AuthorityRightRail';
import AuthorityBottomBar from './AuthorityBottomBar';
import SOSTakeover from './SOSTakeover';
import { ModuleAnalyticsAudit } from '../ModuleAnalyticsAudit';
import {
  X, Users, Radio, MapPin, ShieldAlert, HeartPulse, Building2, Flame, Layers,
  ChevronLeft, ChevronRight, CheckSquare, Square, Clock, AlertTriangle, Send,
  Settings, Trash2, Edit, Plus, Activity, Search, ShieldCheck, CheckCircle2
} from 'lucide-react';
import { getLiveTouristLocations, deleteGeofence, updateGeofence } from '../../lib/api';
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
  geofences: any[];
  onGeofenceCreated?: () => void;

  onDispatchUnit: (incidentId: string, unitId: string) => void;
  onResolveIncident: (incidentId: string) => void;
  onBulkResolveIncidents: (incidentIds: string[]) => void;
  onMarkTouristSafe: (touristId: string) => void;
  onSendBroadcast: (newAlert: Omit<BroadcastAlert, 'id' | 'timestamp' | 'deliveredCount' | 'status'>) => void;

  viewMode?: 'map' | 'split';
  onViewModeChange?: (mode: 'map' | 'split') => void;
  onUpdateUnitStatus?: (unitId: string, status: PatrollingUnit['status']) => void;
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
  tourists, incidents, units, stations, hospitals, clusters, auditLogs, liveLocations, geofences, onGeofenceCreated,
  onDispatchUnit, onResolveIncident, onBulkResolveIncidents, onMarkTouristSafe, onSendBroadcast,
  viewMode = 'split', onViewModeChange, onUpdateUnitStatus,
}: Props) {
  const convertedGeofenceZones = useMemo<GeoFenceZone[]>(() => {
    return geofences.map((z) => {
      if (z.geometry_type === 'CIRCLE') {
        const riskLevel = z.zone_type === 'RESTRICTED' ? 'Unsafe' : z.zone_type === 'BUFFER' ? 'Caution' : 'Safe';
        return {
          id: z.id,
          name: z.name,
          riskLevel,
          description: z.warning_message || `${z.zone_type} zone`,
          center: { lat: z.center_lat, lng: z.center_lng },
          radiusKm: (z.radius_m || 1000) / 1000,
        };
      }
      const coords = Array.isArray(z.coordinates) ? z.coordinates : [];
      if (coords.length === 0) {
        return {
          id: z.id,
          name: z.name,
          riskLevel: 'Unsafe',
          description: z.name,
          center: { lat: 20.5937, lng: 78.9629 },
          radiusKm: 1,
        };
      }
      const lats = coords.map((c) => c[1]);
      const lngs = coords.map((c) => c[0]);
      const centerLat = lats.reduce((a, b) => a + b, 0) / lats.length;
      const centerLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };
      const radiusKm = Math.max(
        0.05,
        ...coords.map(([lng, lat]) => haversineKm(centerLat, centerLng, lat, lng))
      );
      const riskLevel = z.zone_type === 'RESTRICTED' ? 'Unsafe' : z.zone_type === 'BUFFER' ? 'Caution' : 'Safe';
      return {
        id: z.id,
        name: z.name,
        riskLevel,
        description: z.warning_message || `${z.zone_type} zone`,
        center: { lat: centerLat, lng: centerLng },
        radiusKm,
      };
    });
  }, [geofences]);

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
  const [showGeofenceManager, setShowGeofenceManager] = useState(false);
  const [lockedCity, setLockedCity] = useState<any | null>(null);
  const [editingGeofenceId, setEditingGeofenceId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSeverity, setEditSeverity] = useState('MEDIUM');
  const [editWarningMessage, setEditWarningMessage] = useState('');
  // Lets the bottom bar's "Mark Circle Zone" / "Mark Polygon Zone" buttons
  // start ActualGoogleMap's drawing mode from outside the map component —
  // each click bumps `ts` so the effect fires even if the same shape is
  // picked twice in a row.
  const [startDrawTrigger, setStartDrawTrigger] = useState<{ shape: 'circle' | 'polygon'; ts: number } | null>(null);

  const handleDeleteGeofence = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this geofence?')) return;
    try {
      await deleteGeofence(id);
      if (onGeofenceCreated) onGeofenceCreated();
    } catch (err) {
      console.warn('Failed to delete geofence:', err);
      alert('Failed to delete geofence.');
    }
  };

  const handleUpdateGeofence = async (id: string) => {
    try {
      await updateGeofence(id, {
        name: editName,
        severity: editSeverity,
        warning_message: editWarningMessage
      });
      setEditingGeofenceId(null);
      if (onGeofenceCreated) onGeofenceCreated();
    } catch (err) {
      console.warn('Failed to update geofence:', err);
      alert('Failed to update geofence.');
    }
  };

  const startEditingGeofence = (z: any) => {
    setEditingGeofenceId(z.id);
    setEditName(z.name || '');
    setEditSeverity(z.severity || 'MEDIUM');
    setEditWarningMessage(z.warning_message || '');
  };

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

  // Split-view tabs & filter states
  const [leftTab, setLeftTab] = useState<'tourists' | 'responders'>('tourists');
  const [rightTab, setRightTab] = useState<'incidents' | 'broadcast'>('incidents');
  const [centerTab, setCenterTab] = useState<'geofences' | 'audits'>('geofences');
  const [touristSearch, setTouristSearch] = useState('');
  const [touristFilter, setTouristFilter] = useState<'All' | 'SOS Active' | 'Watch' | 'Safe'>('All');

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
      const lat = live?.latitude ?? tr.currentLocation?.lat;
      const lng = live?.longitude ?? tr.currentLocation?.lng;
      if (lat != null && lng != null) {
        const color = '#7C3AED'; // Purple dot for tourists
        const subtitle = `Safety: ${tr.safetyStatus} | Phone: ${tr.phone} | Emergency: ${tr.emergencyContact} (${tr.emergencyRelation}) | Lang: ${tr.nationality}`;
        list.push({ id: `tourist-${tr.id}`, lat, lng, title: tr.full_name || tr.name, subtitle, type: 'user', pinColor: color });
      }
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
    if (tr) {
      const live = mergedLive[tr.tourist_id || ''] || mergedLive[tr.id];
      const lat = live?.latitude ?? tr.currentLocation?.lat;
      const lng = live?.longitude ?? tr.currentLocation?.lng;
      if (lat != null && lng != null) {
        flyTo(lat, lng);
        setSelectedMarkerId(`tourist-${tr.id}`);
      } else {
        alert(`Tourist "${tr.full_name || tr.name}" is offline and has no recorded location.`);
      }
      return;
    }
    const inc = incidents.find((i) => i.id === q || i.backendIncidentId === q);
    if (inc) { flyTo(inc.location.lat, inc.location.lng); setSelectedMarkerId(`incident-${inc.id}`); }
  };

  const activeSosCount = incidents.filter((i) => i.status !== 'Resolved' && i.severity === 'Critical').length;
  const patrolUnitsOnline = units.filter((u) => u.status !== 'Standby').length;

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: '#09090b' }}>
      <ActualGoogleMap
        center={DEFAULT_CENTER}
        zoom={5}
        markers={markers}
        geofenceZones={[...convertedGeofenceZones, ...(layers.showHeatmapLayer ? clustersToZones(clusters) : [])]}
        onMarkerClick={handleMarkerClick}
        selectedMarkerId={selectedMarkerId}
        fullBleed
        chrome={false}
        recenter={recenter}
        height="100%"
        enableDrawing={true}
        onGeofenceCreated={onGeofenceCreated}
        lockedCity={lockedCity}
        enableDirectionsOnClick={false}
        startDrawTrigger={startDrawTrigger}
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
        lockedCity={lockedCity}
        onLockCityChange={setLockedCity}
      />

      <AuthorityLeftRail
        language={language} darkMode={dm} tourists={tourists} layers={layers}
        onToggleLayer={(key) => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
        onFlyToTourist={(tr) => {
          const live = mergedLive[tr.tourist_id || ''] || mergedLive[tr.id];
          const lat = live?.latitude ?? tr.currentLocation?.lat;
          const lng = live?.longitude ?? tr.currentLocation?.lng;
          if (lat != null && lng != null) {
            flyTo(lat, lng);
            setSelectedMarkerId(`tourist-${tr.id}`);
          } else {
            alert(`Tourist "${tr.full_name || tr.name}" is offline and has no recorded location.`);
          }
        }}
      />

      <AuthorityRightRail
        language={language} darkMode={dm} incidents={incidents}
        onResolveIncident={onResolveIncident}
        onBulkResolveIncidents={onBulkResolveIncidents}
        onSendBroadcast={onSendBroadcast}
        onIncidentClick={(inc) => { flyTo(inc.location.lat, inc.location.lng); setManualTakeoverIncident(inc); }}
      />

      <AuthorityBottomBar
        language={language} darkMode={dm} units={units}
        onMarkCircleZoneClick={() => setStartDrawTrigger({ shape: 'circle', ts: Date.now() })}
        onMarkPolygonZoneClick={() => setStartDrawTrigger({ shape: 'polygon', ts: Date.now() })}
        onBroadcastClick={() => { if (visibleQueue[0]) setManualTakeoverIncident(visibleQueue[0]); }}
        onMarkSafeClick={() => { if (activeTakeoverIncident) onMarkTouristSafe(activeTakeoverIncident.touristId); }}
        onAuditLogsClick={() => setShowAuditDrawer(true)}
        onGeofenceManagerClick={() => setShowGeofenceManager(true)}
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

      {showGeofenceManager && (
        <>
          <div className="fixed inset-0 z-[90]" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowGeofenceManager(false)} />
          <div
            className="fixed inset-x-0 bottom-0 z-[95] rounded-t-3xl flex flex-col animate-slide-up"
            style={{ height: '80vh', background: dm ? '#18181b' : '#fff', boxShadow: '0 -8px 40px rgba(0,0,0,0.35)', color: dm ? '#f1f5f9' : '#0c2340' }}
          >
            <div className="flex items-center justify-between px-5 py-3 flex-shrink-0 border-b" style={{ borderColor: dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
              <span className="text-sm font-bold">Manage Geofences / भू-घेरा प्रबंधन</span>
              <button onClick={() => setShowGeofenceManager(false)} className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700">
                <X size={15} className="text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {geofences.length === 0 ? (
                <div className="text-center py-10 text-xs opacity-50">No geofences created yet. Draw a zone on the map to create one!</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {geofences.map((z) => {
                    const isEditing = editingGeofenceId === z.id;
                    return (
                      <div
                        key={z.id}
                        className="p-4 rounded-2xl border flex flex-col justify-between gap-3 bg-zinc-50 dark:bg-zinc-900"
                        style={{ borderColor: dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}
                      >
                        {isEditing ? (
                          <div className="space-y-3 flex-1 text-slate-800 dark:text-slate-100">
                            <div>
                              <label className="text-[9px] uppercase font-bold opacity-60">Name</label>
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="w-full h-8 mt-1 rounded-lg px-2 text-xs border bg-transparent text-slate-800 dark:text-white"
                                style={{ borderColor: dm ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)' }}
                              />
                            </div>
                            <div>
                              <label className="text-[9px] uppercase font-bold opacity-60">Severity</label>
                              <select
                                value={editSeverity}
                                onChange={(e) => setEditSeverity(e.target.value)}
                                className="w-full h-8 mt-1 rounded-lg px-1.5 text-xs border bg-white dark:bg-zinc-800 text-slate-800 dark:text-white"
                                style={{ borderColor: dm ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)' }}
                              >
                                <option value="LOW">Low</option>
                                <option value="MEDIUM">Medium</option>
                                <option value="HIGH">High</option>
                                <option value="CRITICAL">Critical</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[9px] uppercase font-bold opacity-60">Warning Message</label>
                              <textarea
                                value={editWarningMessage}
                                onChange={(e) => setEditWarningMessage(e.target.value)}
                                rows={2}
                                className="w-full mt-1 p-2 text-xs border rounded-lg bg-transparent text-slate-800 dark:text-white"
                                style={{ borderColor: dm ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)' }}
                              />
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={() => handleUpdateGeofence(z.id)}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] px-3 py-1.5 rounded-lg flex-1 cursor-pointer"
                              >
                                Save Changes
                              </button>
                              <button
                                onClick={() => setEditingGeofenceId(null)}
                                className="bg-slate-700 hover:bg-slate-600 text-white font-bold text-[10px] px-3 py-1.5 rounded-lg flex-1 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm">{z.name}</span>
                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                                  z.severity === 'CRITICAL' ? 'bg-red-500/20 text-red-500' :
                                  z.severity === 'HIGH' ? 'bg-orange-500/20 text-orange-500' :
                                  'bg-yellow-500/20 text-yellow-500'
                                }`}>
                                  {z.severity}
                                </span>
                                <span className="text-[9px] font-bold opacity-50">
                                  ({z.geometry_type})
                                </span>
                              </div>
                              <p className="text-xs opacity-75">{z.warning_message || 'No custom warning message'}</p>
                              {z.geometry_type === 'CIRCLE' && z.center_lat && z.center_lng && (
                                <p className="text-[10px] opacity-50">Radius: {z.radius_m}m · Center: ({z.center_lat.toFixed(4)}, {z.center_lng.toFixed(4)})</p>
                              )}
                            </div>
                            <div className="flex gap-2.5 pt-2 border-t" style={{ borderColor: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}>
                              <button
                                onClick={() => startEditingGeofence(z)}
                                className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-[10px] px-3.5 py-1.5 rounded-xl cursor-pointer"
                              >
                                Edit Zone
                              </button>
                              <button
                                onClick={() => handleDeleteGeofence(z.id)}
                                className="bg-red-600 hover:bg-red-500 text-white font-bold text-[10px] px-3.5 py-1.5 rounded-xl cursor-pointer"
                              >
                                Delete Zone
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
