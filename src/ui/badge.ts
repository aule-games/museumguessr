// The test-mode badge (DX3, DX29, M4). It stays in the main bundle so it
// draws with the first screen of a ?test=1 visit.

import type { Inspection } from '../analytics/core.ts';
import { t } from '../copy.ts';
import { h } from './dom.ts';

/** The test badge's controls; the same functions are window.__mgTest (M4). Each marks the game test-assisted (ENG5). */
export interface TestControls {
  finish(): void;
  tenSeconds(): void;
  expire(): void;
  pauseClock(): void;
}

/** "Test mode · analytics off" badge; expands to the test controls and the payloads that would have been sent (DX29, M4). */
export function testBadge(inspect: () => Inspection, controls: TestControls): HTMLElement {
  const list = h('div', { class: 'badge__panel', hidden: true, 'data-test': 'badge-panel' });
  const btn = h('button', { type: 'button', class: 'badge', 'aria-expanded': 'false', 'data-test': 'test-badge' }, t('test.badge'));
  const close = () => {
    btn.setAttribute('aria-expanded', 'false');
    list.hidden = true;
  };
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    list.hidden = !open;
    if (!open) return;
    const info = inspect();
    const control = (label: string, test: string, run: () => void) =>
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--secondary',
          'data-test': test,
          onclick: () => {
            close();
            run();
          },
        },
        label,
      );
    list.replaceChildren(
      control(t('test.finish'), 'test-finish', controls.finish),
      h(
        'div',
        { class: 'badge__clock', role: 'group' },
        control(t('test.tenSeconds'), 'test-ten-seconds', controls.tenSeconds),
        control(t('test.expire'), 'test-expire', controls.expire),
        control(t('test.pauseClock'), 'test-pause-clock', controls.pauseClock),
      ),
      h('p', {}, t('test.payloads')),
      h('p', { class: 'badge__counts' }, t('test.counts', info.counts)),
      info.payloads.length
        ? h('ol', {}, ...info.payloads.map((p) => h('li', {}, h('code', {}, p.name), ' ', h('code', {}, JSON.stringify(p.props)))))
        : h('p', {}, t('test.none')),
    );
  });
  return h('div', { class: 'badge-wrap' }, btn, list);
}
