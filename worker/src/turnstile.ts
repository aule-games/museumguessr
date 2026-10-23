// Turnstile siteverify (ENG14; V12-92). Runs only at POST step 7, after the
// rate limits. It checks success, the hostname expected in this environment
// (TURNSTILE_HOSTNAME) and the action, and passes the client IP (in memory
// only). Cloudflare's documented test keys answer with
// metadata.result_with_testing_key and no action; they pass only where
// TURNSTILE_TEST_KEYS is "1" (local wrangler dev), so production refuses
// dummy credentials. Every retry needs a fresh token from the page.

import { TURNSTILE_ACTION } from '../../src/api/contract.ts';
import type { Ctx } from './platform.ts';

export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const PRODUCTION_HOSTNAME = 'museumguessr.com';

export type Verdict = 'ok' | 'failed' | 'unavailable';

interface SiteverifyAnswer {
  success?: unknown;
  hostname?: unknown;
  action?: unknown;
  metadata?: { result_with_testing_key?: unknown };
}

export async function verifyTurnstile(ctx: Ctx, token: string, ip: string | null): Promise<Verdict> {
  const secret = ctx.env.TURNSTILE_SECRET;
  if (!secret) return 'unavailable';
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set('remoteip', ip);
  let answer: SiteverifyAnswer;
  try {
    const res = await ctx.fetch(SITEVERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return 'unavailable';
    answer = (await res.json()) as SiteverifyAnswer;
  } catch {
    return 'unavailable';
  }
  if (answer.success !== true) return 'failed';
  const testKey = answer.metadata?.result_with_testing_key === true;
  if (testKey && ctx.env.TURNSTILE_TEST_KEYS !== '1') return 'failed';
  if (answer.hostname !== (ctx.env.TURNSTILE_HOSTNAME ?? PRODUCTION_HOSTNAME)) return 'failed';
  if (!testKey && answer.action !== TURNSTILE_ACTION) return 'failed';
  return 'ok';
}
