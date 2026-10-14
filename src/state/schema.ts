// Versioned saved-state contract (DX18, E6, ENG14, ENG37). Every Pages project
// on the same account shares one origin, so storage keys are namespaced.

import { revalidateSrc, type Src } from '../analytics/channels.ts';
import type { Step } from '../analytics/events.ts';
import { SCORING_VERSION } from '../scoring/config.ts';
import type { LatLng } from '../scoring/geo.ts';

/** Bump when the shape of saved state changes. */
export const STATE_VERSION = 1;

export const KEYS = {
  save: 'museumguessr:v1:save',
  last: 'museumguessr:v1:last',
  test: 'museumguessr:test',
  /** sessionStorage */
  session: 'museumguessr:v1:session',
  bootFailures: 'museumguessr:v1:boot-failures',
  chunkReload: 'museumguessr:v1:chunk-reload',
  /** The first-visit tour ran (done or skipped); it starts again only from the menu. */
  tour: 'museumguessr:v1:tour',
} as const;

export type Phase = 'answering' | 'reveal';

export interface RoundAnswers {
  kept: LatLng | null;
  made: LatLng | null;
  when: number | null;
}

export interface RoundResult {
  kept: { points: number; km: number };
  made: { points: number; km: number };
  when: { points: number; yearsOff: number };
  points: number;
  skipped: boolean;
}

export interface Versions {
  state_version: number;
  scoring_version: number;
  items_version: string;
}

export interface GameState extends Versions {
  game_id: string;
  /** Write counter for cross-tab safety (ENG30). */
  rev: number;
  /** Channel captured at game start (PH3). */
  src: Src;
  item_ids: string[];
  /** 0-based round index. */
  round: number;
  step: Step;
  phase: Phase;
  answers: RoundAnswers[];
  results: (RoundResult | null)[];
  /** Ledger of events already handed to analytics: `${game_id}:${event}:${round}:${step}` (ENG14, R3). */
  sent: string[];
  finished: boolean;
}

/** A finished game, kept next to the active save for "Review your 10" (ENG37). */
export interface FinishedSnapshot extends Versions {
  game_id: string;
  item_ids: string[];
  answers: RoundAnswers[];
  results: RoundResult[];
  total: number;
}

export function currentVersions(itemsVersion: string): Versions {
  return { state_version: STATE_VERSION, scoring_version: SCORING_VERSION, items_version: itemsVersion };
}

export function versionsMatch(v: Partial<Versions>, itemsVersion: string): boolean {
  return (
    v.state_version === STATE_VERSION &&
    v.scoring_version === SCORING_VERSION &&
    v.items_version === itemsVersion
  );
}

export function serialize(state: GameState | FinishedSnapshot): string {
  return JSON.stringify(state);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isLatLngOrNull = (v: unknown) =>
  v === null || (isObj(v) && Number.isFinite(v.lat) && Number.isFinite(v.lng));

function answersOk(a: unknown, n: number): a is RoundAnswers[] {
  return (
    Array.isArray(a) &&
    a.length === n &&
    a.every(
      (r) =>
        isObj(r) &&
        isLatLngOrNull(r.kept) &&
        isLatLngOrNull(r.made) &&
        (r.when === null || Number.isInteger(r.when)),
    )
  );
}

function resultOk(r: unknown): r is RoundResult {
  return isObj(r) && Number.isFinite(r.points) && typeof r.skipped === 'boolean';
}

/**
 * Parse a saved game. Returns null (start a new game) on a parse error, a
 * version mismatch or unknown item ids (E6, DX18).
 */
export function parseSave(raw: string | null, itemsVersion: string, knownIds: readonly string[]): GameState | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || !versionsMatch(v as Partial<Versions>, itemsVersion)) return null;
  const ids = v.item_ids;
  if (!Array.isArray(ids) || ids.length !== knownIds.length || ids.some((id, i) => id !== knownIds[i])) return null;
  const n = ids.length;
  if (
    typeof v.game_id !== 'string' ||
    !Number.isInteger(v.rev) ||
    !Number.isInteger(v.round) ||
    (v.round as number) < 0 ||
    (v.round as number) >= n ||
    !['kept', 'made', 'when'].includes(v.step as string) ||
    !['answering', 'reveal'].includes(v.phase as string) ||
    !answersOk(v.answers, n) ||
    !Array.isArray(v.results) ||
    v.results.length !== n ||
    !v.results.every((r) => r === null || resultOk(r)) ||
    !Array.isArray(v.sent) ||
    !v.sent.every((s) => typeof s === 'string') ||
    typeof v.finished !== 'boolean'
  ) {
    return null;
  }
  return { ...(v as unknown as GameState), src: revalidateSrc(v.src) };
}

export interface ParsedSnapshot {
  snapshot: FinishedSnapshot;
  /** False when the snapshot was saved under other versions: show the total only (ENG37). */
  current: boolean;
}

export function parseSnapshot(raw: string | null, itemsVersion: string): ParsedSnapshot | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as FinishedSnapshot;
    if (!isObj(v) || !Number.isFinite(v.total)) return null;
    const current =
      versionsMatch(v, itemsVersion) &&
      Array.isArray(v.item_ids) &&
      answersOk(v.answers, v.item_ids.length) &&
      Array.isArray(v.results) &&
      v.results.every(resultOk);
    return { snapshot: v, current };
  } catch {
    return null;
  }
}
