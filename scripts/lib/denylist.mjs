// Confidential-name matcher shared by the git hooks and the release scan
// (G2, ENG7). Terms come from a git-excluded file and are never printed:
// a hit is reported as "term #k of N" plus a location.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Approved exemptions (founder decision): the GitHub username and the public
// address may appear. They are masked before matching. The old Pages address
// stays exempt because the requirement ledger quotes it as a replaced rule.
export const EXEMPT = [
  'https://museumguessr.com/',
  'museumguessr.com',
  'https://aule-games.github.io/museumguessr/',
  'aule-games.github.io',
  'mert-aktas',
];

export function denylistPath(root) {
  return process.env.MG_DENYLIST || join(root, '.denylist');
}

export function loadDenylist(root) {
  const path = denylistPath(root);
  if (!existsSync(path)) return { path, terms: null };
  const terms = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith('#'));
  return { path, terms };
}

export function normalize(text) {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[ıİ]/g, 'i')
    .toLowerCase()
    .replace(/ß/g, 'ss');
}

export function variants(term) {
  const out = new Set();
  const norm = normalize(term);
  const words = norm.split(/[\s\-_]+/).filter(Boolean);
  for (const sep of [' ', '-', '_', '', '%20', '+']) out.add(words.join(sep));
  const encoded = encodeURIComponent(term.toLowerCase()).toLowerCase();
  out.add(encoded);
  out.add(encoded.replace(/%20/g, '+'));
  return [...out].filter((v) => v.length > 0);
}

function mask(normText) {
  let out = normText;
  for (const ex of EXEMPT) {
    const n = normalize(ex);
    out = out.split(n).join('#'.repeat(n.length));
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Returns a function text -> [{ term, line }] with 1-based term and line.
// A term written as `=word` matches only as a whole word, for short names that
// also occur inside unrelated words (a city, a package name).
export function buildMatcher(terms) {
  const expanded = terms.map((t) => {
    if (!t.startsWith('=')) return variants(t).map((v) => (line) => line.includes(v));
    return variants(t.slice(1)).map((v) => {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(v)}(?![\\p{L}\\p{N}])`, 'u');
      return (line) => re.test(line);
    });
  });
  return (text) => {
    const hits = [];
    const lines = mask(normalize(text)).split('\n');
    lines.forEach((line, i) => {
      expanded.forEach((tests, k) => {
        if (tests.some((test) => test(line))) hits.push({ term: k + 1, line: i + 1 });
      });
    });
    return hits;
  };
}
