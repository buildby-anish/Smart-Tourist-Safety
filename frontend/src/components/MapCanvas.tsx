import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Circle, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
// ─── Fix Leaflet default icon paths broken by Vite ───
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// ─── Marker configs ───────────────────────────────────
const MARKER_CONFIG = {
  attraction: { bg: '#FF9933', border: '#e67a0f', label: '★', size: 22 },
  restaurant:  { bg: '#f97316', border: '#c2410c', label: '✦', size: 20 },
  hotel:       { bg: '#6366f1', border: '#4338ca', label: 'H', size: 20 },
  police:      { bg: '#2563eb', border: '#1d4ed8', label: '⚑', size: 20 },
  hospital:    { bg: '#16a34a', border: '#14532d', label: '+', size: 20 },
  alert:       { bg: '#dc2626', border: '#991b1b', label: '!', size: 20 },
  crowd:       { bg: '#d97706', border: '#92400e', label: '◎', size: 20 },
  safe:        { bg: '#138808', border: '#065f46', label: '✓', size: 20 },
}

function makeIcon(type: keyof typeof MARKER_CONFIG, isUser = false) {
  const cfg = MARKER_CONFIG[type] || MARKER_CONFIG.attraction
  const sz = cfg.size

  if (isUser) {
    const html = `
      <div style="position:relative;width:${sz}px;height:${sz}px;display:flex;align-items:center;justify-content:center">
        <div style="position:absolute;width:${sz * 2.4}px;height:${sz * 2.4}px;border-radius:50%;background:rgba(11,36,71,0.18);border:1.5px solid rgba(255,153,51,0.35);top:50%;left:50%;transform:translate(-50%,-50%)" class="ss-user-pulse"></div>
        <div style="width:${sz}px;height:${sz}px;border-radius:50%;background:#0b2447;border:3px solid #FF9933;box-shadow:0 2px 10px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center">
          <div style="width:${sz / 2.8}px;height:${sz / 2.8}px;border-radius:50%;background:#FF9933"></div>
        </div>
      </div>`
    return L.divIcon({ html, className: 'ss-marker', iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2] })
  }

  const tailSize = 6
  const html = `
    <div class="ss-marker-pin">
      <div class="ss-marker-head" style="width:${sz}px;height:${sz}px;background:${cfg.bg};border:2px solid ${cfg.border}">
        <span style="color:#fff;font-size:${sz * 0.46}px;font-weight:800;line-height:1;font-family:system-ui">${cfg.label}</span>
      </div>
      <div class="ss-marker-tail" style="border-left:${tailSize}px solid transparent;border-right:${tailSize}px solid transparent;border-top:${tailSize + 2}px solid ${cfg.bg}"></div>
    </div>`
  return L.divIcon({ html, className: 'ss-marker', iconSize: [sz, sz + tailSize + 2], iconAnchor: [sz / 2, sz + tailSize + 2] })
}

// ─── POIs ────────────────────────────────────────────
const POIS = [
  { id: 'gate',   lat: 18.9220, lng: 72.8347, type: 'attraction' as const, label: 'Gateway of India',    rating: 4.7, dist: '0.8 km',  open: true  },
  { id: 'taj_m',  lat: 18.9256, lng: 72.8242, type: 'hotel'      as const, label: 'Taj Mahal Palace',    rating: 4.8, dist: '1.2 km',  open: true  },
  { id: 'cafe1',  lat: 18.9280, lng: 72.8300, type: 'restaurant' as const, label: 'Café Mondegar',       rating: 4.4, dist: '1.5 km',  open: true  },
  { id: 'colaba', lat: 18.9150, lng: 72.8280, type: 'attraction' as const, label: 'Colaba Causeway',     rating: 4.3, dist: '1.9 km',  open: true  },
  { id: 'hosp1',  lat: 18.9300, lng: 72.8350, type: 'hospital'  as const, label: 'St. George Hospital', rating: null, dist: '2.1 km', open: true  },
  { id: 'pol1',   lat: 18.9190, lng: 72.8270, type: 'police'    as const, label: 'Colaba Police Stn',   rating: null, dist: '2.3 km', open: true  },
  { id: 'alert1', lat: 18.9200, lng: 72.8380, type: 'alert'     as const, label: 'Crowd Alert',         rating: null, dist: '0.5 km', open: false },
  { id: 'hotel2', lat: 18.9340, lng: 72.8260, type: 'hotel'     as const, label: 'Trident Nariman',     rating: 4.5, dist: '3.1 km',  open: true  },
  { id: 'rest2',  lat: 18.9240, lng: 72.8400, type: 'restaurant' as const, label: 'Leopold Café',       rating: 4.2, dist: '1.0 km',  open: true  },
]

const SAFE_ZONE: [number, number] = [18.9230, 72.8320]
const USER_LOC:  [number, number] = [18.9230, 72.8320]
const ROUTE: [number, number][] = [
  [18.9230, 72.8320],
  [18.9225, 72.8335],
  [18.9220, 72.8347],
]

// ─── Map re-center helper ─────────────────────────────
function RecenterControl({ trigger }: { trigger: number }) {
  const map = useMap()
  useEffect(() => {
    if (trigger > 0) {
      map.flyTo(USER_LOC, 15, { duration: 1.2 })
    }
  }, [trigger, map])
  return null
}

// ─── Dark tile layer ──────────────────────────────────
function TileLayer2({ darkMode }: { darkMode: boolean }) {
  if (darkMode) {
    return (
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        maxZoom={19}
      />
    )
  }
  return (
    <TileLayer
      url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      maxZoom={19}
    />
  )
}

interface Props {
  darkMode: boolean
  activeFilter: string | null
  recenterTrigger: number
  onMarkerClick: (id: string) => void
}

export default function MapCanvas({ darkMode, activeFilter, recenterTrigger, onMarkerClick }: Props) {
  const visible = POIS.filter((p) => !activeFilter || p.type === activeFilter)

  return (
    <MapContainer
      center={USER_LOC}
      zoom={14}
      zoomControl={false}
      attributionControl={true}
      style={{ width: '100%', height: '100%' }}
    >
      <TileLayer2 darkMode={darkMode} />
      <RecenterControl trigger={recenterTrigger} />

      {/* Safe zone ring */}
      <Circle
        center={SAFE_ZONE}
        radius={280}
        pathOptions={{ color: '#138808', fillColor: '#138808', fillOpacity: 0.07, weight: 1.5, dashArray: '4 4' }}
      />

      {/* Alert zone */}
      <Circle
        center={[18.9200, 72.8380]}
        radius={120}
        pathOptions={{ color: '#dc2626', fillColor: '#dc2626', fillOpacity: 0.08, weight: 1, dashArray: '3 3' }}
      />

      {/* Route */}
      <Polyline
        positions={ROUTE}
        pathOptions={{ color: '#FF9933', weight: 4, opacity: 0.85, dashArray: '8 5', lineCap: 'round' }}
      />

      {/* User location */}
      <Marker position={USER_LOC} icon={makeIcon('attraction', true)} />

      {/* POI markers */}
      {visible.map((poi) => (
        <Marker
          key={poi.id}
          position={[poi.lat, poi.lng]}
          icon={makeIcon(poi.type)}
          eventHandlers={{ click: () => onMarkerClick(poi.id) }}
        />
      ))}
    </MapContainer>
  )
}

export { POIS, USER_LOC }
