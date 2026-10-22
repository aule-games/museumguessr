import { describe, expect, it } from 'vitest';
import { RULES_VERSION, challengeUrl, parseChallenge } from '../../src/challenge/link';
import { cleanedUrl } from '../../src/game/session';
import { cleanName, isListed } from '../../src/game/names';
import { X_LIMIT, shareText, xLength } from '../../src/game/text';
import list from '../../data/name-list.json';

const IDS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'];
const known = (id: string) => IDS.includes(id) || id === '112';
const parse = (q: string) => parseChallenge(new URLSearchParams(q), known);

describe('[V1-20] player names', () => {
  it.each([
    ['Ali', 'Ali'],
    ['  Barış   Can ', 'Barış Can'],
    ['İpek', 'İpek'],
    ['देवनागरी', 'देवनागरी'],
    ['محمد', 'محمد'],
    ['x_y-z 9', 'x_y-z 9'],
  ])('keeps %j as %j', (raw, clean) => {
    expect(cleanName(raw)).toBe(clean);
  });

  it.each([
    ['one character', 'A'],
    ['17 characters', 'a'.repeat(17)],
    ['a link', 'http://x.io'],
    ['an invisible character', 'Al​i'],
    ['a control character', 'Al\ti'],
    ['stacked combining marks', `q${'\u0301'.repeat(3)}algo`],
    ['too many code points', 'á'.repeat(16) + 'b'.repeat(1)],
  ])('rejects %s', (_label, raw) => {
    expect(cleanName(raw)).toBeNull();
  });

  it('counts code points where Intl.Segmenter is missing', () => {
    expect(cleanName('Ab', (s) => [...s])).toBe('Ab');
    expect(cleanName('A', (s) => [...s])).toBeNull();
  });

  it('matches listed words as whole tokens only, so ordinary names that contain one are kept', () => {
    const words = (list as { words: string[] }).words;
    const listed = words.find((w) => /^[a-z]{4,}$/.test(w)) as string;
    expect(isListed(`Hi ${listed.toUpperCase()}`, words)).toBe(true);
    expect(isListed(`x${listed}y`, words)).toBe(false);
    expect(isListed('Barış', words)).toBe(false);
  });
});

describe('[V1-16] challenge links', () => {
  it('reads ten known ids, a score, a name and a deck hash', () => {
    expect(parse(`d=${IDS.join('.')}&s=18240&n=Ali&h=35ca1219&r=${RULES_VERSION}`)).toEqual({ kind: 'ok', link: { ids: IDS, score: 18240, name: 'Ali', hash: '35ca1219', rules: RULES_VERSION } });
  });

  it('a link without d is no challenge; bad d is a broken link', () => {
    expect(parse('utm_source=share')).toEqual({ kind: 'none' });
    expect(parse('d=01.02')).toEqual({ kind: 'broken' });
    expect(parse(`d=${[...IDS.slice(0, 9), '99'].join('.')}`)).toEqual({ kind: 'broken' });
    expect(parse(`d=${[...IDS.slice(0, 9), '01'].join('.')}`)).toEqual({ kind: 'broken' });
  });

  it('ignores a bad score, name or hash but keeps the deck', () => {
    const r = parse(`d=${IDS.join('.')}&s=99999&n=%3Cb%3E&h=zz`);
    expect(r).toEqual({ kind: 'ok', link: { ids: IDS, score: null, name: null, hash: null, rules: null } });
    expect(parse(`d=${IDS.join('.')}&s=-5`)).toMatchObject({ link: { score: null } });
    expect(parse(`d=${IDS.join('.')}&s=30000`)).toMatchObject({ link: { score: 30000 } });
  });

  it('builds a tagged link that parses back to the same challenge', () => {
    const url = challengeUrl('https://museumguessr.com/', { ids: IDS, score: 18240, name: 'Barış', hash: '35ca1219' }, 'whatsapp', 'reply');
    const q = new URL(url).searchParams;
    expect(q.get('utm_source')).toBe('share');
    expect(q.get('utm_medium')).toBe('whatsapp');
    expect(q.get('utm_campaign')).toBe('reply');
    expect(parse(q.toString())).toEqual({ kind: 'ok', link: { ids: IDS, score: 18240, name: 'Barış', hash: '35ca1219', rules: RULES_VERSION } });
  });

  it('drops the challenge parameters from the address bar but keeps the rest', () => {
    expect(cleanedUrl(new URL(`https://x.io/?d=${IDS.join('.')}&s=1&n=A&h=1&utm_source=share#a`))).toBe('/?utm_source=share#a');
    expect(cleanedUrl(new URL('https://x.io/play/?d=1'))).toBe('/play/');
    expect(cleanedUrl(new URL('https://x.io/?utm_source=share'))).toBeNull();
  });
});

describe('[V1-19] share text', () => {
  const url = 'https://museumguessr.com/?d=01.02.03.04.05.06.07.08.09.10&s=10840&n=Ali&h=35ca1219&utm_source=share&utm_medium=x&utm_campaign=challenge';

  it('the share text is the hook and the link only, with no round-by-round answers', () => {
    const text = shareText({ total: 10840, url, replay: false, kind: 'challenge' });
    expect(text).toBe(`Can you beat my 10,840/30,000 on MuseumGuessr? ${url}`);
    expect(text.split('\n')).toHaveLength(1);
    expect(text).not.toMatch(/\bkm\b|\byrs\b|R1 /);
  });

  it('the share text fits 280 characters on X with the link counted as 23', () => {
    const text = shareText({ total: 30000, url: `${url}&pad=${'x'.repeat(400)}`, replay: true, kind: 'challenge' });
    expect(xLength(text)).toBeLessThanOrEqual(X_LIMIT);
    expect(text).toContain('(replay)');
  });

  it('a reply answers the friend', () => {
    expect(shareText({ total: 10840, url, replay: false, kind: 'reply' })).toMatch(/^I scored 10,840\/30,000 on your 10/);
  });
});
