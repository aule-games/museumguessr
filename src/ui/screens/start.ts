// Start screen (DS9, DS24, PH11, ENG1, ENG21, V1-17, V1-18, V1-23). Order:
// headline, sample photo with its made→kept mini map, Start (or Continue +
// New game, or the returning visitor's options), the one-line expectation,
// the privacy line. A challenge link uses the same layout: its line is the
// h1, in the body face; a broken link and the reply result do too.

import { formatNumber, t } from '../../copy.ts';
import { imageUrl } from '../../content/items.ts';
import { pinElement } from '../../map/map.ts';
import worldSvg from '../../assets/maps/world.svg?raw';
import type { LatLng } from '../../scoring/geo.ts';
import type { Item } from '../../types/item.ts';
import { h, s } from '../dom.ts';

export type StartMode =
  | { kind: 'new' }
  | { kind: 'continue'; round: number; challenge: boolean }
  | { kind: 'finished'; total: number; canReview: boolean }
  /** `line` is null while the friend's name is being checked. */
  | { kind: 'challenge'; line: string | null; meta: string; notes: string[]; unfinished: boolean }
  | { kind: 'broken' }
  | { kind: 'reply'; line: string };

export interface StartProps {
  sample: Item;
  mode: StartMode;
  /** Start stays "Loading…" until the round-1 image is ready (max 4 s). */
  ready: boolean;
  webgl: boolean;
  /** "You have seen N of M objects", or null. */
  collection: string | null;
  /** The live pool size, for the one-line expectation. */
  poolSize: number;
  onStart(): void;
  onContinue(): void;
  onNew(): void;
  onReview(): void;
  /** Play the challenge deck ("Play the same 10", "Play the challenge"). */
  onChallenge(opener: HTMLElement): void;
  /** The reply result's "Replay these 10 (not ranked)". */
  onReplay(): void;
  onAbout(opener: HTMLElement): void;
}

const W = 320;
const H = 160;
const project = (p: LatLng) => ({ x: ((p.lng + 180) / 360) * W, y: ((90 - p.lat) / 180) * H });

/** Static Natural Earth land, with the short journey centred even across ±180°. */
export function miniMap(made: LatLng, kept: LatLng, label: string): SVGSVGElement {
  const a = project(made);
  const projectedKept = project(kept);
  // Choose the nearest world copy before centring. No long line across the
  // opposite hemisphere and no cut-off endpoint at the antimeridian.
  const dx = ((projectedKept.x - a.x + W * 1.5) % W) - W / 2;
  const b = { x: a.x + dx, y: projectedKept.y };
  const offset = W / 2 - (a.x + b.x) / 2;
  const mx = (a.x + b.x) / 2;
  const my = Math.max(0, Math.min(a.y, b.y) - Math.abs(dx) * 0.25);
  const world = new DOMParser().parseFromString(worldSvg, 'image/svg+xml').querySelector('path')!;
  const glyph = (kind: 'made' | 'kept', point: { x: number; y: number }) => {
    const shape = pinElement(kind, '').querySelector('svg')!;
    shape.setAttribute('x', String(point.x + offset - 8));
    shape.setAttribute('y', String(point.y - 18.5));
    shape.setAttribute('width', '16');
    shape.setAttribute('height', '20');
    shape.setAttribute('class', `minimap__${kind}`);
    return shape;
  };
  return s(
    'svg',
    { class: 'minimap', viewBox: `0 -20 ${W} ${H + 24}`, role: 'img', 'aria-label': label },
    s('rect', { class: 'minimap__sea', x: 0, y: -20, width: W, height: H + 24 }),
    ...[-60, -30, 0, 30, 60].map((lat) =>
      s('line', { class: 'minimap__grid', x1: 0, x2: W, y1: ((90 - lat) / 180) * H, y2: ((90 - lat) / 180) * H }),
    ),
    ...[-W, 0, W].map((shift) => s('g', { class: 'minimap__land', transform: `translate(${offset + shift} 0)` }, document.importNode(world, true))),
    s('path', { class: 'minimap__line', d: `M${a.x + offset},${a.y} Q${mx + offset},${my} ${b.x + offset},${b.y}` }),
    glyph('made', a),
    glyph('kept', b),
  );
}

/** The logo: the museum pin on an accent tile, then the name with its second half in the accent. */
export function wordmark(): HTMLElement {
  const pin = pinElement('kept', '');
  pin.removeAttribute('role');
  pin.removeAttribute('aria-label');
  pin.classList.add('wordmark__glyph');
  const name = t('app.name');
  const split = name.indexOf('Guessr');
  return h('p', { class: 'wordmark' },
    h('span', { class: 'wordmark__mark', 'aria-hidden': 'true' }, pin),
    h('span', { class: 'wordmark__name' }, split > 0 ? name.slice(0, split) : name, split > 0 ? h('span', { class: 'wordmark__accent' }, name.slice(split)) : null),
  );
}

export function startScreen(p: StartProps): HTMLElement {
  const sample = p.sample;
  const caption = t('start.sampleCaption', { made: sample.made.place, kept: `${sample.kept.museum}, ${sample.kept.city}` });

  const actions = h('div', { class: 'start__actions' });
  const primary = (label: string, test: string, onclick: (e: MouseEvent) => void) =>
    h('button', { type: 'button', class: 'btn btn--primary', 'data-test': test, disabled: !p.ready, 'aria-busy': String(!p.ready), onclick }, p.ready ? label : t('start.loading'));
  const secondary = (label: string, test: string, onclick: () => void) => h('button', { type: 'button', class: 'btn btn--secondary', 'data-test': test, onclick }, label);
  const mode = p.mode;
  if (!p.webgl) {
    actions.append(h('p', { class: 'start__nowebgl', role: 'alert' }, t('start.noWebgl')));
  } else if (mode.kind === 'continue') {
    actions.append(
      h('button', { type: 'button', class: 'btn btn--primary', 'data-test': 'continue', onclick: p.onContinue }, t(mode.challenge ? 'start.continueChallenge' : 'start.continue', { round: mode.round })),
      secondary(t('start.new'), 'new-game', p.onNew),
    );
  } else if (mode.kind === 'finished') {
    actions.append(h('p', { class: 'start__finished' }, t('start.finished', { total: formatNumber(mode.total) })));
    actions.append(primary(t('start.another'), 'play-another', p.onStart));
    if (mode.canReview) actions.append(secondary(t('start.review'), 'review', p.onReview));
  } else if (mode.kind === 'challenge') {
    const onPlay = (e: MouseEvent) => p.onChallenge(e.currentTarget as HTMLElement);
    actions.append(primary(t(mode.unfinished ? 'challenge.playChallenge' : 'challenge.play'), 'play-challenge', onPlay));
    if (mode.unfinished) actions.append(secondary(t('challenge.continueMine'), 'continue-mine', p.onContinue));
  } else if (mode.kind === 'broken') {
    actions.append(primary(t('challenge.brokenPlay'), 'start', p.onStart));
  } else if (mode.kind === 'reply') {
    actions.append(primary(t('start.another'), 'play-another', p.onStart), secondary(t('reply.replay'), 'replay-reply', p.onReplay));
  } else {
    actions.append(primary(t('start.start'), 'start', p.onStart));
  }

  const about = h('button', { type: 'button', class: 'link', onclick: (e: MouseEvent) => p.onAbout(e.currentTarget as HTMLElement) }, t('start.privacyLink'));
  const img = h('img', {
    class: 'start__photo',
    src: imageUrl(sample.id),
    alt: sample.title,
    decoding: 'async',
    fetchpriority: 'high',
  });
  img.addEventListener('error', () => img.classList.add('is-broken'));

  // A challenge, broken link or reply result puts its own line in the h1 (V1-17).
  const own = mode.kind === 'challenge' ? mode.line ?? '' : mode.kind === 'broken' ? t('challenge.broken') : mode.kind === 'reply' ? mode.line : null;
  let intro: HTMLElement;
  if (own === null) {
    const lines = t('app.tagline').split(/(?<=\.)\s+/);
    const headline = h('h1', { class: 'start__headline' });
    lines.forEach((line, i) => headline.append(i > 0 ? ' ' : '', h('span', { class: 'start__line' }, line)));
    intro = h('div', { class: 'start__intro' }, h('p', { class: 'eyebrow' }, t('start.eyebrow')), headline);
  } else {
    const notes = mode.kind === 'challenge' ? mode.notes : [];
    intro = h(
      'div',
      { class: 'start__intro start__intro--challenge' },
      h('p', { class: 'eyebrow' }, t('app.tagline')),
      h('h1', { class: 'start__challenge', tabindex: -1, 'data-test': 'challenge-line', 'aria-busy': String(mode.kind === 'challenge' && mode.line === null) }, h('bdi', {}, own)),
      ...notes.map((n) => h('p', { class: 'start__note', 'data-test': 'challenge-note' }, n)),
    );
  }
  const meta = mode.kind === 'challenge' ? mode.meta : t('start.meta', { total: formatNumber(p.poolSize) });

  return h(
    'main',
    { class: 'screen start', 'data-screen': 'start' },
    h('header', { class: 'brandbar' }, wordmark()),
    intro,
    h(
      'figure',
      { class: 'start__sample' },
      h(
        'div',
        { class: 'start__card' },
        h('div', { class: 'start__photo-wrap' }, img, h('span', { class: 'tag' }, t('start.example'))),
        miniMap(sample.made, sample.kept, caption),
      ),
      h(
        'figcaption',
        { class: 'start__caption' },
        h('strong', {}, sample.title),
        ' ',
        caption,
        h('span', { class: 'start__credit' }, t('reveal.credit', { author: sample.photo.author, licence: sample.photo.licence })),
      ),
    ),
    actions,
    p.collection ? h('p', { class: 'start__collection', 'data-test': 'collection' }, p.collection) : null,
    h('p', { class: 'start__meta' }, meta),
    h('footer', { class: 'start__privacy' }, t('start.privacy'), ' ', about),
  );
}
