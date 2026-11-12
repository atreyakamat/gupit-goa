import { GOA_BOUNDS, isWithinGoa } from '@gupit/shared';
import type { Geocoder } from '../types';

/** No geocoding. Candidates without stated coordinates wait for a reviewer to place the pin. */
export function createNoopGeocoder(): Geocoder {
  return {
    name: 'none',
    async geocode() {
      return null;
    },
  };
}

/**
 * Nominatim-compatible geocoder (OpenStreetMap data, ODbL). Point `baseUrl` at your own
 * instance or a commercial host for volume: the public instance allows at most one
 * request per second and requires an identifying User-Agent, which this client enforces.
 * Results are always "approximate" until a reviewer confirms the pin.
 */
export function createNominatimGeocoder(options: {
  baseUrl: string;
  userAgent: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Geocoder {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastCall = 0;

  return {
    name: 'nominatim',
    async geocode({ name, locality }) {
      // A bare name is too ambiguous to geocode: wait for a locality.
      if (!locality) return null;
      const wait = lastCall + 1100 - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();

      const url = new URL('/search', options.baseUrl);
      url.searchParams.set('q', `${name}, ${locality}, Goa, India`);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '1');
      url.searchParams.set('countrycodes', 'in');
      url.searchParams.set(
        'viewbox',
        `${GOA_BOUNDS.minLng},${GOA_BOUNDS.maxLat},${GOA_BOUNDS.maxLng},${GOA_BOUNDS.minLat}`,
      );
      url.searchParams.set('bounded', '1');
      if (options.apiKey) url.searchParams.set('key', options.apiKey);

      try {
        const response = await fetchImpl(url, {
          headers: { 'user-agent': options.userAgent },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) return null;
        const results = (await response.json()) as {
          lat?: string;
          lon?: string;
          importance?: number;
          addresstype?: string;
        }[];
        const top = results[0];
        if (!top?.lat || !top.lon) return null;
        const point = { lat: Number(top.lat), lng: Number(top.lon) };
        if (!isWithinGoa(point)) return null;
        // A hit on the town itself is not the place: treat it as weak evidence.
        const isArea = [
          'city',
          'town',
          'village',
          'suburb',
          'state',
          'county',
          'municipality',
        ].includes(top.addresstype ?? '');
        return {
          ...point,
          confidence: isArea ? 0.2 : Math.min(0.85, 0.45 + (top.importance ?? 0)),
          provider: 'nominatim',
        };
      } catch {
        return null;
      }
    },
  };
}
