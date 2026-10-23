// POST /api/v1/scores, GET and DELETE /api/v1/scores/<row_id> (W6, ENG1,
// ENG14, ENG15, ENG19, ENG22, N4; V12-83 to V12-97). The POST runs the
// steps of docs/api.md in order, and nothing writes D1 before step 7 has
// passed. Step 8 is one transactional batch: insert, or improve only when
// the total is higher and no tombstone exists; the receipt changes are
// conditioned on the row's current game id, so a lost race writes nothing
// and answers `removed` or a fresh `not_best`.

import { CONTRACT_VERSION, type Best, type Receipt, type ReceiptResponse, type ReceiptStatus, type ScorePayload, type ScoreResponse, type Week } from '../../src/api/contract.ts';
import { LIMITS } from '../../src/api/limits.ts';
import { nameFromHash } from '../../src/board/names.ts';
import { SCORING_VERSION } from '../../src/scoring/config.ts';
import { checkRevisions, rescore } from './answers.ts';
import { bearer, clientIp, ipKey, playerHash } from './auth.ts';
import { projectionOf, wantsSmoke, type Modes } from './board.ts';
import { Refused, store } from './errors.ts';
import type { Ctx, D1Database } from './platform.ts';
import { parseScoreRequest, payloadHash, readBody } from './payload.ts';
import { cachedPublicBoard, dropCachedBoard, exactRankSql, readProjection, rebuild, rebuildSql, CUTOFF_SQL } from './projection.ts';
import { json, privateJson } from './respond.ts';
import { MAX_BUCKET_ROWS, standingOf } from './standing.ts';
import { charge, chargeIp } from './throttle.ts';
import { verifyTurnstile } from './turnstile.ts';
import { currentWeek, resetsAt } from './weeks.ts';

export const ROW_ID = /^[A-Za-z0-9_-]{12}$/;

/** A random 72-bit public row id (12 base64url characters). */
export function newRowId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_');
}

interface ReceiptRow {
  game_id: string;
  player_hash: string;
  week: Week;
  row_id: string;
  total: number;
  payload_sha256: string;
  status: ReceiptStatus;
  receipt_rank: number | null;
  count: number;
  replaced: number;
  smoke: number;
}

interface BestRow {
  game_id: string;
  row_id: string;
  total: number;
  hidden: number;
}

const tableOf = (smoke: boolean) => (smoke ? 'smoke_scores' : 'scores');
const hiddenCol = (smoke: boolean) => (smoke ? '0 AS hidden' : 'hidden');

async function currentBest(db: D1Database, smoke: boolean, week: Week, hash: string): Promise<BestRow | null> {
  return db.prepare(`SELECT game_id, row_id, total, ${hiddenCol(smoke)} FROM ${tableOf(smoke)} WHERE week = ?1 AND player_hash = ?2`).bind(week, hash).first<BestRow>();
}

const tiedSql = 'SELECT COUNT(*) AS n FROM (SELECT 1 FROM scores WHERE week = ?1 AND hidden = 0 AND total = ?2 LIMIT 2)';

function receiptOf(r: ReceiptRow, current: BestRow | null, best: Best | null): Receipt {
  return {
    game_id: r.game_id,
    current_game_id: current?.game_id ?? null,
    row_id: r.row_id,
    week: r.week,
    total: r.total,
    status: r.status,
    receipt_rank: r.smoke ? null : r.receipt_rank,
    count: r.smoke ? 0 : r.count,
    best,
  };
}

/** A known game's own receipt (step 2): no standing work, so a retry stays cheap. */
async function knownAnswer(db: D1Database, r: ReceiptRow): Promise<Response> {
  const current = r.status === 'removed' ? null : await currentBest(db, !!r.smoke, r.week, r.player_hash);
  const best = current && !current.hidden ? { row_id: current.row_id, total: current.total, standing: null } : null;
  const body: ScoreResponse = { receipt: receiptOf(r, current, best), replaced: !!r.replaced, smoke: !!r.smoke };
  return privateJson(body, 200);
}

/** Contract version skew (ENG19): the current contract, or the previous one only through an adapter with the same scoring version. */
export function compatible(p: ScorePayload): boolean {
  if (p.scoring_version !== SCORING_VERSION) return false;
  return p.client_version === CONTRACT_VERSION; // No previous contract exists at version 1, so no adapter yet.
}

const UPSERT_SCORE = `INSERT INTO scores (week, player_hash, row_id, name, game_id, payload_sha256, total, points, item_ids, deck_kind, fresh, hidden, seq, created_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, (SELECT seq + 1 FROM board_weeks WHERE week = ?1), ?12
WHERE NOT EXISTS (SELECT 1 FROM tombstones WHERE week = ?1 AND player_hash = ?2 AND smoke = 0)
ON CONFLICT (week, player_hash) DO UPDATE SET name = excluded.name, game_id = excluded.game_id, payload_sha256 = excluded.payload_sha256,
  total = excluded.total, points = excluded.points, item_ids = excluded.item_ids, deck_kind = excluded.deck_kind, fresh = excluded.fresh,
  seq = excluded.seq, created_at = excluded.created_at
WHERE excluded.total > scores.total`;

const UPSERT_SMOKE = `INSERT INTO smoke_scores (week, player_hash, row_id, game_id, payload_sha256, total, points, item_ids, deck_kind, fresh, created_at)
SELECT ?1, ?2, ?3, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
WHERE NOT EXISTS (SELECT 1 FROM tombstones WHERE week = ?1 AND player_hash = ?2 AND smoke = 1)
ON CONFLICT (week, player_hash) DO UPDATE SET game_id = excluded.game_id, payload_sha256 = excluded.payload_sha256,
  total = excluded.total, points = excluded.points, item_ids = excluded.item_ids, deck_kind = excluded.deck_kind, fresh = excluded.fresh,
  created_at = excluded.created_at
WHERE excluded.total > smoke_scores.total`;

const insertReceiptSql = (smoke: boolean) => `INSERT INTO receipts (game_id, player_hash, week, row_id, total, payload_sha256, status, receipt_rank, count, replaced, smoke, created_at)
SELECT s.game_id, s.player_hash, s.week, s.row_id, s.total, s.payload_sha256, 'current',
  ${smoke ? 'NULL' : `CASE WHEN s.hidden = 0 THEN ${exactRankSql('s.week', 's.total')} END`},
  ${smoke ? '0' : '(SELECT n FROM board_weeks w WHERE w.week = s.week)'},
  EXISTS (SELECT 1 FROM receipts r WHERE r.week = s.week AND r.player_hash = s.player_hash AND r.status = 'current' AND r.smoke = ${smoke ? 1 : 0}),
  ${smoke ? 1 : 0}, ?4
FROM ${tableOf(smoke)} s WHERE s.week = ?2 AND s.player_hash = ?3 AND s.game_id = ?1
ON CONFLICT (game_id) DO NOTHING`;

const markReplacedSql = (smoke: boolean) => `UPDATE receipts SET status = 'replaced'
WHERE week = ?1 AND player_hash = ?2 AND status = 'current' AND smoke = ${smoke ? 1 : 0} AND game_id != ?3
  AND EXISTS (SELECT 1 FROM ${tableOf(smoke)} WHERE week = ?1 AND player_hash = ?2 AND game_id = ?3)`;

/** The rebuild runs only when this game won and can change the listed 50. */
const WON_AND_LISTED = 'EXISTS (SELECT 1 FROM scores WHERE week = ?1 AND player_hash = ?3 AND game_id = ?4 AND hidden = 0) AND (cutoff_total IS NULL OR ?5 >= cutoff_total)';

export async function postScore(request: Request, ctx: Ctx, modes: Modes): Promise<Response> {
  // 1. Bounded body, exact schema, credential and version shape; then the request-IP window.
  const auth = bearer(request);
  const text = await readBody(request, LIMITS.maxBodyBytes);
  if (text === 'too_large') throw new Refused('too_large');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Refused('invalid');
  }
  const parsed = parseScoreRequest(value);
  if (!parsed || auth.kind !== 'key') throw new Refused('invalid');
  const { payload, token } = parsed;
  const ip = clientIp(request);
  await chargeIp(ctx.env.IP_LIMIT, ip);
  const mode = await modes.read(ctx);
  if (mode === 'off' || (mode === 'dark' && !payload.test_assisted)) throw new Refused('board_disabled');
  const smoke = mode === 'dark';
  const hash = await playerHash(auth.key);
  const digest = await payloadHash(payload);
  const db = store(ctx);

  // 2. A known game: only its owner with the same payload gets its receipt (no limits, no verification).
  const known = await db.prepare('SELECT * FROM receipts WHERE game_id = ?1').bind(payload.game_id).first<ReceiptRow>();
  if (known) {
    if (known.player_hash !== hash || known.payload_sha256 !== digest || !!known.smoke !== smoke) throw new Refused('duplicate');
    return knownAnswer(db, known);
  }

  // 3. A removed device-week stays removed.
  const week = currentWeek(ctx.now());
  const tomb = await db.prepare('SELECT 1 AS x FROM tombstones WHERE week = ?1 AND player_hash = ?2 AND smoke = ?3').bind(week, hash, smoke ? 1 : 0).first();
  if (tomb) throw new Refused('removed');

  // 4. Eligibility, contract and scoring versions, the server week, answer revisions.
  if (payload.deck_kind === 'replay' || (mode === 'on' && payload.test_assisted)) throw new Refused('replay');
  if (!compatible(payload)) throw new Refused('update_page');
  if (payload.board_week !== week) throw new Refused('week_closed');
  const revisions = checkRevisions(payload.item_ids, payload.answers_revs);
  if (revisions !== 'ok') throw new Refused(revisions);

  // 5. Rescore with the shared scorer and the bundled keys.
  const { total, points } = rescore(payload);

  // 6. Not higher than this week's best: nothing is written.
  const prior = await currentBest(db, smoke, week, hash);
  if (prior && prior.total >= total) throw new Refused('not_best', { best: { row_id: prior.row_id, total: prior.total, standing: null } });

  // 7. Per-key and new-row windows, then siteverify.
  await charge(ctx.env.KEY_LIMIT, hash);
  if (!prior) await charge(ctx.env.NEW_ROW_LIMIT, ipKey(ip));
  const verdict = await verifyTurnstile(ctx, token, ip);
  if (verdict === 'failed') throw new Refused('turnstile_failed');
  if (verdict === 'unavailable') throw new Refused('unavailable');

  // 8. One transactional batch.
  const nowIso = new Date(ctx.now()).toISOString();
  const rowId = prior?.row_id ?? newRowId();
  const values = [week, hash, rowId, smoke ? '' : nameFromHash(hash), payload.game_id, digest, total, JSON.stringify(points), JSON.stringify(payload.item_ids), payload.deck_kind, payload.fresh ? 1 : 0, nowIso];
  const statements = smoke
    ? [db.prepare(UPSERT_SMOKE).bind(...values)]
    : [db.prepare('INSERT INTO board_weeks (week, updated_at) VALUES (?1, ?2) ON CONFLICT (week) DO NOTHING').bind(week, nowIso), db.prepare(UPSERT_SCORE).bind(...values)];
  statements.push(
    db.prepare(insertReceiptSql(smoke)).bind(payload.game_id, week, hash, nowIso),
    db.prepare(markReplacedSql(smoke)).bind(week, hash, payload.game_id),
  );
  if (!smoke) {
    statements.push(db.prepare(rebuildSql(WON_AND_LISTED)).bind(week, nowIso, hash, payload.game_id, total));
    statements.push(db.prepare(`${CUTOFF_SQL} AND (${WON_AND_LISTED})`).bind(week, nowIso, hash, payload.game_id, total));
  }
  const results = await db.batch(statements);
  const written = results[smoke ? 0 : 1]!.meta.changes > 0;

  const mine = await db.prepare('SELECT * FROM receipts WHERE game_id = ?1').bind(payload.game_id).first<ReceiptRow>();
  if (!written) {
    // A lost race: the same game won in another request, a tombstone won, or a higher best did.
    if (mine) {
      if (mine.player_hash !== hash || mine.payload_sha256 !== digest) throw new Refused('duplicate');
      return knownAnswer(db, mine);
    }
    const removed = await db.prepare('SELECT 1 AS x FROM tombstones WHERE week = ?1 AND player_hash = ?2 AND smoke = ?3').bind(week, hash, smoke ? 1 : 0).first();
    if (removed) throw new Refused('removed');
    const fresh = await currentBest(db, smoke, week, hash);
    throw new Refused('not_best', fresh ? { best: { row_id: fresh.row_id, total: fresh.total, standing: null } } : {});
  }
  if (!mine) throw new Error('receipt missing after a winning write');
  const tied = smoke ? false : ((await db.prepare(tiedSql).bind(week, total).first<{ n: number }>())?.n ?? 0) > 1;
  const best: Best = { row_id: mine.row_id, total: mine.total, standing: mine.receipt_rank === null ? null : { kind: 'exact', rank: mine.receipt_rank, tied } };
  const body: ScoreResponse = { receipt: receiptOf(mine, { game_id: mine.game_id, row_id: mine.row_id, total: mine.total, hidden: 0 }, best), replaced: !!mine.replaced, smoke };
  return privateJson(body, 201);
}

interface RowLookup {
  week: Week;
  player_hash: string;
  row_id: string;
  total: number;
  hidden: number;
  game_id: string;
  final_rank: number | null;
}

function rowIdOf(path: string): string {
  const id = path.slice(path.lastIndexOf('/') + 1);
  if (!ROW_ID.test(id)) throw new Refused('invalid');
  return id;
}

/** GET /api/v1/scores/<row_id>: the owner's receipt of the row's current game, with its standing. */
export async function getReceipt(request: Request, ctx: Ctx, modes: Modes): Promise<Response> {
  const auth = bearer(request);
  if (auth.kind !== 'key') throw new Refused('invalid');
  const rowId = rowIdOf(new URL(request.url).pathname);
  await chargeIp(ctx.env.IP_LIMIT, clientIp(request));
  const mode = await modes.read(ctx);
  const smoke = mode === 'dark' && wantsSmoke(request);
  const hash = await playerHash(auth.key);
  const db = store(ctx);
  const week = currentWeek(ctx.now());
  const row = await db
    .prepare(`SELECT week, player_hash, row_id, total, ${hiddenCol(smoke)}, game_id, ${smoke ? 'NULL AS final_rank' : 'final_rank'} FROM ${tableOf(smoke)} WHERE row_id = ?1`)
    .bind(rowId)
    .first<RowLookup>();
  if (!row) throw new Refused('not_found');
  if (row.player_hash !== hash) throw new Refused('duplicate');
  if (row.hidden) throw new Refused('not_found');
  const r = await db.prepare('SELECT * FROM receipts WHERE game_id = ?1').bind(row.game_id).first<ReceiptRow>();
  if (!r) throw new Refused('not_found');
  if (smoke) {
    const body: ReceiptResponse = { receipt: receiptOf(r, row, { row_id: row.row_id, total: row.total, standing: null }), standing: null, final_rank: null, count: 0, week: row.week, resets_at: resetsAt(row.week), cutoff_total: null };
    return privateJson(body);
  }
  const p = row.week === week && mode === 'on' ? projectionOf(await cachedPublicBoard(ctx, () => db, new URL(request.url).origin, week, mode)) : await readProjection(db, row.week, ctx.now());
  const standing = row.week === week ? await standingOf(db, p, row, LIMITS.personalReadRows - 4 - MAX_BUCKET_ROWS - 2) : null;
  const body: ReceiptResponse = {
    receipt: receiptOf(r, row, { row_id: row.row_id, total: row.total, standing }),
    standing,
    final_rank: row.week === week ? null : row.final_rank,
    count: p.n,
    week: row.week,
    resets_at: resetsAt(row.week),
    cutoff_total: p.cutoff,
  };
  return privateJson(body);
}

/**
 * DELETE /api/v1/scores/<row_id> (V12-97): the owner removes a weekly best.
 * The row and its name and points go; receipts say removed; a tombstone for
 * that device-week stops a late submission recreating it; the public
 * projection is rebuilt and this location's cached copy dropped. Works in
 * every board mode. A repeated DELETE answers the same.
 */
export async function deleteScore(request: Request, ctx: Ctx): Promise<Response> {
  const auth = bearer(request);
  if (auth.kind !== 'key') throw new Refused('invalid');
  const rowId = rowIdOf(new URL(request.url).pathname);
  await chargeIp(ctx.env.IP_LIMIT, clientIp(request));
  const hash = await playerHash(auth.key);
  const db = store(ctx);
  const nowIso = new Date(ctx.now()).toISOString();
  for (const smoke of [false, true]) {
    const row = await db.prepare(`SELECT week, player_hash FROM ${tableOf(smoke)} WHERE row_id = ?1`).bind(rowId).first<{ week: Week; player_hash: string }>();
    if (!row) continue;
    if (row.player_hash !== hash) throw new Refused('duplicate');
    const flag = smoke ? 1 : 0;
    await db.batch([
      db.prepare('INSERT INTO tombstones (week, player_hash, smoke, row_id, removed_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT DO NOTHING').bind(row.week, hash, flag, rowId, nowIso),
      db.prepare("UPDATE receipts SET status = 'removed' WHERE week = ?1 AND player_hash = ?2 AND smoke = ?3 AND status != 'removed'").bind(row.week, hash, flag),
      db.prepare(`DELETE FROM ${tableOf(smoke)} WHERE row_id = ?1 AND player_hash = ?2`).bind(rowId, hash),
      ...(smoke ? [] : rebuild(db, row.week, nowIso)),
    ]);
    if (!smoke) await dropCachedBoard(ctx.cache, new URL(request.url).origin, row.week);
    return json({ removed: true, row_id: rowId, week: row.week });
  }
  const tomb = await db.prepare('SELECT week, player_hash FROM tombstones WHERE row_id = ?1').bind(rowId).first<{ week: Week; player_hash: string }>();
  if (!tomb) throw new Refused('not_found');
  if (tomb.player_hash !== hash) throw new Refused('duplicate');
  return json({ removed: true, row_id: rowId, week: tomb.week });
}
