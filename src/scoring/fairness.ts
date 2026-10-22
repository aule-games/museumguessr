// Constant-guess baselines (V3, ENG12). A player who always pins the same
// spot, or always types the same year, must score under 40% of each
// question's game maximum. The search tries a world grid plus every answer
// point, and every year on the slider.

import { MAX_POINTS, SLIDER } from './config.ts';
import type { LatLng } from './geo.ts';
import { scoreDistance, scoreYear } from './score.ts';

export const BASELINE_LIMIT = 0.4;

export interface PlaceTarget extends LatLng {
  fullMarksKm: number;
}

export interface Baseline<T> {
  best: T;
  points: number;
  share: number;
}

export function bestConstantPlace(targets: readonly PlaceTarget[], stepDeg = 2): Baseline<LatLng> {
  const candidates: LatLng[] = targets.map((t) => ({ lat: t.lat, lng: t.lng }));
  for (let lat = -88; lat <= 88; lat += stepDeg) {
    for (let lng = -180; lng < 180; lng += stepDeg) candidates.push({ lat, lng });
  }
  let best: Baseline<LatLng> = { best: { lat: 0, lng: 0 }, points: -1, share: 0 };
  for (const c of candidates) {
    let points = 0;
    for (const t of targets) points += scoreDistance(c, t, t.fullMarksKm).points;
    if (points > best.points) best = { best: c, points, share: points / (MAX_POINTS * targets.length) };
  }
  // refine around the best grid point
  for (let dLat = -stepDeg; dLat <= stepDeg; dLat += 0.25) {
    for (let dLng = -stepDeg; dLng <= stepDeg; dLng += 0.25) {
      const c = { lat: Math.max(-90, Math.min(90, best.best.lat + dLat)), lng: ((best.best.lng + dLng + 540) % 360) - 180 };
      let points = 0;
      for (const t of targets) points += scoreDistance(c, t, t.fullMarksKm).points;
      if (points > best.points) best = { best: c, points, share: points / (MAX_POINTS * targets.length) };
    }
  }
  return best;
}

/** Tries the early stop and every year on the slider (W5): the stop must not pay either. */
export function bestConstantYear(ranges: readonly { start: number; end: number }[]): Baseline<number> {
  let best: Baseline<number> = { best: 1, points: -1, share: 0 };
  for (let y: number = SLIDER.earlyStop; y <= SLIDER.max; y++) {
    if (y === 0 || y === SLIDER.min) continue;
    let points = 0;
    for (const r of ranges) points += scoreYear(y, r.start, r.end).points;
    if (points > best.points) best = { best: y, points, share: points / (MAX_POINTS * ranges.length) };
  }
  return best;
}
