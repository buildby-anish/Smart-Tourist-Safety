import React, { useEffect, useState } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow, useAdvancedMarkerRef, useMap } from '@vis.gl/react-google-maps';
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
    // Only re-run when the trigger counter changes, not on every target
    // object identity change (target is recreated each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, zoomAction?.ts]);
  return null;
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
  // Fallback (no API key) mode has no imperative map handle — it's a static
  // embed URL — so recenter/zoom are honored there by rebuilding the embed
  // URL from local state instead.
  const [fallbackCenter, setFallbackCenter] = useState(center);
  const [fallbackZoom, setFallbackZoom] = useState(zoom);

  useEffect(() => {
    if (recenter && recenter.trigger > 0) setFallbackCenter(recenter.target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenter?.trigger]);

  useEffect(() => {
    if (!zoomAction) return;
    setFallbackZoom((z) => Math.max(3, Math.min(20, zoomAction.type === 'in' ? z + 1 : z - 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Fallback Google Map View using Google Maps embed query + custom crowd/route overlays
  // Google Map embed URL with dynamic query / coordinates
  const searchLocation = destination ? encodeURIComponent(destination) : `${fallbackCenter.lat},${fallbackCenter.lng}`;
  const embedUrl = `https://maps.google.com/maps?q=${searchLocation}&t=${mapMode}&z=${fallbackZoom}&ie=UTF8&iwloc=&output=embed`;

  const fallbackWrapperClass = fullBleed
    ? 'relative w-full h-full overflow-hidden bg-slate-900'
    : 'relative w-full rounded-2xl overflow-hidden border-2 border-slate-300 shadow-sm bg-slate-900';

  return (
    <div className={fallbackWrapperClass} style={fullBleed ? undefined : { height }}>
      
      {/* Live Google Map Iframe Layer */}
      <iframe
        title="Google Maps Location View"
        src={embedUrl}
        className="w-full h-full border-0 filter brightness-95 contrast-105"
        loading="lazy"
        allowFullScreen
      />

      {/* Map Control Bar Top */}
      {chrome && (
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700 shadow-md text-white text-xs font-bold">
          <MapPin className="w-3.5 h-3.5 text-red-500 animate-pulse" />
          <span className="truncate max-w-[180px] sm:max-w-[280px]">
            {destination ? `${origin || 'My Location'} ➔ ${destination}` : 'Live Google Maps View'}
          </span>
        </div>

        {mapTypeControl && (
          <div className="pointer-events-auto flex items-center bg-slate-900/90 backdrop-blur-md p-1 rounded-xl border border-slate-700 shadow-md">
            <button
              onClick={() => setMapMode('m')}
              className={`px-2 py-1 text-[10px] font-black rounded-lg transition ${
                mapMode === 'm' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Map
            </button>
            <button
              onClick={() => setMapMode('k')}
              className={`px-2 py-1 text-[10px] font-black rounded-lg transition ${
                mapMode === 'k' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Satellite
            </button>
            <button
              onClick={() => setMapMode('p')}
              className={`px-2 py-1 text-[10px] font-black rounded-lg transition ${
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
                className={`flex-shrink-0 px-3 py-1.5 rounded-xl border text-xs font-black transition flex items-center gap-1.5 shadow-lg backdrop-blur-md ${
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
        href={`https://www.google.com/maps/search/?api=1&query=${searchLocation}`}
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
