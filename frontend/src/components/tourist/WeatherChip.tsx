import { useEffect, useState } from 'react';
import { getSOSLocation } from '../../lib/location';

interface Props {
  darkMode: boolean;
}

interface WeatherState {
  tempC: number;
  emoji: string;
  label: string;
}

// Open-Meteo is free, keyless, and CORS-friendly — consistent with the rest
// of this app's map stack (Leaflet/OSM tiles/OSRM routing/Nominatim search
// are all free & keyless already), so no new API key management is needed.
// WMO weather codes: https://open-meteo.com/en/docs
function describeWeatherCode(code: number): { emoji: string; label: string } {
  if (code === 0) return { emoji: '☀️', label: 'Clear' };
  if (code === 1 || code === 2) return { emoji: '🌤️', label: 'Partly cloudy' };
  if (code === 3) return { emoji: '☁️', label: 'Overcast' };
  if (code === 45 || code === 48) return { emoji: '🌫️', label: 'Fog' };
  if (code >= 51 && code <= 57) return { emoji: '🌦️', label: 'Drizzle' };
  if (code >= 61 && code <= 67) return { emoji: '🌧️', label: 'Rain' };
  if (code >= 71 && code <= 77) return { emoji: '🌨️', label: 'Snow' };
  if (code >= 80 && code <= 82) return { emoji: '🌧️', label: 'Showers' };
  if (code === 85 || code === 86) return { emoji: '🌨️', label: 'Snow showers' };
  if (code >= 95) return { emoji: '⛈️', label: 'Thunderstorm' };
  return { emoji: '🌡️', label: 'Weather' };
}

// Refresh cadence for "live" weather around the tourist's current spot —
// frequent enough to track real changes, not so frequent it hammers the
// free API or the device's battery/location stack.
const REFRESH_MS = 10 * 60 * 1000;

export default function WeatherChip({ darkMode: dm }: Props) {
  const [weather, setWeather] = useState<WeatherState | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchWeather = async () => {
      try {
        const loc = await getSOSLocation();
        if (loc.latitude == null || loc.longitude == null) throw new Error('No location');

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current_weather=true`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Open-Meteo returned ${resp.status}`);
        const data = await resp.json();
        const cw = data?.current_weather;
        if (!cw || cw.temperature == null) throw new Error('No current_weather in response');

        if (!cancelled) {
          const { emoji, label } = describeWeatherCode(cw.weathercode ?? -1);
          setWeather({ tempC: Math.round(cw.temperature), emoji, label });
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    fetchWeather();
    const intervalId = setInterval(fetchWeather, REFRESH_MS);
    return () => { cancelled = true; clearInterval(intervalId); };
  }, []);

  // Nothing to show yet and nothing failed — skip rendering rather than
  // showing an empty/loading chip that just adds clutter over the map.
  if (!weather && !failed) return null;
  if (!weather) return null;

  return (
    <div
      aria-label={`Current weather: ${weather.label}, ${weather.tempC}°C`}
      className="h-11 px-3.5 rounded-xl flex items-center justify-center gap-1.5 transition-all duration-150"
      style={{
        background: dm ? '#27272a' : '#ffffff',
        border: `1px solid ${dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)'}`,
        boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
        color: dm ? '#f1f5f9' : '#0c2340',
      }}
    >
      <span className="text-base leading-none">{weather.emoji}</span>
      <span className="text-xs font-bold leading-none whitespace-nowrap">{weather.tempC}°C</span>
    </div>
  );
}
