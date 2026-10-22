// Round screen (DS1, DS16, DS19, DS20, DS23, DS35, DS36, E1, A1). Fixed rows: top bar,
// photo, prompt row, map or year control, Back (after the first question) and Confirm.

import { STEPS, type Step } from '../../analytics/events.ts';
import { HINT, QUESTION, formatNumber, t } from '../../copy.ts';
import { imageUrl } from '../../content/items.ts';
import tokens from '../../design/tokens.json';
import { formatAnswerYear } from '../../game/text.ts';
import type { Draft } from '../../game/timer.ts';
import type { GameMap } from '../../map/map.ts';
import type { LatLng } from '../../scoring/geo.ts';
import type { Item } from '../../types/item.ts';
import { difficultyLabel } from '../difficulty.ts';
import { counterSlot, topBarClock } from '../clock.ts';
import { h, s } from '../dom.ts';
import { openLightbox } from '../lightbox.ts';
import { yearControl } from '../year.ts';

export const MAX_IMAGE_RETRIES = 3;

export function topBar(round: number, total: number, onMenu: (opener: HTMLElement) => void, item?: { difficulty: number }): HTMLElement {
  const label = item ? difficultyLabel(item) : null;
  const pips = label?.querySelector<HTMLElement>('.difficulty__pips') ?? null;
  pips?.remove();
  return h(
    'header',
    { class: 'topbar' },
    // the counter's slot holds "Round 4/10 · Hard" and the last-ten-seconds cue that replaces it;
    // the pips stay beside it (D3)
    counterSlot(h('span', { class: 'topbar__counter' }, h('span', { class: 'topbar__round' }, t('round.counter', { round: round + 1 })), label)),
    pips,
    h('span', { class: 'topbar__total', 'data-test': 'total' }, t('round.total', { total: formatNumber(total) })),
    h(
      'button',
      { type: 'button', class: 'topbar__menu', 'aria-label': t('menu.open'), 'aria-haspopup': 'dialog', 'data-test': 'menu', onclick: (e: MouseEvent) => onMenu(e.currentTarget as HTMLElement) },
      h('span', { class: 'topbar__menu-icon', 'aria-hidden': 'true' }),
    ),
    // the draining line on the bar's bottom edge and the timer's hidden text (R2, D7)
    topBarClock(),
  );
}

/** The photo region persists across the three steps of a round (one load per round). */
export class PhotoRegion {
  readonly element: HTMLElement;
  readonly img: HTMLImageElement;
  ready = false;
  private retries = 0;
  private status: HTMLElement;
  private listeners = new Set<() => void>();

  constructor(
    readonly item: Item,
    private onSkip: () => void,
  ) {
    this.img = h('img', { class: 'photo__img', alt: item.alt_neutral, decoding: 'async', draggable: 'false' });
    this.status = h('div', { class: 'photo__status', role: 'status' }, t('photo.loading'));
    const open = h(
      'button',
      { type: 'button', class: 'photo__open', 'aria-label': t('photo.open'), onclick: (e: MouseEvent) => void openLightbox(this.img, e.currentTarget as HTMLElement, item.caption) },
      this.img,
      // A small enlarge icon in the photo's corner; the whole photo is the button (DS37).
      h(
        'span',
        { class: 'photo__hint', 'aria-hidden': 'true' },
        s('svg', { viewBox: '0 0 24 24', class: 'photo__hint-icon' }, s('path', { d: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7' })),
      ),
    );
    // A short neutral subject line (DS37): what the object is, never its title, place or date (A1).
    // Read by screen readers here; shown under the enlarged photo.
    const caption = h('figcaption', { class: 'photo__caption', 'data-test': 'photo-caption' }, item.caption);
    this.element = h('figure', { class: 'photo round__photo', 'data-state': 'loading', 'data-test': 'photo' }, open, caption, this.status);
    this.img.addEventListener('load', () => this.loaded());
    this.img.addEventListener('error', () => this.failed());
    this.img.src = imageUrl(item.id);
  }

  onChange(cb: () => void) {
    this.listeners.add(cb);
  }

  /** The photo failed to load (and has not been retried successfully yet). */
  get isFailed(): boolean {
    return this.element.dataset.state === 'failed';
  }

  private set(state: string) {
    this.element.dataset.state = state;
    for (const cb of this.listeners) cb();
  }

  private loaded() {
    this.ready = true;
    this.status.replaceChildren();
    this.set('ready');
  }

  private failed() {
    this.ready = false;
    const retry = h('button', { type: 'button', class: 'btn btn--secondary', 'data-test': 'retry-image', onclick: () => this.retry() }, t('photo.retry'));
    const children: Node[] = [h('p', {}, t('photo.failed')), retry];
    if (this.retries >= MAX_IMAGE_RETRIES) {
      children.push(
        h('button', { type: 'button', class: 'btn btn--secondary', 'data-test': 'skip', onclick: this.onSkip }, t('photo.skip')),
        h('p', { class: 'photo__note' }, t('photo.skipNote')),
      );
    }
    this.status.replaceChildren(...children);
    this.set('failed');
  }

  private retry() {
    this.retries += 1;
    this.status.replaceChildren(t('photo.loading'));
    this.set('loading');
    this.img.src = `${imageUrl(this.item.id)}?retry=${this.retries}`;
  }
}

export interface RoundProps {
  item: Item;
  round: number;
  step: Step;
  total: number;
  /** This step's draft (a saved edit) or else its earlier answer (DS36); it starts as the draft. */
  answer: LatLng | number | null;
  /** When an edit of a confirmed year is empty or invalid: that confirmed year, used if time runs out (D8). */
  previous?: number | null;
  /** The confirmed Made pin, shown dimmed on the Kept step. */
  madePin: LatLng | null;
  photo: PhotoRegion;
  map: GameMap | null;
  webgl: boolean;
  onConfirm(value: LatLng | number): void;
  /** Reopen the previous question of this round; absent on the first question. */
  onBack?(): void;
  onMenu(opener: HTMLElement): void;
  /** Every edit of this question, including an empty or invalid one (null), so it can be saved (ENG7). */
  onDraft?(value: Draft): void;
}

export interface RoundView {
  element: HTMLElement;
  prompt: HTMLElement;
  /** Called by the app when the map places a pin. */
  pinPlaced(p: LatLng, label: string): void;
  refresh(): void;
  /** Time is up (D2): cancel a pin drag, blur the year field and dim the answer controls; nothing answers any more. */
  freeze(): void;
}

export function roundScreen(p: RoundProps): RoundView {
  let draft: LatLng | number | null = p.answer;

  const dots = h(
    'ol',
    { class: 'steps', 'aria-label': STEPS.map((s) => t(`step.${s}`)).join(', ') },
    ...STEPS.map((s) => {
      const i = STEPS.indexOf(s);
      const cur = STEPS.indexOf(p.step);
      const state = i < cur ? 'done' : i === cur ? 'active' : 'todo';
      return h('li', { class: `steps__dot steps__dot--${state}`, 'aria-current': state === 'active' ? 'step' : null }, t(`step.${s}`));
    }),
  );
  const question = h('h2', { class: 'prompt__question', tabindex: -1, 'data-test': 'question' }, t(QUESTION[p.step]));
  // The step's rule, always shown under the question: one short sentence, no toggle.
  const hint = h('p', { class: 'prompt__hint', 'data-test': 'hint' }, t(HINT[p.step]));
  // the question leads the row; the step dots sit at its end
  const prompt = h('div', { class: 'prompt' }, h('div', { class: 'prompt__text' }, question, hint), dots);

  const confirm = h('button', { type: 'button', class: 'btn btn--primary btn--wide', 'data-test': 'confirm', disabled: true }, t(p.step === 'kept' ? 'confirm.last' : 'confirm'));
  let submitted = false;
  confirm.addEventListener('click', () => {
    if (submitted || draft == null || confirm.disabled) return;
    submitted = true; // a double tap records one answer (R2); the reducer is idempotent too
    p.onConfirm(draft);
  });

  const back = p.onBack
    ? h('button', { type: 'button', class: 'btn btn--secondary', 'data-test': 'back', onclick: () => {
        if (submitted) return;
        submitted = true;
        p.onBack?.();
      } }, t('back'))
    : null;

  // "The clock is paused until the map works" on the map's failed state (D4)
  const pausedNote = h('p', { class: 'answer__paused', 'data-test': 'clock-paused-map', hidden: true }, t('timer.pausedMap'));
  const refresh = () => {
    const mapOk = p.step === 'when' || (p.map != null && (p.map.state === 'ready' || p.map.state === 'fallback'));
    confirm.disabled = submitted || draft == null || !p.photo.ready || !mapOk;
    pausedNote.hidden = p.step === 'when' || p.map?.state !== 'failed';
  };
  p.photo.onChange(refresh);

  let answer: HTMLElement;
  if (p.step === 'when') {
    // While an edit is empty or invalid, the last confirmed year is what counts at time-up (D8).
    const previous = h('p', { class: 'answer__previous', 'data-test': 'previous-answer', hidden: true });
    const showPrevious = (y: number | null) => {
      previous.hidden = y != null || p.previous == null;
      previous.textContent = previous.hidden || p.previous == null ? '' : t('timer.previousAnswer', { answer: formatAnswerYear(p.previous) });
    };
    const year = yearControl(typeof p.answer === 'number' ? p.answer : null, (y) => {
      draft = y;
      showPrevious(y);
      p.onDraft?.(y);
      refresh();
    });
    showPrevious(typeof p.answer === 'number' ? p.answer : null);
    answer = h('div', { class: 'answer answer--year' }, year.element, previous);
  } else {
    answer = h('div', { class: 'answer answer--map', 'data-test': 'map-region' }, pausedNote);
    if (!p.webgl) answer.append(h('p', { class: 'map__nowebgl', role: 'alert' }, t('start.noWebgl')));
  }

  const element = h(
    'main',
    { class: `screen round round--${p.step}`, 'data-screen': 'round', 'data-step': p.step, 'data-round': p.round + 1 },
    topBar(p.round, p.total, p.onMenu, p.item),
    h('div', { class: 'round__body' }, p.photo.element, prompt, answer),
    h('div', { class: 'round__footer' }, h('div', { class: `actionbar${back ? ' actionbar--back' : ''}` }, back, confirm)),
  );

  // Use the rendered reading size, not a test flag. The two wrappers are
  // display:contents at normal size, preserving the existing gallery grid.
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (!element.isConnected) {
        observer.disconnect();
        return;
      }
      element.classList.toggle('round--reflow', parseFloat(getComputedStyle(element).fontSize) > parseFloat(tokens.text.md));
    });
    observer.observe(question);
    observer.observe(hint);
  }

  if (p.map && p.step !== 'when') {
    p.map.attach(answer);
    const pin = p.answer != null && typeof p.answer === 'object' ? p.answer : null;
    p.map.guess({ step: p.step, pin, dimmed: p.step === 'kept' && p.madePin ? { step: 'made', at: p.madePin } : null });
  }

  refresh(); // an answer reopened with Back is already a valid draft (DS36)

  return {
    element,
    prompt: question,
    pinPlaced(pt) {
      if (submitted) return;
      draft = pt;
      p.onDraft?.(pt);
      refresh();
    },
    refresh,
    freeze() {
      submitted = true;
      p.map?.cancelDrag();
      if (document.activeElement instanceof HTMLElement && element.contains(document.activeElement)) document.activeElement.blur();
      element.classList.add('round--timeup');
      for (const part of element.querySelectorAll<HTMLElement>('.answer, .actionbar')) part.inert = true;
      refresh();
    },
  };
}
