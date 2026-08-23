import React, { useEffect, useState, useRef } from 'react';
import {
  Car, Bike, Footprints, Train, X as XIcon, MapPin, Navigation,
  Users, ShieldCheck, AlertTriangle, ExternalLink, ShieldAlert, Shield
} from 'lucide-react';
import { GeoFenceZone } from '../types';

declare var google: any;

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
}

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';

const TRAVEL_MODES = [
  { id: 'drive', label: 'Car', googleMode: 'DRIVING', icon: Car },
  { id: 'walk', label: 'Walk', googleMode: 'WALKING', icon: Footprints },
  { id: 'bike', label: 'Bike', googleMode: 'BICYCLING', icon: Bike },
  { id: 'train', label: 'Transit', googleMode: 'TRANSIT', icon: Train },
];

const darkMapStyle = [
  {
    "elementType": "geometry",
    "stylers": [
      { "color": "#212121" }
    ]
  },
  {
    "elementType": "labels.icon",
    "stylers": [
      { "visibility": "on" }
    ]
  },
  {
    "elementType": "labels.text.fill",
    "stylers": [
      { "color": "#ffffff" },
      { "weight": 700 }
    ]
  },
  {
    "elementType": "labels.text.stroke",
    "stylers": [
      { "color": "#212121" },
      { "weight": 3 }
    ]
  },
  {
    "featureType": "administrative",
    "elementType": "geometry",
    "stylers": [
      { "color": "#757575" }
    ]
  },
  {
    "featureType": "administrative.country",
    "elementType": "labels.text.fill",
    "stylers": [
      { "color": "#ffffff" }
    ]
  },
  {
    "featureType": "administrative.locality",
    "elementType": "labels.text.fill",
    "stylers": [
      { "color": "#ffffff" }
    ]
  },
  {
    "featureType": "landscape",
    "elementType": "geometry",
    "stylers": [
      { "color": "#282828" }
    ]
  },
  {
    "featureType": "poi",
    "elementType": "geometry",
    "stylers": [
      { "color": "#333333" }
    ]
  },
  {
    "featureType": "poi",
    "elementType": "labels.text.fill",
    "stylers": [
      { "color": "#ffffff" }
    ]
  },
  {
    "featureType": "poi.park",
    "elementType": "geometry",
    "stylers": [
      { "color": "#183018" }
    ]
  },
  {
    "featureType": "poi.park",
    "elementType": "labels.text.fill",
    "stylers": [
      { "color": "#a5d6a7" }
    ]
  },
  {
    "featureType": "road",
    "elementType": "geometry.fill",
    "stylers": [
      { "color": "#424242" }
    ]
  },
  {
    "featureType": "road",
    "elementType": "labels.text.fill",
    "stylers": [
      { "color": "#ffffff" }
    ]
  },
  {
    "featureType": "road.arterial",
    "elementType": "geometry.fill",
    "stylers": [
      { "color": "#525252" }
    ]
  },
  {
    "featureType": "road.highway",
    "elementType": "geometry.fill",
    "stylers": [
      { "color": "#616161" }
    ]
  },
  {
    "featureType": "road.highway.controlled_access",
    "elementType": "geometry.fill",
    "stylers": [
      { "color": "#757575" }
    ]
  },
  {
    "featureType": "road.local",
    "elementType": "geometry.fill",
    "stylers": [
      { "color": "#383838" }
    ]
  },
  {
    "featureType": "transit",
    "elementType": "geometry",
    "stylers": [
      { "color": "#2c2c2c" }
    ]
  },
  {
    "featureType": "transit",
    "elementType": "labels.text.fill",
    "stylers": [
      { "color": "#ffffff" }
    ]
  },
  {
    "featureType": "water",
    "elementType": "geometry",
    "stylers": [
      { "color": "#121212" }
    ]
  },
  {
    "featureType": "water",
    "elementType": "labels.text.fill",
    "stylers": [
      { "color": "#ffffff" }
    ]
  }
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
  zoomAction
}) => {
  const [map, setMap] = useState<any>(null);
  const [googleLoaded, setGoogleLoaded] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => document.documentElement.classList.contains('dark'));
  const [activeMarker, setActiveMarker] = useState<MapClusterMarker | null>(null);

  // Directions routing states
  const [selectedPlaceInfo, setSelectedPlaceInfo] = useState<{
    name: string;
    address: string;
    lat: number;
    lng: number;
    placeId?: string;
  } | null>(null);
  const [travelMode, setTravelMode] = useState<string>('DRIVING');
  const [directionsResult, setDirectionsResult] = useState<any>(null);
  const [routeInfo, setRouteInfo] = useState<{ distance: string; duration: string } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const googleMarkersRef = useRef<any[]>([]);
  const googleCirclesRef = useRef<any[]>([]);
  const directionsRendererRef = useRef<any>(null);

  // Track global dark mode changes using MutationObserver
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Dynamically load Google Maps script
  useEffect(() => {
    const callback = () => setGoogleLoaded(true);
    if ((window as any).google && (window as any).google.maps) {
      callback();
      return;
    }

    const existingScript = document.getElementById('google-maps-script');
    if (existingScript) {
      existingScript.addEventListener('load', callback);
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-maps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?${API_KEY ? `key=${API_KEY}` : ''}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = callback;
    document.head.appendChild(script);
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!googleLoaded || !containerRef.current || map) return;

    const mapInstance = new google.maps.Map(containerRef.current, {
      center: center,
      zoom: zoom,
      styles: isDarkMode ? darkMapStyle : [],
      mapTypeControl: false,
      zoomControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      gestureHandling: 'greedy',
    });

    // Add map click listener to select real-life places or coordinate pins
    mapInstance.addListener('click', (event: any) => {
      if ('placeId' in event && event.placeId) {
        event.stop(); // Stop default info popup
        const service = new google.maps.places.PlacesService(mapInstance);
        service.getDetails({ placeId: event.placeId }, (place: any, status: any) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && place && place.geometry?.location) {
            setSelectedPlaceInfo({
              name: place.name || 'Selected Destination',
              address: place.formatted_address || 'Real-life Place',
              lat: place.geometry.location.lat(),
              lng: place.geometry.location.lng(),
              placeId: event.placeId,
            });
          }
        });
      } else if (event.latLng) {
        const lat = event.latLng.lat();
        const lng = event.latLng.lng();
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: { lat, lng } }, (results: any, status: any) => {
          if (status === google.maps.GeocoderStatus.OK && results && results[0]) {
            setSelectedPlaceInfo({
              name: 'Dropped Pin',
              address: results[0].formatted_address,
              lat,
              lng,
            });
          } else {
            setSelectedPlaceInfo({
              name: 'Dropped Pin',
              address: `Coordinate: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
              lat,
              lng,
            });
          }
        });
      }
    });

    setMap(mapInstance);
  }, [googleLoaded]);

  // Apply dark mode styling updates dynamically
  useEffect(() => {
    if (map) {
      map.setOptions({ styles: isDarkMode ? darkMapStyle : [] });
    }
  }, [map, isDarkMode]);

  // Recenter Handler
  useEffect(() => {
    if (map && recenter && recenter.trigger > 0) {
      map.panTo(recenter.target);
      map.setZoom(15);
    }
  }, [map, recenter?.trigger]);

  // Zoom Handler
  useEffect(() => {
    if (map && zoomAction) {
      const current = map.getZoom() || 14;
      map.setZoom(zoomAction.type === 'in' ? current + 1 : current - 1);
    }
  }, [map, zoomAction?.ts]);

  // Render/Sync Markers
  useEffect(() => {
    if (!map) return;

    googleMarkersRef.current.forEach((m) => m.setMap(null));
    googleMarkersRef.current = [];

    markers.forEach((m) => {
      let pinColor = m.pinColor || '#3B82F6';
      if (!m.pinColor) {
        if (m.crowdLevel === 'extreme' || m.crowdLevel === 'high') pinColor = '#EF4444';
        else if (m.crowdLevel === 'medium') pinColor = '#F59E0B';
        else if (m.crowdLevel === 'low') pinColor = '#10B981';
        if (m.type === 'police') pinColor = '#138808';
      }

      const isSelected = selectedMarkerId === m.id || activeMarker?.id === m.id;

      const marker = new google.maps.Marker({
        position: { lat: m.lat, lng: m.lng },
        map: map,
        title: m.title,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: pinColor,
          fillOpacity: 1.0,
          strokeColor: '#FFFFFF',
          strokeWeight: isSelected ? 3.5 : 1.5,
          scale: isSelected ? 12 : 8,
        },
      });

      marker.addListener('click', () => {
        handleSelectMarker(m);
      });

      googleMarkersRef.current.push(marker);
    });
  }, [map, markers, selectedMarkerId, activeMarker]);

  // Render/Sync Geofences
  useEffect(() => {
    if (!map) return;

    googleCirclesRef.current.forEach((c) => c.setMap(null));
    googleCirclesRef.current = [];

    geofenceZones.forEach((z) => {
      const isActive = activeZoneId === z.id;
      let color = '#3B82F6';
      if (z.riskLevel === 'Unsafe') color = '#EF4444';
      else if (z.riskLevel === 'Caution') color = '#F59E0B';
      else if (z.riskLevel === 'Safe') color = '#10B981';

      const circle = new google.maps.Circle({
        strokeColor: color,
        strokeOpacity: isActive ? 0.8 : 0.4,
        strokeWeight: isActive ? 3 : 1.5,
        fillColor: color,
        fillOpacity: isActive ? 0.35 : 0.15,
        map: map,
        center: { lat: z.center.lat, lng: z.center.lng },
        radius: z.radiusKm * 1000,
      });

      googleCirclesRef.current.push(circle);
    });
  }, [map, geofenceZones, activeZoneId]);

  // Helper to handle marker select
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

  // Extract user location from markers
  const userMarker = markers.find((m) => m.id === 'user-location' || m.type === 'user');
  const userLocation = userMarker ? { lat: userMarker.lat, lng: userMarker.lng } : null;

  // Directions calculation: Find the shortest route among alternatives
  useEffect(() => {
    if (!map || !selectedPlaceInfo) {
      setDirectionsResult(null);
      setRouteInfo(null);
      return;
    }

    const directionsService = new google.maps.DirectionsService();
    const startLoc = userLocation || center;

    directionsService.route(
      {
        origin: startLoc,
        destination: { lat: selectedPlaceInfo.lat, lng: selectedPlaceInfo.lng },
        travelMode: travelMode as any,
        provideRouteAlternatives: true,
      },
      (result: any, status: any) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          let shortestRoute = result.routes[0];
          let shortestDistance = Infinity;
          result.routes.forEach((route: any) => {
            let distVal = 0;
            route.legs.forEach((leg: any) => {
              distVal += leg.distance?.value || 0;
            });
            if (distVal < shortestDistance) {
              shortestDistance = distVal;
              shortestRoute = route;
            }
          });

          setDirectionsResult(result);
          const leg = shortestRoute.legs[0];
          if (leg) {
            setRouteInfo({
              distance: leg.distance?.text || '',
              duration: leg.duration?.text || '',
            });
          }
        } else {
          setDirectionsResult(null);
          setRouteInfo(null);
        }
      }
    );
  }, [map, selectedPlaceInfo, travelMode, userLocation]);

  // Render directions polyline
  useEffect(() => {
    if (!map) return;

    if (!directionsRendererRef.current) {
      directionsRendererRef.current = new google.maps.DirectionsRenderer({
        map: map,
        suppressMarkers: false,
        polylineOptions: {
          strokeColor: '#FF9933', // Saffron / Safety Orange
          strokeOpacity: 0.85,
          strokeWeight: 6,
        },
      });
    }

    directionsRendererRef.current.setDirections(directionsResult);
  }, [map, directionsResult]);

  const handleCloseDirections = () => {
    setSelectedPlaceInfo(null);
    setDirectionsResult(null);
    setRouteInfo(null);
    if (directionsRendererRef.current) {
      directionsRendererRef.current.setDirections({ routes: [] });
    }
  };

  const wrapperClass = fullBleed
    ? 'relative w-full h-full overflow-hidden'
    : 'relative w-full rounded-2xl overflow-hidden border border-slate-300 shadow-sm';

  if (!googleLoaded) {
    return (
      <div className={wrapperClass} style={fullBleed ? undefined : { height }}>
        <div className={`w-full h-full flex items-center justify-center ${isDarkMode ? 'bg-[#1e1e1e] text-slate-400' : 'bg-white text-slate-500'} text-sm font-medium`}>
          Loading safety map...
        </div>
      </div>
    );
  }

  return (
    <div className={wrapperClass} style={fullBleed ? undefined : { height }}>
      <div ref={containerRef} className="w-full h-full z-0" />

      {/* Map Control Bar Top */}
      {chrome && (
        <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700 shadow-md text-white text-xs font-bold">
            <MapPin className="w-3.5 h-3.5 text-red-500 animate-pulse" />
            <span className="truncate max-w-[180px] sm:max-w-[280px]">
              {destination ? `${origin || 'My Location'} ➔ ${destination}` : 'Live GIS View'}
            </span>
          </div>
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

      {/* External Google Maps Button */}
      {chrome && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${center.lat},${center.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-3 right-3 z-20 hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/90 hover:bg-white text-slate-900 font-extrabold text-[11px] shadow border border-slate-300 transition"
        >
          <span>Open Google Maps</span>
          <ExternalLink className="w-3.5 h-3.5 text-blue-600" />
        </a>
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
            <div className="min-w-0">
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
              className="w-7 h-7 rounded-full flex items-center justify-center transition-colors cursor-pointer"
              style={{
                background: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                color: isDarkMode ? '#ffffff' : '#0c2340',
              }}
            >
              <XIcon size={14} />
            </button>
          </div>

          <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80">
            {TRAVEL_MODES.map((mode) => {
              const active = travelMode === mode.googleMode;
              const Icon = mode.icon;
              return (
                <button
                  key={mode.id}
                  onClick={() => setTravelMode(mode.googleMode)}
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

          {routeInfo ? (
            <div className="flex items-center justify-between border-t border-slate-150 dark:border-slate-800 pt-3 mt-1">
              <div className="flex items-center gap-2">
                <Navigation className="w-4 h-4 text-orange-500 rotate-45" />
                <span className="text-xs font-semibold">Shortest Route</span>
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
