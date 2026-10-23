// The board's device key (W6, N3; V12-81, V12-82). A random 128-bit
// base64url credential, created the first time the board card shows,
// inside the named Web Lock so two tabs opening their first card at once
// end with one key (read, check, write under the lock). It goes only to
// this site's API, as `Authorization: Bearer <key>`; never in a URL, a body,
// analytics or a log. Every POST and DELETE reads it again first, and each
// local receipt stores a fingerprint of the key that made it, so a receipt
// from an older key is never shown as this device's.

import { sha256Hex } from '../api/hash.ts';
import { KEYS } from '../state/schema.ts';
import type { KV } from '../storage/guarded.ts';

/** The Web Locks name for creating the key (N3). */
export const KEY_LOCK = 'museumguessr-board-key';

const KEY = /^[A-Za-z0-9_-]{22}$/;

export const isKey = (v: unknown): v is string => typeof v === 'string' && KEY.test(v);

/** 16 random bytes as base64url without padding (22 characters). */
export function newKey(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let bin = '';
  for (const b of random(16)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The stored key, or null when there is none (or it is damaged). */
export function readKey(kv: KV): string | null {
  const v = kv.get(KEYS.boardKey);
  return isKey(v) ? v : null;
}

/**
 * The device key, created when missing: read, check and write inside the
 * named lock so concurrent first cards in two tabs agree on one key. Without
 * Web Locks the same steps run unlocked.
 */
export async function ensureKey(kv: KV, locks: LockManager | undefined = globalThis.navigator?.locks, random?: (n: number) => Uint8Array): Promise<string> {
  const step = () => {
    const found = readKey(kv);
    if (found) return found;
    const key = newKey(random);
    kv.set(KEYS.boardKey, key);
    return key;
  };
  if (!locks) return step();
  return locks.request(KEY_LOCK, async () => step());
}

/** Forget the key (the local loop's reset): the next card creates a new device. */
export function resetKey(kv: KV) {
  kv.remove(KEYS.boardKey);
}

/** A short local fingerprint of a key, stored with each receipt; never sent anywhere. */
export async function fingerprint(key: string): Promise<string> {
  return (await sha256Hex(`museumguessr-receipt:${key}`)).slice(0, 16);
}
