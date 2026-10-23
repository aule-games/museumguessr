// Credentials and the client address (W6, ENG15, ENG22; V12-82, V12-84).
// The device key travels only as `Authorization: Bearer <key>`: 128 random
// bits as 22 base64url characters. The Worker keeps sha256 of it, never the
// key. The client IP is used in memory only, as a rate-limit key: the IPv4
// address, or the /64 prefix of an IPv6 address.

import { playerHash } from '../../src/board/names.ts';

/** 22 base64url characters whose last one carries only 2 bits: exactly 128 bits. */
export const KEY_PATTERN = /^[A-Za-z0-9_-]{21}[AQgw]$/;

export type Bearer = { kind: 'none' } | { kind: 'bad' } | { kind: 'key'; key: string };

export function bearer(request: Request): Bearer {
  const header = request.headers.get('Authorization');
  if (header === null) return { kind: 'none' };
  const m = /^Bearer ([^\s]+)$/.exec(header);
  return m && KEY_PATTERN.test(m[1]!) ? { kind: 'key', key: m[1]! } : { kind: 'bad' };
}

export { playerHash };

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function v4(text: string): number[] | null {
  const m = V4.exec(text);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

/** The eight 16-bit groups of an IPv6 address, or null. */
function v6Groups(text: string): number[] | null {
  let s = text.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const tail4 = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (tail4) {
    const p = v4(tail4[2]!);
    if (!p) return null;
    s = `${tail4[1]}${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 2 && fill === 0)) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * The rate-limit key of a client address: "v4:<address>" or "v6:<first four
 * groups>" (its /64). An IPv4-mapped IPv6 address counts as its IPv4 address.
 */
export function ipKey(address: string | null): string {
  const text = (address ?? '').trim();
  const four = v4(text);
  if (four) return `v4:${four.join('.')}`;
  const six = v6Groups(text);
  if (!six) return 'unknown';
  if (six.slice(0, 5).every((g) => g === 0) && six[5] === 0xffff) {
    return `v4:${[six[6]! >> 8, six[6]! & 255, six[7]! >> 8, six[7]! & 255].join('.')}`;
  }
  return `v6:${six.slice(0, 4).map((g) => g.toString(16).padStart(4, '0')).join(':')}`;
}

/** The client address Cloudflare reports (in memory only; never stored or logged). */
export const clientIp = (request: Request): string | null => request.headers.get('CF-Connecting-IP');
