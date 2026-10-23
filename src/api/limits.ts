// One limits module (M3, ENG15; V12-24). Every number docs/ops.md "Hosting
// and limits" names lives here; a docs test checks that the runbook states
// these values. DOM-free: the page, the Worker and the scripts share it.

import { MAX_BODY_BYTES } from './contract.ts';

export const LIMITS = {
  /** API request bodies are read as a stream up to this many bytes. */
  maxBodyBytes: MAX_BODY_BYTES,
  /** Rows on the public weekly board. */
  boardTop: 50,
  /** The edge WAF rule on /api/*: a burst limit per IP, not a daily quota. */
  waf: { requests: 20, periodSeconds: 10, mitigationSeconds: 10 },
  /** Worker rate-limit bindings per window; IPv6 addresses are keyed by their /64. */
  bindings: { windowSeconds: 60, requestsPerIp: 30, newRowsPerIp: 5, submissionsPerKey: 3, ipv6PrefixBits: 64 },
  /** Points on a hard object that count as "Hard one nailed". */
  hardNailedPoints: 2400,
  /** The Kept-city cap of the pool is max(3, floor(cityCapRatio × N)). */
  cityCapRatio: 0.08,
  /** Top-50 totals at or above this feed the saturation tripwire in board:list. */
  saturationTotal: 29500,
  /** Seconds the Worker keeps the board mode in memory (ENG3). */
  modeCacheSeconds: 30,
  /** Longest life of the cached public top 50; never past Monday 00:00 UTC (ENG2). */
  publicCacheSeconds: 60,
  /** Rows the owner's board read may scan, standing included (ENG18). */
  personalReadRows: 100,
  /** Rows of each table one purge run deletes (N2). */
  purgeChunkRows: 500,
  /** Hours around the Monday 00:00 UTC reset in which the purge does not run (N2). */
  purgeQuietHours: 2,
} as const;

/** Requests one IP may send in a day without ever tripping the WAF burst rule. */
export const WAF_DAILY_CEILING_PER_IP = (LIMITS.waf.requests * 86_400) / LIMITS.waf.periodSeconds;
