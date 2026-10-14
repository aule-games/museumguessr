import { describe, expect, it } from 'vitest';
import { fallbackRank, overlaps, revealPadding } from '../../src/map/layout';

describe('[DS22] reveal fit clearance', () => {
  const pin = { height: 40, labelWidth: 110, labelHeight: 20, labelGap: 4, gap: 8 };
  it('[DS22] keeps the landscape World button and attribution below every fitted pin label', () => {
    const padding = revealPadding({ w: 464, h: 174 }, pin,
      { left: 8, top: 122, right: 60, bottom: 166 },
      { left: 240, top: 140, right: 454, bottom: 164 });
    expect(174 - padding.bottom + pin.labelGap + pin.labelHeight).toBeLessThan(122);
    expect(padding.top - pin.height).toBeGreaterThanOrEqual(pin.gap);
    expect(padding.top + padding.bottom).toBeLessThan(174);
  });
  it('[DS22] reserves the desktop controls column as well as half the answer label width', () => {
    const padding = revealPadding({ w: 660, h: 600 }, pin,
      { left: 596, top: 12, right: 648, bottom: 152 }, null);
    expect(660 - padding.right + pin.labelWidth / 2).toBeLessThan(596);
  });
  it('[DS22] accepts hidden phone controls and leaves a positive fit area in tiny hosts', () => {
    for (const [w, h] of [[375, 214], [100, 60], [0, 0]] as const) {
      const p = revealPadding({ w, h }, pin, null, null);
      expect(p.left + p.right).toBeLessThanOrEqual(w * 0.9 + 0.01);
      expect(p.top + p.bottom).toBeLessThanOrEqual(h * 0.9 + 0.01);
    }
  });
});

describe('[DS4] fallback label density', () => {
  it('[DS4] admits only rank-zero cities at world zoom and adds ranks as the map zooms in', () => {
    expect(fallbackRank(0)).toBe(0);
    expect(fallbackRank(1.5)).toBe(0);
    expect(fallbackRank(3)).toBe(3);
    expect(fallbackRank(6)).toBeGreaterThan(fallbackRank(3));
  });
  it('[DS4] rejects overlapping label boxes and preserves a screen-space gutter', () => {
    const a = { left: 0, top: 0, right: 60, bottom: 18 };
    expect(overlaps(a, { left: 40, top: 10, right: 100, bottom: 28 }, 8)).toBe(true);
    expect(overlaps(a, { left: 64, top: 0, right: 124, bottom: 18 }, 8)).toBe(true);
    expect(overlaps(a, { left: 68, top: 0, right: 128, bottom: 18 }, 8)).toBe(false);
    expect(overlaps(a, { left: 0, top: 26, right: 60, bottom: 44 }, 8)).toBe(false);
  });
});
