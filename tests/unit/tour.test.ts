import { describe, expect, it } from 'vitest';
import { GAP, SPOT_PAD, placeCard, cardLimits, TOUR_STEPS } from '../../src/ui/tour';
import { COPY } from '../../src/copy';

const view = { w: 390, h: 844 };
const card = { w: 360, h: 200 };

describe('[DS34] tour card placement', () => {
  it('centres the card when a step lights up nothing', () => {
    expect(placeCard(null, card, view)).toEqual({ x: 15, y: 322 });
  });
  it('puts the card below the lit element when it fits', () => {
    const target = { x: 0, y: 48, w: 390, h: 56 };
    expect(placeCard(target, card, view).y).toBe(48 + 56 + SPOT_PAD + GAP);
  });
  it('puts the card above the lit element when there is no room below', () => {
    const target = { x: 16, y: 780, w: 358, h: 48 };
    const pos = placeCard(target, card, view);
    expect(pos.y + card.h).toBeLessThanOrEqual(780 - SPOT_PAD);
  });
  it('keeps the card fully on screen even when the lit element fills the screen', () => {
    const pos = placeCard({ x: 0, y: 0, w: 390, h: 844 }, card, view);
    expect(pos.x).toBeGreaterThanOrEqual(GAP);
    expect(pos.y + card.h).toBeLessThanOrEqual(view.h - GAP);
  });
  it('has a title and a body for every step', () => {
    for (const s of TOUR_STEPS) {
      expect(COPY).toHaveProperty(`tour.${s.key}.title`);
      expect(COPY).toHaveProperty(`tour.${s.key}.body`);
    }
  });
  it('[DS34] places the small-phone map card above the map after restoring the photo share', () => {
    const target = { x: 0, y: 304, w: 375, h: 299 };
    const card = { w: 351, h: 251 };
    const pos = placeCard(target, card, { w: 375, h: 667 });
    expect(pos.y + card.h).toBeLessThan(target.y);
  });
  it('[DS34] narrows the landscape photo card into the free side column', () => {
    const view = { w: 844, h: 390 };
    const target = { x: 0, y: 48, w: 464, h: 342 };
    const limits = cardLimits(target, { w: 384, h: 250 }, view);
    expect(limits.w).toBe(350);
    const pos = placeCard(target, { w: limits.w, h: 280 }, view);
    expect(pos.x).toBeGreaterThan(target.x + target.w);
    expect(pos.x + limits.w).toBeLessThanOrEqual(view.w - GAP);
  });
  it('[DS34] bounds enlarged map instructions to the space above the target before overlapping it', () => {
    const view = { w: 375, h: 667 };
    const target = { x: 0, y: 304, w: 375, h: 299 };
    const limits = cardLimits(target, { w: 351, h: 400 }, view);
    const pos = placeCard(target, limits, view);
    expect(limits.h).toBe(274);
    expect(pos.y + limits.h).toBeLessThan(target.y);
  });
  it('[DS34] describes year controls as appearing only on When, not under the Confirm spotlight', () => {
    expect(COPY['tour.confirm.body']).toContain('Year controls appear only on When');
    expect(TOUR_STEPS).toHaveLength(7);
  });
});
