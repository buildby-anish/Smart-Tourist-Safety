import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  Car, Bike, Footprints, Train, X as XIcon, MapPin, Navigation,
  Users, ShieldCheck, AlertTriangle, ExternalLink, ShieldAlert, Shield, Flame
} from 'lucide-react';
import { GeoFenceZone } from '../types';
import { createGeofence } from '../lib/api';

declare var L: any;

export interface MapClusterMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  crowdLevel?: 'extreme' | 'high' | 'medium' | 'low';
  crowdCount?: number;
  type?: 'crowd' | 'user' | 'police' | 'hotel' | 'alert' | 'geofence';
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
  fullBleed?: boolean;
  chrome?: boolean;
  recenter?: { trigger: number; target: { lat: number; lng: number } };
  zoomAction?: { type: 'in' | 'out'; ts: number };
  routeTarget?: { lat: number; lng: number; name: string; address: string } | null;
  onClearRoute?: () => void;
  enableDrawing?: boolean;
  onGeofenceCreated?: () => void;
  lockedCity?: any;
  /** When false, clicking an empty spot on the map no longer reverse-geocodes
   * and shows the Directions popup — used to keep the authority dashboard's
   * map click-to-pan/select behavior free of the tourist-facing directions
   * flow. Defaults to true (existing behavior) for the tourist map. */
  enableDirectionsOnClick?: boolean;
}

const TRAVEL_MODES = [
  { id: 'drive', label: 'Car', osrmMode: 'driving', icon: Car },
  { id: 'walk', label: 'Walk', osrmMode: 'foot', icon: Footprints },
  { id: 'bike', label: 'Bike', osrmMode: 'bicycle', icon: Bike },
  { id: 'train', label: 'Transit', osrmMode: 'transit', icon: Train },
];

export const ActualGoogleMap: React.FC<ActualGoogleMapProps> = ({
  center = { lat: 18.9220, lng: 72.8347 },
  zoom = 14,
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
  zoomAction,
  routeTarget,
  onClearRoute,
  enableDrawing = false,
  onGeofenceCreated,
  lockedCity,
  enableDirectionsOnClick = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const markersGroupRef = useRef<any>(null);
  const geofencesGroupRef = useRef<any>(null);
  const routePolylineRef = useRef<any>(null);
  const alternativePolylinesRef = useRef<any[]>([]);
  const destMarkerRef = useRef<any>(null);
  const heatLayerRef = useRef<any>(null);

  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => document.documentElement.classList.contains('dark'));
  const [activeMarker, setActiveMarker] = useState<MapClusterMarker | null>(null);

  // Drawing tools state
  const [drawingMode, setDrawingMode] = useState<'circle' | 'polygon' | null>(null);
  const [drawPoints, setDrawPoints] = useState<{ lat: number; lng: number }[]>([]);
  const [drawRadius, setDrawRadius] = useState<number>(1000);
  const [showDrawDialog, setShowDrawDialog] = useState(false);
  const [newGeofenceName, setNewGeofenceName] = useState('');
  const [newGeofenceSeverity, setNewGeofenceSeverity] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('HIGH');
  const [savingGeofence, setSavingGeofence] = useState(false);
  const drawLayerRef = useRef<any>(null);

  // Map settings
  const [mapMode, setMapMode] = useState<'m' | 'k' | 'p'>('m'); // m: roadmap, k: satellite, p: terrain
  const [showHeatmap, setShowHeatmap] = useState(true);

  // Directions routing states
  const [selectedPlaceInfo, setSelectedPlaceInfo] = useState<{
    name: string;
    address: string;
    lat: number;
    lng: number;
  } | null>(null);
  // Place tapped on the map but not yet confirmed for directions — shown as
  // a lightweight "Start Direction?" prompt before the full route/estimated
  // time panel (selectedPlaceInfo) takes over.
  const [pendingPlace, setPendingPlace] = useState<{
    name: string;
    address: string;
    lat: number;
    lng: number;
  } | null>(null);
  const [travelMode, setTravelMode] = useState<string>('driving');
  
  // Multi-route alternatives states
  const [alternativeRoutes, setAlternativeRoutes] = useState<any[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number>(0);
  const [routeInfo, setRouteInfo] = useState<{ distance: string; duration: string } | null>(null);
  const [isRouting, setIsRouting] = useState(false);

  // Synchronize routeTarget prop into selectedPlaceInfo local state
  useEffect(() => {
    if (routeTarget) {
      setSelectedPlaceInfo(routeTarget);
    } else {
      setSelectedPlaceInfo(null);
    }
  }, [routeTarget]);

  // Enforce lockedCity map bounds constraints
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const L = (window as any).L;
    if (!L) return;

    if (lockedCity) {
      const bounds = L.latLngBounds(lockedCity.bounds);
      map.setMaxBounds(bounds);
      map.setMinZoom(lockedCity.minZoom);
      map.setView(lockedCity.center, lockedCity.minZoom + 1);
      
      map.options.minZoom = lockedCity.minZoom;
      map.options.maxBounds = bounds;
      
      console.log(`Map locked to city: ${lockedCity.name}`);
    } else {
      const INDIA_BOUNDS = L.latLngBounds([
        [6.0, 66.5],
        [37.5, 99.0],
      ]);
      map.options.minZoom = 5;
      map.options.maxBounds = INDIA_BOUNDS;
      map.setMaxBounds(INDIA_BOUNDS);
      map.setMinZoom(5);
      map.setView(center, zoom);
      
      console.log("Map bounds reset to national India limits.");
    }
  }, [lockedCity, center, zoom]);

  // Track global dark mode changes using MutationObserver
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Dynamically load Leaflet resources
  const [leafletLoadFailed, setLeafletLoadFailed] = useState(false);
  useEffect(() => {
    if ((window as any).L && (window as any).L.heatLayer) {
      setLeafletLoaded(true);
      return;
    }

    let settled = false;
    // Safety net: if the CDN scripts never fire onload/onerror (slow/
    // blocked network), surface an error instead of spinning forever on
    // "Loading safety map...".
    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        setLeafletLoadFailed(true);
      }
    }, 12000);

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    script.onload = () => {
      // Load leaflet-heat after leaflet is loaded
      const heatScript = document.createElement('script');
      heatScript.src = 'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js';
      heatScript.async = true;
      heatScript.onload = () => {
        settled = true;
        window.clearTimeout(timeoutId);
        setLeafletLoaded(true);
      };
      heatScript.onerror = () => {
        // Heatmap plugin failing to load shouldn't block the whole map —
        // core Leaflet is already up, so proceed without the heat layer.
        settled = true;
        window.clearTimeout(timeoutId);
        setLeafletLoaded(true);
      };
      document.body.appendChild(heatScript);
    };
    script.onerror = () => {
      settled = true;
      window.clearTimeout(timeoutId);
      setLeafletLoadFailed(true);
    };
    document.body.appendChild(script);

    return () => window.clearTimeout(timeoutId);
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!leafletLoaded || !containerRef.current || mapRef.current) return;
    const L = (window as any).L;

    // Locked to India: the app is India-only tourist safety infrastructure,
    // so zooming/panning out to a world/continent view is not a
    // legitimate use case here. minZoom keeps zoom-out capped at roughly
    // country level; maxBounds (with viscosity 1.0, i.e. a hard stop
    // rather than an elastic snap-back) keeps panning within India's
    // bounding box, generously padded so border regions aren't clipped.
    const INDIA_BOUNDS = L.latLngBounds([
      [6.0, 66.5],   // SW — south of Kanyakumari, west of Gujarat coast
      [37.5, 99.0],  // NE — north of Kashmir, east of Arunachal Pradesh
    ]);

    const mapInstance = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: true,
      dragging: true,
      touchZoom: true,
      minZoom: 5,
      maxBounds: INDIA_BOUNDS,
      maxBoundsViscosity: 1.0,
    }).setView([center.lat, center.lng], zoom);

    mapRef.current = mapInstance;

    markersGroupRef.current = L.layerGroup().addTo(mapInstance);
    geofencesGroupRef.current = L.layerGroup().addTo(mapInstance);

    // Map click listener: select real-life places or drop pins
    mapInstance.on('click', async (event: any) => {
      const mode = drawingModeRef.current;
      const { lat, lng } = event.latlng;

      if (mode) {
        if (mode === 'circle') {
          setDrawPoints([{ lat, lng }]);
          if (drawLayerRef.current) {
            drawLayerRef.current.remove();
          }
          drawLayerRef.current = L.circle([lat, lng], {
            radius: drawRadiusRef.current,
            color: '#dc2626',
            fillColor: '#dc2626',
            fillOpacity: 0.25,
            weight: 2
          }).addTo(mapInstance);
          setShowDrawDialog(true);
        } else if (mode === 'polygon') {
          const newPts = [...drawPointsRef.current, { lat, lng }];
          setDrawPoints(newPts);
          if (drawLayerRef.current) {
            drawLayerRef.current.remove();
          }
          drawLayerRef.current = L.polygon(newPts.map(p => [p.lat, p.lng]), {
            color: '#dc2626',
            fillColor: '#dc2626',
            fillOpacity: 0.25,
            weight: 2
          }).addTo(mapInstance);
        }
        return; // skip reverse geocoding
      }

      // Authority dashboard: a plain map click is for panning/selecting,
      // not for requesting directions — skip the reverse-geocode + popup
      // entirely rather than showing the tourist-facing directions flow.
      if (!enableDirectionsOnClickRef.current) {
        return;
      }

      // Temporary loading indicator
      setPendingPlace({
        name: 'Locating place...',
        address: 'Fetching address details...',
        lat,
        lng,
      });

      try {
        // Reverse geocoding via Nominatim OpenStreetMap API
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
          { headers: { 'User-Agent': 'SurakshaSetu/1.0' } }
        );
        const data = await response.json();
        
        if (data && data.display_name) {
          const addr = data.address || {};
          let specificName = data.name ||
                             addr.amenity ||
                             addr.shop ||
                             addr.tourism ||
                             addr.natural ||
                             addr.leisure ||
                             addr.waterway ||
                             addr.railway ||
                             addr.building;
          
          if (!specificName) {
            if (addr.house_number && addr.road) {
              specificName = `${addr.house_number} ${addr.road}`;
            } else {
              specificName = addr.road || addr.place || addr.suburb || 'Selected Location';
            }
          }

          setPendingPlace({
            name: specificName,
            address: data.display_name,
            lat,
            lng,
          });
        } else {
          throw new Error('No address found');
        }
      } catch (err) {
        setPendingPlace({
          name: 'Dropped Pin',
          address: `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          lat,
          lng,
        });
      }
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [leafletLoaded]);

  // Apply Tile Layers based on Mode and Dark/Light Theme
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !leafletLoaded) return;
    const L = (window as any).L;

    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }

    let tileUrl = '';
    let attribution = '';

    if (mapMode === 'k') {
      // Google Satellite
      tileUrl = 'https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';
      attribution = '&copy; Google Maps';
    } else if (mapMode === 'p') {
      // Google Terrain
      tileUrl = 'https://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}';
      attribution = '&copy; Google Maps';
    } else {
      if (isDarkMode) {
        tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
        attribution = '&copy; OpenStreetMap &copy; CARTO';
      } else {
        // Google Streets (matches the user's uploaded image exactly)
        tileUrl = 'https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
        attribution = '&copy; Google Maps';
      }
    }

    tileLayerRef.current = L.tileLayer(tileUrl, {
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution,
      maxZoom: 20,
    }).addTo(map);
  }, [mapRef.current, mapMode, isDarkMode, leafletLoaded]);

  // Recenter Handler
  useEffect(() => {
    const map = mapRef.current;
    if (map && recenter && recenter.trigger > 0) {
      map.setView([recenter.target.lat, recenter.target.lng], 15, { animate: true });
    }
  }, [recenter?.trigger]);

  // Zoom Handler
  useEffect(() => {
    const map = mapRef.current;
    if (map && zoomAction) {
      const current = map.getZoom();
      map.setZoom(zoomAction.type === 'in' ? current + 1 : current - 1, { animate: true });
    }
  }, [zoomAction?.ts]);

  // Render/Sync Markers
  useEffect(() => {
    const map = mapRef.current;
    const markersGroup = markersGroupRef.current;
    if (!map || !markersGroup || !leafletLoaded) return;
    const L = (window as any).L;

    markersGroup.clearLayers();

    markers.forEach((m) => {
      let pinColor = m.pinColor || '#3B82F6';
      if (!m.pinColor) {
        if (m.crowdLevel === 'extreme' || m.crowdLevel === 'high') pinColor = '#EF4444';
        else if (m.crowdLevel === 'medium') pinColor = '#F59E0B';
        else if (m.crowdLevel === 'low') pinColor = '#10B981';
        if (m.type === 'police') pinColor = '#138808';
      }

      const isSelected = selectedMarkerId === m.id || activeMarker?.id === m.id;

      // Premium custom HTML markers with ripple effect for active alerts/users
      const isPulse = m.type === 'user' || m.type === 'alert' || m.crowdLevel === 'extreme';
      const pulseHtml = isPulse 
        ? `<span class="absolute inline-flex h-full w-full rounded-full animate-ping opacity-75" style="background-color: ${pinColor}"></span>`
        : '';

      const icon = L.divIcon({
        html: `
          <div class="relative flex items-center justify-center w-7 h-7">
            ${pulseHtml}
            <div style="
              background-color: ${pinColor};
              width: 24px;
              height: 24px;
              border-radius: 50%;
              border: 2px solid ${isSelected ? '#FFFFFF' : 'rgba(255,255,255,0.85)'};
              box-shadow: 0 3px 8px rgba(0,0,0,0.4);
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-size: 11px;
              transform: ${isSelected ? 'scale(1.2)' : 'none'};
              transition: transform 0.15s;
            ">
              ${m.glyph || ''}
            </div>
          </div>
        `,
        className: 'custom-leaflet-marker-wrapper',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      const marker = L.marker([m.lat, m.lng], { icon }).addTo(markersGroup);

      if (m.title) {
        // Tooltip for hover
        marker.bindTooltip(`
          <div style="font-family: sans-serif; font-size: 11px; padding: 2px;">
            <strong>${m.title}</strong>
            ${m.subtitle ? `<div style="opacity: 0.85; margin-top: 2px;">${m.subtitle.split('|')[0]}</div>` : ''}
          </div>
        `, { direction: 'top', offset: [0, -10] });

        // Popup for click
        const details = m.subtitle ? m.subtitle.split('|').map(s => s.trim()).join('<br/>') : '';
        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px; color: #1e293b; padding: 4px; min-width: 180px;">
            <h4 style="margin: 0 0 6px 0; font-size: 13px; font-weight: bold; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; color: #7c3aed;">
              ${m.title}
            </h4>
            <div style="line-height: 1.4;">
              ${details || 'No details available.'}
            </div>
          </div>
        `);
      }

      marker.on('click', (e: any) => {
        L.DomEvent.stopPropagation(e);
        handleSelectMarker(m);
      });
    });
  }, [mapRef.current, markers, selectedMarkerId, activeMarker, leafletLoaded]);

  // Render/Sync Geofences
  useEffect(() => {
    const map = mapRef.current;
    const geofencesGroup = geofencesGroupRef.current;
    if (!map || !geofencesGroup || !leafletLoaded) return;
    const L = (window as any).L;

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
  }, [mapRef.current, geofenceZones, activeZoneId, leafletLoaded]);

  // Render/Sync Heatmap Layer for Crowd Densities
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !leafletLoaded) return;
    const L = (window as any).L;

    // Clear existing heat layer
    if (heatLayerRef.current) {
      heatLayerRef.current.remove();
      heatLayerRef.current = null;
    }

    if (!showHeatmap || !L.heatLayer) return;

    // Build intensity points: [lat, lng, intensity]
    const heatPoints: [number, number, number][] = [];

    markers.forEach((m) => {
      // Base intensity on crowdLevel and crowdCount
      let intensity = 0.2; // default low
      if (m.crowdLevel === 'extreme') intensity = 1.0;
      else if (m.crowdLevel === 'high') intensity = 0.8;
      else if (m.crowdLevel === 'medium') intensity = 0.5;

      heatPoints.push([m.lat, m.lng, intensity]);

      // If extreme/high, add minor jittered points around to simulate real-time crowd spread
      if (m.crowdLevel === 'extreme' || m.crowdLevel === 'high') {
        const numSecondaryPoints = m.crowdLevel === 'extreme' ? 8 : 4;
        for (let i = 0; i < numSecondaryPoints; i++) {
          const angle = Math.random() * Math.PI * 2;
          const radius = (0.04 + Math.random() * 0.08) / 111.3; // ~50 to 120 meters
          const latJitter = Math.sin(angle) * radius;
          const lngJitter = Math.cos(angle) * (radius / Math.cos(m.lat * Math.PI / 180));
          heatPoints.push([m.lat + latJitter, m.lng + lngJitter, intensity * 0.75]);
        }
      }
    });

    // Custom yellow-orange-red gradient (no blue shades for dark mode safety)
    const heatGradient = {
      0.25: 'rgba(245, 158, 11, 0.25)', // transparent amber
      0.55: 'rgba(249, 115, 22, 0.65)', // orange
      0.85: 'rgba(239, 68, 68, 0.85)', // red
      1.0: 'rgba(220, 38, 38, 1.0)'    // dark red
    };

    const heatLayer = L.heatLayer(heatPoints, {
      radius: 28,
      blur: 18,
      maxZoom: 16,
      max: 1.0,
      gradient: heatGradient
    }).addTo(map);

    heatLayerRef.current = heatLayer;

    // Cleanup layer on unmount or toggle off
    return () => {
      if (heatLayerRef.current) {
        heatLayerRef.current.remove();
        heatLayerRef.current = null;
      }
    };
  }, [mapRef.current, markers, showHeatmap, leafletLoaded]);

  // Extract user location from markers
  const userMarker = markers.find((m) => m.id === 'user-location' || m.type === 'user');
  const userLat = userMarker?.lat || null;
  const userLng = userMarker?.lng || null;

  const destLat = selectedPlaceInfo?.lat || null;
  const destLng = selectedPlaceInfo?.lng || null;

  // Directions calculation using OSRM API (completely free and fast)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedPlaceInfo || !leafletLoaded) {
      if (routePolylineRef.current) {
        routePolylineRef.current.remove();
        routePolylineRef.current = null;
      }
      alternativePolylinesRef.current.forEach((p) => p.remove());
      alternativePolylinesRef.current = [];
      setAlternativeRoutes([]);
      setRouteInfo(null);
      if (destMarkerRef.current) {
        destMarkerRef.current.remove();
        destMarkerRef.current = null;
      }
      return;
    }

    const L = (window as any).L;
    const startLoc = (userLat && userLng) ? { lat: userLat, lng: userLng } : center;

    // Drop/update red location pin for selected destination
    if (destMarkerRef.current) {
      destMarkerRef.current.setLatLng([selectedPlaceInfo.lat, selectedPlaceInfo.lng]);
    } else {
      const destIcon = L.divIcon({
        html: `
          <div class="relative flex items-center justify-center w-8 h-8">
            <span class="absolute inline-flex h-full w-full rounded-full bg-red-500 animate-ping opacity-50"></span>
            <div class="bg-red-600 w-5 h-5 rounded-full border-2 border-white shadow flex items-center justify-center text-white">
              📍
            </div>
          </div>
        `,
        className: 'dest-marker',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      destMarkerRef.current = L.marker([selectedPlaceInfo.lat, selectedPlaceInfo.lng], { icon: destIcon }).addTo(map);
    }

    const calculateRoute = async () => {
      setIsRouting(true);

      if (travelMode === 'transit') {
        // Direct track line styled as a railroad track, not following the road network
        const coordinates = [[startLoc.lat, startLoc.lng], [selectedPlaceInfo.lat, selectedPlaceInfo.lng]];
        const distanceVal = map.distance([startLoc.lat, startLoc.lng], [selectedPlaceInfo.lat, selectedPlaceInfo.lng]);
        const distKm = (distanceVal / 1000).toFixed(1);
        // Trains average 50 km/h -> 833 meters per minute
        const durationMin = Math.max(3, Math.round(distanceVal / 833));

        const transitRoute = {
          index: 0,
          coordinates,
          distance: `${distKm} km`,
          duration: `${durationMin} mins`,
          distanceVal,
        };

        setAlternativeRoutes([transitRoute]);
        setSelectedRouteIndex(0);
        setIsRouting(false);
        return;
      }

      // Determine profile for OSRM
      // Options are: driving, foot, bicycle (we map transit to foot/driving with custom render)
      let osrmProfile = 'driving';
      if (travelMode === 'foot') osrmProfile = 'foot';
      else if (travelMode === 'bicycle') osrmProfile = 'bicycle';

      // alternatives=true query parameter retrieves alternative path options
      const url = `https://router.project-osrm.org/route/v1/${osrmProfile}/${startLoc.lng},${startLoc.lat};${selectedPlaceInfo.lng},${selectedPlaceInfo.lat}?overview=full&geometries=geojson&alternatives=true`;

      try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
          const parsedRoutes = data.routes.map((route: any, index: number) => {
            const coordinates = route.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]); // OSRM [lng, lat] -> Leaflet [lat, lng]
            const distKm = (route.distance / 1000).toFixed(1);
            let durationMin = Math.round(route.duration / 60);

            return {
              index,
              coordinates,
              distance: `${distKm} km`,
              duration: `${durationMin} mins`,
              distanceVal: route.distance, // in meters
            };
          });

          setAlternativeRoutes(parsedRoutes);

          // Find shortest route index
          let shortestIdx = 0;
          let minDistance = Infinity;
          parsedRoutes.forEach((r: any) => {
            if (r.distanceVal < minDistance) {
              minDistance = r.distanceVal;
              shortestIdx = r.index;
            }
          });

          // Default to the shortest path
          setSelectedRouteIndex(shortestIdx);
        } else {
          throw new Error('No route found');
        }
      } catch (err) {
        // Fallback straight dotted line if routing fails (e.g. offline)
        const coordinates = [[startLoc.lat, startLoc.lng], [selectedPlaceInfo.lat, selectedPlaceInfo.lng]];
        const distanceVal = map.distance([startLoc.lat, startLoc.lng], [selectedPlaceInfo.lat, selectedPlaceInfo.lng]);
        const distKm = (distanceVal / 1000).toFixed(1);
        const durationMin = Math.round(distanceVal / (travelMode === 'foot' ? 80 : 400));
        
        const fallbackRoute = {
          index: 0,
          coordinates,
          distance: `${distKm} km`,
          duration: `~${durationMin} mins`,
          distanceVal,
        };
        setAlternativeRoutes([fallbackRoute]);
        setSelectedRouteIndex(0);
      } finally {
        setIsRouting(false);
      }
    };

    calculateRoute();
  }, [destLat, destLng, travelMode, userLat, userLng, leafletLoaded]);

  // Fit bounds to route ONLY once when route calculation updates (avoids resetting user custom zoom during toggles or pans)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !leafletLoaded || alternativeRoutes.length === 0) return;
    const L = (window as any).L;

    const startLoc = (userLat && userLng) ? { lat: userLat, lng: userLng } : center;
    const destLoc = selectedPlaceInfo || center;

    const bounds = L.latLngBounds([
      [startLoc.lat, startLoc.lng],
      [destLoc.lat, destLoc.lng]
    ]);
    map.fitBounds(bounds, { padding: [55, 55] });
  }, [alternativeRoutes, leafletLoaded]);

  // Draw / Sync Route Polylines
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !leafletLoaded) return;
    const L = (window as any).L;

    // Clear old route lines
    if (routePolylineRef.current) {
      routePolylineRef.current.remove();
      routePolylineRef.current = null;
    }
    alternativePolylinesRef.current.forEach((p) => p.remove());
    alternativePolylinesRef.current = [];

    if (alternativeRoutes.length === 0) return;

    // Draw alternatives first (rendered below the active path)
    alternativeRoutes.forEach((r) => {
      if (r.index === selectedRouteIndex) return;

      const poly = L.polyline(r.coordinates, {
        color: '#94a3b8', // Semi-transparent grey for alternative routes
        weight: 5,
        opacity: 0.55,
        dashArray: travelMode === 'transit' ? '8, 8' : undefined,
      }).addTo(map);

      // Select route on click
      poly.on('click', (e: any) => {
        L.DomEvent.stopPropagation(e);
        setSelectedRouteIndex(r.index);
      });

      alternativePolylinesRef.current.push(poly);
    });

    // Draw active path on top
    const selectedRoute = alternativeRoutes.find((r) => r.index === selectedRouteIndex);
    if (selectedRoute) {
      if (travelMode === 'transit') {
        // Draw real-life track styling (solid black/grey underneath, dashed white/yellow on top)
        const polyBase = L.polyline(selectedRoute.coordinates, {
          color: isDarkMode ? '#f1f5f9' : '#1e293b',
          weight: 6,
          opacity: 0.85,
        }).addTo(map);

        const polyTrack = L.polyline(selectedRoute.coordinates, {
          color: isDarkMode ? '#0f172a' : '#ffffff',
          weight: 4,
          opacity: 0.95,
          dashArray: '8, 12',
        }).addTo(map);

        routePolylineRef.current = L.featureGroup([polyBase, polyTrack]).addTo(map);
      } else {
        const poly = L.polyline(selectedRoute.coordinates, {
          color: '#FF9933', // Saffron / Safety Orange
          weight: 8,
          opacity: 0.9,
          dashArray: travelMode === 'transit' ? '12, 12' : undefined,
        }).addTo(map);

        routePolylineRef.current = poly;
      }
    }
  }, [alternativeRoutes, selectedRouteIndex, travelMode, isDarkMode, leafletLoaded]);

  // Sync route details text
  useEffect(() => {
    const activeRoute = alternativeRoutes.find((r) => r.index === selectedRouteIndex);
    if (activeRoute) {
      setRouteInfo({
        distance: activeRoute.distance,
        duration: activeRoute.duration,
      });
    } else {
      setRouteInfo(null);
    }
  }, [alternativeRoutes, selectedRouteIndex]);

  // Marker select helper
  const handleSelectMarker = (m: MapClusterMarker) => {
    setActiveMarker(m);
    if (onMarkerClick) onMarkerClick(m);

    if (m.id !== 'user-location') {
      setSelectedPlaceInfo({
        name: m.title,
        address: m.subtitle || 'Tourist Point of Interest',
        lat: m.lat,
        lng: m.lng,
      });
    }
  };

  // Tourist confirms the "Start Direction?" prompt — closes that prompt and
  // hands the place off to the existing route-calculation/estimated-time
  // panel below.
  const handleStartDirection = () => {
    if (!pendingPlace) return;
    setSelectedPlaceInfo(pendingPlace);
    setPendingPlace(null);
  };

  const handleDismissPendingPlace = () => {
    setPendingPlace(null);
  };

  const handleCloseDirections = () => {
    setSelectedPlaceInfo(null);
    setRouteInfo(null);
    setAlternativeRoutes([]);
    setSelectedRouteIndex(0);
    if (routePolylineRef.current) {
      routePolylineRef.current.remove();
      routePolylineRef.current = null;
    }
    alternativePolylinesRef.current.forEach((p) => p.remove());
    alternativePolylinesRef.current = [];
    if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }
    if (onClearRoute) {
      onClearRoute();
    }
  };

  // Refs to avoid stale closures in Leaflet events
  const drawingModeRef = useRef(drawingMode);
  useEffect(() => {
    drawingModeRef.current = drawingMode;
  }, [drawingMode]);

  const enableDirectionsOnClickRef = useRef(enableDirectionsOnClick);
  useEffect(() => {
    enableDirectionsOnClickRef.current = enableDirectionsOnClick;
  }, [enableDirectionsOnClick]);

  const drawPointsRef = useRef(drawPoints);
  useEffect(() => {
    drawPointsRef.current = drawPoints;
  }, [drawPoints]);

  const drawRadiusRef = useRef(drawRadius);
  useEffect(() => {
    drawRadiusRef.current = drawRadius;
  }, [drawRadius]);

  const startDrawing = (mode: 'circle' | 'polygon') => {
    setDrawingMode(mode);
    setDrawPoints([]);
    setShowDrawDialog(false);
    if (drawLayerRef.current) {
      drawLayerRef.current.remove();
      drawLayerRef.current = null;
    }
  };

  const handleCancelDrawing = () => {
    setDrawingMode(null);
    setDrawPoints([]);
    setShowDrawDialog(false);
    setNewGeofenceName('');
    if (drawLayerRef.current) {
      drawLayerRef.current.remove();
      drawLayerRef.current = null;
    }
  };

  const handleFinishPolygon = () => {
    if (drawPoints.length < 3) return;
    setShowDrawDialog(true);
  };

  const handleSaveGeofence = async () => {
    if (!newGeofenceName.trim() || savingGeofence) return;
    setSavingGeofence(true);

    try {
      let payload: any = {
        name: newGeofenceName,
        zone_type: 'RESTRICTED',
        geometry_type: drawingMode === 'circle' ? 'CIRCLE' : 'POLYGON',
        severity: newGeofenceSeverity,
        warning_message: `DANGER: Entered ${newGeofenceName}. Proceed with caution.`,
        is_active: true
      };

      if (drawingMode === 'circle') {
        const centerPt = drawPoints[0];
        payload.center_lat = centerPt.lat;
        payload.center_lng = centerPt.lng;
        payload.radius_m = drawRadius;
      } else {
        const coords = drawPoints.map(p => [p.lng, p.lat]);
        coords.push([coords[0][0], coords[0][1]]); // Close polygon ring
        payload.coordinates = coords;
      }

      await createGeofence(payload);
      console.log('Geofence created successfully!');
      
      if (onGeofenceCreated) {
        onGeofenceCreated();
      }
    } catch (err) {
      console.warn('Failed to save geofence:', err);
    } finally {
      setSavingGeofence(false);
      handleCancelDrawing();
    }
  };

  // Watch radius changes for circle live preview
  useEffect(() => {
    if (drawingMode === 'circle' && drawPoints.length > 0 && mapRef.current) {
      const centerPt = drawPoints[0];
      const L = (window as any).L;
      if (drawLayerRef.current) {
        drawLayerRef.current.remove();
      }
      drawLayerRef.current = L.circle([centerPt.lat, centerPt.lng], {
        radius: drawRadius,
        color: '#dc2626',
        fillColor: '#dc2626',
        fillOpacity: 0.25,
        weight: 2
      }).addTo(mapRef.current);
    }
  }, [drawRadius, drawPoints, drawingMode]);

  const wrapperClass = fullBleed
    ? 'relative w-full h-full overflow-hidden'
    : 'relative w-full rounded-2xl overflow-hidden border border-slate-300 shadow-sm';

  if (!leafletLoaded) {
    return (
      <div className={wrapperClass} style={fullBleed ? undefined : { height }}>
        <div className={`w-full h-full flex flex-col items-center justify-center gap-3 ${isDarkMode ? 'bg-[#1e1e1e] text-slate-400' : 'bg-white text-slate-500'} text-sm font-medium`}>
          {leafletLoadFailed ? (
            <>
              <span>Couldn't load the map. Check your connection.</span>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white cursor-pointer"
                style={{ background: '#FF9933' }}
              >
                Retry
              </button>
            </>
          ) : (
            'Loading safety map...'
          )}
        </div>
      </div>
    );
  }

  // Find minimum distance for "shortest" tag rendering
  const minDistanceVal = alternativeRoutes.length > 0
    ? Math.min(...alternativeRoutes.map((ar) => ar.distanceVal))
    : 0;

  return (
    <div className={wrapperClass} style={fullBleed ? undefined : { height }}>
      {/* Map Anchor container */}
      <div ref={containerRef} className="w-full h-full z-0" />

      {/* Geofence Drawing Overlay — anchored top-left (below the authority
          header) rather than top-right, so it never sits on top of the
          header's logout button in the opposite corner. */}
      {enableDrawing && (
        <div
          className="absolute left-4 z-[40] pointer-events-auto flex flex-col gap-2"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 68px)' }}
        >
          {drawingMode ? (
            <div className="bg-slate-900/95 backdrop-blur-md p-3 rounded-2xl border border-slate-700 shadow-xl text-white text-xs max-w-[240px] space-y-2">
              <div className="font-bold text-orange-400 uppercase tracking-wider text-[10px]">
                Drawing Geofence ({drawingMode})
              </div>
              <p className="opacity-80 text-[10px]">
                {drawingMode === 'circle'
                  ? 'Click anywhere on the map to set the center of the danger circle.'
                  : 'Click on the map to place vertices.'}
              </p>
              <div className="flex gap-2">
                {drawingMode === 'polygon' && drawPoints.length >= 3 && (
                  <button
                    onClick={handleFinishPolygon}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 py-1 rounded-lg font-bold text-white transition-transform active:scale-95 text-[10px]"
                  >
                    Finish
                  </button>
                )}
                <button
                  onClick={handleCancelDrawing}
                  className="flex-1 bg-red-600 hover:bg-red-500 py-1 rounded-lg font-bold text-white transition-transform active:scale-95 text-[10px]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/95 backdrop-blur-md p-1.5 rounded-2xl border border-slate-700 shadow-xl flex gap-1.5">
              <button
                onClick={() => startDrawing('circle')}
                className="bg-orange-500 hover:bg-orange-400 text-white font-bold text-[9px] px-2.5 py-1.5 rounded-xl transition-transform active:scale-95 flex items-center gap-1 cursor-pointer"
              >
                🔴 Draw Circle Zone
              </button>
              <button
                onClick={() => startDrawing('polygon')}
                className="bg-orange-500 hover:bg-orange-400 text-white font-bold text-[9px] px-2.5 py-1.5 rounded-xl transition-transform active:scale-95 flex items-center gap-1 cursor-pointer"
              >
                ⬡ Draw Polygon Zone
              </button>
            </div>
          )}
        </div>
      )}

      {/* Geofence Creation Form Modal */}
      {showDrawDialog && (
        <div className="absolute inset-0 z-[50] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto">
          <div className="w-full max-w-xs bg-slate-900 border border-slate-700 rounded-3xl p-5 space-y-4 text-white shadow-2xl">
            <h3 className="text-xs font-bold text-orange-400 uppercase tracking-wide">
              Create Danger Zone / ख़तरा क्षेत्र
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-[9px] uppercase font-bold text-slate-400">Zone Name</label>
                <input
                  type="text"
                  value={newGeofenceName}
                  onChange={(e) => setNewGeofenceName(e.target.value)}
                  placeholder="e.g. Solang River Landslide"
                  className="w-full h-8 mt-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 text-[11px] text-white outline-none focus:border-orange-500"
                />
              </div>
              
              {drawingMode === 'circle' && (
                <div>
                  <label className="text-[9px] uppercase font-bold text-slate-400">Radius (meters)</label>
                  <input
                    type="number"
                    value={drawRadius}
                    onChange={(e) => setDrawRadius(Number(e.target.value))}
                    className="w-full h-8 mt-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 text-[11px] text-white outline-none"
                  />
                </div>
              )}

              <div>
                <label className="text-[9px] uppercase font-bold text-slate-400">Severity</label>
                <select
                  value={newGeofenceSeverity}
                  onChange={(e) => setNewGeofenceSeverity(e.target.value as any)}
                  className="w-full h-8 mt-1 bg-slate-800 border border-slate-700 rounded-lg px-2 text-[11px] text-white outline-none"
                >
                  <option value="CRITICAL">Critical (Red Zone)</option>
                  <option value="HIGH">High (Orange Zone)</option>
                  <option value="MEDIUM">Medium (Yellow Zone)</option>
                  <option value="LOW">Low (Green Zone)</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSaveGeofence}
                disabled={!newGeofenceName.trim() || savingGeofence}
                className="flex-1 h-9 bg-orange-500 hover:bg-orange-400 disabled:opacity-40 rounded-xl text-[10px] font-bold text-white transition-transform active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
              >
                {savingGeofence && (
                  <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                )}
                {savingGeofence ? 'Saving Zone…' : 'Save Zone'}
              </button>
              <button
                onClick={handleCancelDrawing}
                disabled={savingGeofence}
                className="flex-1 h-9 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-xl text-[10px] font-bold text-slate-300 transition-transform active:scale-95 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
            <div className="pointer-events-auto flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md p-1 rounded-xl border border-slate-700 shadow-md">
              <div className="flex items-center">
                <button
                  onClick={() => setMapMode('m')}
                  className={`px-2 py-1 text-[10px] font-black rounded-lg transition cursor-pointer ${
                    mapMode === 'm' ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Map
                </button>
                <button
                  onClick={() => setMapMode('k')}
                  className={`px-2 py-1 text-[10px] font-black rounded-lg transition cursor-pointer ${
                    mapMode === 'k' ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Satellite
                </button>
                <button
                  onClick={() => setMapMode('p')}
                  className={`px-2 py-1 text-[10px] font-black rounded-lg transition cursor-pointer ${
                    mapMode === 'p' ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Terrain
                </button>
              </div>
              <div className="w-[1px] h-4 bg-slate-700 mx-0.5" />
              <button
                onClick={() => setShowHeatmap(!showHeatmap)}
                className={`px-2 py-1 text-[10px] font-black rounded-lg transition cursor-pointer flex items-center gap-1 ${
                  showHeatmap ? 'bg-red-600 text-white shadow-sm font-bold' : 'text-slate-300 hover:text-white'
                }`}
                title="Toggle Crowd Heatmap"
              >
                <Flame size={11} className={showHeatmap ? 'animate-pulse' : ''} />
                <span>Heatmap</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Interactive People Clusters Floating Overlay */}
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

      {/* "Start Direction?" confirm prompt — shown right after tapping an
          empty spot on the map, before any route is calculated. Confirming
          (Yes / Start Direction) closes this and hands off to the
          estimated-time + route panel below; the X/Cancel just dismisses it. */}
      {pendingPlace && (
        <div
          className="absolute left-4 right-4 z-30 p-4 rounded-2xl border backdrop-blur-md shadow-2xl flex flex-col gap-3 max-w-sm sm:max-w-md mx-auto transition-all animate-sheet-up"
          style={{
            bottom: 84,
            background: isDarkMode ? '#1e1e1e' : '#ffffff',
            borderColor: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
            boxShadow: isDarkMode ? '0 10px 30px rgba(0,0,0,0.5)' : '0 10px 30px rgba(0,0,0,0.08)',
            color: isDarkMode ? '#ffffff' : '#0c2340',
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-400">
                Get Directions?
              </span>
              <h4 className="text-sm font-bold truncate mt-0.5">
                {pendingPlace.name}
              </h4>
              <p className="text-xs truncate opacity-60 mt-0.5">
                {pendingPlace.address}
              </p>
            </div>
            <button
              onClick={handleDismissPendingPlace}
              className="w-7 h-7 rounded-full flex items-center justify-center transition-colors cursor-pointer flex-shrink-0"
              style={{
                background: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                color: isDarkMode ? '#ffffff' : '#0c2340',
              }}
            >
              <XIcon size={14} />
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleDismissPendingPlace}
              className="flex-1 h-10 rounded-xl text-xs font-bold transition-transform active:scale-95 cursor-pointer"
              style={{
                background: isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
                color: isDarkMode ? '#ffffff' : '#0c2340',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleStartDirection}
              disabled={pendingPlace.name === 'Locating place...'}
              className="flex-1 h-10 rounded-xl text-xs font-bold text-white transition-transform active:scale-95 cursor-pointer disabled:opacity-50"
              style={{ background: '#FF9933' }}
            >
              {pendingPlace.name === 'Locating place...' ? 'Locating…' : 'Start Direction'}
            </button>
          </div>
        </div>
      )}

      {/* Shortest Directions Floating Panel Overlay */}
      {selectedPlaceInfo && (
        <div
          className="absolute left-4 right-4 z-30 p-4 rounded-2xl border backdrop-blur-md shadow-2xl flex flex-col gap-3 max-w-sm sm:max-w-md mx-auto transition-all animate-sheet-up"
          style={{
            bottom: 84,
            background: isDarkMode ? '#1e1e1e' : '#ffffff',
            borderColor: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
            boxShadow: isDarkMode ? '0 10px 30px rgba(0,0,0,0.5)' : '0 10px 30px rgba(0,0,0,0.08)',
            color: isDarkMode ? '#ffffff' : '#0c2340',
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-400">
                Directions / मार्ग
              </span>
              <h4 className="text-sm font-bold truncate mt-0.5">
                {selectedPlaceInfo.name}
              </h4>
              <p className="text-xs truncate opacity-60 mt-0.5">
                {selectedPlaceInfo.address}
              </p>
            </div>
            <button
              onClick={handleCloseDirections}
              className="w-7 h-7 rounded-full flex items-center justify-center transition-colors cursor-pointer flex-shrink-0"
              style={{
                background: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                color: isDarkMode ? '#ffffff' : '#0c2340',
              }}
            >
              <XIcon size={14} />
            </button>
          </div>

          {/* Travel Mode selection grid */}
          <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80">
            {TRAVEL_MODES.map((mode) => {
              const active = travelMode === mode.osrmMode;
              const Icon = mode.icon;
              return (
                <button
                  key={mode.id}
                  onClick={() => setTravelMode(mode.osrmMode)}
                  className={`py-2 rounded-lg flex flex-col items-center gap-1 transition-all cursor-pointer ${
                    active
                      ? 'bg-orange-500 text-white shadow-sm font-bold'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <Icon size={16} />
                  <span className="text-[10px] uppercase font-bold tracking-wide">
                    {mode.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Multi-route selector options (Shortest vs Alternatives) */}
          {alternativeRoutes.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1 mt-1 scrollbar-thin">
              {alternativeRoutes.map((r) => {
                const isSelected = selectedRouteIndex === r.index;
                const isShortest = r.distanceVal === minDistanceVal;
                return (
                  <button
                    key={r.index}
                    onClick={() => setSelectedRouteIndex(r.index)}
                    className={`px-3 py-1.5 rounded-xl border text-[11px] font-black whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-orange-500 border-orange-500 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
                    }`}
                  >
                    <span>{isShortest ? '⚡ Shortest Route' : `Alt Route ${r.index + 1}`}</span>
                    <span className="opacity-75 font-normal">({r.distance} - {r.duration})</span>
                  </button>
                );
              })}
            </div>
          )}

          {routeInfo ? (
            <div className="flex items-center justify-between border-t border-slate-150 dark:border-slate-800 pt-3 mt-1">
              <div className="flex items-center gap-2">
                <Navigation className="w-4 h-4 text-orange-500 rotate-45 animate-pulse" />
                <span className="text-xs font-semibold">Active Path Info</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 px-2.5 py-1 rounded-lg">
                  {routeInfo.distance}
                </span>
                <span className="text-sm font-black text-slate-800 dark:text-slate-200">
                  {routeInfo.duration}
                </span>
              </div>
            </div>
          ) : isRouting ? (
            <div className="text-center text-xs opacity-50 py-2 border-t border-slate-150 dark:border-slate-800">
              Calculating alternative paths...
            </div>
          ) : (
            <div className="text-center text-xs opacity-50 py-2 border-t border-slate-150 dark:border-slate-800">
              No route found for this mode
            </div>
          )}
        </div>
      )}
    </div>
  );
};
