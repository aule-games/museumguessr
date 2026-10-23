// Response helpers: every Worker response carries the security headers from
// the one source (V12-13, V12-170), and API errors use the contract's
// envelope (docs/api.md "Errors").

import { ERRORS, type ApiError, type Reason } from '../../src/api/contract.ts';
import { SECURITY_HEADERS } from '../../src/security/headers.ts';

/** A copy of a response with the security headers set (assets keep their own body and status). */
export function secured(response: Response): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(name, value);
  return out;
}

/** A JSON API response; API answers are never cached unless a route says so. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return secured(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
    }),
  );
}

/** A personal answer (a device part, a receipt, smoke context): never stored by any cache. */
export const privateJson = (body: unknown, status = 200): Response => json(body, status, { 'Cache-Control': 'private, no-store' });

/** The error envelope `{ reason, retryable, retry_after?, request_id?, best? }` with the contract's status. */
export function apiError(reason: Reason, extra: Omit<ApiError, 'reason' | 'retryable'> = {}): Response {
  const { status, retryable } = ERRORS[reason];
  const headers: Record<string, string> = extra.retry_after !== undefined ? { 'Retry-After': String(extra.retry_after) } : {};
  return json({ reason, retryable, ...extra } satisfies ApiError, status, headers);
}
