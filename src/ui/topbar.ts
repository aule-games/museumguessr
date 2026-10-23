// The round and reveal screens' top bar (DS7, D3, R2): round counter with the
// object's difficulty, running total, menu button and the clock's line. Its
// own module, so the reveal chunk does not pull in the round screen (V1-02).

import { formatNumber, t } from '../copy.ts';
import { counterSlot, topBarClock } from './clock.ts';
import { difficultyLabel } from './difficulty.ts';
import { h } from './dom.ts';

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
