import React, { useEffect, useState, useRef } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, useMap } from '@vis.gl/react-google-maps';
import { MapPin, Navigation, Users, ShieldCheck, AlertTriangle, Layers, ExternalLink, ShieldAlert, Shield } from 'lucide-react';
import { GeoFenceZone } from '../types';

export interface MapClusterMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  crowdLevel?: 'extreme' | 'high' | 'medium' | 'low';
  crowdCount?: number;
  type?: 'crowd' | 'user' | 'police' | 'hotel' | 'alert' | 'geofence';
  /** Optional explicit pin color, used by callers (e.g. the tourist map) that
   * need a marker palette beyond the crowd/police heuristics below. */
  pinColor?: string;
  glyph?: string;
}

interface ActualGoogleMapProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  markers?: MapClusterMarker[];
  geofenceZones?: GeoFenceZone[];
  activeZoneId?: string;
  origin?: string;
  destination?: string;
  height?: string;
  onMarkerClick?: (marker: MapClusterMarker) => void;
  selectedMarkerId?: string;
  mapTypeControl?: boolean;
  /**
   * When true, renders edge-to-edge (no rounded corners / border) so the map
   * can sit as a full-bleed background layer behind floating chrome (search
   * bar, quick-action chips, SOS button, etc.) — used by the tourist map
   * screen. Defaults to false to keep every other existing usage unchanged.
   */
  fullBleed?: boolean;
  /**
   * When false, suppresses this component's own built-in overlay chrome
   * (top info/mode bar, bottom marker-badge strip, "Open Google Maps" link)
   * so a caller that provides its own floating search/quick-action/legend UI
   * doesn't end up with two overlapping control layers. Defaults to true so
   * every other existing usage is unaffected.
   */
  chrome?: boolean;
  /**
   * Bump `trigger` (e.g. from a "Locate me" button) to imperatively pan the
   * map to `target`. Ignored if unset.
   */
  recenter?: { trigger: number; target: { lat: number; lng: number } };
  /**
   * Bump `ts` (with a new Date.now()-style value) to imperatively zoom the
   * map in/out by one step. Ignored if unset.
   */
  zoomAction?: { type: 'in' | 'out'; ts: number };
}

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';

const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

/** Imperatively pans the live Google Map when `recenter.trigger` changes. */
const RecenterHandler: React.FC<{ recenter?: ActualGoogleMapProps['recenter'] }> = ({ recenter }) => {
  const map = useMap();
  useEffect(() => {
    if (!map || !recenter || recenter.trigger <= 0) return;
    map.panTo(recenter.target);
    map.setZoom(15);
  }, [map, recenter?.trigger]);
  return null;
};

/** Imperatively zooms the live Google Map when `zoomAction.ts` changes. */
const ZoomHandler: React.FC<{ zoomAction?: ActualGoogleMapProps['zoomAction'] }> = ({ zoomAction }) => {
  const map = useMap();
  useEffect(() => {
    if (!map || !zoomAction) return;
    const current = map.getZoom() ?? 14;
    map.setZoom(zoomAction.type === 'in' ? current + 1 : current - 1);
  }, [map, zoomAction?.ts]);
  return null;
};

const LeafletMap: React.FC<{
  center: { lat: number; lng: number };
  zoom: number;
  markers: MapClusterMarker[];
  geofenceZones?: GeoFenceZone[];
  activeZoneId?: string;
  onMarkerClick?: (marker: MapClusterMarker) => void;
  selectedMarkerId?: string;
  recenter?: { trigger: number; target: { lat: number; lng: number } };
  zoomAction?: { type: 'in' | 'out'; ts: number };
  darkMode: boolean;
  mapMode: 'm' | 'k' | 'p';
}> = ({
  center,
  zoom,
  markers,
  geofenceZones = [],
  activeZoneId,
  onMarkerClick,
  selectedMarkerId,
  recenter,
  zoomAction,
  darkMode,
  mapMode
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const markersGroupRef = useRef<any>(null);
  const geofencesGroupRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || !(window as any).L) return;
    const L = (window as any).L;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      scrollWheelZoom: true,
      dragging: true,
      touchZoom: true,
    }).setView([center.lat, center.lng], zoom);

    mapRef.current = map;

    markersGroupRef.current = L.layerGroup().addTo(map);
    geofencesGroupRef.current = L.layerGroup().addTo(map);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !(window as any).L) return;
    const L = (window as any).L;

    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }

    let tileUrl = '';
    let attribution = '';

    if (mapMode === 'k') {
      tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
      attribution = '&copy; Esri &mdash; Satellite';
    } else if (mapMode === 'p') {
      tileUrl = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
      attribution = '&copy; OpenTopoMap';
    } else {
      if (darkMode) {
        tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
        attribution = '&copy; OpenStreetMap &copy; CARTO';
      } else {
        tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
        attribution = '&copy; OpenStreetMap';
      }
    }

    tileLayerRef.current = L.tileLayer(tileUrl, { attribution, maxZoom: 19 }).addTo(map);
  }, [mapMode, darkMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && recenter && recenter.trigger > 0) {
      map.setView([recenter.target.lat, recenter.target.lng], 15, { animate: true });
    }
  }, [recenter?.trigger]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && zoomAction) {
      const current = map.getZoom();
      map.setZoom(zoomAction.type === 'in' ? current + 1 : current - 1, { animate: true });
    }
  }, [zoomAction?.ts]);

  useEffect(() => {
    const map = mapRef.current;
    const markersGroup = markersGroupRef.current;
    const geofencesGroup = geofencesGroupRef.current;
    if (!map || !markersGroup || !geofencesGroup || !(window as any).L) return;
    const L = (window as any).L;

    markersGroup.clearLayers();
    geofencesGroup.clearLayers();

    geofenceZones.forEach((z) => {
      const isActive = activeZoneId === z.id;
      let color = '#3B82F6';
      if (z.riskLevel === 'Unsafe') color = '#EF4444';
      else if (z.riskLevel === 'Caution') color = '#F59E0B';
      else if (z.riskLevel === 'Safe') color = '#10B981';

      L.circle([z.center.lat, z.center.lng], {
        color: color,
        fillColor: color,
        fillOpacity: isActive ? 0.35 : 0.15,
        weight: isActive ? 3 : 1.5,
        radius: z.radiusKm * 1000
      }).addTo(geofencesGroup);
    });

    markers.forEach((m) => {
      let pinColor = m.pinColor || '#3B82F6';
      if (!m.pinColor) {
        if (m.crowdLevel === 'extreme' || m.crowdLevel === 'high') pinColor = '#EF4444';
        else if (m.crowdLevel === 'medium') pinColor = '#F59E0B';
        else if (m.crowdLevel === 'low') pinColor = '#10B981';
        if (m.type === 'police') pinColor = '#138808';
      }

      const isSelected = selectedMarkerId === m.id;

      const icon = L.divIcon({
        html: `<div style="
          background-color: ${pinColor};
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 2px solid ${isSelected ? '#FFFFFF' : 'rgba(255,255,255,0.8)'};
          box-shadow: 0 2px 8px rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 900;
          font-size: 11px;
          transform: ${isSelected ? 'scale(1.2)' : 'none'};
          transition: transform 0.15s;
        ">${m.glyph || ''}</div>`,
        className: 'custom-leaflet-marker',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const marker = L.marker([m.lat, m.lng], { icon }).addTo(markersGroup);
      if (onMarkerClick) {
        marker.on('click', () => onMarkerClick(m));
      }
    });
  }, [markers, geofenceZones, activeZoneId, selectedMarkerId]);

  return <div ref={containerRef} className="w-full h-full z-0" />;
};

export const ActualGoogleMap: React.FC<ActualGoogleMapProps> = ({
  center = { lat: 32.2432, lng: 77.1892 }, // Manali default
  zoom = 12,
  markers = [],
  geofenceZones = [],
  activeZoneId,
  origin,
  destination,
  height = '320px',
  onMarkerClick,
  selectedMarkerId,
  mapTypeControl = true,
  fullBleed = false,
  chrome = true,
  recenter,
  zoomAction
}) => {
  const [activeMarker, setActiveMarker] = useState<MapClusterMarker | null>(null);
  const [mapMode, setMapMode] = useState<'m' | 'k' | 'p'>('m'); // m: roadmap, k: satellite, p: terrain
  const [fallbackCenter, setFallbackCenter] = useState(center);
  const [fallbackZoom, setFallbackZoom] = useState(zoom);

  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => document.documentElement.classList.contains('dark'));

  // Track global dark mode changes using MutationObserver
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Dynamically load Leaflet if no Google Maps key is present
  useEffect(() => {
    if (hasValidKey) return;
    if ((window as any).L) {
      setLeafletLoaded(true);
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    script.onload = () => {
      setLeafletLoaded(true);
    };
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    if (recenter && recenter.trigger > 0) setFallbackCenter(recenter.target);
  }, [recenter?.trigger]);

  useEffect(() => {
    if (!zoomAction) return;
    setFallbackZoom((z) => Math.max(3, Math.min(20, zoomAction.type === 'in' ? z + 1 : z - 1)));
  }, [zoomAction?.ts]);

  const handleSelectMarker = (m: MapClusterMarker) => {
    setActiveMarker(m);
    if (onMarkerClick) onMarkerClick(m);
  };

  const wrapperClass = fullBleed
    ? 'relative w-full h-full overflow-hidden'
    : 'relative w-full rounded-2xl overflow-hidden border border-slate-300 shadow-sm';

  // If valid API key is supplied, use @vis.gl/react-google-maps
  if (hasValidKey) {
    return (
      <div className={wrapperClass} style={fullBleed ? undefined : { height }}>
        <APIProvider apiKey={API_KEY} version="weekly">
          <Map
            defaultCenter={center}
            defaultZoom={zoom}
            mapId="DEMO_MAP_ID"
            colorScheme={isDarkMode ? 'DARK' : 'LIGHT'}
            gestureHandling="greedy"
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            style={{ width: '100%', height: '100%' }}
          >
            <RecenterHandler recenter={recenter} />
            <ZoomHandler zoomAction={zoomAction} />
            {markers.map((m) => {
              let pinBg = m.pinColor || '#3B82F6';
              if (!m.pinColor) {
                if (m.crowdLevel === 'extreme' || m.crowdLevel === 'high') pinBg = '#EF4444';
                else if (m.crowdLevel === 'medium') pinBg = '#F59E0B';
                else if (m.crowdLevel === 'low') pinBg = '#10B981';
                if (m.type === 'police') pinBg = '#138808';
              }

              return (
                <AdvancedMarker
                  key={m.id}
                  position={{ lat: m.lat, lng: m.lng }}
                  onClick={() => handleSelectMarker(m)}
                >
                  <Pin background={pinBg} glyphColor="#FFFFFF" glyph={m.glyph} />
                </AdvancedMarker>
              );
            })}
          </Map>
        </APIProvider>
      </div>
    );
  }

  // Loading state if Leaflet resources are not yet loaded
  if (!leafletLoaded) {
    return (
      <div className={wrapperClass} style={fullBleed ? undefined : { height }}>
        <div className="w-full h-full flex items-center justify-center bg-slate-900 text-slate-400 text-sm font-medium">
          Loading safety map...
        </div>
      </div>
    );
  }

  return (
    <div className={wrapperClass} style={fullBleed ? undefined : { height }}>
      
      {/* Interactive CDN-loaded Leaflet Map Layer */}
      <LeafletMap
        center={fallbackCenter}
        zoom={fallbackZoom}
        markers={markers}
        geofenceZones={geofenceZones}
        activeZoneId={activeZoneId}
        onMarkerClick={handleSelectMarker}
        selectedMarkerId={selectedMarkerId || activeMarker?.id}
        recenter={recenter}
        zoomAction={zoomAction}
        darkMode={isDarkMode}
        mapMode={mapMode}
      />

      {/* Map Control Bar Top */}
      {chrome && (
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700 shadow-md text-white text-xs font-bold">
          <MapPin className="w-3.5 h-3.5 text-red-500 animate-pulse" />
          <span className="truncate max-w-[180px] sm:max-w-[280px]">
            {destination ? `${origin || 'My Location'} ➔ ${destination}` : 'Live GIS View'}
          </span>
        </div>

        {mapTypeControl && (
          <div className="pointer-events-auto flex items-center bg-slate-900/90 backdrop-blur-md p-1 rounded-xl border border-slate-700 shadow-md">
            <button
              onClick={() => setMapMode('m')}
              className={`px-2 py-1 text-[10px] font-black rounded-lg transition cursor-pointer ${
                mapMode === 'm' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Map
            </button>
            <button
              onClick={() => setMapMode('k')}
              className={`px-2 py-1 text-[10px] font-black rounded-lg transition cursor-pointer ${
                mapMode === 'k' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Satellite
            </button>
            <button
              onClick={() => setMapMode('p')}
              className={`px-2 py-1 text-[10px] font-black rounded-lg transition cursor-pointer ${
                mapMode === 'p' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Terrain
            </button>
          </div>
        )}
      </div>
      )}

      {/* Interactive People Clusters Floating Overlay on the Map */}
      {chrome && (markers.length > 0 || geofenceZones.length > 0) && (
        <div className="absolute bottom-3 left-3 right-3 z-10 pointer-events-auto flex gap-2 overflow-x-auto pb-1 max-w-full scrollbar-thin">
          {geofenceZones.map((z) => {
            const isActive = activeZoneId === z.id;
            let badgeBg = 'bg-slate-900/85 text-slate-200 border-slate-700';
            if (z.riskLevel === 'Unsafe') {
              badgeBg = isActive ? 'bg-red-600 border-red-400 text-white ring-2 ring-white scale-105' : 'bg-red-950/80 border-red-700 text-red-200';
            } else if (z.riskLevel === 'Caution') {
              badgeBg = isActive ? 'bg-amber-500 border-amber-300 text-slate-950 ring-2 ring-white scale-105' : 'bg-amber-950/80 border-amber-700 text-amber-200';
            } else if (z.riskLevel === 'Safe') {
              badgeBg = isActive ? 'bg-emerald-600 border-emerald-300 text-white ring-2 ring-white scale-105' : 'bg-emerald-950/80 border-emerald-700 text-emerald-200';
            }

            return (
              <div
                key={z.id}
                className={`flex-shrink-0 px-3 py-1.5 rounded-xl border text-xs font-black flex items-center gap-1.5 shadow-lg backdrop-blur-md ${badgeBg}`}
              >
                {z.riskLevel === 'Unsafe' && <ShieldAlert className="w-3.5 h-3.5 text-red-400" />}
                {z.riskLevel === 'Caution' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                {z.riskLevel === 'Safe' && <Shield className="w-3.5 h-3.5 text-emerald-400" />}
                <span>{z.name}</span>
                <span className="px-1.5 py-0.2 rounded bg-black/30 text-[9px] uppercase font-bold">
                  {z.riskLevel}
                </span>
              </div>
            );
          })}

          {markers.map((m) => {
            const isSelected = selectedMarkerId === m.id || activeMarker?.id === m.id;
            let badgeBg = 'bg-blue-600 border-blue-400 text-white';
            if (m.crowdLevel === 'extreme' || m.crowdLevel === 'high') {
              badgeBg = 'bg-red-600 border-red-400 text-white';
            } else if (m.crowdLevel === 'medium') {
              badgeBg = 'bg-amber-500 border-amber-300 text-slate-950';
            } else if (m.crowdLevel === 'low') {
              badgeBg = 'bg-emerald-600 border-emerald-300 text-white';
            }

            return (
              <button
                key={m.id}
                onClick={() => handleSelectMarker(m)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-xl border text-xs font-black transition flex items-center gap-1.5 shadow-lg backdrop-blur-md cursor-pointer ${
                  isSelected
                    ? `${badgeBg} ring-2 ring-white scale-105`
                    : 'bg-slate-900/85 text-slate-200 border-slate-700 hover:bg-slate-800'
                }`}
              >
                {m.type === 'crowd' && <Users className="w-3.5 h-3.5" />}
                {m.type === 'police' && <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />}
                {m.type === 'user' && <MapPin className="w-3.5 h-3.5 text-blue-400" />}
                <span>{m.title}</span>
                {m.crowdCount !== undefined && (
                  <span className="px-1.5 py-0.2 rounded bg-black/30 text-[10px]">
                    👥 {m.crowdCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* External Google Maps Button */}
      {chrome && (
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${fallbackCenter.lat},${fallbackCenter.lng}`}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute top-3 right-3 z-20 hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/90 hover:bg-white text-slate-900 font-extrabold text-[11px] shadow border border-slate-300 transition"
      >
        <span>Open Google Maps</span>
        <ExternalLink className="w-3.5 h-3.5 text-blue-600" />
      </a>
      )}

    </div>
  );
};
