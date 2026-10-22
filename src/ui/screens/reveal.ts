// Reveal (DS3, DS12, DS17, DS21, DS22, DS31, PV1, V2). Above the fold on a
// phone: compact wall-label header, then the score table, then the map and
// journey fact (one row per question: result, then points in their own column; the
// round total last; hover, focus or tap shows how the points were computed),
// the contested note, facts, the credit line and a sticky Next.

import { FEEDBACK, type Step } from '../../analytics/events.ts';
import { formatNumber, t, type CopyKey } from '../../copy.ts';
import tokens from '../../design/tokens.json';
import { hardNailed } from '../../game/hard.ts';
import { formatAnswerYear, howText, rowResult } from '../../game/text.ts';
import type { GameMap } from '../../map/map.ts';
import { MAX_POINTS, SLIDER } from '../../scoring/config.ts';
import { madeFullMarksKm } from '../../scoring/score.ts';
import { formatRange, yearToPosition } from '../../scoring/years.ts';
import type { RoundAnswers, RoundResult, TimeUp } from '../../state/schema.ts';
import type { Item } from '../../types/item.ts';
import { clockGlyph } from '../clock.ts';
import { objectDifficulty } from '../difficulty.ts';
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
  /** Show the optional "this game so far" row (after round 3, once per game). */
  pulse: boolean;
  /** During a challenge game, the friend's score, shown under the round total (V1-21). */
  toBeat?: number | null;
  /** How the round ended at time-up, or null when it ended by Reveal answers or a photo skip (D2). */
  timeUp?: TimeUp | null;
  /** The device's first timed-out reveal: show the one-time tip (V12-63). */
  tip?: boolean;
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

const timelineLabel = (item: Item, guess: number | null) => `${formatRange(item.when.start, item.when.end)}${guess != null ? `, ${formatAnswerYear(guess)}` : ''}`;

/** The When row's timeline: a local window around the date range, with the guess (the early stop plots at 4000 BCE). */
export function timeline(item: Item, guess: number | null): SVGSVGElement {
  if (item.when.start < SLIDER.min) return brokenTimeline(item, guess);
  const g = guess === SLIDER.earlyStop ? SLIDER.min : guess;
  // a local window around the range so the band is visible
  const span = Math.max(50, (item.when.end - item.when.start) * 3, g != null ? Math.abs(g - item.when.start) * 1.3 : 0);
  const mid = (item.when.start + item.when.end) / 2;
  const lo = mid - span;
  const hi = mid + span;
  const x = (y: number) => 8 + ((y - lo) / (hi - lo)) * 284;
  return s(
    'svg',
    { class: 'timeline', viewBox: '0 0 300 36', role: 'img', 'aria-label': timelineLabel(item, guess) },
    s('line', { class: 'timeline__axis', x1: 8, x2: 292, y1: 18, y2: 18 }),
    s('rect', { class: 'timeline__band', x: x(item.when.start) - 2, y: 10, width: Math.max(4, x(item.when.end) - x(item.when.start) + 4), height: 16, rx: 3 }),
    g != null && s('circle', { class: 'timeline__guess', cx: Math.min(292, Math.max(8, x(g))), cy: 18, r: 5 }),
  );
}

/**
 * A date range that begins before 4000 BCE (D11): a broken axis. The left
 * part is a local window around the range; past the break, the right part
 * is the year control's own scale from 4000 BCE to 2025 CE. The early stop
 * sits at the near end of an older range (it scored full marks), or at
 * 4000 BCE for a younger one.
 */
function brokenTimeline(item: Item, guess: number | null): SVGSVGElement {
  const { start, end } = item.when;
  const early = Math.min(end, SLIDER.min);
  const pad = Math.max(50, (early - start) * 0.5);
  const lo = start - pad;
  const hi = early + pad;
  const xa = (y: number) => 8 + ((y - lo) / (hi - lo)) * 128;
  const xb = (y: number) => 164 + yearToPosition(y) * 128;
  const guessX = guess == null ? null : guess === SLIDER.earlyStop ? (end < SLIDER.min ? xa(end) : xb(SLIDER.min)) : xb(guess);
  return s(
    'svg',
    { class: 'timeline timeline--broken', viewBox: '0 0 300 36', role: 'img', 'aria-label': timelineLabel(item, guess), 'data-test': 'timeline-broken' },
    s('line', { class: 'timeline__axis', x1: 8, x2: 136, y1: 18, y2: 18 }),
    s('line', { class: 'timeline__axis', x1: 164, x2: 292, y1: 18, y2: 18 }),
    s('path', { class: 'timeline__break', d: 'M142 26 L148 10 M152 26 L158 10' }),
    s('rect', { class: 'timeline__band', x: xa(start) - 2, y: 10, width: Math.max(4, xa(early) - xa(start) + 4), height: 16, rx: 3 }),
    end > SLIDER.min && s('rect', { class: 'timeline__band', x: 162, y: 10, width: Math.max(4, xb(end) - 164 + 4), height: 16, rx: 3 }),
    guessX != null && s('circle', { class: 'timeline__guess', cx: guessX, cy: 18, r: 5 }),
  );
}

/**
 * The When row's details: the museum's own date caveat, if any, then the
 * timeline; for the early stop on a younger object, that its distance is
 * measured from 4000 BCE (D11).
 */
function whenExtra(item: Item, guess: number | null): Node {
  const line = timeline(item, guess);
  const fromStop = guess === SLIDER.earlyStop && item.when.end >= SLIDER.min;
  const notes = [
    item.when.note ? h('p', { class: 'score__note' }, item.when.note) : null,
    fromStop ? h('p', { class: 'score__note', 'data-test': 'early-distance' }, t('year.earlyDistance')) : null,
  ].filter((n) => n !== null);
  return notes.length ? h('div', { class: 'score__extra' }, ...notes, line) : line;
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

/** Fit within the padded content area, preserving at least 80% of the CSS font
 *  size (and MIN_RESULT_PX); wrap if the text still does not fit at that floor. */
function fitOneLine(el: HTMLElement) {
  if (typeof ResizeObserver === 'undefined') return;
  let width = -1;
  let watchingFonts = false;
  const fit = (force = false) => {
    if (!el.isConnected || el.clientWidth === 0) return;
    const screen = el.closest<HTMLElement>('.reveal');
    const enlarged = !!screen && parseFloat(getComputedStyle(screen).fontSize) > parseFloat(tokens.text.md);
    screen?.classList.toggle('reveal--reflow', enlarged);
    // Reading-size changes need reflow even when the result width is unchanged.
    // Do not shrink enlarged text back towards its normal reading size.
    if (enlarged) {
      el.style.removeProperty('font-size');
      el.style.whiteSpace = 'normal';
      width = -1;
      return;
    }
    // Refit only when the width changes. Wrapping changes the height, and
    // refitting on that would undo the wrap and loop every frame. Font loading
    // gets one explicit refit, since it can change text width without resizing.
    if (!force && el.clientWidth === width) return;
    width = el.clientWidth;
    el.style.removeProperty('font-size');
    el.style.removeProperty('white-space');
    const css = getComputedStyle(el);
    let size = parseFloat(css.fontSize);
    const floor = Math.max(MIN_RESULT_PX, 0.8 * size);
    const available = el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    const text = document.createRange();
    text.selectNodeContents(el);
    const overflows = () => text.getBoundingClientRect().width > available;
    while (overflows() && size > floor) {
      size = Math.max(floor, size - 0.5);
      el.style.fontSize = `${size}px`;
    }
    if (overflows()) el.style.whiteSpace = 'normal';
  };
  new ResizeObserver(() => {
    fit();
    // Subscribe after the first layout has requested the line's fonts.
    if (!watchingFonts && el.isConnected && document.fonts) {
      watchingFonts = true;
      void document.fonts.ready.then(() => fit(true));
    }
  }).observe(el);
}

/** How a score row ended: answered, timed out (no answer before time ran out) or skipped (the photo failed). */
export type RowStatus = 'answered' | 'timedout' | 'skipped';

/** A broken-image glyph: a photo skip looks different from a time-out (D2). */
function skipGlyph(): SVGSVGElement {
  return s(
    'svg',
    { class: 'score__glyph', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
    s('rect', { x: 2, y: 3, width: 12, height: 10, rx: 1.5 }),
    s('path', { d: 'M2 11l3.5-3.5 2.5 2.5M9 3l-2 5 2 1-1 4' }),
  );
}

/** A row's status and its "Counted at time-up" tag, from the round's time-up record (D2, D8). */
export function rowStatus(step: Step, r: RoundResult, timeUp: TimeUp | null | undefined): { status: RowStatus; counted: boolean } {
  if (r.skipped) return { status: 'skipped', counted: false };
  if (timeUp?.questions.includes(step)) return { status: 'timedout', counted: false };
  return { status: 'answered', counted: !!timeUp?.counted.includes(step) };
}

function scoreRow(
  step: Step,
  points: number,
  result: { text: string; value: string | null },
  how: string,
  extra?: Node | null,
  mark: { status: RowStatus; counted: boolean } = { status: 'answered', counted: false },
): HTMLElement {
  const full = points === MAX_POINTS;
  const howId = `how-${step}-${++rowIds}`;
  // a timed-out question says so and explains its zero; it is never "Skipped" (D2)
  const timedOut = mark.status === 'timedout';
  const shown = timedOut ? { text: t('reveal.timedOut'), value: null } : result;
  // the explanation takes the result line's place on hover, keyboard focus or tap,
  // so the row explains itself and the table grows no extra strip
  const howLine = h('span', { class: 'score__how', id: howId }, timedOut ? t('reason.timedOut') : how);
  // a tap also opens the row's extras (When's timeline, a place or date note)
  const detail = extra ? h('div', { class: 'score__detail', hidden: true }, extra) : null;
  const glyph = timedOut ? clockGlyph('score__glyph') : mark.status === 'skipped' ? skipGlyph() : null;
  const btn = h(
    'button',
    { type: 'button', class: 'score__row', 'aria-expanded': 'false', 'aria-describedby': howId, 'data-test': `row-${step}`, 'data-full': String(full), 'data-status': mark.status },
    h('span', { class: 'score__label' }, glyph, t(`reveal.row.${step}` as CopyKey)),
    resultLine(shown),
    howLine,
    h('span', { class: 'score__points', 'data-test': `points-${step}` }, formatNumber(points)),
    mark.counted ? h('span', { class: 'score__tag', 'data-test': `counted-${step}` }, t('reveal.countedAtTimeUp')) : null,
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

  // A hard object nailed shows its mark inside the lime total and joins the one score announcement (D12).
  const nailed = hardNailed(item.difficulty, r)
    ? h('span', { class: 'hard-mark', 'data-test': 'hard-nailed' }, h('span', { class: 'hard-mark__star', 'aria-hidden': 'true' }), ' ', t('hard.nailed'))
    : null;
  const score = h('p', { class: 'reveal__score', 'aria-live': 'polite', tabindex: -1, 'data-test': 'round-score' }, ...scoreText(t('reveal.score', { points: formatNumber(r.points) })), nailed);
  const rows = h(
    'ul',
    { class: 'scores', 'data-test': 'scores' },
    // rows follow the question order (DS35)
    scoreRow('made', r.made.points, rowResult('made', item, r), howText('made', item, r), madeNote, rowStatus('made', r, p.timeUp)),
    scoreRow('when', r.when.points, rowResult('when', item, r), howText('when', item, r, p.answers.when), whenExtra(item, p.answers.when), rowStatus('when', r, p.timeUp)),
    scoreRow('kept', r.kept.points, rowResult('kept', item, r), howText('kept', item, r), null, rowStatus('kept', r, p.timeUp)),
    h(
      'li',
      { class: 'scores__summary' },
      h('div', { class: 'scores__total reveal__total' }, h('span', { class: 'scores__total-label' }, t('reveal.scoreLabel')), score),
      p.toBeat != null ? h('p', { class: 'reveal__tobeat', 'data-test': 'to-beat' }, t('reveal.toBeat', { score: formatNumber(p.toBeat) })) : null,
    ),
  );

  const mapHost = h('div', { class: 'reveal__map', 'data-test': 'reveal-map' });
  // no guess pins (both map questions timed out): no guess entry in the legend either (D2)
  const noGuesses = !r.skipped && p.answers.kept == null && p.answers.made == null;
  const legend = h('p', { class: 'reveal__legend', 'data-test': 'legend' }, t(noGuesses ? 'reveal.legendNoGuess' : 'reveal.legend'));
  const away = p.timeUp?.away ? h('p', { class: 'reveal__away', 'data-test': 'timed-out-away' }, clockGlyph('reveal__glyph'), t('reveal.timedOutAway')) : null;
  // after the score table, so the rows and the total keep their place above the fold (DS21)
  const tip = p.tip ? h('p', { class: 'reveal__tip', 'data-test': 'time-up-tip' }, t('reveal.timeUpTip')) : null;

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
    // It asks about this game so far, never the object's own difficulty label (R3).
    pulseRow = h('div', { class: 'pulse', role: 'group', 'aria-label': t('pulse.gameSoFar'), 'data-test': 'pulse' }, h('span', { class: 'pulse__q' }, t('pulse.gameSoFar')), ...choices, thanks);
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
    topBar(p.round, p.total, p.onMenu, item),
    h(
      'div',
      { class: 'reveal__scroll' },
      h(
        'header',
        { class: 'label' },
        h('h2', { class: 'label__title', 'data-test': 'reveal-title' }, item.title),
        h('p', { class: 'label__line' }, wallLabel(item), ' · ', h('span', { class: 'label__difficulty', 'data-test': 'object-difficulty' }, objectDifficulty(item))),
      ),
      away,
      rows,
      tip,
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
