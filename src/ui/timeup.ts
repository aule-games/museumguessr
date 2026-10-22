// The time-up transition (D2): cancel a pin drag, blur the year field and
// close any overlay through its history pop (cancelling queued actions),
// show "Time's up" in the cue slot for about 800 ms with the answer controls
// dimmed (no modal), then open the reveal. Reduced motion, and an expiry the
// player did not watch (a hidden tab, a late return), skip the hold.

import { TIME_UP_HOLD_MS } from '../game/timer.ts';
import { closeAllOverlays } from './overlay.ts';

export interface TimeUpOptions {
  /** Dims the answer controls, cancels a drag and blurs the year field; null when no round is on screen. */
  freeze: (() => void) | null;
  away: boolean;
  reducedMotion: boolean;
  /** Draws "Time's up" in the cue slot. */
  showCue(): void;
  wait(ms: number): Promise<void>;
  /** Opens the reveal; the caller checks that the game and round are still the ones that timed out. */
  reveal(): void;
}

export async function presentTimeUp(o: TimeUpOptions): Promise<void> {
  o.freeze?.();
  const closed = closeAllOverlays();
  const hold = o.away || o.reducedMotion ? 0 : TIME_UP_HOLD_MS;
  if (hold > 0) o.showCue();
  await Promise.all([closed, hold > 0 ? o.wait(hold) : Promise.resolve()]);
  o.reveal();
}
