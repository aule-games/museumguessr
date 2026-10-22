// Draft saving (ENG7): every edit of the active question, including an empty
// or invalid one, is saved under the writer lock while it changes, not only
// when the page goes away, so a tab that takes over sees it. Edits are
// throttled; each carries the time it was made, so an edit made before the
// deadline still counts when it is flushed just before the expiry.

import type { Step } from '../analytics/events.ts';
import type { Draft } from './timer.ts';

export const DRAFT_THROTTLE_MS = 250;

export interface PendingDraft {
  gameId: string;
  round: number;
  step: Step;
  value: Draft;
  /** Wall-clock time of the edit. */
  at: number;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export class DraftQueue {
  private pending: PendingDraft | null = null;
  private timer: unknown = null;

  constructor(
    private save: (d: PendingDraft) => void,
    private timers: Timers,
    private delayMs = DRAFT_THROTTLE_MS,
  ) {}

  /** Queue the latest edit; at most one save per throttle window, always the newest value. */
  push(d: PendingDraft) {
    if (this.pending && (this.pending.gameId !== d.gameId || this.pending.round !== d.round || this.pending.step !== d.step)) this.flush();
    this.pending = d;
    if (this.timer === null) {
      this.timer = this.timers.set(() => {
        this.timer = null;
        this.flush();
      }, this.delayMs);
    }
  }

  /** Save the pending edit now (before Confirm, Back, the expiry, hiding or leaving the page). */
  flush() {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
    const d = this.pending;
    this.pending = null;
    if (d) this.save(d);
  }
}
