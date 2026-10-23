// Rate-limit bindings (ENG15; V12-84, V12-91). Three windows of 60 s:
// requests per IPv4 address or IPv6 /64 (POST before the known-game lookup,
// and every bearer read, retries included), new device-week rows per IP,
// and new submissions per device key (never charged for a known retry).
// Keys stay in memory; the binding sees only the derived key.

import { LIMITS } from '../../src/api/limits.ts';
import { ipKey } from './auth.ts';
import { Refused } from './errors.ts';
import type { RateLimiter } from './platform.ts';

/** Throws rate_limited (retry_after = the window) when the binding refuses. A missing binding allows. */
export async function charge(binding: RateLimiter | undefined, key: string): Promise<void> {
  if (!binding) return;
  const { success } = await binding.limit({ key });
  if (!success) throw new Refused('rate_limited', { retry_after: LIMITS.bindings.windowSeconds });
}

export const chargeIp = (binding: RateLimiter | undefined, ip: string | null) => charge(binding, ipKey(ip));
