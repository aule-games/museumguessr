// The board card's one status line (D10, G2; V12-117): every row of the
// board-state table in docs/screen-spec.md, derived from what the device and
// the server know. Pure: the card UI renders whatever this returns, and the
// unit tests walk every row. Week ownership comes from the server's week,
// never the device clock (N4).

import { ERRORS, type PersonalBoard, type Week } from '../api/contract.ts';
import { formatNumber, t, type CopyKey } from '../copy.ts';
import type { Eligibility } from './payload.ts';
import { MAX_AUTO_ATTEMPTS, type GameRecord } from './store.ts';
import { receiptStanding, standingText } from './wording.ts';

/** What the end card's board read said: still loading, ranking on, dark smoke context, off, or no answer. */
export type Mode = 'loading' | 'on' | 'smoke' | 'disabled' | 'unavailable';
/** Turnstile for the current attempt. */
export type Verify = 'idle' | 'checking' | 'interactive' | 'failed';

export interface CardInput {
  /** Local storage keeps data (false: memory only, so nothing can be added). */
  storage: boolean;
  mode: Mode;
  /** The server's current week, when the read answered. */
  serverWeek: Week | null;
  /** Devices on this week's board, from the read (0 when unknown, which omits "of N"). */
  count: number;
  /** The finished game on screen; null when this page cannot tell (an old review). */
  game: { eligibility: Eligibility; week: Week | null; total: number } | null;
  auto: boolean;
  record: GameRecord | null;
  /** The receipt was made by the current key (N3). */
  ownReceipt: boolean;
  /** The receipt came from this page's own POST, so the earlier read predates it. */
  justConfirmed: boolean;
  personal: PersonalBoard | null;
  removedWeeks: readonly Week[];
  posting: boolean;
  verify: Verify;
  /** No add has ever been confirmed for this device. */
  firstAdd: boolean;
  name: string | null;
}

export interface CardView {
  hidden: boolean;
  /** The skeleton, with no invented standing. */
  loading: boolean;
  /** The copy key of the status line (for tests and styling). */
  state: CopyKey | null;
  status: string | null;
  note: string | null;
  name: string | null;
  action: 'retry' | 'reload' | 'retryList' | null;
  /** The verification slot is open for interaction. */
  interactive: boolean;
}

const view = (state: CopyKey | null, status: string | null, extra: Partial<CardView> = {}): CardView => ({
  hidden: false,
  loading: false,
  state,
  status,
  note: null,
  name: null,
  action: null,
  interactive: false,
  ...extra,
});

const say = (key: CopyKey, vars: Record<string, string | number> = {}, extra: Partial<CardView> = {}) => view(key, t(key, vars), extra);

/** "(#12 of 40 this week)" dropped cleanly when the server gave no standing. */
function notBest(best: number, standing: string | null, total: number): string {
  const text = t('board.notBest', { best: formatNumber(best), standing: standing ?? '', total: formatNumber(total) });
  return standing ? text : text.replace(' ()', '');
}

const INELIGIBLE: Record<Exclude<Eligibility, 'ok'>, CopyKey> = { replay: 'board.notRankedReplay', seen: 'board.notRankedSeen', test: 'board.notRankedTest' };

/** The status of a confirmed receipt. */
function confirmed(i: CardInput, r: GameRecord): CardView {
  const rc = r.receipt!;
  if (!i.ownReceipt) return say('board.hidden');
  if (rc.status === 'removed' || i.removedWeeks.includes(rc.week)) return say('board.removed');
  if (i.serverWeek && rc.week !== i.serverWeek) {
    const rank = i.personal?.weeks.find((w) => w.week === rc.week)?.rank ?? rc.receipt_rank;
    return rank ? say('board.lastRank', { rank: formatNumber(rank) }) : say('board.lastWeek');
  }
  const smoke = rc.smoke ? t('board.notRankedTest') : null;
  const best = i.personal?.best;
  if (i.personal && !i.justConfirmed && !rc.smoke) {
    if (!best || best.row_id !== rc.row_id) return say('board.hidden');
    if (best.total > rc.total || rc.status === 'replaced') return say('board.replaced', { total: formatNumber(best.total) });
    const standing = standingText(best.standing, i.count) ?? standingText(receiptStanding(rc.receipt_rank, rc.standing), rc.count) ?? '';
    return say(rc.improved ? 'board.newBest' : 'board.added', { standing });
  }
  if (rc.status === 'replaced') return say('board.replaced', { total: formatNumber(best?.total ?? rc.total) });
  if (i.justConfirmed && i.mode === 'unavailable') return say('board.sentUnavailable', {}, { action: 'retryList' });
  const standing = smoke ?? standingText(receiptStanding(rc.receipt_rank, rc.standing), rc.count) ?? '';
  return say(rc.improved ? 'board.newBest' : 'board.added', { standing });
}

/** The status of a refused submission: the reason's copy (docs/api.md error table). */
function refused(i: CardInput, r: GameRecord): CardView {
  const reason = r.outcome;
  if (reason === 'not_best' && r.best) {
    // not_best names the best without a standing; the card's earlier read may hold it (V12-90)
    const known = r.best.standing ?? (i.personal?.best?.row_id === r.best.row_id ? i.personal.best.standing : null);
    const standing = i.mode === 'smoke' ? t('board.notRankedTest') : standingText(known, i.count);
    return view('board.notBest', notBest(r.best.total, standing, r.total), { note: t('board.notHigher') });
  }
  if (reason === 'update_page') return say('board.updatePage', {}, { action: 'reload' });
  if (reason && reason !== 'added' && reason !== 'replaced') return say(ERRORS[reason].copy as CopyKey);
  return say('board.invalid');
}

/** A pending submission: its last reason's copy, with Retry once automatic attempts are spent or the board is unavailable. */
function pending(i: CardInput, r: GameRecord): CardView {
  const reason = r.outcome && r.outcome !== 'added' && r.outcome !== 'replaced' ? r.outcome : null;
  if (i.verify === 'failed' || reason === 'turnstile_failed') return say('board.verificationFailed', {}, { action: 'retry' });
  const key = (reason ? ERRORS[reason].copy : 'board.pending') as CopyKey;
  const spent = r.attempts >= MAX_AUTO_ATTEMPTS;
  return say(key, {}, { action: spent || key === 'board.unavailable' ? 'retry' : null });
}

export function cardView(i: CardInput): CardView {
  if (i.mode === 'disabled') return view(null, null, { hidden: true });
  const name = i.name ? t('board.name', { name: i.name }) : null;
  const withName = (v: CardView) => ({ ...v, name: v.state === 'board.firstAdd' ? null : name });

  // an attempt in progress: verification, then the request
  if (i.posting) {
    if (i.verify === 'interactive') return withName(say('board.tapToFinish', {}, { interactive: true }));
    if (i.firstAdd && i.name) return withName(say('board.firstAdd', { name: i.name }));
    if (i.verify === 'checking') return withName(say('board.checking'));
    return withName(say('board.adding'));
  }

  const r = i.record;
  if (r?.status === 'confirmed' && r.receipt) return withName(confirmed(i, r));
  if (r?.status === 'refused') return withName(refused(i, r));
  if (r?.status === 'pending') return withName(pending(i, r));

  // nothing submitted for this game
  const g = i.game;
  if (!g) return withName(view(null, null));
  if (g.eligibility !== 'ok' && !(g.eligibility === 'test' && i.mode === 'smoke')) return withName(say(INELIGIBLE[g.eligibility]));
  if (!i.storage) return say('board.storageOff');
  if (g.week === null) return withName(say('board.unknownWeek'));
  if (i.serverWeek && g.week !== i.serverWeek) return withName(say('board.lastWeek'));
  if (i.removedWeeks.includes(g.week)) return withName(say('board.removed'));
  if (!i.auto) return withName(say('board.autoOff'));
  if (i.mode === 'loading') return view(null, null, { loading: true });
  if (i.mode === 'unavailable') return withName(say('board.unavailable', {}, { action: 'retry' }));
  if (i.firstAdd && i.name) return withName(say('board.firstAdd', { name: i.name }));
  return withName(say('board.adding'));
}
