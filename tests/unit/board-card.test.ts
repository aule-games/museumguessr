import { describe, expect, it } from 'vitest';
import type { Standing } from '../../src/api/contract';
import { cardView, type CardInput } from '../../src/board/card';
import { relativeReset, startLine, writeStanding } from '../../src/board/standing-line';
import type { GameRecord, StoredReceipt } from '../../src/board/store';
import { standingText } from '../../src/board/wording';
import { COPY } from '../../src/copy';
import { kv, WEEK } from './helpers/board';

const base = (over: Partial<CardInput> = {}): CardInput => ({
  storage: true,
  mode: 'on',
  serverWeek: WEEK,
  count: 40,
  game: { eligibility: 'ok', week: WEEK, total: 18240 },
  auto: true,
  record: null,
  ownReceipt: true,
  justConfirmed: false,
  personal: { name: 'Bold Ochre Lantern', best: null, weeks: [] },
  removedWeeks: [],
  posting: false,
  verify: 'idle',
  firstAdd: false,
  name: 'Bold Ochre Lantern',
  ...over,
});

const rc = (over: Partial<StoredReceipt> = {}): StoredReceipt => ({ row_id: 'row-1', week: WEEK, total: 18240, status: 'current', receipt_rank: 12, count: 40, standing: { kind: 'exact', rank: 12, tied: false }, improved: false, smoke: false, fp: 'fp', ...over });

const rec = (over: Partial<GameRecord> = {}): GameRecord => ({
  game_id: 'g1',
  game_ref: 'ref',
  src: 'none',
  week: WEEK,
  total: 18240,
  test: false,
  status: 'confirmed',
  outcome: 'added',
  payload: null,
  attempts: 1,
  next_at: 0,
  receipt: rc(),
  best: null,
  sent: [],
  at: 0,
  ...over,
});

const best = (total: number, standing: Standing | null = { kind: 'exact', rank: 3, tied: false }, row_id = 'row-1') => ({ row_id, total, standing });
const line = (over: Partial<CardInput>) => cardView(base(over)).status;
const state = (over: Partial<CardInput>) => cardView(base(over)).state;

describe('the board card states', () => {
  it('every row of the board-state table has its exact string [V12-117]', () => {
    expect(cardView(base({ mode: 'loading' }))).toMatchObject({ loading: true, status: null });
    expect(line({ firstAdd: true })).toBe("Your score goes on this week's board as Bold Ochre Lantern");
    expect(line({ posting: true, verify: 'idle' })).toBe('Adding…');
    expect(line({ posting: true, verify: 'checking' })).toBe('Checking…');
    expect(cardView(base({ posting: true, verify: 'interactive' }))).toMatchObject({ status: 'Tap to finish adding', interactive: true });
    expect(line({ record: rec(), justConfirmed: true })).toBe('Added: #12 of 40 this week');
    expect(line({ record: rec({ receipt: rc({ improved: true }) }), justConfirmed: true })).toBe('New best: #12 of 40 this week');
    expect(cardView(base({ record: rec({ status: 'refused', outcome: 'not_best', receipt: null, best: best(25000) }) }))).toMatchObject({
      status: 'Your best this week: 25,000 (#3 of 40 this week) · this game 18,240',
      note: "Ties and lower scores don't replace your best",
    });
    expect(line({ record: rec(), personal: { name: 'x', best: best(26000), weeks: [] } })).toBe('Replaced by a better game this week · 26,000');
    // not_best names the best without a standing; the card's earlier read supplies it
    expect(line({ record: rec({ status: 'refused', outcome: 'not_best', receipt: null, best: best(25000, null) }), personal: { name: 'x', best: best(25000), weeks: [] } })).toBe('Your best this week: 25,000 (#3 of 40 this week) · this game 18,240');
    expect(line({ record: rec({ receipt: rc({ status: 'removed' }) }) })).toBe('You removed your score this week');
    expect(line({ record: rec(), removedWeeks: [WEEK] })).toBe('You removed your score this week');
    expect(line({ record: rec(), personal: { name: 'x', best: null, weeks: [] } })).toBe('No longer on the board');
    expect(line({ record: rec(), ownReceipt: false })).toBe('No longer on the board');
    expect(line({ game: { eligibility: 'replay', week: WEEK, total: 1 } })).toBe('Not ranked (replay)');
    expect(line({ game: { eligibility: 'seen', week: WEEK, total: 1 } })).toBe('Not ranked (all objects seen before)');
    expect(line({ game: { eligibility: 'test', week: WEEK, total: 1 } })).toBe('Not ranked (test game)');
    expect(cardView(base({ mode: 'disabled' })).hidden).toBe(true);
    expect(line({ auto: false })).toBe('Automatic board entry is off');
    expect(cardView(base({ storage: false, name: null }))).toMatchObject({ status: "Your browser isn't keeping data, so this score can't be added", name: null });
    expect(cardView(base({ record: rec({ status: 'pending', outcome: 'rate_limited', receipt: null, attempts: 1 }) }))).toMatchObject({ status: 'Saved on this device; waiting to retry', action: null });
    expect(cardView(base({ record: rec({ status: 'pending', outcome: 'turnstile_failed', receipt: null }) }))).toMatchObject({ status: "Verification couldn't load", action: 'retry' });
    expect(cardView(base({ record: rec({ status: 'pending', outcome: null, receipt: null }), verify: 'failed' }))).toMatchObject({ status: "Verification couldn't load", action: 'retry' });
    expect(cardView(base({ record: rec({ status: 'pending', outcome: 'unavailable', receipt: null }) }))).toMatchObject({ status: 'The board is unavailable right now', action: 'retry' });
    expect(cardView(base({ mode: 'unavailable', record: rec(), justConfirmed: true }))).toMatchObject({ status: 'Score sent; the board is unavailable right now', action: 'retryList' });
    expect(line({ serverWeek: '2026-W44' as never })).toBe('Played last week · the board resets weekly');
    expect(line({ record: rec({ status: 'refused', outcome: 'week_closed', receipt: null }) })).toBe('Played last week · the board resets weekly');
    expect(line({ game: { eligibility: 'ok', week: null, total: 1 } })).toBe("Couldn't confirm which week this game belongs to");
    expect(line({ serverWeek: '2026-W44' as never, record: rec(), personal: { name: 'x', best: null, weeks: [{ week: WEEK, row_id: 'row-1', total: 18240, rank: 7 }] } })).toBe('Last week: #7');
    expect(line({ record: rec({ status: 'refused', outcome: 'invalid', receipt: null }) })).toBe("This game couldn't be added");
    expect(line({ record: rec({ status: 'refused', outcome: 'too_large', receipt: null }) })).toBe("This game couldn't be added");
    expect(line({ record: rec({ status: 'refused', outcome: 'duplicate', receipt: null }) })).toBe('This game has a different saved result');
    expect(cardView(base({ record: rec({ status: 'refused', outcome: 'update_page', receipt: null }) }))).toMatchObject({ status: 'Update the page before playing another game', action: 'reload' });
    expect(line({ record: rec({ status: 'refused', outcome: 'replay', receipt: null }) })).toBe('Not ranked (replay)');
    // the name line, except where the status already names the player
    expect(cardView(base({ record: rec(), justConfirmed: true })).name).toBe('You appear as Bold Ochre Lantern');
    expect(cardView(base({ firstAdd: true })).name).toBeNull();
    // every status string is a copy key
    for (const s of [state({ firstAdd: true }), state({ posting: true }), state({ record: rec(), justConfirmed: true })]) expect(s && s in COPY).toBe(true);
  });

  it('after an add the card shows the receipt rank even while the public copy is cached, and a test game in dark mode says it is not ranked [V12-119]', () => {
    // the read came before the POST: the receipt wins over the older personal best
    expect(line({ record: rec(), justConfirmed: true, personal: { name: 'x', best: null, weeks: [] } })).toBe('Added: #12 of 40 this week');
    expect(line({ record: rec({ receipt: rc({ smoke: true, receipt_rank: null, standing: null }) }), justConfirmed: true, mode: 'smoke' })).toBe('Added: Not ranked (test game)');
    expect(line({ mode: 'smoke', record: rec({ status: 'refused', outcome: 'not_best', receipt: null, best: best(25000, null) }) })).toBe('Your best this week: 25,000 (Not ranked (test game)) · this game 18,240');
  });
});

describe('rank wording', () => {
  it('omits "of N" below ten devices, says when a tie falls outside the fifty listed rows, and bounds estimates to the top half [V12-118]', () => {
    expect(standingText({ kind: 'exact', rank: 12, tied: false }, 40)).toBe('#12 of 40 this week');
    expect(standingText({ kind: 'exact', rank: 3, tied: false }, 9)).toBe('#3 this week');
    expect(standingText({ kind: 'exact', rank: 47, tied: true }, 300)).toBe('#47 of 300 this week');
    expect(standingText({ kind: 'exact', rank: 61, tied: true }, 300)).toBe('#61 (tied) · the board lists the first 50');
    // a tie at #47 whose row the submission order put after the fiftieth listed row
    expect(standingText({ kind: 'exact', rank: 47, tied: true }, 300, true)).toBe('#47 (tied) · the board lists the first 50');
    expect(standingText({ kind: 'exact', rank: 47, tied: false }, 300, true)).toBe('#47 of 300 this week');
    expect(standingText({ kind: 'percentile', top_percent: 12.2 }, 4000)).toBe('Top 13%');
    expect(standingText({ kind: 'percentile', top_percent: 80 }, 4000)).toBe('Top 50%');
    expect(standingText({ kind: 'distance', points_to_top_50: 1240 }, 4000)).toBe('1,240 points from the top 50');
    expect(standingText(null, 10)).toBeNull();
    expect(line({ count: 6, record: rec({ receipt: rc({ count: 6 }) }), justConfirmed: true })).toBe('Added: #12 this week');
    expect(line({ record: rec({ status: 'refused', outcome: 'not_best', receipt: null, best: best(25000, null) }) })).toBe('Your best this week: 25,000 · this game 18,240');
  });
});

describe('the start screen line', () => {
  it('shows the last confirmed best and rank with the relative reset, from the device only, until the week resets [V12-123]', () => {
    const store = kv();
    const now = Date.parse('2026-10-24T09:00:00Z');
    expect(startLine(store, now)).toBeNull();
    writeStanding(store, { week: WEEK, resets_at: '2026-10-26T00:00:00.000Z', total: 21340, rank: 12 });
    expect(startLine(store, now)).toBe('Your best this week: 21,340 · Last confirmed: #12 · resets in 2 days');
    expect(startLine(store, Date.parse('2026-10-25T20:00:00Z'))).toBe('Your best this week: 21,340 · Last confirmed: #12 · resets in 4 hours');
    expect(startLine(store, Date.parse('2026-10-26T00:00:01Z'))).toBeNull();
    expect(relativeReset('2026-10-26T00:00:00Z', Date.parse('2026-10-25T00:00:00Z'))).toBe('tomorrow');
    writeStanding(store, null);
    expect(startLine(store, now)).toBeNull();
  });
});
