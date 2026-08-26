import { useEffect, useState } from 'react';
import { ActualGoogleMap, MapClusterMarker } from '../ActualGoogleMap';
import { getSOSLocation } from '../../lib/location';
import { listGeofences } from '../../lib/api';
import { GeoFenceZone } from '../../types';
import { MOCK_GEOFENCE_ZONES } from '../../data/mockData';

// ─── Marker palette (kept in sync with the redesigned UI's legend/quick-action colors) ───
const MARKER_COLOR: Record<string, string> = {
  attraction: '#FF9933',
  restaurant: '#f97316',
  hotel: '#6366f1',
  police: '#2563eb',
  hospital: '#16a34a',
  alert: '#dc2626',
  crowd: '#d97706',
  safe: '#138808',
};

const MARKER_GLYPH: Record<string, string> = {
  attraction: '\u2605',
  restaurant: '\u2726',
  hotel: 'H',
  police: '\u2691',
  hospital: '+',
  alert: '!',
  crowd: '\u25CE',
  safe: '\u2713',
};

// ─── Points of interest ───────────────────────────────────────────────────
// No backend "places" endpoint exists in this project (confirmed against
// backend/routers/*) — the previous frontend's map layer was populated the
// same way, from static in-app data (see the old ActualGoogleMap callers and
// data/mockData.ts). This preserves that existing behavior instead of
// inventing a places API; it is not new mock data introduced by this pass.
export const POIS: {
  id: string;
  lat: number;
  lng: number;
  type: keyof typeof MARKER_COLOR;
  label: string;
  crowdLevel?: 'extreme' | 'high' | 'medium' | 'low';
  crowdCount?: number;
}[] = [
  { id: 'gate', lat: 18.9220, lng: 72.8347, type: 'attraction', label: 'Gateway of India', crowdLevel: 'extreme', crowdCount: 450 },
  { id: 'taj_m', lat: 18.9256, lng: 72.8242, type: 'hotel', label: 'Taj Mahal Palace', crowdLevel: 'medium', crowdCount: 120 },
  { id: 'cafe1', lat: 18.9280, lng: 72.8300, type: 'restaurant', label: 'Café Mondegar', crowdLevel: 'low', crowdCount: 45 },
  { id: 'colaba', lat: 18.9150, lng: 72.8280, type: 'attraction', label: 'Colaba Causeway', crowdLevel: 'high', crowdCount: 280 },
  { id: 'hosp1', lat: 18.9300, lng: 72.8350, type: 'hospital', label: 'St. George Hospital' },
  { id: 'pol1', lat: 18.9190, lng: 72.8270, type: 'police', label: 'Colaba Police Stn' },
  { id: 'alert1', lat: 18.9200, lng: 72.8380, type: 'alert', label: 'Crowd Alert', crowdLevel: 'extreme', crowdCount: 520 },
  { id: 'hotel2', lat: 18.9340, lng: 72.8260, type: 'hotel', label: 'Trident Nariman' },
  { id: 'rest2', lat: 18.9240, lng: 72.8400, type: 'restaurant', label: 'Leopold Café', crowdLevel: 'high', crowdCount: 180 },
  { id: 'crowd1', lat: 18.9210, lng: 72.8310, type: 'crowd', label: 'Market Square', crowdLevel: 'extreme', crowdCount: 650 },
  { id: 'crowd2', lat: 18.9260, lng: 72.8370, type: 'crowd', label: 'Station Exit 2', crowdLevel: 'high', crowdCount: 380 }
];

export const DEFAULT_CENTER = { lat: 18.9230, lng: 72.8320 };

interface Props {
  activeFilter: string | null;
  /** Bump to re-pan/zoom to the user's live location. */
  recenterTrigger: number;
  zoomAction?: { type: 'in' | 'out'; ts: number };
  onMarkerClick: (id: string) => void;
  activeRouteTarget?: { lat: number; lng: number; name: string; address: string } | null;
  onClearRoute?: () => void;
}

export default function MapCanvas({
  activeFilter,
  recenterTrigger,
  zoomAction,
  onMarkerClick,
  activeRouteTarget,
  onClearRoute
}: Props) {
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [geofenceZones, setGeofenceZones] = useState<GeoFenceZone[]>(MOCK_GEOFENCE_ZONES);

  // ── Real geofences from the backend (directive §A.3: safe/buffer/
  // restricted zone overlay) ──
  //
  // The existing map renderer (ActualGoogleMap) draws zones as circles
  // (center + radiusKm), not arbitrary polygons — that rendering path is
  // unchanged here. The backend stores real polygons (directive §4:
  // geofences.coordinates), so each polygon is approximated by its
  // centroid + the distance to its farthest vertex as the circle radius.
  // This is a visual approximation, not the exact polygon boundary — good
  // enough to show tourists roughly where a zone is, but a genuine polygon
  // renderer would be a more accurate follow-up if this matters for
  // production use. Falls back to the existing mock zones if the backend
  // has none defined yet or the request fails (e.g. offline).
  useEffect(() => {
    let cancelled = false;
    listGeofences(true)
      .then((zones) => {
        if (cancelled || !zones?.length) return;
        const converted: GeoFenceZone[] = zones.flatMap((z) => {
          const riskLevel = z.zone_type === 'RESTRICTED' ? 'Unsafe' : z.zone_type === 'BUFFER' ? 'Caution' : 'Safe';

          // CIRCLE geometry — use center + radius directly
          if (z.geometry_type === 'CIRCLE' && z.center_lat != null && z.center_lng != null) {
            return [{
              id: z.id,
              name: z.name,
              riskLevel,
              description: `${z.zone_type} zone`,
              center: { lat: z.center_lat, lng: z.center_lng },
              radiusKm: z.radius_m ? z.radius_m / 1000 : 0.1,
            }];
          }

          // POLYGON geometry — derive centroid + bounding radius
          if (!z.coordinates?.length) return []; // skip malformed zones
          const lats = z.coordinates.map((c) => c[1]);
          const lngs = z.coordinates.map((c) => c[0]);
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
            ...z.coordinates.map(([lng, lat]) => haversineKm(centerLat, centerLng, lat, lng))
          );
          return [{
            id: z.id,
            name: z.name,
            riskLevel,
            description: `${z.zone_type} zone`,
            center: { lat: centerLat, lng: centerLng },
            radiusKm,
          }];
        });
        if (converted.length > 0) setGeofenceZones(converted);
      })
      .catch(() => { /* keep the existing (mock) zones on failure */ });
    return () => { cancelled = true; };
  }, []);

  // Resolve a real device location once on mount (falls back to the last
  // known IndexedDB location, then to the default center — the same
  // resolution order already used by the SOS flow) so "your location" and
  // the recenter/locate-me button reflect the device, not a hardcoded point.
  useEffect(() => {
    let cancelled = false;
    getSOSLocation().then((loc) => {
      if (!cancelled && loc.latitude != null && loc.longitude != null) {
        setUserLoc({ lat: loc.latitude, lng: loc.longitude });
      }
    }).catch(() => {
      /* no location available — the map simply falls back to DEFAULT_CENTER */
    });
    return () => { cancelled = true; };
  }, []);

  const visible = POIS.filter((p) => !activeFilter || p.type === activeFilter);

  const markers: MapClusterMarker[] = visible.map((p) => ({
    id: p.id,
    lat: p.lat,
    lng: p.lng,
    title: p.label,
    type: p.type as any,
    crowdLevel: p.crowdLevel,
    crowdCount: p.crowdCount,
    pinColor: MARKER_COLOR[p.type],
    glyph: MARKER_GLYPH[p.type],
  }));

  if (userLoc) {
    markers.push({
      id: 'user-location',
      lat: userLoc.lat,
      lng: userLoc.lng,
      title: 'Your location',
      type: 'user',
      pinColor: '#0b2447',
      glyph: '\u25CF',
    });
  }

  return (
    <ActualGoogleMap
      center={userLoc || DEFAULT_CENTER}
      zoom={14}
      markers={markers}
      geofenceZones={geofenceZones}
      height="100%"
      fullBleed
      chrome={false}
      mapTypeControl={false}
      recenter={{ trigger: recenterTrigger, target: userLoc || DEFAULT_CENTER }}
      zoomAction={zoomAction}
      onMarkerClick={(m) => { if (m.id !== 'user-location') onMarkerClick(m.id); }}
      routeTarget={activeRouteTarget}
      onClearRoute={onClearRoute}
    />
  );
}
