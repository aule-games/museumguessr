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
} as const;

/** Requests one IP may send in a day without ever tripping the WAF burst rule. */
export const WAF_DAILY_CEILING_PER_IP = (LIMITS.waf.requests * 86_400) / LIMITS.waf.periodSeconds;
