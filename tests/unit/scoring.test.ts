import { describe, expect, it } from 'vitest';
import { DISTANCE, MAX_POINTS, SLIDER, TIERS, YEARS } from '../../src/scoring/config';
import { distanceKm, greatCircle, unwrapAround } from '../../src/scoring/geo';
import {
  distancePoints,
  madeFullMarksKm,
  scoreDistance,
  scoreYear,
  tierFor,
  yearPoints,
  yearTolerance,
} from '../../src/scoring/score';
import {
  formatRange,
  formatYear,
  inSliderBounds,
  joinYear,
  positionToYear,
  yearToPosition,
  yearsBetween,
  yearsOutside,
} from '../../src/scoring/years';

// Small deterministic PRNG so property tests are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('[DX4] historical years have no year 0', () => {
  it('yearsBetween(-1, 1) is 1', () => expect(yearsBetween(-1, 1)).toBe(1));
  it('counts across the BCE/CE boundary', () => {
    expect(yearsBetween(-10, 14)).toBe(23);
    expect(yearsBetween(1450, 1500)).toBe(50);
    expect(yearsBetween(-883, -859)).toBe(24);
  });
  it('is zero inside a range and counts to the nearest end outside it', () => {
    expect(yearsOutside(1460, 1450, 1500)).toBe(0);
    expect(yearsOutside(1400, 1450, 1500)).toBe(50);
    expect(yearsOutside(1620, 1450, 1500)).toBe(120);
    expect(yearsOutside(1, -20, -1)).toBe(1);
  });
});

describe('[DS5] year display never shows negative numbers', () => {
  it('formats years and ranges', () => {
    expect(formatYear(-1200)).toBe('1200 BCE');
    expect(formatYear(1450)).toBe('1450 CE');
    expect(formatRange(1450, 1500)).toBe('1450–1500 CE');
    expect(formatRange(-883, -859)).toBe('883–859 BCE');
    expect(formatRange(-10, 14)).toBe('10 BCE–14 CE');
    expect(formatRange(1665, 1665)).toBe('1665 CE');
    expect(joinYear(300, 'BCE')).toBe(-300);
  });
  it('knows the slider bounds', () => {
    expect(inSliderBounds(SLIDER.min)).toBe(true);
    expect(inSliderBounds(SLIDER.max)).toBe(true);
    expect(inSliderBounds(-5000)).toBe(false);
    expect(inSliderBounds(2025)).toBe(true);
    expect(inSliderBounds(2026)).toBe(false);
  });
});

describe('[DS28] piecewise slider scale', () => {
  it('gives each segment an equal share of the track', () => {
    expect(yearToPosition(-4000)).toBeCloseTo(0, 6);
    expect(yearToPosition(1)).toBeCloseTo(1 / 3, 6);
    expect(yearToPosition(1000)).toBeCloseTo(2 / 3, 6);
    expect(yearToPosition(2025)).toBeCloseTo(1, 6);
    expect(yearToPosition(2000)).toBeLessThan(1);
  });
  it('round-trips every year in bounds within one year', () => {
    for (let y: number = SLIDER.min; y <= SLIDER.max; y += 7) {
      if (y === 0) continue;
      expect(yearsBetween(positionToYear(yearToPosition(y)), y)).toBeLessThanOrEqual(1);
    }
  });
  it('never returns year 0', () => {
    for (let i = 0; i <= 3000; i++) expect(positionToYear(i / 3000)).not.toBe(0);
  });
});

describe('[ENG12] distance scoring', () => {
  it('gives full marks inside the radius', () => {
    expect(distancePoints(0, 50)).toBe(MAX_POINTS);
    expect(distancePoints(50, 50)).toBe(MAX_POINTS);
  });
  it('treats 179.9 and -179.9 as about 22 km apart at the equator', () => {
    const km = distanceKm({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 });
    expect(km).toBeGreaterThan(21);
    expect(km).toBeLessThan(23);
  });
  it('handles the poles', () => {
    expect(distanceKm({ lat: 90, lng: 0 }, { lat: 90, lng: 120 })).toBeCloseTo(0, 6);
    expect(distanceKm({ lat: 90, lng: 0 }, { lat: -90, lng: 0 })).toBeCloseTo(20015, -1);
  });
  it('scores invalid guesses 0', () => {
    expect(scoreDistance(null, { lat: 0, lng: 0 }, 50).points).toBe(0);
    expect(scoreDistance({ lat: NaN, lng: 0 }, { lat: 0, lng: 0 }, 50).points).toBe(0);
    expect(distancePoints(NaN, 50)).toBe(0);
  });
  it('caps an item radius by its precision', () => {
    expect(madeFullMarksKm('city')).toBe(DISTANCE.madeFullMarksKm.city);
    expect(madeFullMarksKm('region', 150)).toBe(150);
    expect(madeFullMarksKm('region', 5000)).toBe(DISTANCE.madeFullMarksKm.region);
  });
  it('property: within [0, 1000], integer, symmetric, non-increasing with distance', () => {
    const r = rng(42);
    for (let i = 0; i < 2000; i++) {
      const a = { lat: r() * 180 - 90, lng: r() * 360 - 180 };
      const b = { lat: r() * 180 - 90, lng: r() * 360 - 180 };
      const radius = [50, 300, 600][i % 3] as number;
      const ab = scoreDistance(a, b, radius);
      const ba = scoreDistance(b, a, radius);
      expect(ab.points).toBe(ba.points);
      expect(Number.isInteger(ab.points)).toBe(true);
      expect(ab.points).toBeGreaterThanOrEqual(0);
      expect(ab.points).toBeLessThanOrEqual(MAX_POINTS);
      const km = r() * 20000;
      expect(distancePoints(km + r() * 500, radius)).toBeLessThanOrEqual(distancePoints(km, radius));
    }
  });
});

describe('[ENG12] year scoring', () => {
  it('gives full marks anywhere inside the range', () => {
    expect(scoreYear(1450, 1450, 1500).points).toBe(MAX_POINTS);
    expect(scoreYear(1500, 1450, 1500).points).toBe(MAX_POINTS);
    expect(scoreYear(-870, -883, -859).points).toBe(MAX_POINTS);
  });
  it('is gentler for older objects', () => {
    const old = scoreYear(-2050, -2000, -2000).points;
    const recent = scoreYear(1800, 1850, 1850).points;
    expect(old).toBeGreaterThan(recent);
  });
  it('uses a fixed reference year, not today', () => {
    expect(yearTolerance(1850, 1850)).toBeCloseTo(YEARS.toleranceBase + YEARS.tolerancePerYearOfAge * 150, 6);
  });
  it('scores invalid guesses 0, including year 0', () => {
    expect(scoreYear(null, 1450, 1500).points).toBe(0);
    expect(scoreYear(0, 1450, 1500).points).toBe(0);
    expect(scoreYear(NaN, 1450, 1500).points).toBe(0);
    expect(yearPoints(NaN, 30)).toBe(0);
  });
  it('crosses the BCE/CE boundary without a year 0', () => {
    expect(scoreYear(1, -20, -1).yearsOff).toBe(1);
    expect(scoreYear(-1, 1, 14).yearsOff).toBe(1);
  });
  it('property: within [0, 1000], integer, non-increasing with years off', () => {
    const r = rng(7);
    for (let i = 0; i < 2000; i++) {
      const start = Math.round(r() * 5999) - 4000 || 1;
      const end = Math.min(2000, start + Math.round(r() * 300)) || 1;
      const off = Math.round(r() * 3000);
      const tol = yearTolerance(start, end);
      const p = yearPoints(off, tol);
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(MAX_POINTS);
      expect(yearPoints(off + Math.round(r() * 100), tol)).toBeLessThanOrEqual(p);
    }
  });
});

describe('[ENG25] great-circle reveal line', () => {
  it('crosses the antimeridian without circling the globe', () => {
    const line = greatCircle({ lat: 35.7, lng: 139.7 }, { lat: 37.8, lng: -122.4 });
    for (let i = 1; i < line.length; i++) {
      expect(Math.abs((line[i] as [number, number])[0] - (line[i - 1] as [number, number])[0])).toBeLessThan(20);
    }
  });
});

describe('[DS7] tiers', () => {
  it('maps totals to tier names', () => {
    expect(tierFor(0)).toBe('Visitor');
    expect(tierFor(30000)).toBe('Director');
  });

  it('each tier starts exactly at its lower bound (inclusive)', () => {
    for (const [i, tier] of TIERS.entries()) {
      expect(tierFor(tier.min)).toBe(tier.name);
      if (i > 0) expect(tierFor(tier.min - 1)).toBe(TIERS[i - 1]?.name);
    }
  });
});

describe('[ENG25] reveal longitudes stay on one side of the antimeridian', () => {
  it('moves a point within 180° of the reference longitude', () => {
    expect(unwrapAround({ lat: -13.8, lng: -171.8 }, 178.4)).toEqual({ lat: -13.8, lng: 188.2 });
    expect(unwrapAround({ lat: 64.8, lng: 178 }, -150)).toEqual({ lat: 64.8, lng: -182 });
    expect(unwrapAround({ lat: 48.9, lng: 2.35 }, 12.5)).toEqual({ lat: 48.9, lng: 2.35 });
  });

  it('keeps every unwrapped point within 180° of the reference, from any start', () => {
    for (const ref of [-179, -90, 0, 90, 179]) {
      for (const lng of [-540, -181, -180, -1, 0, 1, 180, 181, 540]) {
        const out = unwrapAround({ lat: 0, lng }, ref);
        expect(Math.abs(out.lng - ref)).toBeLessThanOrEqual(180);
        expect((((out.lng - lng) % 360) + 360) % 360).toBeCloseTo(0);
      }
    }
  });
});
