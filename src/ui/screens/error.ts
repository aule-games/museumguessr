// Error screen (E8, DX13) and "Continued in another tab" (ENG30). Both stay
// in the main bundle: they must draw when nothing else can load.

import { BUILD_ID } from '../../config.ts';
import { t } from '../../copy.ts';
import type { ErrorReport } from '../../errors/boundary.ts';
import { h } from '../dom.ts';

export function errorScreen(report: ErrorReport, saved: boolean, onNew: () => void): HTMLElement {
  return h(
    'main',
    { class: 'screen error', 'data-screen': 'error', role: 'alert' },
    h('h1', {}, t('error.title')),
    saved && h('p', {}, t('error.saved')),
    h(
      'div',
      { class: 'error__actions' },
      h('button', { type: 'button', class: 'btn btn--primary', 'data-test': 'reload', onclick: () => location.reload() }, t('error.reload')),
      h('button', { type: 'button', class: 'btn btn--secondary', 'data-test': 'error-new', onclick: onNew }, t('error.new')),
    ),
    h('p', { class: 'error__ref', 'data-test': 'error-ref' }, t('error.ref', { name: report.name, build: BUILD_ID })),
  );
}

export function frozenScreen(onTake: () => void): HTMLElement {
  return h(
    'main',
    { class: 'screen frozen', 'data-screen': 'frozen' },
    h('h1', {}, t('tab.title')),
    h('p', {}, t('tab.body')),
    h('button', { type: 'button', class: 'btn btn--primary', 'data-test': 'take-over', onclick: onTake }, t('tab.take')),
  );
}
