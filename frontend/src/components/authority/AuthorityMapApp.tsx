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

  // Broadcast composer state variables
  const [regionState, setRegionState] = useState('All');
  const [radiusState, setRadiusState] = useState(10);
  const [severityState, setSeverityState] = useState<AlertSeverity>('Critical');
  const [titleState, setTitleState] = useState('');
  const [bodyState, setBodyState] = useState('');

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
    <div className="fixed inset-0 overflow-hidden" style={{ background: dm ? '#09090b' : '#f8fafc' }}>
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
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
      />

      {viewMode === 'split' ? (
        // Split-Screen Command Grid Dashboard
        <div className="absolute inset-x-0 bottom-0 top-14 flex p-3 gap-3 overflow-hidden">
          
          {/* Left Side: Tourists & Responders Panel */}
          <div 
            className="w-80 flex flex-col rounded-2xl border flex-shrink-0 overflow-hidden"
            style={{ 
              background: dm ? 'rgba(10,20,40,0.6)' : 'rgba(255,255,255,0.85)',
              borderColor: dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
              backdropFilter: 'blur(16px)'
            }}
          >
            {/* Panel tab buttons */}
            <div className="flex p-1 bg-black/10 dark:bg-white/5 border-b" style={{ borderColor: dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
              <button
                onClick={() => setLeftTab('tourists')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  leftTab === 'tourists' 
                    ? 'bg-white dark:bg-zinc-800 text-[#0C2340] dark:text-white shadow-sm font-extrabold' 
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <Users size={14} />
                <span>Tourists ({tourists.length})</span>
              </button>
              <button
                onClick={() => setLeftTab('responders')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  leftTab === 'responders' 
                    ? 'bg-white dark:bg-zinc-800 text-[#0C2340] dark:text-white shadow-sm font-extrabold' 
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <Radio size={14} />
                <span>Responders ({units.length})</span>
              </button>
            </div>

            {/* Search bar & status filters (only if tourists active) */}
            {leftTab === 'tourists' && (
              <div className="p-3 space-y-2 border-b" style={{ borderColor: dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Filter by name / ID..."
                    value={touristSearch}
                    onChange={(e) => setTouristSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border bg-transparent text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#FF9933]"
                    style={{ borderColor: dm ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)' }}
                  />
                  <Search size={12} className="text-slate-400 absolute left-2.5 top-2.5" />
                </div>
                <div className="flex gap-1 overflow-x-auto no-scrollbar">
                  {(['All', 'SOS Active', 'Watch', 'Safe'] as const).map((filterVal) => (
                    <button
                      key={filterVal}
                      onClick={() => setTouristFilter(filterVal)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap transition cursor-pointer ${
                        touristFilter === filterVal
                          ? 'bg-[#0B2447] text-white dark:bg-white dark:text-slate-900 shadow-sm'
                          : dm ? 'bg-white/5 text-white/50 hover:bg-white/10' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {filterVal}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Tab content area */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {leftTab === 'tourists' ? (
                // Tourists tab content
                tourists
                  .filter(tr => 
                    (touristFilter === 'All' || tr.safetyStatus === touristFilter) &&
                    (tr.full_name || tr.name || '').toLowerCase().includes(touristSearch.toLowerCase())
                  )
                  .map((tr) => (
                    <button
                      key={tr.id}
                      onClick={() => {
                        const live = mergedLive[tr.tourist_id || ''] || mergedLive[tr.id];
                        const lat = live?.latitude ?? tr.currentLocation?.lat;
                        const lng = live?.longitude ?? tr.currentLocation?.lng;
                        if (lat != null && lng != null) {
                          flyTo(lat, lng);
                          setSelectedMarkerId(`tourist-${tr.id}`);
                        } else {
                          alert(`Tourist "${tr.full_name || tr.name}" is offline.`);
                        }
                      }}
                      className="w-full text-left p-2.5 rounded-xl transition border bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 flex items-start gap-2 text-slate-800 dark:text-slate-100 cursor-pointer"
                      style={{ borderColor: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}
                    >
                      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-[11px]" style={{ background: dm ? 'rgba(255,255,255,0.08)' : 'rgba(11,36,71,0.08)' }}>
                        {(tr.full_name || tr.name || 'T').substring(0, 1).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="text-xs font-bold truncate">{tr.full_name || tr.name}</span>
                          <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full border ${
                            tr.safetyStatus === 'SOS Active' ? 'bg-red-500/10 text-red-500 border-red-500/30' :
                            tr.safetyStatus === 'Watch' ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' :
                            'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                          }`}>
                            {tr.safetyStatus}
                          </span>
                        </div>
                        <div className="text-[10px] opacity-60 truncate mt-0.5 flex items-center gap-1">
                          <MapPin size={9} />
                          <span>Last seen: {tr.lastSeenTime}</span>
                        </div>
                      </div>
                    </button>
                  ))
              ) : (
                // Patrol Units (Responders) tab content
                units.map((u) => {
                  return (
                    <div
                      key={u.id}
                      className="p-3 rounded-xl border flex flex-col gap-2 bg-black/5 dark:bg-white/5 text-slate-800 dark:text-slate-100"
                      style={{ borderColor: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0 flex-1">
                          <span className="text-xs font-extrabold block truncate">{u.unitName}</span>
                          <span className="text-[10px] opacity-50 block mt-0.5">{u.type} · {u.unitLeader}</span>
                        </div>
                        <span 
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1 shadow-sm"
                          style={{ 
                            background: u.status === 'Patrolling' ? '#138808' : 
                                        u.status === 'Dispatched' ? '#FF9933' : 
                                        u.status === 'On Scene' ? '#dc2626' : '#64748b' 
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-2 pt-1 border-t" style={{ borderColor: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}>
                        <div className="flex-1">
                          <select
                            value={u.status}
                            onChange={(e) => {
                              if (onUpdateUnitStatus) {
                                onUpdateUnitStatus(u.id, e.target.value as PatrollingUnit['status']);
                              }
                            }}
                            className="w-full h-7 rounded-lg px-1 text-[10px] font-bold border bg-white dark:bg-zinc-800 text-slate-800 dark:text-white border-slate-200 dark:border-zinc-700 outline-none cursor-pointer"
                          >
                            <option value="Standby">Standby</option>
                            <option value="Patrolling">Patrolling</option>
                            <option value="Dispatched">Dispatched</option>
                            <option value="On Scene">On Scene</option>
                          </select>
                        </div>
                        <button
                          onClick={() => flyTo(u.location.lat, u.location.lng)}
                          className="h-7 px-2 rounded-lg text-[10px] font-bold bg-[#0B2447] text-white hover:opacity-90 flex items-center gap-1 cursor-pointer"
                        >
                          <MapPin size={10} />
                          <span>Track</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Center Section: Map & Operations Control Panel */}
          <div className="flex-1 flex flex-col gap-3 overflow-hidden h-full">
            {/* Map Container */}
            <div 
              className="flex-1 relative rounded-2xl overflow-hidden border"
              style={{ 
                borderColor: dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                background: '#09090b' 
              }}
            >
              <ActualGoogleMap
                center={DEFAULT_CENTER}
                zoom={5}
                markers={markers}
                geofenceZones={[...convertedGeofenceZones, ...(layers.showHeatmapLayer ? clustersToZones(clusters) : [])]}
                onMarkerClick={handleMarkerClick}
                selectedMarkerId={selectedMarkerId}
                fullBleed={false}
                chrome={false}
                recenter={recenter}
                height="100%"
                enableDrawing={true}
                onGeofenceCreated={onGeofenceCreated}
                lockedCity={lockedCity}
                enableDirectionsOnClick={false}
                startDrawTrigger={startDrawTrigger}
              />
            </div>

            {/* Operations Tab panel */}
            <div 
              className="h-[250px] rounded-2xl border flex flex-col overflow-hidden flex-shrink-0"
              style={{ 
                background: dm ? 'rgba(10,20,40,0.6)' : 'rgba(255,255,255,0.85)',
                borderColor: dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                backdropFilter: 'blur(16px)'
              }}
            >
              <div className="flex p-1 bg-black/10 dark:bg-white/5 border-b" style={{ borderColor: dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
                <button
                  onClick={() => setCenterTab('geofences')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    centerTab === 'geofences' 
                      ? 'bg-white dark:bg-zinc-800 text-[#0C2340] dark:text-white shadow-sm font-extrabold' 
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  <Settings size={14} className="text-pink-500" />
                  <span>Geofence Zone Management</span>
                </button>
                <button
                  onClick={() => setCenterTab('audits')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    centerTab === 'audits' 
                      ? 'bg-white dark:bg-zinc-800 text-[#0C2340] dark:text-white shadow-sm font-extrabold' 
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  <Activity size={14} className="text-blue-500" />
                  <span>Real-Time Audit Trails</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {centerTab === 'geofences' ? (
                  <div className="flex gap-4 h-full items-stretch">
                    {/* Drawing triggers */}
                    <div className="w-[180px] border-r pr-4 flex flex-col justify-center gap-2" style={{ borderColor: dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
                      <span className="text-[10px] font-extrabold uppercase opacity-55">Draw Zones</span>
                      <button
                        onClick={() => setStartDrawTrigger({ shape: 'circle', ts: Date.now() })}
                        className="w-full py-1.5 rounded-lg text-[10px] font-bold bg-[#0B2447] text-white hover:opacity-90 flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Plus size={10} />
                        <span>Draw Circle Zone</span>
                      </button>
                      <button
                        onClick={() => setStartDrawTrigger({ shape: 'polygon', ts: Date.now() })}
                        className="w-full py-1.5 rounded-lg text-[10px] font-bold bg-[#0B2447] text-white hover:opacity-90 flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Plus size={10} />
                        <span>Draw Polygon Zone</span>
                      </button>
                    </div>
                    
                    {/* Active Zones List */}
                    <div className="flex-1 overflow-y-auto pr-1">
                      {geofences.length === 0 ? (
                        <div className="text-center py-8 text-xs opacity-50">No geofences active. Draw a zone on the map to create one!</div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-slate-800 dark:text-slate-200">
                          {geofences.map((z) => {
                            const isEditing = editingGeofenceId === z.id;
                            return (
                              <div 
                                key={z.id}
                                className="p-2.5 border rounded-xl flex flex-col gap-2 bg-black/5 dark:bg-white/5 text-slate-800 dark:text-slate-200"
                                style={{ borderColor: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}
                              >
                                {isEditing ? (
                                  <div className="space-y-2 flex-1 text-slate-800 dark:text-slate-100">
                                    <div>
                                      <label className="text-[8px] uppercase font-bold opacity-60">Name</label>
                                      <input
                                        type="text"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        className="w-full h-7 mt-0.5 rounded-lg px-2 text-xs border bg-transparent text-slate-800 dark:text-white"
                                        style={{ borderColor: dm ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)' }}
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[8px] uppercase font-bold opacity-60">Severity</label>
                                      <select
                                        value={editSeverity}
                                        onChange={(e) => setEditSeverity(e.target.value)}
                                        className="w-full h-7 mt-0.5 rounded-lg px-1 text-xs border bg-white dark:bg-zinc-800 text-slate-800 dark:text-white"
                                        style={{ borderColor: dm ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)' }}
                                      >
                                        <option value="LOW">Low</option>
                                        <option value="MEDIUM">Medium</option>
                                        <option value="HIGH">High</option>
                                        <option value="CRITICAL">Critical</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="text-[8px] uppercase font-bold opacity-60">Warning Message</label>
                                      <textarea
                                        value={editWarningMessage}
                                        onChange={(e) => setEditWarningMessage(e.target.value)}
                                        rows={2}
                                        className="w-full mt-0.5 p-1.5 text-xs border rounded-lg bg-transparent text-slate-800 dark:text-white"
                                        style={{ borderColor: dm ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)' }}
                                      />
                                    </div>
                                    <div className="flex gap-1.5 pt-1">
                                      <button
                                        onClick={() => handleUpdateGeofence(z.id)}
                                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[9px] px-2.5 py-1 rounded-lg flex-1 cursor-pointer"
                                      >
                                        Save
                                      </button>
                                      <button
                                        onClick={() => setEditingGeofenceId(null)}
                                        className="bg-slate-700 hover:bg-slate-600 text-white font-bold text-[9px] px-2.5 py-1 rounded-lg flex-1 cursor-pointer"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div className="flex items-center justify-between gap-1.5">
                                      <div className="min-w-0 flex-1">
                                        <span className="font-extrabold text-[11px] block truncate">{z.name}</span>
                                        <span className="text-[9px] opacity-60 block mt-0.5">{z.severity} · {z.geometry_type}</span>
                                      </div>
                                      <div className="flex gap-1 flex-shrink-0">
                                        <button
                                          onClick={() => startEditingGeofence(z)}
                                          className="p-1 rounded bg-blue-600/10 text-blue-500 hover:bg-blue-600 hover:text-white transition cursor-pointer"
                                          title="Edit"
                                        >
                                          <Edit size={12} />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteGeofence(z.id)}
                                          className="p-1 rounded bg-red-600/10 text-red-500 hover:bg-red-600 hover:text-white transition cursor-pointer"
                                          title="Delete"
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      </div>
                                    </div>
                                    {z.warning_message && (
                                      <p className="text-[10px] opacity-75 border-t pt-1 mt-1 truncate" style={{ borderColor: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}>
                                        {z.warning_message}
                                      </p>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="h-full overflow-y-auto -mt-2">
                    <ModuleAnalyticsAudit language={language} auditLogs={auditLogs} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Section: Active SOS & Broadcast Alert Composer */}
          <div 
            className="w-[340px] flex flex-col rounded-2xl border flex-shrink-0 overflow-hidden"
            style={{ 
              background: dm ? 'rgba(10,20,40,0.6)' : 'rgba(255,255,255,0.85)',
              borderColor: dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
              backdropFilter: 'blur(16px)'
            }}
          >
            {/* Panel tab buttons */}
            <div className="flex p-1 bg-black/10 dark:bg-white/5 border-b" style={{ borderColor: dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
              <button
                onClick={() => setRightTab('incidents')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  rightTab === 'incidents' 
                    ? 'bg-white dark:bg-zinc-800 text-[#0C2340] dark:text-white shadow-sm font-extrabold' 
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <ShieldAlert size={14} className="text-red-500" />
                <span>Active SOS ({incidents.filter(i => i.status !== 'Resolved').length})</span>
              </button>
              <button
                onClick={() => setRightTab('broadcast')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  rightTab === 'broadcast' 
                    ? 'bg-white dark:bg-zinc-800 text-[#0C2340] dark:text-white shadow-sm font-extrabold' 
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <Send size={14} className="text-amber-500" />
                <span>Broadcast Hub</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {rightTab === 'incidents' ? (
                // Incidents Queue List
                <div className="space-y-3">
                  {/* Select operations header */}
                  {incidents.filter(i => i.status !== 'Resolved').length > 0 && (
                    <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}>
                      <button
                        onClick={() => {
                          setSelectMode((prev) => !prev);
                          setSelectedIds(new Set());
                        }}
                        className="text-[10px] font-extrabold uppercase tracking-wide px-2 py-1 rounded transition bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                      >
                        {selectMode ? 'Cancel Selection' : 'Bulk Select'}
                      </button>
                      
                      {selectMode && (
                        <button
                          onClick={() => {
                            if (selectedIds.size === 0) return;
                            if (!window.confirm(`Mark ${selectedIds.size} SOS incident(s) as resolved?`)) return;
                            onBulkResolveIncidents(Array.from(selectedIds));
                            setSelectedIds(new Set());
                            setSelectMode(false);
                          }}
                          disabled={selectedIds.size === 0}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold text-white bg-emerald-600 disabled:opacity-40 cursor-pointer animate-pulse"
                        >
                          <CheckCircle2 size={12} />
                          <span>Resolve ({selectedIds.size})</span>
                        </button>
                      )}
                    </div>
                  )}
                  
                  {incidents.filter(i => i.status !== 'Resolved').length === 0 ? (
                    <div className="text-center py-10 text-xs opacity-50">No active SOS incidents. Excellent!</div>
                  ) : (
                    incidents.filter(i => i.status !== 'Resolved').map((inc) => {
                      const isSelected = selectedIds.has(inc.id);
                      return (
                        <div
                          key={inc.id}
                          className={`p-3 rounded-xl border flex flex-col gap-2 relative bg-black/5 dark:bg-white/5 text-slate-800 dark:text-slate-100 transition-all ${
                            inc.severity === 'Critical' ? 'border-red-500/40 animate-pulse-glow shadow-sm' : ''
                          }`}
                          style={{
                            borderColor: isSelected ? '#FF9933' : undefined
                          }}
                        >
                          {selectMode && (
                            <button
                              onClick={() => {
                                setSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(inc.id)) next.delete(inc.id); else next.add(inc.id);
                                  return next;
                                });
                              }}
                              className="absolute top-2.5 right-2.5 cursor-pointer"
                            >
                              {isSelected ? (
                                <CheckSquare size={16} className="text-[#FF9933]" />
                              ) : (
                                <Square size={16} className="opacity-50" />
                              )}
                            </button>
                          )}
                          <div className="flex items-center gap-1.5 justify-between pr-6">
                            <span className="font-mono text-[10px] opacity-50">{inc.id}</span>
                            <span className={`text-[8px] font-extrabold px-1.5 py-0.5 rounded-full border ${
                              inc.severity === 'Critical' ? 'bg-red-500/15 text-red-500 border-red-500/35' : 'bg-amber-500/15 text-amber-500 border-amber-500/35'
                            }`}>
                              {inc.severity}
                            </span>
                          </div>
                          <div>
                            <span className="font-bold text-xs block">{inc.touristName}</span>
                            <span className="text-[10px] opacity-60 block mt-0.5">{inc.hazardType}</span>
                          </div>
                          <div className="text-[9px] opacity-40 flex items-center gap-1">
                            <Clock size={10} />
                            <span>{inc.timestamp}</span>
                          </div>
                          <div className="flex gap-1.5 pt-1.5 border-t" style={{ borderColor: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}>
                            <button
                              onClick={() => {
                                flyTo(inc.location.lat, inc.location.lng);
                                setManualTakeoverIncident(inc);
                              }}
                              className="flex-1 py-1 rounded-lg text-[10px] font-bold bg-[#0B2447] text-white hover:opacity-90 flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <MapPin size={10} />
                              <span>Locate</span>
                            </button>
                            <button
                              onClick={() => onResolveIncident(inc.id)}
                              className="flex-1 py-1 rounded-lg text-[10px] font-bold bg-emerald-600 text-white hover:opacity-90 flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <CheckCircle2 size={10} />
                              <span>Resolve</span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                // Broadcast Alert Composer Form Inline
                <div className="space-y-3.5 text-slate-800 dark:text-slate-100">
                  <span className="text-[10px] font-extrabold uppercase opacity-55 block">Send Alert Broadcast</span>
                  
                  <div>
                    <label className="text-[9px] font-bold uppercase opacity-65">Target Region</label>
                    <select
                      value={regionState}
                      onChange={(e) => setRegionState(e.target.value)}
                      className="w-full h-8 mt-1 rounded-lg px-2 text-xs border bg-white dark:bg-zinc-850 text-slate-800 dark:text-white border-slate-200 dark:border-zinc-700 outline-none"
                    >
                      <option value="All">All Regions / States</option>
                      <option value="Himachal Pradesh">Himachal Pradesh</option>
                      <option value="Maharashtra">Maharashtra</option>
                    </select>
                  </div>
                  
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-[9px] font-bold uppercase opacity-65">Radius (km)</label>
                      <input
                        type="number"
                        value={radiusState}
                        onChange={(e) => setRadiusState(Number(e.target.value))}
                        className="w-full h-8 mt-1 rounded-lg px-2 text-xs border bg-transparent text-slate-800 dark:text-white border-slate-200 dark:border-zinc-700"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[9px] font-bold uppercase opacity-65">Severity</label>
                      <select
                        value={severityState}
                        onChange={(e) => setSeverityState(e.target.value as AlertSeverity)}
                        className="w-full h-8 mt-1 rounded-lg px-1.5 text-xs border bg-white dark:bg-zinc-850 text-slate-800 dark:text-white border-slate-200 dark:border-zinc-700 outline-none"
                      >
                        <option value="Critical">Critical</option>
                        <option value="Warning">Warning</option>
                        <option value="Advisory">Advisory</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[9px] font-bold uppercase opacity-65">Alert Title</label>
                    <input
                      type="text"
                      value={titleState}
                      onChange={(e) => setTitleState(e.target.value)}
                      placeholder="E.g., Severe Weather Warning"
                      className="w-full h-8 mt-1 rounded-lg px-2 text-xs border bg-transparent text-slate-800 dark:text-white border-slate-200 dark:border-zinc-700"
                    />
                  </div>

                  <div>
                    <label className="text-[9px] font-bold uppercase opacity-65">Alert Message</label>
                    <textarea
                      value={bodyState}
                      onChange={(e) => setBodyState(e.target.value)}
                      placeholder="Enter emergency message details..."
                      rows={3}
                      className="w-full mt-1 p-2 text-xs border rounded-lg bg-transparent text-slate-800 dark:text-white border-slate-200 dark:border-zinc-700"
                    />
                  </div>

                  <button
                    onClick={() => {
                      if (!titleState.trim() || !bodyState.trim()) return;
                      onSendBroadcast({
                        senderBadge: 'Officer',
                        region: regionState,
                        radiusKm: radiusState,
                        titleEn: titleState,
                        titleHi: titleState,
                        bodyEn: bodyState,
                        bodyHi: bodyState,
                        severity: severityState,
                        recipientCount: Math.round(1800 * (radiusState / 5))
                      });
                      setTitleState('');
                      setBodyState('');
                      alert('Broadcast alert dispatched to active devices!');
                    }}
                    disabled={!titleState.trim() || !bodyState.trim()}
                    className="w-full py-2.5 rounded-xl text-xs font-bold text-white bg-amber-500 hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Send size={12} />
                    <span>Send Broadcast</span>
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>
      ) : (
        // Map-Only overlay view (Original Layout)
        <>
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
        </>
      )}

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
