import { saveLastKnownLocation, getLastKnownLocation, LocationData } from "./db";
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';

export async function getLiveLocation(
  options = { timeout: 10000, maxAge: 10000, enableHighAccuracy: true }
): Promise<LocationData> {
  // On Native (Android/iOS), use the Capacitor Geolocation plugin for better
  // permission handling and background reliability.
  if (Capacitor.isNativePlatform()) {
    try {
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted') {
        const req = await Geolocation.requestPermissions();
        if (req.location !== 'granted') {
          throw new Error("Location permission denied by user");
        }
      }

      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: options.enableHighAccuracy,
        timeout: options.timeout,
      });

      const locData: LocationData = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: new Date(position.timestamp).toISOString(),
        location_source: "live",
      };

      await saveLastKnownLocation(locData).catch(() => {});
      return locData;
    } catch (err: any) {
      throw new Error(`Native GPS failed: ${err.message || err}`);
    }
  }

  // Fallback to Browser Geolocation for web/pwa
  if (!navigator.geolocation) {
    throw new Error("Geolocation API not supported by browser");
  }

  return new Promise<LocationData>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const locData: LocationData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: new Date(position.timestamp).toISOString(),
          location_source: "live",
        };

        await saveLastKnownLocation(locData).catch(() => {});
        resolve(locData);
      },
      (error) => {
        reject(error);
      },
      options
    );
  });
}

export async function getSOSLocation(): Promise<LocationData> {
  try {
    console.log("Attempting live GPS location acquisition...");
    const liveLoc = await getLiveLocation();
    console.log("Live GPS acquired:", liveLoc);
    return liveLoc;
  } catch (gpsError: any) {
    console.warn("Live GPS unavailable or timed out:", gpsError.message || gpsError);

    try {
      const lastKnown = await getLastKnownLocation();
      if (lastKnown && lastKnown.latitude && lastKnown.longitude) {
        console.log("Using last-known location from IndexedDB:", lastKnown);
        return {
          latitude: lastKnown.latitude,
          longitude: lastKnown.longitude,
          accuracy: lastKnown.accuracy || null,
          timestamp: lastKnown.timestamp,
          location_source: "last_known",
        };
      }
    } catch (dbError) {
      console.warn("Could not read last-known location from IndexedDB:", dbError);
    }

    console.log("No GPS or last-known location available. Proceeding with 'unavailable'.");
    return {
      latitude: null,
      longitude: null,
      accuracy: null,
      timestamp: new Date().toISOString(),
      location_source: "unavailable",
    };
  }
}
