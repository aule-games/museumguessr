// Reveal (DS3, DS12, DS17, DS21, DS22, DS31, PV1, V2). Above the fold on a
// phone: compact wall-label header, then the score table, then the map and
// journey fact (one row per question: result, then points in their own column; the
// round total last; hover, focus or tap shows how the points were computed),
// the contested note, facts, the credit line and a sticky Next.

import { FEEDBACK, type Step } from '../../analytics/events.ts';
import { formatNumber, t, type CopyKey } from '../../copy.ts';
import { howText, rowResult } from '../../game/text.ts';
import type { GameMap } from '../../map/map.ts';
import { MAX_POINTS } from '../../scoring/config.ts';
import { madeFullMarksKm } from '../../scoring/score.ts';
import { formatRange, formatYear } from '../../scoring/years.ts';
import type { RoundAnswers, RoundResult } from '../../state/schema.ts';
import type { Item } from '../../types/item.ts';
import { ext, h, reducedMotion, s, scoreText } from '../dom.ts';
import { topBar } from './round.ts';

export interface RevealProps {
  item: Item;
  round: number;
  total: number;
  isLast: boolean;
  answers: RoundAnswers;
  result: RoundResult;
  map: GameMap | null;
  /** Show the optional difficulty row (after round 3, once per game). */
  pulse: boolean;
  /** During a challenge game, the friend's score, shown under the round total (V1-21). */
  toBeat?: number | null;
  onPulse(a: string): void;
  onNext(): void;
  onMenu(opener: HTMLElement): void;
}

/** "Made in <place>, <date> → Now in <museum>, <city>" or the same-area line (PV1). */
export function wallLabel(item: Item): string {
  const date = formatRange(item.when.start, item.when.end);
  if (!item.moved) return `${t('reveal.sameArea', { place: item.made.place })} · ${date}`;
  return t('reveal.madeKept', { made: item.made.place, date, museum: item.kept.museum, city: item.kept.city });
}

function timeline(item: Item, guess: number | null): SVGSVGElement {
  // a local window around the range so the band is visible
  const span = Math.max(50, (item.when.end - item.when.start) * 3, guess != null ? Math.abs(guess - item.when.start) * 1.3 : 0);
  const mid = (item.when.start + item.when.end) / 2;
  const lo = mid - span;
  const hi = mid + span;
  const x = (y: number) => 8 + ((y - lo) / (hi - lo)) * 284;
  return s(
    'svg',
    { class: 'timeline', viewBox: '0 0 300 36', role: 'img', 'aria-label': `${formatRange(item.when.start, item.when.end)}${guess != null ? `, ${formatYear(guess)}` : ''}` },
    s('line', { class: 'timeline__axis', x1: 8, x2: 292, y1: 18, y2: 18 }),
    s('rect', { class: 'timeline__band', x: x(item.when.start) - 2, y: 10, width: Math.max(4, x(item.when.end) - x(item.when.start) + 4), height: 16, rx: 3 }),
    guess != null && s('circle', { class: 'timeline__guess', cx: Math.min(292, Math.max(8, x(guess))), cy: 18, r: 5 }),
  );
}

/** The When row's details: the museum's own date caveat, if any, then the timeline. */
function whenExtra(item: Item, guess: number | null): Node {
  const line = timeline(item, guess);
  return item.when.note ? h('div', { class: 'score__extra' }, h('p', { class: 'score__note' }, item.when.note), line) : line;
}

let rowIds = 0;

/** The result line with the difference in bold, so it reads at a glance (DS12). */
function resultLine({ text, value }: { text: string; value: string | null }): HTMLElement {
  const at = value ? text.indexOf(value) : -1;
  const line = !value || at < 0
    ? h('span', { class: 'score__result' }, text)
    : h('span', { class: 'score__result' }, text.slice(0, at), h('strong', { class: 'score__value' }, value), text.slice(at + value.length));
  fitOneLine(line);
  return line;
}

export const MIN_RESULT_PX = 11;

/** Keep a result on one line: step its font down (not below MIN_RESULT_PX) until it
 *  fits; only if it still does not fit may it wrap, so nothing is ever cut off. */
function fitOneLine(el: HTMLElement) {
  if (typeof ResizeObserver === 'undefined') return;
  const fit = () => {
    el.style.removeProperty('font-size');
    el.style.removeProperty('white-space');
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth + 1 && size > MIN_RESULT_PX) {
      size = Math.max(MIN_RESULT_PX, size - 0.5);
      el.style.fontSize = `${size}px`;
    }
    if (el.scrollWidth > el.clientWidth + 1) el.style.whiteSpace = 'normal';
  };
  new ResizeObserver(fit).observe(el);
}

function scoreRow(step: Step, points: number, result: { text: string; value: string | null }, how: string, extra?: Node | null): HTMLElement {
  const full = points === MAX_POINTS;
  const howId = `how-${step}-${++rowIds}`;
  // the explanation takes the result line's place on hover, keyboard focus or tap,
  // so the row explains itself and the table grows no extra strip
  const howLine = h('span', { class: 'score__how', id: howId }, how);
  // a tap also opens the row's extras (When's timeline, a place or date note)
  const detail = extra ? h('div', { class: 'score__detail', hidden: true }, extra) : null;
  const btn = h(
    'button',
    { type: 'button', class: 'score__row', 'aria-expanded': 'false', 'aria-describedby': howId, 'data-test': `row-${step}`, 'data-full': String(full) },
    h('span', { class: 'score__label' }, t(`reveal.row.${step}` as CopyKey)),
    resultLine(result),
    howLine,
    h('span', { class: 'score__points', 'data-test': `points-${step}` }, formatNumber(points)),
  );
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    if (detail) detail.hidden = !open;
  });
  return h('li', { class: `score score--${step}${full ? ' score--spot-on' : ''}` }, btn, detail);
}

export interface RevealView {
  element: HTMLElement;
  next: HTMLButtonElement;
  score: HTMLElement;
}

export function revealScreen(p: RevealProps): RevealView {
  const { item, result: r } = p;
  const journey = item.journey_fact;
  const madeNote = item.made.note && !r.skipped ? h('p', { class: 'score__note' }, item.made.note) : null;

  const score = h('p', { class: 'reveal__score', 'aria-live': 'polite', tabindex: -1, 'data-test': 'round-score' }, ...scoreText(t('reveal.score', { points: formatNumber(r.points) })));
  const rows = h(
    'ul',
    { class: 'scores', 'data-test': 'scores' },
    // rows follow the question order (DS35)
    scoreRow('made', r.made.points, rowResult('made', item, r), howText('made', item, r), madeNote),
    scoreRow('when', r.when.points, rowResult('when', item, r), howText('when', item, r), whenExtra(item, p.answers.when)),
    scoreRow('kept', r.kept.points, rowResult('kept', item, r), howText('kept', item, r)),
    h('li', { class: 'scores__total reveal__total' }, h('span', { class: 'scores__total-label' }, t('reveal.scoreLabel')), score),
  );

  const mapHost = h('div', { class: 'reveal__map', 'data-test': 'reveal-map' });
  const legend = h('p', { class: 'reveal__legend' }, t('reveal.legend'));

  const next = h(
    'button',
    { type: 'button', class: 'btn btn--primary btn--wide', 'data-test': 'next', onclick: p.onNext },
    p.isLast ? t('reveal.results') : t('reveal.next'),
  );

  let pulseRow: HTMLElement | null = null;
  if (p.pulse) {
    const thanks = h('span', { class: 'pulse__thanks', 'aria-live': 'polite' });
    const choices = FEEDBACK.difficulty.map((a) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'data-test': `pulse-${a}`,
          onclick: () => {
            p.onPulse(a);
            choices.forEach((c) => c.remove());
            thanks.textContent = t('pulse.thanks');
          },
        },
        t(`pulse.${a}` as CopyKey),
      ),
    );
    pulseRow = h('div', { class: 'pulse', role: 'group', 'aria-label': t('pulse.difficulty'), 'data-test': 'pulse' }, h('span', { class: 'pulse__q' }, t('pulse.difficulty')), ...choices, thanks);
  }

  const credit = h(
    'p',
    { class: 'reveal__credit' },
    t('reveal.credit', { author: item.photo.author, licence: item.photo.licence }),
    ' · ',
    ext(item.photo.source_url, t('reveal.creditSource')),
    ' · ',
    ext(item.record_url, t('reveal.record')),
  );

  const element = h(
    'main',
    { class: 'screen reveal', 'data-screen': 'reveal', 'data-round': p.round + 1 },
    topBar(p.round, p.total, p.onMenu),
    h(
      'div',
      { class: 'reveal__scroll' },
      h(
        'header',
        { class: 'label' },
        h('h2', { class: 'label__title', 'data-test': 'reveal-title' }, item.title),
        h('p', { class: 'label__line' }, wallLabel(item)),
      ),
      rows,
      p.toBeat != null ? h('p', { class: 'reveal__tobeat', 'data-test': 'to-beat' }, t('reveal.toBeat', { score: formatNumber(p.toBeat) })) : null,
      h('div', { class: 'reveal__media' }, mapHost, legend),
      journey && h('p', { class: 'reveal__journey', 'data-test': 'journey' }, journey.text, ' ', ext(journey.source_url, t('reveal.source'))),
      item.contested && item.claimant_source
        ? h('p', { class: 'reveal__contested' }, t('reveal.contested', { text: item.claimant_source.text }), ' ', ext(item.claimant_source.source_url, t('reveal.source')))
        : null,
      h('ul', { class: 'reveal__facts' }, ...item.facts.map((f) => h('li', {}, f.text, ' ', ext(f.source_url, t('reveal.source'))))),
      credit,
    ),
    h('div', { class: 'actionbar actionbar--reveal' }, pulseRow, next),
  );

  if (p.map) {
    p.map.attach(mapHost);
    const area = item.made.precision === 'city' ? null : { km: madeFullMarksKm(item.made.precision, item.made.full_marks_km), label: item.made.place };
    p.map.reveal({
      kept: item.kept,
      made: item.made,
      keptLabel: item.kept.city,
      madeLabel: item.made.precision === 'city' ? item.made.place : t('reveal.madeRegion', { place: item.made.place, precision: item.made.precision }),
      guessKept: p.answers.kept,
      guessMade: p.answers.made,
      madeArea: area,
      animate: !reducedMotion(),
    });
  }
  return { element, next, score };
}
