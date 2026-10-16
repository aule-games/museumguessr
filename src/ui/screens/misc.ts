// Error screen (E8, DX13), "Continued in another tab" (ENG30), the header
// menu and its overlays (DS27), and the test-mode badge (DX3, DX29).

import type { Inspection } from '../../analytics/core.ts';
import { CATALOGUE } from '../../analytics/events.ts';
import { BUILD_ID } from '../../config.ts';
import { t } from '../../copy.ts';
import type { ErrorReport } from '../../errors/boundary.ts';
import type { Item } from '../../types/item.ts';
import { ext, h } from '../dom.ts';
import { closeDialog, openDialog } from '../overlay.ts';

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

export function howToPlay(opener: HTMLElement | null) {
  openDialog(t('how.title'), [
    h('p', {}, t('how.body')),
    h('ul', {}, h('li', {}, t('hint.kept')), h('li', {}, t('hint.made')), h('li', {}, t('hint.when'))),
  ], opener);
}

export function credits(items: readonly Item[], sample: Item, opener: HTMLElement | null) {
  const row = (it: Item) =>
    h('li', { class: 'credits__row' }, t('credits.row', { title: it.title, author: it.photo.author, licence: it.photo.licence }), ' · ', ext(it.photo.source_url, t('reveal.creditSource')));
  openDialog(t('credits.title'), [
    h('ul', { class: 'credits', 'data-test': 'credits' }, ...items.map(row), row(sample)),
    h('p', { class: 'credits__map' }, t('credits.map')),
  ], opener);
}

export function aboutPrivacy(opener: HTMLElement | null) {
  openDialog(t('about.title'), [
    h('p', {}, t('about.body')),
    h('ul', { class: 'about__events', 'data-test': 'events' }, ...CATALOGUE.map((e) => h('li', {}, h('code', {}, e.name), ': ', e.fires))),
    h('p', {}, t('about.device')),
    h('p', {}, t('about.testMode')),
  ], opener);
}

export function confirmNewGame(opener: HTMLElement | null, onYes: () => void) {
  const yes = h('button', { type: 'button', class: 'btn btn--primary', 'data-test': 'confirm-new' }, t('confirmNew.yes'));
  const no = h('button', { type: 'button', class: 'btn btn--secondary' }, t('confirmNew.no'));
  const dlg = openDialog(t('confirmNew.title'), [h('p', {}, t('confirmNew.body')), h('div', { class: 'dialog__actions' }, no, yes)], opener);
  no.addEventListener('click', () => closeDialog(dlg));
  // change screens only after the history entry has popped
  yes.addEventListener('click', () => closeDialog(dlg, onYes));
}

export interface MenuActions {
  items: readonly Item[];
  sample: Item;
  inGame: boolean;
  onNewGame(): void;
  /** Offered on the round screen: replay the game tour (DS34). */
  onTour?: () => void;
}

export function openMenu(opener: HTMLElement, a: MenuActions) {
  const go = (fn: () => void) => () => closeDialog(dlg, fn);
  const item = (label: string, test: string, fn: () => void) =>
    h('li', {}, h('button', { type: 'button', class: 'menu__item', 'data-test': test, onclick: go(fn) }, label));
  const dlg = openDialog(
    t('app.name'),
    [
      h(
        'ul',
        { class: 'menu' },
        item(t('menu.how'), 'menu-how', () => howToPlay(opener)),
        a.onTour ? item(t('menu.tour'), 'menu-tour', a.onTour) : null,
        a.inGame ? item(t('menu.new'), 'menu-new', () => confirmNewGame(opener, a.onNewGame)) : null,
        item(t('menu.credits'), 'menu-credits', () => credits(a.items, a.sample, opener)),
        item(t('menu.about'), 'menu-about', () => aboutPrivacy(opener)),
      ),
    ],
    opener,
    'dialog--menu',
  );
}

/** "Test mode · analytics off" badge; expands to the payloads that would have been sent (DX29). */
export function testBadge(inspect: () => Inspection, onFinish: () => void): HTMLElement {
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
    const finish = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--secondary',
        'data-test': 'test-finish',
        onclick: () => {
          close();
          onFinish();
        },
      },
      t('test.finish'),
    );
    list.replaceChildren(
      finish,
      h('p', {}, t('test.payloads')),
      h('p', { class: 'badge__counts' }, t('test.counts', info.counts)),
      info.payloads.length
        ? h('ol', {}, ...info.payloads.map((p) => h('li', {}, h('code', {}, p.name), ' ', h('code', {}, JSON.stringify(p.props)))))
        : h('p', {}, t('test.none')),
    );
  });
  return h('div', { class: 'badge-wrap' }, btn, list);
}
