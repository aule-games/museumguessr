// The one content gate (ENG20; V12-148, V12-106): public ranking and the
// final release need batches F and T promoted, or the founder's approved
// F-only fallback. The record is data/content-approval.json, written by the
// content step when the founder approves; until it says so the board stays
// off or dark. A missing or malformed record means not approved.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const APPROVAL_FILE = 'data/content-approval.json';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** { ok, why }: ok only for both batches promoted, or F promoted with an approved F-only fallback. */
export function contentApproved(root) {
  const path = join(root, APPROVAL_FILE);
  if (!existsSync(path)) return { ok: false, why: `${APPROVAL_FILE} does not exist yet (batches F and T are not promoted)` };
  let record;
  try {
    record = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { ok: false, why: `${APPROVAL_FILE} is not valid JSON` };
  }
  const promoted = (batch) => DATE.test(String(record?.[batch]?.promoted ?? ''));
  if (promoted('F') && promoted('T')) return { ok: true, why: 'batches F and T are promoted' };
  if (promoted('F') && DATE.test(String(record?.fallback?.approved ?? ''))) return { ok: true, why: 'batch F is promoted under the approved F-only fallback' };
  return { ok: false, why: `${APPROVAL_FILE} records F ${promoted('F') ? 'promoted' : 'not promoted'}, T ${promoted('T') ? 'promoted' : 'not promoted'} and no approved F-only fallback` };
}
