import type { Coordinate } from './types';

declare global {
  interface Window {
    google?: any;
    __growafGoogleMapsReady?: () => void;
  }
}

let mapsPromise: Promise<any> | null = null;

export function loadGoogleMaps(apiKey: string): Promise<any> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (!apiKey) return Promise.reject(new Error('A Google Maps browser API key is required'));
  if (mapsPromise) return mapsPromise;

  mapsPromise = new Promise((resolve, reject) => {
    window.__growafGoogleMapsReady = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error('Google Maps loaded without the Maps JavaScript API'));
      delete window.__growafGoogleMapsReady;
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=geometry&loading=async&callback=__growafGoogleMapsReady`;
    script.async = true;
    script.onerror = () => reject(new Error('Google Maps JavaScript API failed to load'));
    document.head.appendChild(script);
  });
  return mapsPromise;
}

export function coordinateFromLatLng(latLng: any): Coordinate {
  return { lat: latLng.lat(), lng: latLng.lng() };
}

export function coordinatesFromPath(path: any): Coordinate[] {
  const coordinates: Coordinate[] = [];
  for (let index = 0; index < path.getLength(); index += 1) {
    coordinates.push(coordinateFromLatLng(path.getAt(index)));
  }
  return coordinates;
}

export function sitePreviewBounds(polygon: Coordinate[]) {
  const latitudes = polygon.map((point) => point.lat);
  const longitudes = polygon.map((point) => point.lng);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latPadding = Math.max(0.0001, maxLat - minLat) * 0.428;
  const lngPadding = Math.max(0.0001, maxLng - minLng) * 0.428;
  return {
    north: maxLat + latPadding,
    south: minLat - latPadding,
    east: maxLng + lngPadding,
    west: minLng - lngPadding,
  };
}
