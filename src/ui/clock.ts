// What the round clock looks like (R2, D3, D7): a 3 px number-free line on
// the top bar's bottom edge, the last-ten-seconds cue in the counter's slot,
// a visually hidden timer text updated every ten seconds, and one polite
// announcement at the warning and one at time-up. The line and the cue are
// mirrored in every dialog header, the tour card and the photo viewer, so
// time stays visible inside overlays. The screen controller computes a
// ClockFace from src/game/timer.ts; this module only draws it.

import { t } from '../copy.ts';
import { DEFAULT_TIMER, TICK_MS, aboutSeconds, cueSeconds, lineFraction, type TimerConfig } from '../game/timer.ts';
import { h, s } from './dom.ts';

export interface ClockFace {
  /** off: no round clock (start, reveal, end, untimed); idle: full and static before the start. */
  mode: 'off' | 'idle' | 'running' | 'paused' | 'timeup';
  /** Time left in ms. */
  remaining: number;
  /** Round length in ms. */
  limit: number;
  /** The last-ten-seconds state: cue shown, line in the warning colour. */
  warning: boolean;
  /** Reduced motion: whole-second steps, no transition. */
  stepped: boolean;
}

export const OFF: ClockFace = { mode: 'off', remaining: 0, limit: 0, warning: false, stepped: false };

/** The clock's strings, derived from the timer constants (M4). */
export function timerCopy(remaining: number, cfg: TimerConfig = DEFAULT_TIMER) {
  const limit = cfg.roundSeconds * 1000;
  return {
    hurry: t('timer.hurry', { seconds: cueSeconds(remaining) }),
    warning: t('timer.warning', { seconds: cfg.warnSeconds }),
    about: t('timer.remaining', { seconds: aboutSeconds(remaining, Math.max(limit, remaining)) }),
    timeUp: t('round.timeUp'),
  };
}

/** The small clock glyph of the cue and the timed-out reveal rows (DS3: never colour alone). */
export function clockGlyph(cls = 'clock-glyph'): SVGSVGElement {
  return s(
    'svg',
    { class: cls, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
    s('circle', { cx: 8, cy: 8, r: 6.25 }),
    s('path', { d: 'M8 4.5V8l2.5 1.75' }),
  );
}

interface Mount {
  el: HTMLElement;
  seen: boolean;
  update(face: ClockFace): void;
}

const mounts = new Set<Mount>();
let current: ClockFace = OFF;

function register(el: HTMLElement, update: (face: ClockFace) => void): HTMLElement {
  const m: Mount = { el, seen: false, update };
  mounts.add(m);
  update(current);
  return el;
}

/** Draw the clock everywhere it is mounted; mounts that left the page are dropped. */
export function renderClockFace(face: ClockFace) {
  current = face;
  for (const m of [...mounts]) {
    if (m.el.isConnected) m.seen = true;
    else if (m.seen) {
      mounts.delete(m);
      continue;
    }
    m.update(face);
  }
}

export function currentClockFace(): ClockFace {
  return current;
}

/** The draining line: decorative, no digits, hidden from screen readers (R2). */
function line(): { el: HTMLElement; update(face: ClockFace): void } {
  const fill = h('div', { class: 'clockline__fill' });
  const el = h('div', { class: 'clockline', 'aria-hidden': 'true', 'data-test': 'clock-line', 'data-state': 'off' }, fill);
  let last = '';
  return {
    el,
    update(face) {
      el.dataset.state = face.mode;
      el.dataset.warning = String(face.warning);
      el.hidden = face.mode === 'off';
      let fraction = 1;
      let transition = 'none';
      if (face.mode === 'running' && face.limit > 0) {
        if (face.stepped) fraction = lineFraction(face.remaining, face.limit, true);
        else {
          // aim at where the line will be at the next check, so it drains linearly between checks
          fraction = lineFraction(Math.max(0, face.remaining - TICK_MS), face.limit, false);
          transition = `transform ${TICK_MS}ms linear`;
        }
      } else if ((face.mode === 'paused' || face.mode === 'timeup') && face.limit > 0) {
        fraction = lineFraction(face.remaining, face.limit, face.stepped);
      }
      const transform = `scaleX(${fraction.toFixed(4)})`;
      if (transform + transition === last) return;
      last = transform + transition;
      fill.style.transition = transition;
      fill.style.transform = transform;
    },
  };
}

/** The cue: "Hurry up · 9" with a clock glyph in the last ten seconds, "Time's up" at the end. */
function cue(): { el: HTMLElement; update(face: ClockFace): void } {
  const text = h('span', { class: 'clockcue__text' });
  const el = h('span', { class: 'clockcue', 'data-test': 'clock-cue', hidden: true }, clockGlyph('clockcue__glyph'), text);
  return {
    el,
    update(face) {
      const show = face.mode === 'timeup' || ((face.mode === 'running' || face.mode === 'paused') && face.warning);
      el.hidden = !show;
      const value = !show ? '' : face.mode === 'timeup' ? t('round.timeUp') : timerCopy(face.remaining).hurry;
      if (text.textContent !== value) text.textContent = value;
    },
  };
}

/**
 * The round's counter slot: the counter text, and the cue stacked in the
 * same grid cell, so showing the cue shifts nothing (DS19). The slot is as
 * wide as the wider of the two; "Hurry up · 10" is set while hidden, to
 * reserve its width.
 */
export function counterSlot(counter: HTMLElement): HTMLElement {
  const c = cue();
  const reserve = h('span', { class: 'clockcue clockcue--reserve', 'aria-hidden': 'true' }, clockGlyph('clockcue__glyph'), t('timer.hurry', { seconds: DEFAULT_TIMER.warnSeconds }));
  const slot = h('span', { class: 'topbar__cluster', 'data-cue': 'off' }, counter, c.el, reserve);
  return register(slot, (face) => {
    c.update(face);
    slot.dataset.cue = c.el.hidden ? 'off' : 'on';
  });
}

/** The top bar's line and its timer element: visually hidden, not live, updated every ten seconds (D7). */
export function topBarClock(): HTMLElement {
  const l = line();
  const text = h('span', { class: 'visually-hidden', role: 'timer', 'aria-live': 'off', 'data-test': 'clock-text' });
  const el = h('span', { class: 'topbar__clock' }, l.el, text);
  return register(el, (face) => {
    l.update(face);
    const value = face.mode === 'off' ? '' : face.mode === 'timeup' ? t('round.timeUp') : timerCopy(face.mode === 'idle' ? face.limit : face.remaining).about;
    if (text.textContent !== value) text.textContent = value;
  });
}

/** The line and cue repeated in an overlay's header (dialogs, the tour card, the photo viewer). */
export function clockMirror(): HTMLElement {
  const l = line();
  const c = cue();
  const el = h('span', { class: 'clockmirror', 'data-test': 'clock-mirror' }, c.el, l.el);
  return register(el, (face) => {
    l.update(face);
    c.update(face);
    el.hidden = face.mode === 'off';
  });
}

let region: HTMLElement | null = null;

/** Say something once in the polite live region (the warning and "Time's up"; never every tick). */
export function announce(text: string) {
  if (!region || !region.isConnected) {
    region = h('div', { class: 'visually-hidden', 'aria-live': 'polite', 'data-test': 'announcer' });
    document.body.append(region);
  }
  region.textContent = text;
}
