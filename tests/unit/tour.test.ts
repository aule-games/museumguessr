import { describe, expect, it } from 'vitest';
import { GAP, SPOT_PAD, placeCard, TOUR_STEPS } from '../../src/ui/tour';
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
});
