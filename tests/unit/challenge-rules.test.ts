// Challenge links carry the rules they were played under (ENG11), and shared
// links never carry test or development switches (N11).
import { describe, expect, it } from 'vitest';
import { CHALLENGE_PARAMS, RULES_VERSION, challengeUrl, parseChallenge, rulesVersion, scoreToBeat, type ChallengeLink } from '../../src/challenge/link';
import { COPY } from '../../src/copy';
import { cleanedUrl } from '../../src/game/session';
import { TIMER } from '../../src/game/timer-config';
import { SCORING_VERSION } from '../../src/scoring/config';

const IDS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'];
const HASH = '35ca1219';
const link = (over: Partial<ChallengeLink> = {}): ChallengeLink => ({ ids: IDS, score: 18240, name: 'Ali', hash: HASH, rules: RULES_VERSION, ...over });

describe('challenge rules versions', () => {
  it('the rules version derives from the scoring version and every timer constant [V12-72]', () => {
    expect(RULES_VERSION).toBe(rulesVersion({ scoringVersion: SCORING_VERSION, timer: TIMER }));
    expect(RULES_VERSION).toBe('3.60.60.10');
    const base = { scoringVersion: 3, timer: { roundSeconds: 60, firstRoundSeconds: 60, warnSeconds: 10 } };
    const variants = [
      { ...base, scoringVersion: 4 },
      { ...base, timer: { ...base.timer, roundSeconds: 75 } },
      { ...base, timer: { ...base.timer, firstRoundSeconds: null } },
      { ...base, timer: { ...base.timer, firstRoundSeconds: 90 } },
      { ...base, timer: { ...base.timer, warnSeconds: 15 } },
    ];
    const versions = new Set([rulesVersion(base), ...variants.map(rulesVersion)]);
    expect(versions.size).toBe(variants.length + 1);
    expect(rulesVersion(variants[2]!)).toBe('3.60.u.10');
  });

  it('a link made under these rules keeps its score to beat [V12-72]', () => {
    expect(scoreToBeat(link(), HASH)).toEqual({ score: 18240, rulesChanged: false, answersChanged: false });
  });

  it('a missing or different rules version keeps the deck playable but removes the score to beat [V12-72]', () => {
    const legacy = parseChallenge(new URLSearchParams(`d=${IDS.join('.')}&s=18240&n=Ali&h=${HASH}`), (id) => IDS.includes(id));
    expect(legacy).toMatchObject({ kind: 'ok', link: { ids: IDS, score: 18240, rules: null } });
    if (legacy.kind !== 'ok') throw new Error('expected a playable deck');
    expect(scoreToBeat(legacy.link, HASH)).toEqual({ score: null, rulesChanged: true, answersChanged: false });
    expect(scoreToBeat(link({ rules: '2.60.60.10' }), HASH)).toEqual({ score: null, rulesChanged: true, answersChanged: false });
    expect(scoreToBeat(link(), HASH, '4.60.60.10').score).toBeNull();
    expect(scoreToBeat(link({ hash: '00000000' }), HASH)).toEqual({ score: null, rulesChanged: false, answersChanged: true });
    expect(scoreToBeat(link({ score: null, rules: null }), HASH)).toEqual({ score: null, rulesChanged: false, answersChanged: false });
    expect(COPY['challenge.rulesChanged']).toBe('Rules changed since this link was made');
  });

  it('a malformed rules value reads as no rules version [V12-72]', () => {
    for (const r of ['', 'x'.repeat(25), '3;60', '<b>']) {
      const parsed = parseChallenge(new URLSearchParams({ d: IDS.join('.'), s: '1', r }), (id) => IDS.includes(id));
      expect(parsed, r).toMatchObject({ kind: 'ok', link: { rules: null } });
    }
  });

  it('new links carry this page’s rules version and parse back to a comparable score [V12-72]', () => {
    const url = challengeUrl('https://example.org/', { ids: IDS, score: 18240, name: null, hash: HASH }, 'copy', 'challenge');
    const q = new URL(url).searchParams;
    expect(q.get('r')).toBe(RULES_VERSION);
    const parsed = parseChallenge(q, (id) => IDS.includes(id));
    if (parsed.kind !== 'ok') throw new Error('expected a challenge');
    expect(scoreToBeat(parsed.link, HASH).score).toBe(18240);
    expect(CHALLENGE_PARAMS).toContain('r');
    expect(cleanedUrl(new URL(`https://example.org/?d=1&r=${RULES_VERSION}&utm_source=share`))).toBe('/?utm_source=share');
  });
});

describe('link hygiene', () => {
  it('share and challenge links omit test, fixture and clock parameters [V12-56]', () => {
    const base = 'https://example.org/play/?test=1&fixture=end-random&clock=off&keep=yes&d=99&utm_source=old';
    for (const medium of ['native', 'whatsapp', 'x', 'copy', 'manual'] as const) {
      const url = new URL(challengeUrl(base, { ids: IDS, score: 100, name: 'Ali', hash: HASH }, medium, 'challenge'));
      for (const p of ['test', 'fixture', 'clock']) expect(url.searchParams.has(p), `${medium} ${p}`).toBe(false);
      expect(url.pathname).toBe('/play/');
      expect(url.searchParams.get('keep')).toBe('yes');
      expect(url.searchParams.get('d')).toBe(IDS.join('.'));
      expect(url.searchParams.getAll('utm_source')).toEqual(['share']);
    }
  });
});
