// Test mode only (`?test=1`): guesses that finish a game in one tap, so the
// end screen can be checked without playing 10 rounds. Each round gets a
// random skill, so a finished test game mixes close and far answers.

import type { Step } from '../analytics/events.ts';
import type { AnswerKey } from '../scoring/game.ts';
import type { LatLng } from '../scoring/geo.ts';
import { SLIDER } from '../scoring/config.ts';

/** A valid answer for this step, near or far from the right one; `skill` 0 is spot on, 1 is far off. */
export function testGuess(step: Step, key: AnswerKey, skill: number, rng: () => number): LatLng | number {
  const spread = skill * skill;
  if (step === 'when') {
    const year = Math.round((key.start + key.end) / 2 + (rng() * 2 - 1) * spread * 1500);
    // 4000 BCE and earlier is the one early stop (W5): the scale's own years start at 3999 BCE
    if (year <= SLIDER.min) return SLIDER.earlyStop;
    const clamped = Math.min(SLIDER.max, year);
    return clamped === 0 ? 1 : clamped;
  }
  const at = step === 'kept' ? key.kept : key.made;
  const lat = Math.min(80, Math.max(-60, at.lat + (rng() * 2 - 1) * spread * 40));
  const lng = ((at.lng + (rng() * 2 - 1) * spread * 80 + 540) % 360) - 180;
  return { lat, lng };
}
