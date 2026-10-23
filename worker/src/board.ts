// GET /api/v1/board (W6, ENG2, H2; V12-95, V12-99, V12-100, V12-105).
// The mode check runs before any cache or ranking access. Off: disabled.
// Dark: disabled for ordinary clients; with the test header, the server
// week (and, with a key, that owner's smoke bests), private and uncached.
// On: the public top 50 (cached copy or the one projection row); with a
// key, the device part is added uncached (`private, no-store`): its name,
// this week's best with its standing and at most one best per retained
// week, newest first. No history paging; game ids never appear.

import { LIMITS } from '../../src/api/limits.ts';
import { SMOKE_READ_HEADER, type BoardMode, type DarkBoard, type PersonalBoard, type PublicBoard, type Week, type WeekBest } from '../../src/api/contract.ts';
import { nameFromHash } from '../../src/board/names.ts';
import { bearer, clientIp, playerHash } from './auth.ts';
import { Refused, store } from './errors.ts';
import type { Ctx, D1Database } from './platform.ts';
import { cachedPublicBoard, type Projection } from './projection.ts';
import { json, privateJson } from './respond.ts';
import { MAX_BUCKET_ROWS, standingOf } from './standing.ts';
import { chargeIp } from './throttle.ts';
import { currentWeek, resetsAt, retainedWeeks } from './weeks.ts';

export interface Modes {
  read(ctx: Ctx): Promise<BoardMode>;
}

/** The test header selects smoke context; only its exact value "1" counts, and only in dark mode. */
export const wantsSmoke = (request: Request): boolean => request.headers.get(SMOKE_READ_HEADER) === '1';

const DISABLED = { disabled: true } as const;

interface OwnerRow {
  week: Week;
  row_id: string;
  total: number;
  hidden: number;
  game_id: string;
  final_rank: number | null;
}

const weekList = (weeks: readonly Week[], from: number) => weeks.map((_, i) => `?${i + from}`).join(', ');

/** Rows the personal read may still spend on the in-bucket scan. */
const scanBudget = (spent: number) => LIMITS.personalReadRows - spent - MAX_BUCKET_ROWS - 2;

export async function personalBoard(ctx: Ctx, db: D1Database, hash: string, p: Projection): Promise<PersonalBoard> {
  const weeks = retainedWeeks(ctx.now());
  const rows = (
    await db
      .prepare(`SELECT week, row_id, total, hidden, game_id, final_rank FROM scores WHERE player_hash = ?1 AND week IN (${weekList(weeks, 2)})`)
      .bind(hash, ...weeks)
      .all<OwnerRow>()
  ).results.sort((a, b) => (a.week < b.week ? 1 : -1));
  const current = rows.find((r) => r.week === weeks[0]) ?? null;
  const receipt = current
    ? await db.prepare('SELECT receipt_rank FROM receipts WHERE game_id = ?1').bind(current.game_id).first<{ receipt_rank: number | null }>()
    : null;
  const list: WeekBest[] = rows.map((r) => ({
    week: r.week,
    row_id: r.row_id,
    total: r.total,
    rank: r.hidden ? null : r === current ? (receipt?.receipt_rank ?? null) : r.final_rank,
  }));
  const spent = weeks.length + 2;
  const best = current ? { row_id: current.row_id, total: current.total, standing: await standingOf(db, p, current, scanBudget(spent)) } : null;
  return { name: nameFromHash(hash), best, weeks: list };
}

export async function smokePersonal(ctx: Ctx, db: D1Database, hash: string): Promise<PersonalBoard> {
  const weeks = retainedWeeks(ctx.now());
  const rows = (
    await db
      .prepare(`SELECT week, row_id, total FROM smoke_scores WHERE player_hash = ?1 AND week IN (${weekList(weeks, 2)})`)
      .bind(hash, ...weeks)
      .all<{ week: Week; row_id: string; total: number }>()
  ).results.sort((a, b) => (a.week < b.week ? 1 : -1));
  const current = rows.find((r) => r.week === weeks[0]);
  return {
    name: nameFromHash(hash),
    best: current ? { row_id: current.row_id, total: current.total, standing: null } : null,
    weeks: rows.map((r) => ({ week: r.week, row_id: r.row_id, total: r.total, rank: null })),
  };
}

export const projectionOf = (b: PublicBoard): Projection => ({ week: b.week, n: b.count, rows: [...b.rows], cutoff: b.cutoff_total, updated_at: b.updated_at });

export async function getBoard(request: Request, ctx: Ctx, modes: Modes): Promise<Response> {
  const auth = bearer(request);
  if (auth.kind === 'bad') throw new Refused('invalid');
  if (auth.kind === 'key') await chargeIp(ctx.env.IP_LIMIT, clientIp(request));
  const mode = await modes.read(ctx);
  if (mode === 'off') return json(DISABLED);
  const week = currentWeek(ctx.now());
  if (mode === 'dark') {
    if (!wantsSmoke(request)) return json(DISABLED);
    const dark: DarkBoard = { smoke: true, week, resets_at: resetsAt(week) };
    if (auth.kind === 'none') return privateJson(dark);
    return privateJson({ ...dark, personal: await smokePersonal(ctx, store(ctx), await playerHash(auth.key)) });
  }
  const board = await cachedPublicBoard(ctx, () => store(ctx), new URL(request.url).origin, week, mode);
  if (auth.kind === 'none') return json(board);
  const personal = await personalBoard(ctx, store(ctx), await playerHash(auth.key), projectionOf(board));
  return privateJson({ ...board, personal });
}
