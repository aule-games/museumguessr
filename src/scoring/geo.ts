export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km (haversine); handles the antimeridian and poles. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidLatLng(p: LatLng | null | undefined): p is LatLng {
  return (
    !!p &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

/** Points along the great circle from a to b (inclusive), for reveal lines (ENG25). */
export function greatCircle(a: LatLng, b: LatLng, steps = 64): [number, number][] {
  const φ1 = rad(a.lat);
  const λ1 = rad(a.lng);
  const φ2 = rad(b.lat);
  const λ2 = rad(b.lng);
  const d = distanceKm(a, b) / EARTH_RADIUS_KM;
  if (d < 1e-9) return [[a.lng, a.lat]];
  const out: [number, number][] = [];
  let prevLng = a.lng;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    const lat = (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI;
    let lng = (Math.atan2(y, x) * 180) / Math.PI;
    // unwrap so the line crosses the antimeridian instead of circling the globe
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    prevLng = lng;
    out.push([lng, lat]);
  }
  return out;
}

/** The same point with its longitude moved within 180° of `refLng`, so a reveal never draws across the antimeridian (ENG25). */
export function unwrapAround(p: LatLng, refLng: number): LatLng {
  let lng = p.lng;
  while (lng - refLng > 180) lng -= 360;
  while (lng - refLng < -180) lng += 360;
  return { lat: p.lat, lng };
}
