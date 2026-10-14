// Drop labels and pin snapping (DS4, DS33, ENG25). Pure functions over the
// bundled Natural Earth data so they are unit-testable without a map.

import { distanceKm, type LatLng } from '../scoring/geo.ts';

export type Place = [name: string, country: string, lat: number, lng: number, rank: number];

/** Beyond this distance from every bundled place there is no "Near X" and no snap. */
export const NEAR_LIMIT_KM = 250;
/** A tap snaps to a place within this many screen pixels. */
export const SNAP_PX = 30;

export interface Nearest {
  place: Place;
  km: number;
}

export function nearestPlace(p: LatLng, places: readonly Place[]): Nearest | null {
  let best: Nearest | null = null;
  for (const place of places) {
    // cheap latitude pre-filter: 1 degree of latitude is ~111 km
    if (best && Math.abs(place[2] - p.lat) * 111 > best.km) continue;
    const km = distanceKm(p, { lat: place[2], lng: place[3] });
    if (!best || km < best.km) best = { place, km };
  }
  return best;
}

function inRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(lng: number, lat: number, rings: number[][][]): boolean {
  if (!rings[0] || !inRing(lng, lat, rings[0])) return false;
  return !rings.slice(1).some((hole) => inRing(lng, lat, hole));
}

/** The country outline that contains a point, if any (bundled Natural Earth data). */
export function countryFeatureAt(p: LatLng, countries: GeoJSON.FeatureCollection): GeoJSON.Feature | null {
  for (const f of countries.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    if (polys.some((rings) => inPolygon(p.lng, p.lat, rings as number[][][]))) return f;
  }
  return null;
}

export function countryAt(p: LatLng, countries: GeoJSON.FeatureCollection): string | null {
  return (countryFeatureAt(p, countries)?.properties?.name as string | undefined) ?? null;
}

export type CountryRole = 'kept' | 'made' | 'both';

/**
 * The reveal's highlighted countries: where the object is kept today and
 * where it was made, tagged by role so each gets its pin colour.
 */
export function revealCountries(kept: LatLng, made: LatLng, countries: GeoJSON.FeatureCollection): GeoJSON.Feature[] {
  const k = countryFeatureAt(kept, countries);
  const m = countryFeatureAt(made, countries);
  const tag = (f: GeoJSON.Feature, role: CountryRole): GeoJSON.Feature => ({ ...f, properties: { ...f.properties, role } });
  if (k && k === m) return [tag(k, 'both')];
  return [...(k ? [tag(k, 'kept')] : []), ...(m ? [tag(m, 'made')] : [])];
}

export type DropLabel = { kind: 'near'; place: string; country: string } | { kind: 'country'; country: string } | { kind: 'sea' };

/** "Near Berlin, Germany" within 250 km of a place; else the country; else open sea (ENG25). */
export function dropLabel(p: LatLng, places: readonly Place[], countries: GeoJSON.FeatureCollection | null): DropLabel {
  const n = nearestPlace(p, places);
  if (n && n.km <= NEAR_LIMIT_KM) return { kind: 'near', place: n.place[0], country: n.place[1] };
  const country = countries ? countryAt(p, countries) : null;
  return country ? { kind: 'country', country } : { kind: 'sea' };
}

/** Snap target for a tap, given a function that measures screen distance in pixels. */
export function snapTarget(p: LatLng, places: readonly Place[], screenPx: (q: LatLng) => number): LatLng | null {
  const n = nearestPlace(p, places);
  if (!n || n.km > NEAR_LIMIT_KM) return null;
  const q = { lat: n.place[2], lng: n.place[3] };
  return screenPx(q) <= SNAP_PX ? q : null;
}
