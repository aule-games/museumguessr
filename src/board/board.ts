// The weekly board on the page (W6, G1-G4, R4-R6, D6, D10; V12-80,
// V12-115 to V12-124). A lazy chunk (src/ui/lazy.ts): the end screen's
// compact card, the board overlay ("See the board") and "Your board scores"
// with the switch and removal. The board never opens by itself; persistent
// storage is requested only when the player opens the board or the score
// list. Every server value is set as a text node.

import type { PublicRow, Standing, Week } from '../api/contract.ts';
import { weekStart } from '../api/week.ts';
import { EVENTS } from '../analytics/events.ts';
import { TURNSTILE_SITEKEY } from '../config.ts';
import { formatNumber, t } from '../copy.ts';
import type { KV } from '../storage/guarded.ts';
import { h } from '../ui/dom.ts';
import { closeDialog, openDialog } from '../ui/overlay.ts';
import type { CardView } from './card.ts';
import { api } from './client.ts';
import { fingerprint, readKey } from './key.ts';
import { BoardSession, lastRead, readBoardNow, resumePending, weekContext as fetchWeek, type BoardDeps, type Shown, type Snapshot } from './session.ts';
import { relativeReset, writeStanding } from './standing-line.ts';
import { autoAddOn, markRemoved, readBoard, setAutoAdd } from './store.ts';
import { backgroundVerifier, turnstileVerifier } from './turnstile.ts';
import { standingText } from './wording.ts';

/** What the app hands the board: storage, analytics, the channel and the deck's answer revisions. */
export interface BoardEnv {
  kv: KV;
  src: string;
  track(name: string, props: Record<string, unknown>): void;
  /** answers_rev of ten objects, in deck order (from the full records the end screen has loaded). */
  revs(ids: readonly string[]): number[];
}

function depsFor(env: BoardEnv, slot: HTMLElement | null): BoardDeps {
  return {
    kv: env.kv,
    fetch: (input, init) => fetch(input, init),
    locks: navigator.locks,
    now: () => Date.now(),
    verifier: slot && TURNSTILE_SITEKEY ? turnstileVerifier(slot, TURNSTILE_SITEKEY) : null,
    background: TURNSTILE_SITEKEY ? backgroundVerifier(TURNSTILE_SITEKEY) : null,
    track: env.track,
    revs: env.revs,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

// ----- the end card (G2) -----

interface Live {
  session: BoardSession;
  slot: HTMLElement;
}
const live = new Map<string, Live>();

/** Redraw every card (a removal or the switch changed the device's records). */
function refreshCards() {
  for (const l of live.values()) l.session.refresh();
}

export interface CardProps {
  shown: Shown;
  env: BoardEnv;
  /** Open the board overlay ("See the board"); never called by the card itself. */
  onView(opener: HTMLElement): void;
}

/**
 * The compact board card under Play another 10: heading, one status line,
 * the name line, "See the board", and a zero-height verification slot that
 * opens only when Turnstile needs the player. A rebuilt end screen reattaches
 * to the same session and slot, so nothing is sent twice.
 */
export function boardCard(p: CardProps): HTMLElement {
  let l = live.get(p.shown.game_id);
  if (!l) {
    const slot = h('div', { class: 'board-card__slot', 'data-test': 'board-slot' });
    const session = new BoardSession(depsFor(p.env, slot), p.shown);
    l = { session, slot };
    live.set(p.shown.game_id, l);
    void session.start();
  }
  const { session, slot } = l;
  const heading = h('h2', { class: 'board-card__heading', id: `board-card-${p.shown.game_id}` }, t('board.heading'));
  const status = h('p', { class: 'board-card__status', 'data-test': 'board-status', 'aria-live': 'polite' });
  const note = h('p', { class: 'board-card__note', hidden: true });
  const name = h('p', { class: 'board-card__name', 'data-test': 'board-name', hidden: true });
  const view = h('button', { type: 'button', class: 'link board-card__view', 'data-test': 'board-view' }, t('board.view'));
  view.addEventListener('click', () => p.onView(view));
  const action = h('button', { type: 'button', class: 'link board-card__action', 'data-test': 'board-retry', hidden: true });
  let act: CardView['action'] = null;
  action.addEventListener('click', () => {
    if (act === 'reload') location.reload();
    else void session.retry();
  });
  const card = h(
    'section',
    { class: 'board-card', 'data-test': 'board-card', 'aria-labelledby': heading.id },
    heading,
    status,
    note,
    name,
    slot,
    h('p', { class: 'board-card__links' }, view, action),
  );
  const draw = (v: CardView) => {
    card.hidden = v.hidden;
    card.dataset.state = v.loading ? 'loading' : (v.state ?? 'none');
    status.classList.toggle('board-card__status--loading', v.loading);
    status.setAttribute('aria-busy', String(v.loading));
    status.textContent = v.loading ? '' : (v.status ?? '');
    note.hidden = !v.note;
    note.textContent = v.note ?? '';
    name.hidden = !v.name;
    name.replaceChildren(h('bdi', {}, v.name ?? ''));
    slot.classList.toggle('board-card__slot--open', v.interactive);
    act = v.action;
    action.hidden = !v.action;
    action.textContent = v.action === 'reload' ? t('error.reload') : t('board.retry');
  };
  const off = session.subscribe((v) => {
    if (!card.isConnected && card.dataset.drawn === '1') return off();
    card.dataset.drawn = '1';
    draw(v);
  });
  return card;
}

// ----- shared helpers -----

let persisted = false;
/** Ask once per page for persistent storage, only after a deliberate board or score-list open (G4, V12-122). */
function askPersist() {
  if (persisted) return;
  persisted = true;
  void navigator.storage?.persist?.().catch(() => false);
}

async function freshRead(env: BoardEnv, maxAgeMs: number): Promise<Snapshot> {
  const known = lastRead();
  if (known && Date.now() - known.at < maxAgeMs) return known;
  const key = env.kv.persistent ? readKey(env.kv) : null;
  return readBoardNow({ kv: env.kv, fetch: (i, init) => fetch(i, init), now: () => Date.now() }, key, false);
}

const weekLabel = (week: Week, current: Week | null) =>
  week === current ? t('board.thisWeek') : t('board.weekOf', { date: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(weekStart(week)) });

// ----- the board overlay (V12-118, V12-119, V12-124) -----

/** "See the board": this week's top 50 with this device's row. Counts a deliberate open. */
export function openBoard(opener: HTMLElement | null, env: BoardEnv) {
  askPersist();
  env.track(EVENTS.boardViewed, { src: env.src });
  const status = h('p', { class: 'board__status', 'data-test': 'board-overlay-status', 'aria-live': 'polite' }, t('board.loading'));
  const area = h('div', { class: 'board__area', 'data-test': 'board-overlay' });
  const scores = h('button', { type: 'button', class: 'link board__scores', 'data-test': 'board-scores-open' }, t('board.scores'));
  const dlg = openDialog(t('board.heading'), [h('p', { class: 'board__note' }, t('board.note')), h('p', { class: 'board__note' }, t('board.storageLifetime')), status, area, scores], opener, 'dialog--board');
  scores.addEventListener('click', () => closeDialog(dlg, () => openScores(opener, env)));
  const load = async (maxAge: number) => {
    const snap = await freshRead(env, maxAge);
    if (!dlg.isConnected) return;
    await drawBoard(env, snap, status, area, () => void load(0));
  };
  void load(60_000);
}

async function drawBoard(env: BoardEnv, snap: Snapshot, status: HTMLElement, area: HTMLElement, retry: () => void) {
  area.replaceChildren();
  const b = snap.board;
  if (snap.mode === 'unavailable' || snap.mode === 'disabled' || (snap.mode === 'on' && !b)) {
    status.textContent = t('board.unavailable');
    const again = h('button', { type: 'button', class: 'link', 'data-test': 'board-overlay-retry' }, t('board.retry'));
    again.addEventListener('click', () => {
      status.textContent = t('board.loading');
      retry();
    });
    area.append(again);
    return;
  }
  if (!b || b.count === 0 || b.rows.length === 0) {
    status.textContent = t('board.empty');
    return;
  }
  // this device's confirmed add for the week, which a cached list may not show yet (V12-119)
  const key = env.kv.persistent ? readKey(env.kv) : null;
  const fp = key ? await fingerprint(key) : null;
  const mine = Object.values(readBoard(env.kv).games)
    .map((r) => r.receipt)
    .filter((rc) => rc && rc.fp === fp && rc.week === b.week && rc.status === 'current' && !rc.smoke)
    .sort((x, y) => y!.total - x!.total)[0];
  const best = snap.personal?.best ?? null;
  const cached = !!mine && (best?.total ?? -1) < mine.total;
  const ownId = cached ? mine.row_id : (best?.row_id ?? null);
  const lines: string[] = [];
  if (b.count < 10) lines.push(t('board.lowCount'));
  if (cached) lines.push(t('board.cached'));
  status.textContent = lines.join(' · ');

  const head = h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'board-table__rank' }, t('board.columnRank')), h('th', { scope: 'col' }, t('board.columnName')), h('th', { scope: 'col', class: 'board-table__total' }, t('board.columnTotal'))));
  const row = (r: Pick<PublicRow, 'name' | 'total'> & { rank: string }, you: boolean) =>
    h(
      'tr',
      { class: you ? 'board-table__row board-table__row--you' : 'board-table__row', 'aria-current': you ? 'true' : null, 'data-test': you ? 'board-you' : 'board-row' },
      h('td', { class: 'board-table__rank' }, r.rank),
      h('td', { class: 'board-table__name' }, h('bdi', {}, r.name), you ? h('span', { class: 'board-table__you' }, t('board.you')) : null),
      h('td', { class: 'board-table__total' }, formatNumber(r.total)),
    );
  const listed = b.rows.filter((r) => !(cached && r.row_id === ownId));
  const body = h('tbody', {}, ...listed.map((r) => row({ name: r.name, total: r.total, rank: `#${formatNumber(r.rank)}` }, r.row_id === ownId)));
  const table = h('table', { class: 'board-table', 'data-test': 'board-table' }, h('caption', { class: 'visually-hidden' }, t('board.heading')), head, body);
  // this device's row when it is not among the listed rows (below the top 50, or not in the cached
  // copy yet): the short rank in the column, the full standing on its own line under it
  const name = snap.personal?.name ?? '';
  const own = (total: number, standing: Standing | null, unlisted: boolean) =>
    h(
      'tbody',
      { class: 'board-table__own', 'data-test': 'board-own' },
      row({ name, total, rank: standing?.kind === 'exact' ? `#${formatNumber(standing.rank)}` : '' }, true),
      h('tr', { class: 'board-table__standing' }, h('td', { colspan: 3 }, standingText(standing, b.count, unlisted) ?? '')),
    );
  if (cached && mine) table.append(own(mine.total, mine.standing ?? (mine.receipt_rank ? { kind: 'exact', rank: mine.receipt_rank, tied: false } : null), false));
  else if (best && !b.rows.some((r) => r.row_id === best.row_id)) table.append(own(best.total, best.standing, true));
  area.append(table);
}

// ----- "Your board scores" (G3, D6; V12-120, V12-121) -----

export function openScores(opener: HTMLElement | null, env: BoardEnv) {
  askPersist();
  const toggle = h('input', { type: 'checkbox', role: 'switch', class: 'switch__input', 'data-test': 'board-auto', id: 'board-auto' });
  toggle.checked = autoAddOn(env.kv);
  toggle.addEventListener('change', () => {
    setAutoAdd(env.kv, toggle.checked);
    refreshCards();
  });
  const status = h('p', { class: 'board__status', 'aria-live': 'polite', 'data-test': 'board-scores-status' }, t('board.loading'));
  const list = h('ul', { class: 'board-scores', 'data-test': 'board-scores' });
  const all = h('button', { type: 'button', class: 'btn btn--secondary board-scores__all', 'data-test': 'board-remove-all', hidden: true }, t('board.removeAll'));
  const dlg = openDialog(
    t('board.scores'),
    [h('label', { class: 'switch', for: 'board-auto' }, toggle, h('span', { class: 'switch__label' }, t('board.autoAdd'))), h('p', { class: 'board__note' }, t('board.disclosure')), status, list, all],
    opener,
    'dialog--board',
  );
  const key = env.kv.persistent ? readKey(env.kv) : null;
  let snap: Snapshot | null = null;

  const draw = () => {
    const weeks = snap?.personal?.weeks ?? [];
    list.replaceChildren(
      ...weeks.map((w) => {
        const label = w.rank ? t('board.scoreRow', { week: weekLabel(w.week, snap?.week ?? null), total: formatNumber(w.total), rank: formatNumber(w.rank) }) : t('board.scoreRowNoRank', { week: weekLabel(w.week, snap?.week ?? null), total: formatNumber(w.total) });
        const remove = h('button', { type: 'button', class: 'link board-scores__remove', 'data-test': 'board-remove', 'data-week': w.week }, t('board.remove'));
        remove.addEventListener('click', () => confirmRemove(remove, [w]));
        return h('li', { class: 'board-scores__row', 'data-week': w.week }, h('span', {}, label), remove);
      }),
    );
    all.hidden = weeks.length === 0;
    status.textContent = snap?.mode === 'unavailable' ? t('board.unavailable') : weeks.length ? '' : t('board.noScores');
  };

  /** D6: confirm with the relative local reset time; Removing… / Removed / Couldn't remove; focus stays in the dialog, then returns. */
  const confirmRemove = (from: HTMLElement, weeks: { week: Week; row_id: string }[]) => {
    const current = snap?.week ?? null;
    const reset = snap?.resets_at ? relativeReset(snap.resets_at, Date.now()) : '';
    const body = weeks.length === 1 && weeks[0]!.week !== current ? t('board.removeWeek', { week: weekLabel(weeks[0]!.week, current) }) : t('board.removeConfirm', { reset });
    const keep = h('button', { type: 'button', class: 'btn btn--secondary', 'data-test': 'board-keep' }, t('board.keep'));
    const yes = h('button', { type: 'button', class: 'btn btn--primary', 'data-test': 'board-remove-yes' }, t('board.remove'));
    const state = h('p', { class: 'board__status', 'aria-live': 'assertive', 'data-test': 'board-remove-status' });
    const ask = openDialog(weeks.length > 1 ? t('board.removeAll') : t('board.remove'), [h('p', {}, body), state, h('div', { class: 'dialog__actions' }, keep, yes)], from);
    keep.addEventListener('click', () => closeDialog(ask));
    yes.addEventListener('click', async () => {
      const k = readKey(env.kv) ?? key;
      if (!k) return;
      yes.disabled = true;
      keep.disabled = true;
      state.textContent = t('board.removing');
      let failed = false;
      for (const w of weeks) {
        const res = await api.remove((i, init) => fetch(i, init), k, w.row_id);
        if (res.ok || (!res.ok && res.error.reason === 'not_found')) {
          markRemoved(env.kv, w.week);
          if (w.week === current) writeStanding(env.kv, null);
          if (snap?.personal) snap = { ...snap, personal: { ...snap.personal, weeks: snap.personal.weeks.filter((x) => x.week !== w.week) } };
        } else failed = true;
      }
      refreshCards();
      if (failed) {
        state.textContent = t('board.removeFailed');
        yes.disabled = false;
        keep.disabled = false;
        yes.focus();
        draw();
        return;
      }
      state.textContent = t('board.removeDone');
      // back to the nearest surviving entry, else the list's opener
      const rows = [...list.querySelectorAll<HTMLElement>('.board-scores__row')];
      const at = rows.findIndex((r) => r.dataset.week === weeks[0]!.week);
      closeDialog(ask, () => {
        draw();
        const next = list.querySelectorAll<HTMLButtonElement>('.board-scores__remove');
        const target = next[Math.min(Math.max(at, 0), next.length - 1)] ?? toggle;
        target.focus();
      });
    });
  };
  all.addEventListener('click', () => confirmRemove(all, (snap?.personal?.weeks ?? []).map((w) => ({ week: w.week, row_id: w.row_id }))));

  if (!key) {
    status.textContent = t('board.noScores');
    return;
  }
  void readBoardNow({ kv: env.kv, fetch: (i, init) => fetch(i, init), now: () => Date.now() }, key, false).then((s) => {
    snap = s;
    if (dlg.isConnected) draw();
  });
}

// ----- the app's hooks -----

/** Week context when round ten opens (V12-108). */
export function weekContext(env: BoardEnv, smoke: boolean): Promise<{ week: Week | null }> {
  return fetchWeek({ kv: env.kv, fetch: (i, init) => fetch(i, init), now: () => Date.now() }, smoke);
}

/** Retry pending submissions on load, in the background (V12-113). */
export function resume(env: BoardEnv): Promise<void> {
  return resumePending(depsFor(env, null));
}

