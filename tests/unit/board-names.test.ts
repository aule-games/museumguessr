import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardName, blockedSequences, isBlockedName, NAME_COMBINATIONS, NAME_VERSIONS, NAMES_VERSION, nameFromHash, playerHash } from '../../src/board/names';
import { MATERIALS, QUALITIES, THINGS } from '../../src/board/name-words';
import { isListed } from '../../src/game/names';

const ROOT = join(import.meta.dirname, '../..');
const nameList = (JSON.parse(readFileSync(join(ROOT, 'data/name-list.json'), 'utf8')) as { words: string[] }).words;
const tokens = (s: string) => s.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);

/** FNV-1a over a list prefix: any edit, reorder or removal of a used word changes it. */
const fingerprint = (words: readonly string[]) => {
  let h = 0x811c9dc5;
  for (const c of words.join('\n')) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
};

/** Keys from a fixed seed, so the collision count is the same on every run. */
function keys(n: number): string[] {
  let s = 0x2545f491;
  const out: string[] = [];
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (let i = 0; i < n; i++) {
    let k = '';
    for (let j = 0; j < 21; j++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      k += abc[(s >>> 0) % 64];
    }
    out.push(`${k}A`);
  }
  return out;
}

describe('generated board names', () => {
  it('three append-only word lists give at least a million names with no suffix, each word a single plain word [V12-109]', () => {
    expect(NAME_COMBINATIONS).toBeGreaterThanOrEqual(1_000_000);
    const sizes = NAME_VERSIONS[NAMES_VERSION];
    expect(QUALITIES.length).toBeGreaterThanOrEqual(sizes.qualities);
    expect(MATERIALS.length).toBeGreaterThanOrEqual(sizes.materials);
    expect(THINGS.length).toBeGreaterThanOrEqual(sizes.things);
    const all = [...QUALITIES, ...MATERIALS, ...THINGS];
    expect(new Set(all.map((w) => w.toLowerCase())).size).toBe(all.length);
    for (const w of all) expect(w, w).toMatch(/^[A-Z][a-z]{1,9}$/);
    // Version 1 uses exactly these words in this order; appending is fine, editing is not.
    expect([fingerprint(QUALITIES.slice(0, 110)), fingerprint(MATERIALS.slice(0, 100)), fingerprint(THINGS.slice(0, 100))]).toEqual(['dd5a1ca3', 'a52f5480', '4a18e4e0']);
  });

  it('no word and no run of adjacent words is on the public name list (data/name-list.json) [V12-109]', () => {
    for (const w of [...QUALITIES, ...MATERIALS, ...THINGS]) expect(isListed(w, nameList), w).toBe(false);
    const lists = [QUALITIES, MATERIALS, THINGS].map((l) => new Set(l.map((w) => w.toLowerCase())));
    const hits: string[] = [];
    for (const entry of nameList) {
      const t = tokens(entry);
      // A listed phrase of 2 or 3 words could appear inside a name at any offset.
      for (let start = 0; start + t.length <= 3 && t.length >= 2; start++) {
        if (t.every((w, i) => lists[start + i]!.has(w))) hits.push(entry);
      }
    }
    expect(hits).toEqual([]);
  });

  it('a device key always gives the same name, as these golden fixtures fix [V12-109]', async () => {
    const golden: [string, string][] = [
      ['AAAAAAAAAAAAAAAAAAAAAA', 'Trusty Willow Coyote'],
      ['AQIDBAUGBwgJCgsMDQ4PEA', 'Frank Chalk Finch'],
      ['_____________________w', 'Quick Snow Buffalo'],
      ['abcdefghijklmnopqrstuQ', 'Polite Beryl Coyote'],
      ['ZYXWVUTSRQPONMLKJIHGFw', 'Placid Velvet Koala'],
      ['0123456789-_0123456789', 'Loyal Sepia Stag'],
    ];
    for (const [key, name] of golden) {
      expect(await boardName(key), key).toBe(name);
      expect(nameFromHash(await playerHash(key))).toBe(name);
    }
    expect(await playerHash('AAAAAAAAAAAAAAAAAAAAAA')).toMatch(/^8a5bdb4cc1516412[0-9a-f]{48}$/);
    expect(() => nameFromHash('AAAAAAAAAAAAAAAAAAAAAA')).toThrow(/sha256/);
  });

  it('10,000 devices get nearly all different names: collisions stay near the birthday expectation [V12-109]', async () => {
    const names = await Promise.all(keys(10_000).map((k) => boardName(k)));
    const collisions = names.length - new Set(names).size;
    // Expected about n^2 / (2N) = 45 for N = 1,100,000.
    expect(collisions).toBeLessThan(100);
  });

  it('a blocklisted name or word pair re-derives only the names that contain it [V12-109]', async () => {
    const sample = await Promise.all(keys(2_000).map((k) => playerHash(k)));
    const before = sample.map((h) => nameFromHash(h));
    const target = before[7]!;
    const pair = target.split(' ').slice(1).join(' ');
    for (const entry of [target, pair]) {
      const blocked = blockedSequences([entry]);
      const after = sample.map((h) => nameFromHash(h, blocked));
      for (let i = 0; i < sample.length; i++) {
        const contains = isBlockedName(before[i]!.split(' '), blocked);
        if (contains) {
          expect(after[i], `${entry} → ${before[i]}`).not.toBe(before[i]);
          expect(isBlockedName(after[i]!.split(' '), blocked)).toBe(false);
        } else expect(after[i]).toBe(before[i]);
      }
      expect(after[7]).not.toBe(target);
    }
    expect(isBlockedName(['Quiet', 'Amber', 'Heron'], blockedSequences(['amber heron']))).toBe(true);
    expect(isBlockedName(['Quiet', 'Amber', 'Heron'], blockedSequences(['heron amber']))).toBe(false);
  });
});
