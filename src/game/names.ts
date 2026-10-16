// Player names (V1-20): the optional name in a challenge link, and later the
// board's. NFC, trimmed, inner spaces collapsed; 2-16 user-perceived
// characters of letters, combining marks, digits, space, - and _ (so Turkish,
// Hindi, Thai and Arabic names work); at most 32 code points, 64 UTF-8 bytes
// and 2 combining marks per character, which bounds stacked-mark text.

const ALLOWED = /^[\p{L}\p{M}\p{N} _-]+$/u;
const FORMAT_OR_CONTROL = /[\p{Cc}\p{Cf}]/u;
const MARK = /\p{M}/u;

export const NAME_MIN = 2;
export const NAME_MAX = 16;

type Segment = (s: string) => string[];

/** User-perceived characters, or code points where Intl.Segmenter is missing. */
export const graphemes: Segment = (s) => {
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  return Seg ? [...new Seg(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment) : [...s];
};

/** The cleaned name, or null when it breaks a rule. */
export function cleanName(raw: string, segment: Segment = graphemes): string | null {
  if (FORMAT_OR_CONTROL.test(raw)) return null;
  const name = raw.normalize('NFC').trim().replace(/ +/g, ' ');
  if (!name || !ALLOWED.test(name)) return null;
  const chars = segment(name);
  if (chars.length < NAME_MIN || chars.length > NAME_MAX) return null;
  if ([...name].length > 32 || new TextEncoder().encode(name).length > 64) return null;
  if (chars.some((g) => [...g].filter((c) => MARK.test(c)).length > 2)) return null;
  return name;
}

const tokens = (s: string) => s.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);

/**
 * True when the name contains a listed word or phrase as whole tokens, after
 * NFKC and case folding; a listed word inside a longer token does not count,
 * so ordinary names that merely contain one are kept.
 */
export function isListed(name: string, list: readonly string[]): boolean {
  const have = tokens(name);
  return list.some((entry) => {
    const want = tokens(entry);
    if (!want.length || want.length > have.length) return false;
    for (let i = 0; i + want.length <= have.length; i++) if (want.every((w, j) => have[i + j] === w)) return true;
    return false;
  });
}

let listPromise: Promise<readonly string[]> | null = null;

/** The public word list (LDNOOBW, CC BY 4.0), loaded on first use so it stays out of the main bundle. */
export function nameList(): Promise<readonly string[]> {
  listPromise ??= import('../../data/name-list.json').then((m) => (m.default as { words: string[] }).words);
  return listPromise;
}
