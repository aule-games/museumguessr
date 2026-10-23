// The header menu and its overlays (DS27): How to play, Credits, About &
// privacy with the event list, and the Start-over dialog. A lazy chunk
// (V1-02, src/ui/lazy.ts); the error and other-tab screens are in error.ts.

import { CATALOGUE } from '../../analytics/catalogue.ts';
import { BOARD_UI } from '../../config.ts';
import { t } from '../../copy.ts';
import type { Item } from '../../types/item.ts';
import { ext, h } from '../dom.ts';
import { closeDialog, openDialog } from '../overlay.ts';

export function howToPlay(opener: HTMLElement | null) {
  openDialog(t('how.title'), [
    h('p', {}, t('how.body')),
    ...(BOARD_UI ? [h('p', { 'data-test': 'board-disclosure' }, t('board.disclosure'))] : []),
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
    // the board's two events exist only when the board is built in
    h('ul', { class: 'about__events', 'data-test': 'events' }, ...CATALOGUE.filter((e) => BOARD_UI || !e.name.startsWith('board_')).map((e) => h('li', {}, h('code', {}, e.name), ': ', e.fires))),
    h('p', {}, t('about.device')),
    ...(BOARD_UI ? [h('p', { 'data-test': 'board-disclosure' }, t('board.disclosure'), ' ', t('board.privacy'))] : []),
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
  /** "Your board scores", when the board is built in (G3). */
  onScores?: (opener: HTMLElement) => void;
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
        a.onScores ? item(t('board.scores'), 'menu-board-scores', () => a.onScores?.(opener)) : null,
        item(t('menu.credits'), 'menu-credits', () => credits(a.items, a.sample, opener)),
        item(t('menu.about'), 'menu-about', () => aboutPrivacy(opener)),
      ),
    ],
    opener,
    'dialog--menu',
  );
}
