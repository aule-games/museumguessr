// The object's difficulty (W4, D3): "Round 4/10 · Hard" plus a three-pip
// meter in the top bar's counter cluster, and "Object: Hard" on the reveal's
// wall-label line. The word always shows; the pips are a second, non-colour
// signal (filled against outlined) and hide at enlarged text sizes.

import { t, type CopyKey } from '../copy.ts';
import { h } from './dom.ts';

const WORDS: Record<number, CopyKey> = { 1: 'difficulty.easy', 2: 'difficulty.medium', 3: 'difficulty.hard' };
const LEVELS = [1, 2, 3] as const;

/** "Easy", "Medium" or "Hard". */
export function difficultyWord(difficulty: number): string {
  return t(WORDS[difficulty] ?? 'difficulty.medium');
}

/** "Object: Hard", for the reveal's wall-label line. */
export function objectDifficulty(item: { difficulty: number }): string {
  return t('difficulty.object', { difficulty: difficultyWord(item.difficulty) });
}

/** "· Hard" and the pip meter, the counter cluster's second part. */
export function difficultyLabel(item: { difficulty: number }): HTMLElement {
  const d = item.difficulty;
  return h(
    'span',
    { class: 'difficulty', 'data-difficulty': d, 'data-test': 'difficulty' },
    h('span', { class: 'difficulty__word' }, ' · ', difficultyWord(d)),
    h('span', { class: 'difficulty__pips', 'aria-hidden': 'true' }, ...LEVELS.map((level) => h('span', { class: `difficulty__pip${level <= d ? ' difficulty__pip--on' : ''}` }))),
  );
}
