// Canonical score payload (docs/api.md "Score payload and hashing"; V12-06).
// Fields in PAYLOAD_FIELDS order, nested answers and timeouts in made, when,
// kept order, coordinates as lat then lng. The Worker hashes this text with
// SHA-256 (payload_sha256); the page may send it as the POST body. DOM-free.

import { PAYLOAD_FIELDS, type Answers, type Point, type ScorePayload, type Timeout } from './contract.ts';

const point = (p: Point | null) => (p === null ? null : { lat: p.lat, lng: p.lng });
const answers = (a: Answers) => ({ made: point(a.made), when: a.when, kept: point(a.kept) });
const timeout = (t: Timeout) => ({ made: t.made, when: t.when, kept: t.kept });

/** The payload as canonical JSON text: fixed field order, no turnstile token, no unknown field. */
export function canonicalPayload(p: ScorePayload): string {
  const nested: Partial<Record<keyof ScorePayload, unknown>> = {
    answers: p.answers.map(answers),
    timed_out: p.timed_out.map(timeout),
  };
  const out: Record<string, unknown> = {};
  for (const field of PAYLOAD_FIELDS) out[field] = field in nested ? nested[field] : p[field];
  return JSON.stringify(out);
}
