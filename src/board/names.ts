// Generated board names (q3a, N17, M7, D13; V12-109). One DOM-free module
// shared by the page (the "You appear as <name>" preview) and the Worker
// (the public rows). A name is three words, "Quality Material Thing",
// derived from sha256 of the device key, so a device keeps the same name
// every week and nobody types a name. No suffix numbers.
//
// Stability rules: the word lists are append-only (src/board/name-words.ts)
// and a name version fixes how many words of each list it uses, so adding
// words changes no existing name. A name that contains a blocklisted word
// sequence (src/board/name-blocklist.json, `npm run names:block "<name>"`)
// is derived again with the next salt; every other name stays the same.

import { sha256Hex } from '../api/hash.ts';
import blocklist from './name-blocklist.json';
import { MATERIALS, QUALITIES, THINGS } from './name-words.ts';

/** The name rules in use; a new version may use more words of each list. */
export const NAMES_VERSION = 1;

/** Words of each list that each version uses (a prefix of the append-only lists). */
export const NAME_VERSIONS = {
  1: { qualities: 110, materials: 100, things: 100 },
} as const satisfies Record<number, { qualities: number; materials: number; things: number }>;

const SIZES = NAME_VERSIONS[NAMES_VERSION];

/** Distinct names of the current version. */
export const NAME_COMBINATIONS = SIZES.qualities * SIZES.materials * SIZES.things;

const HEX = /^[0-9a-f]{64}$/;

/** Lower-case word sequences that no name may contain (whole words, in order). */
export function blockedSequences(entries: readonly string[] = (blocklist as { entries: string[] }).entries): string[][] {
  return entries.map((e) => e.toLowerCase().split(/\s+/).filter(Boolean)).filter((w) => w.length > 0);
}

const BLOCKED = blockedSequences();

/** True when `words` contains one of the blocked sequences as consecutive words. */
export function isBlockedName(words: readonly string[], blocked: readonly (readonly string[])[] = BLOCKED): boolean {
  const lower = words.map((w) => w.toLowerCase());
  return blocked.some((seq) => {
    for (let i = 0; i + seq.length <= lower.length; i++) if (seq.every((w, j) => lower[i + j] === w)) return true;
    return false;
  });
}

/** 48 bits for salt `n`: windows of the hash first, then a mixed value of hash and salt. */
function bitsFor(hash: string, n: number): number {
  if (n < 5) return parseInt(hash.slice(n * 12, n * 12 + 12), 16);
  // Two 32-bit FNV-1a passes over "hash:salt", joined into 48 bits.
  const text = `${hash}:${n}`;
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ n;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(text.length - 1 - i), 0x5bd1e995) >>> 0;
  }
  return (a >>> 0) * 0x10000 + (b & 0xffff);
}

/** The three words for one salt. */
function wordsFor(hash: string, salt: number): [string, string, string] {
  let n = bitsFor(hash, salt);
  const q = n % SIZES.qualities;
  n = Math.floor(n / SIZES.qualities);
  const m = n % SIZES.materials;
  n = Math.floor(n / SIZES.materials);
  const t = n % SIZES.things;
  return [QUALITIES[q]!, MATERIALS[m]!, THINGS[t]!];
}

/**
 * The name for a player hash (64 lower-case hex characters, sha256 of the
 * device key). Throws on anything else, so a caller cannot seed it with the
 * raw key by mistake.
 */
export function nameFromHash(hash: string, blocked: readonly (readonly string[])[] = BLOCKED): string {
  if (!HEX.test(hash)) throw new Error('nameFromHash needs a sha256 hex digest');
  for (let salt = 0; salt < 64; salt++) {
    const words = wordsFor(hash, salt);
    if (!isBlockedName(words, blocked)) return words.join(' ');
  }
  throw new Error('no unblocked name within 64 salts; the blocklist is too broad');
}

/** sha256 of the device key's text: the Worker's player hash and the name's seed. */
export const playerHash = (key: string): Promise<string> => sha256Hex(key);

/** The generated name of a device key ("Quiet Amber Heron"). */
export async function boardName(key: string): Promise<string> {
  return nameFromHash(await playerHash(key));
}
