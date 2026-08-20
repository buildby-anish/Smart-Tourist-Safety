import { useEffect, useState } from 'react';
import { ActualGoogleMap, MapClusterMarker } from '../ActualGoogleMap';
import { getSOSLocation } from '../../lib/location';

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
}[] = [
  { id: 'gate', lat: 18.9220, lng: 72.8347, type: 'attraction', label: 'Gateway of India' },
  { id: 'taj_m', lat: 18.9256, lng: 72.8242, type: 'hotel', label: 'Taj Mahal Palace' },
  { id: 'cafe1', lat: 18.9280, lng: 72.8300, type: 'restaurant', label: 'Café Mondegar' },
  { id: 'colaba', lat: 18.9150, lng: 72.8280, type: 'attraction', label: 'Colaba Causeway' },
  { id: 'hosp1', lat: 18.9300, lng: 72.8350, type: 'hospital', label: 'St. George Hospital' },
  { id: 'pol1', lat: 18.9190, lng: 72.8270, type: 'police', label: 'Colaba Police Stn' },
  { id: 'alert1', lat: 18.9200, lng: 72.8380, type: 'alert', label: 'Crowd Alert' },
  { id: 'hotel2', lat: 18.9340, lng: 72.8260, type: 'hotel', label: 'Trident Nariman' },
  { id: 'rest2', lat: 18.9240, lng: 72.8400, type: 'restaurant', label: 'Leopold Café' },
];

export const DEFAULT_CENTER = { lat: 18.9230, lng: 72.8320 };

interface Props {
  activeFilter: string | null;
  /** Bump to re-pan/zoom to the user's live location. */
  recenterTrigger: number;
  zoomAction?: { type: 'in' | 'out'; ts: number };
  onMarkerClick: (id: string) => void;
}

export default function MapCanvas({ activeFilter, recenterTrigger, zoomAction, onMarkerClick }: Props) {
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);

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
    type: p.type === 'police' ? 'police' : undefined,
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
      height="100%"
      fullBleed
      chrome={false}
      mapTypeControl={false}
      recenter={{ trigger: recenterTrigger, target: userLoc || DEFAULT_CENTER }}
      zoomAction={zoomAction}
      onMarkerClick={(m) => { if (m.id !== 'user-location') onMarkerClick(m.id); }}
    />
  );
}
