// End screen and "Review your 10" (DS7, DS15, DS25, V2, V4, ENG37).
// Order: total and tier, Copy result, "Copied", the "Most fun" row, the
// 10-row recap, the collection line, "Replay the same 10".

import { FEEDBACK } from '../../analytics/events.ts';
import { formatNumber, t, type CopyKey } from '../../copy.ts';
import { imageUrl } from '../../content/items.ts';
import { shareText } from '../../game/text.ts';
import { tierFor } from '../../scoring/score.ts';
import type { RoundResult } from '../../state/schema.ts';
import type { Item } from '../../types/item.ts';
import { h, scoreText } from '../dom.ts';
import { wordmark } from './start.ts';

export interface EndProps {
  items: readonly Item[];
  results: readonly (RoundResult | null)[] | null;
  total: number;
  /** False for a snapshot saved under other content versions: total only. */
  detailed: boolean;
  askMostFun: boolean;
  onMostFun(a: string): void;
  onCopied(method: 'clipboard' | 'manual'): void;
  onReplay(): void;
}

export function endScreen(p: EndProps): HTMLElement {
  const copied = h('p', { class: 'end__copied', 'aria-live': 'polite', 'data-test': 'copied' });
  const manual = h('div', { class: 'end__manual', hidden: true });
  const copy = h('button', { type: 'button', class: 'btn btn--primary', 'data-test': 'copy' }, t('end.copy'));
  copy.addEventListener('click', async () => {
    const text = shareText(p.results ?? [], p.total);
    try {
      await navigator.clipboard.writeText(text);
      copied.textContent = t('end.copied');
      p.onCopied('clipboard');
    } catch {
      const area = h('textarea', { class: 'end__text', readonly: true, rows: 8, 'aria-label': t('end.copyManual') });
      area.value = text;
      manual.replaceChildren(h('p', {}, t('end.copyManual')), area);
      manual.hidden = false;
      area.focus();
      area.select();
      p.onCopied('manual');
    }
  });

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

  return h(
    'main',
    { class: 'screen end', 'data-screen': 'end' },
    h('header', { class: 'brandbar' }, wordmark()),
    h(
      'header',
      { class: 'end__head' },
      h('p', { class: 'end__total', 'data-test': 'end-total' }, ...scoreText(t('end.total', { total: formatNumber(p.total) }))),
      h('p', { class: 'end__tier' }, tierFor(p.total)),
    ),
    p.detailed ? copy : null,
    copied,
    manual,
    mostFun,
    recap,
    h('p', { class: 'end__collection' }, t('end.collection')),
    h('button', { type: 'button', class: 'link end__replay', 'data-test': 'replay', onclick: p.onReplay }, t('end.replay')),
  );
}
