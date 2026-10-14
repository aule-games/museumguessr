// First-visit tour (DS34). A spotlight on one element of the round screen at
// a time and a card that explains it, with Back, Next and Skip; the last card
// says "Let's start". It is a modal <dialog>: the game behind it is inert,
// Escape or the browser's Back skips it (one history entry, like every
// overlay), and focus returns to where it was. No third-party code.

import { t, type CopyKey } from '../copy.ts';
import { h, reducedMotion } from './dom.ts';
import { pushOverlay } from './overlay.ts';

export interface TourStep {
  /** CSS selector of the element to light up; null centres the card. */
  target: string | null;
  key: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  { target: null, key: 'welcome' },
  { target: '[data-test=photo]', key: 'photo' },
  { target: '.prompt', key: 'questions' },
  { target: '[data-test=map-region]', key: 'map' },
  { target: '[data-test=confirm]', key: 'confirm' },
  { target: '[data-test=total]', key: 'score' },
  { target: '[data-test=menu]', key: 'menu' },
];

export type TourOutcome = 'done' | 'skipped';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Space kept between the card, the lit element and the screen edge. */
export const GAP = 12;
export const SPOT_PAD = 6;

/**
 * Where the card goes: below the lit element if it fits, else above, else
 * beside it, else over it; always fully on screen. No target centres it.
 */
export function placeCard(target: Rect | null, card: { w: number; h: number }, view: { w: number; h: number }): { x: number; y: number } {
  const clampX = (x: number) => Math.min(Math.max(GAP, x), Math.max(GAP, view.w - card.w - GAP));
  const clampY = (y: number) => Math.min(Math.max(GAP, y), Math.max(GAP, view.h - card.h - GAP));
  if (!target) return { x: clampX((view.w - card.w) / 2), y: clampY((view.h - card.h) / 2) };
  const centreX = clampX(target.x + target.w / 2 - card.w / 2);
  const below = target.y + target.h + SPOT_PAD + GAP;
  if (below + card.h + GAP <= view.h) return { x: centreX, y: below };
  const above = target.y - SPOT_PAD - GAP - card.h;
  if (above >= GAP) return { x: centreX, y: above };
  const centreY = clampY(target.y + target.h / 2 - card.h / 2);
  const right = target.x + target.w + SPOT_PAD + GAP;
  if (right + card.w + GAP <= view.w) return { x: right, y: centreY };
  const left = target.x - SPOT_PAD - GAP - card.w;
  if (left >= GAP) return { x: left, y: centreY };
  return { x: centreX, y: clampY(view.h - card.h - GAP) };
}

export interface TourOptions {
  steps?: readonly TourStep[];
  onEnd(outcome: TourOutcome, step: number): void;
}

/** Open the tour over the current screen. Returns a function that closes it as skipped. */
export function startTour(o: TourOptions): () => void {
  const steps = o.steps ?? TOUR_STEPS;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let index = 0;
  let outcome: TourOutcome = 'skipped';
  let ended = false;

  const spot = h('div', { class: 'tour__spot', 'aria-hidden': 'true' });
  const progress = h('p', { class: 'tour__progress', 'data-test': 'tour-progress' });
  const title = h('h2', { class: 'tour__title', id: 'tour-title' });
  const body = h('p', { class: 'tour__body', 'data-test': 'tour-body' });
  const skip = h('button', { type: 'button', class: 'tour__skip', 'data-test': 'tour-skip' }, t('tour.skip'));
  const back = h('button', { type: 'button', class: 'btn btn--secondary', 'data-test': 'tour-back' }, t('tour.back'));
  const next = h('button', { type: 'button', class: 'btn btn--primary', 'data-test': 'tour-next' });
  const card = h(
    'section',
    { class: 'tour__card', 'aria-live': 'polite' },
    progress,
    title,
    body,
    h('div', { class: 'tour__actions' }, skip, h('span', { class: 'tour__nav' }, back, next)),
  );
  const dialog = h('dialog', { class: 'tour', 'aria-labelledby': title.id, 'data-test': 'tour' }, spot, card);
  if (reducedMotion()) dialog.classList.add('tour--still');

  const layout = () => {
    if (!dialog.isConnected) return;
    const step = steps[index];
    const el = step?.target ? document.querySelector<HTMLElement>(step.target) : null;
    const box = el?.getBoundingClientRect();
    const rect = box && box.width > 0 && box.height > 0 ? { x: box.left, y: box.top, w: box.width, h: box.height } : null;
    const view = { w: window.innerWidth, h: window.innerHeight };
    if (rect) {
      spot.hidden = false;
      Object.assign(spot.style, {
        left: `${rect.x - SPOT_PAD}px`,
        top: `${rect.y - SPOT_PAD}px`,
        width: `${rect.w + SPOT_PAD * 2}px`,
        height: `${rect.h + SPOT_PAD * 2}px`,
      });
    } else {
      // nothing to light up: the spot shrinks to the centre and its shade covers the screen
      spot.hidden = false;
      Object.assign(spot.style, { left: `${view.w / 2}px`, top: `${view.h / 2}px`, width: '0px', height: '0px' });
    }
    const pos = placeCard(rect, { w: card.offsetWidth, h: card.offsetHeight }, view);
    card.style.left = `${pos.x}px`;
    card.style.top = `${pos.y}px`;
  };

  const render = () => {
    const step = steps[index];
    if (!step) return;
    const last = index === steps.length - 1;
    progress.textContent = t('tour.progress', { n: index + 1, total: steps.length });
    title.textContent = t(`tour.${step.key}.title` as CopyKey);
    body.textContent = t(`tour.${step.key}.body` as CopyKey);
    back.hidden = index === 0;
    next.textContent = last ? t('tour.start') : t('tour.next');
    dialog.dataset.step = step.key;
    layout();
    next.focus({ preventScroll: true });
  };

  const requestClose = pushOverlay(() => {
    window.removeEventListener('resize', layout);
    dialog.close();
    dialog.remove();
    opener?.focus({ preventScroll: true });
    if (!ended) {
      ended = true;
      o.onEnd(outcome, index + 1);
    }
  });

  next.addEventListener('click', () => {
    if (index === steps.length - 1) {
      outcome = 'done';
      requestClose();
      return;
    }
    index += 1;
    render();
  });
  back.addEventListener('click', () => {
    if (index === 0) return;
    index -= 1;
    render();
  });
  skip.addEventListener('click', requestClose);
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    requestClose();
  });
  window.addEventListener('resize', layout);

  document.body.append(dialog);
  dialog.showModal();
  render();
  return requestClose;
}
