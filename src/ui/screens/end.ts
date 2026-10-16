// End screen and "Review your 10" (DS7, DS25, V2, ENG37, V1-19 to V1-22).
// Normal game: total and tier, the share block (name disclosure, Share,
// Copy link), "Play another 10", a waiting challenge, the collection line,
// the "Most fun" row, the 10-row recap, "Replay these 10". A challenge game
// shows both totals and the result, and its share block sends the score
// back. Desktop puts the summary and actions left and the recap right.

import { FEEDBACK } from '../../analytics/events.ts';
import { formatNumber, t, type CopyKey } from '../../copy.ts';
import { imageUrl } from '../../content/items.ts';
import { tierFor } from '../../scoring/score.ts';
import type { RoundResult } from '../../state/schema.ts';
import type { Item } from '../../types/item.ts';
import { h, scoreText } from '../dom.ts';
import { shareBlock, type ShareSetup } from '../share.ts';
import { wordmark } from './start.ts';

export interface ChallengeResult {
  /** The friend's name as shown, already checked ("A friend" when none). */
  name: string;
  /** The friend's score, or null when the link had no comparable one. */
  score: number | null;
}

export interface EndProps {
  items: readonly Item[];
  results: readonly (RoundResult | null)[] | null;
  total: number;
  /** False for a snapshot saved under other answers: total only. */
  detailed: boolean;
  askMostFun: boolean;
  onMostFun(a: string): void;
  /** The share block; null when the recap is not available. */
  share: ShareSetup | null;
  challenge: ChallengeResult | null;
  /** "You have seen N of M objects"; null when this device keeps no list. */
  collection: { seen: number; total: number } | null;
  /** A friend's challenge set aside with "Continue my game". */
  waiting: { name: string | null; onPlay(): void; onDismiss(): void } | null;
  onAnother(): void;
  onReplay(): void;
}

/** "You win by 760", "Ali wins by 760" or "A tie: you both scored 18,240". */
export function resultLine(you: number, name: string, them: number): string {
  if (you === them) return t('challenge.tie', { total: formatNumber(you) });
  return you > them ? t('challenge.youWin', { diff: formatNumber(you - them) }) : t('challenge.theyWin', { name, diff: formatNumber(them - you) });
}

export function collectionLine(c: { seen: number; total: number }): string {
  return c.seen >= c.total ? t('end.collectionAll') : t('end.collection', { seen: formatNumber(c.seen), total: formatNumber(c.total) });
}

export function endScreen(p: EndProps): HTMLElement {
  let mostFun: HTMLElement | null = null;
  if (p.askMostFun) {
    const thanks = h('span', { class: 'pulse__thanks', 'aria-live': 'polite' });
    const choices = FEEDBACK.most_fun.map((a) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'data-test': `fun-${a}`,
          onclick: () => {
            p.onMostFun(a);
            choices.forEach((c) => c.remove());
            thanks.textContent = t('pulse.thanks');
          },
        },
        t(`step.${a}` as CopyKey),
      ),
    );
    mostFun = h('div', { class: 'pulse', role: 'group', 'aria-label': t('pulse.mostFun') }, h('span', { class: 'pulse__q' }, t('pulse.mostFun')), ...choices, thanks);
  }

  const recap =
    p.detailed && p.results
      ? h(
          'ol',
          { class: 'recap', 'data-test': 'recap' },
          ...p.items.map((it, i) => {
            const r = p.results?.[i];
            return h(
              'li',
              { class: 'recap__row' },
              h('img', { class: 'recap__thumb', src: imageUrl(it.id), alt: '', loading: 'lazy', decoding: 'async' }),
              h(
                'div',
                { class: 'recap__text' },
                h('p', { class: 'recap__title' }, it.title),
                h('p', { class: 'recap__line' }, t('end.recapRow', { made: it.made.place, kept: `${it.kept.museum}, ${it.kept.city}` })),
              ),
              h('p', { class: 'recap__points' }, r?.skipped ? t('reveal.skipped') : t('end.points', { points: formatNumber(r?.points ?? 0) })),
            );
          }),
        )
      : h('p', { class: 'end__note' }, t('end.versionChanged'));

  const c = p.challenge;
  const versus =
    c && c.score !== null
      ? [
          h('p', { class: 'end__versus', 'data-test': 'end-versus' }, h('bdi', {}, t('challenge.both', { you: formatNumber(p.total), name: c.name, them: formatNumber(c.score) }))),
          h('p', { class: 'end__result', 'data-test': 'end-result' }, h('bdi', {}, resultLine(p.total, c.name, c.score))),
        ]
      : [];

  const waiting = p.waiting
    ? h(
        'p',
        { class: 'end__waiting', 'data-test': 'waiting-challenge' },
        h(
          'button',
          { type: 'button', class: 'link', onclick: p.waiting.onPlay },
          h('bdi', {}, p.waiting.name ? t('end.waiting', { name: p.waiting.name }) : t('end.waitingFriend')),
        ),
        ' · ',
        h('button', { type: 'button', class: 'link end__dismiss', onclick: p.waiting.onDismiss }, t('end.waitingDismiss')),
      )
    : null;

  const summary = h(
    'div',
    { class: 'end__summary' },
    h(
      'header',
      { class: 'end__head' },
      h('p', { class: 'end__total', 'data-test': 'end-total' }, ...scoreText(t('end.total', { total: formatNumber(p.total) }))),
      h('p', { class: 'end__tier' }, tierFor(p.total)),
      ...versus,
    ),
    p.detailed && p.share ? shareBlock(p.share, c ? 'sendBack.button' : 'share.button') : null,
    h('button', { type: 'button', class: 'btn btn--secondary btn--wide end__another', 'data-test': 'play-another', onclick: p.onAnother }, t('end.another')),
    waiting,
    p.collection ? h('p', { class: 'end__collection', 'data-test': 'collection' }, collectionLine(p.collection)) : null,
    mostFun,
  );

  return h(
    'main',
    { class: 'screen end', 'data-screen': 'end' },
    h('header', { class: 'brandbar' }, wordmark()),
    h(
      'div',
      { class: 'end__layout' },
      summary,
      h(
        'div',
        { class: 'end__recap' },
        recap,
        h('button', { type: 'button', class: 'link end__replay', 'data-test': 'replay', onclick: p.onReplay }, t('end.replay')),
      ),
    ),
  );
}
