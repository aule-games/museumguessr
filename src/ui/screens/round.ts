// Round screen (DS1, DS16, DS19, DS20, DS23, E1, A1). Fixed rows: top bar,
// prompt row, photo, map or year control, one Confirm in the action bar.

import { STEPS, type Step } from '../../analytics/events.ts';
import { HINT, QUESTION, formatNumber, t } from '../../copy.ts';
import { imageUrl } from '../../content/items.ts';
import type { GameMap } from '../../map/map.ts';
import type { LatLng } from '../../scoring/geo.ts';
import type { Item } from '../../types/item.ts';
import { h } from '../dom.ts';
import { openLightbox } from '../lightbox.ts';
import { yearControl } from '../year.ts';

export const MAX_IMAGE_RETRIES = 3;

export function topBar(round: number, total: number, onMenu: (opener: HTMLElement) => void): HTMLElement {
  return h(
    'header',
    { class: 'topbar' },
    h('span', { class: 'topbar__round' }, t('round.counter', { round: round + 1 })),
    h('span', { class: 'topbar__total', 'data-test': 'total' }, t('round.total', { total: formatNumber(total) })),
    h(
      'button',
      { type: 'button', class: 'topbar__menu', 'aria-label': t('menu.open'), 'aria-haspopup': 'dialog', 'data-test': 'menu', onclick: (e: MouseEvent) => onMenu(e.currentTarget as HTMLElement) },
      h('span', { class: 'topbar__menu-icon', 'aria-hidden': 'true' }),
    ),
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
      { type: 'button', class: 'photo__open', 'aria-label': t('photo.open'), onclick: (e: MouseEvent) => void openLightbox(this.img, e.currentTarget as HTMLElement) },
      this.img,
      h('span', { class: 'photo__hint', 'aria-hidden': 'true' }, t('photo.view'), ' ↗'),
    );
    this.element = h('figure', { class: 'photo', 'data-state': 'loading', 'data-test': 'photo' }, open, this.status);
    this.img.addEventListener('load', () => this.loaded());
    this.img.addEventListener('error', () => this.failed());
    this.img.src = imageUrl(item.id);
  }

  onChange(cb: () => void) {
    this.listeners.add(cb);
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
  /** The confirmed Kept pin, shown dimmed on the Made step. */
  keptPin: LatLng | null;
  showHint: boolean;
  photo: PhotoRegion;
  map: GameMap | null;
  webgl: boolean;
  onConfirm(value: LatLng | number): void;
  onMenu(opener: HTMLElement): void;
}

export interface RoundView {
  element: HTMLElement;
  prompt: HTMLElement;
  /** Called by the app when the map places a pin. */
  pinPlaced(p: LatLng, label: string): void;
  refresh(): void;
}

export function roundScreen(p: RoundProps): RoundView {
  let draft: LatLng | number | null = null;
  let hintOpen = p.showHint;

  const dots = h(
    'ol',
    { class: 'steps', 'aria-label': `${t('step.kept')}, ${t('step.made')}, ${t('step.when')}` },
    ...STEPS.map((s) => {
      const i = STEPS.indexOf(s);
      const cur = STEPS.indexOf(p.step);
      const state = i < cur ? 'done' : i === cur ? 'active' : 'todo';
      return h('li', { class: `steps__dot steps__dot--${state}`, 'aria-current': state === 'active' ? 'step' : null }, t(`step.${s}`));
    }),
  );
  const question = h('h2', { class: 'prompt__question', tabindex: -1, 'data-test': 'question' }, t(QUESTION[p.step]));
  const hint = h('p', { class: 'prompt__hint', 'data-test': 'hint', hidden: !hintOpen }, t(HINT[p.step]));
  const hintBtn = h(
    'button',
    { type: 'button', class: 'prompt__help', 'aria-label': t('hint.show'), 'aria-expanded': String(hintOpen), onclick: () => toggleHint() },
    '?',
  );
  const toggleHint = () => {
    hintOpen = !hintOpen;
    hint.hidden = !hintOpen;
    hintBtn.setAttribute('aria-expanded', String(hintOpen));
  };
  const prompt = h('div', { class: 'prompt' }, dots, h('div', { class: 'prompt__text' }, question, hint), hintBtn);

  const confirm = h('button', { type: 'button', class: 'btn btn--primary btn--wide', 'data-test': 'confirm', disabled: true }, t('confirm'));
  let submitted = false;
  confirm.addEventListener('click', () => {
    if (submitted || draft == null || confirm.disabled) return;
    submitted = true; // a double tap records one answer (R2); the reducer is idempotent too
    p.onConfirm(draft);
  });

  const refresh = () => {
    const mapOk = p.step === 'when' || (p.map != null && (p.map.state === 'ready' || p.map.state === 'fallback'));
    confirm.disabled = submitted || draft == null || !p.photo.ready || !mapOk;
  };
  p.photo.onChange(refresh);

  let answer: HTMLElement;
  if (p.step === 'when') {
    const year = yearControl(null, (y) => {
      draft = y;
      refresh();
    });
    answer = h('div', { class: 'answer answer--year' }, year.element);
  } else {
    answer = h('div', { class: 'answer answer--map', 'data-test': 'map-region' });
    if (!p.webgl) answer.append(h('p', { class: 'map__nowebgl', role: 'alert' }, t('start.noWebgl')));
  }

  const element = h(
    'main',
    { class: `screen round round--${p.step}`, 'data-screen': 'round', 'data-step': p.step, 'data-round': p.round + 1 },
    topBar(p.round, p.total, p.onMenu),
    prompt,
    h('div', { class: 'round__photo' }, p.photo.element),
    answer,
    h('div', { class: 'actionbar' }, confirm),
  );

  if (p.map && p.step !== 'when') {
    p.map.attach(answer);
    p.map.guess({ step: p.step, pin: null, dimmed: p.step === 'made' ? p.keptPin : null });
  }

  return {
    element,
    prompt: question,
    pinPlaced(pt) {
      draft = pt;
      refresh();
    },
    refresh,
  };
}
