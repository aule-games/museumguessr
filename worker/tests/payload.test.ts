import { describe, expect, it } from 'vitest';
import { canonicalPayload } from '../../src/api/canonical';
import { PAYLOAD_FIELDS, type ScorePayload } from '../../src/api/contract';
import { checkRevisions, rescore } from '../src/answers';
import { bearer, ipKey } from '../src/auth';
import { isWeek, parseScoreRequest, readBody } from '../src/payload';
import { harness } from './helpers/harness';
import { sqliteD1 } from './helpers/sqlite-d1';

const h = harness(() => ({ db: sqliteD1(), cache: null }));
const valid = () => h.payload(12000);
const parse = (over: Record<string, unknown>) => parseScoreRequest({ ...valid(), ...over });

describe('the score request shape', () => {
  it('accepts exactly the canonical fields plus the turnstile token and refuses unknown, missing or credential fields [V12-06] [V12-83]', () => {
    expect(parseScoreRequest(valid())).not.toBeNull();
    expect(parse({ total: 30000 })).toBeNull();
    expect(parse({ nickname: 'x' })).toBeNull();
    expect(parse({ key: 'AAAAAAAAAAAAAAAAAAAAAA' })).toBeNull();
    const { turnstile_token: _t, ...noToken } = valid();
    void _t;
    expect(parseScoreRequest(noToken)).toBeNull();
    for (const field of PAYLOAD_FIELDS) {
      const v = valid() as Record<string, unknown>;
      delete v[field];
      expect(parseScoreRequest(v), field).toBeNull();
    }
    expect(parseScoreRequest([valid()])).toBeNull();
    expect(parseScoreRequest(null)).toBeNull();
  });

  it('checks ids, ten distinct items, revisions, versions, weeks at runtime and bounded coordinates [V12-06] [V12-108]', () => {
    const p = valid();
    expect(parse({ game_id: 'short' })).toBeNull();
    expect(parse({ game_id: `${p.game_id.slice(0, 21)}B` })).toBeNull();
    expect(parse({ item_ids: [...p.item_ids.slice(0, 9), p.item_ids[0]] })).toBeNull();
    expect(parse({ item_ids: p.item_ids.slice(0, 9) })).toBeNull();
    expect(parse({ answers_revs: [0, ...p.answers_revs.slice(1)] })).toBeNull();
    expect(parse({ answers_revs: [1.5, ...p.answers_revs.slice(1)] })).toBeNull();
    expect(parse({ client_version: 0 })).toBeNull();
    expect(parse({ deck_kind: 'daily' })).toBeNull();
    expect(parse({ deck_hash: 'NOTHEX00' })).toBeNull();
    expect(parse({ board_week: '2025-W53' })).toBeNull();
    expect(parse({ board_week: '2026-W53' })).not.toBeNull();
    expect(parse({ board_week: '2026-W43' })).not.toBeNull();
    expect(parse({ board_week: '2020-W53' })).not.toBeNull();
    expect(parse({ board_week: null })).not.toBeNull();
    expect(isWeek('2027-W00')).toBe(false);
    const far = { ...p.answers[0]!, made: { lat: 91, lng: 0 } };
    expect(parse({ answers: [far, ...p.answers.slice(1)] })).toBeNull();
    const extra = { ...p.answers[0]!, made: { lat: 1, lng: 2, alt: 3 } };
    expect(parse({ answers: [extra, ...p.answers.slice(1)] })).toBeNull();
    expect(parse({ turnstile_token: '' })).toBeNull();
  });

  it('a timed-out question must carry a null answer, an answered question cannot be null, and only canonical years pass, -4001 included [V12-89] [V12-68]', () => {
    const p = h.payload(30000);
    const out = { made: true, when: false, kept: false };
    expect(parse({ ...p, timed_out: [out, ...p.timed_out.slice(1)] })).toBeNull();
    const nulled = { ...p.answers[0]!, made: null };
    expect(parse({ ...p, answers: [nulled, ...p.answers.slice(1)] })).toBeNull();
    expect(parse({ ...p, answers: [nulled, ...p.answers.slice(1)], timed_out: [out, ...p.timed_out.slice(1)] })).not.toBeNull();
    // A skipped round may hold no answers and stays a skip, not a timeout.
    expect(parse({ ...p, answers: [{ made: null, when: null, kept: null }, ...p.answers.slice(1)], skipped: [true, ...p.skipped.slice(1)] })).not.toBeNull();
    for (const [year, ok] of [[-4001, true], [-3999, true], [2025, true], [0, false], [-5000, false], [-4000, false], [2026, false], [1.5, false]] as const) {
      expect(parse({ ...p, answers: [{ ...p.answers[0]!, when: year }, ...p.answers.slice(1)] }) !== null, String(year)).toBe(ok);
    }
  });

  it('the canonical text keeps field order and made, when, kept order whatever order the request used, without the token [V12-06]', () => {
    const p = parseScoreRequest(valid())!.payload;
    const reordered = Object.fromEntries(Object.entries(p).reverse()) as unknown as ScorePayload;
    const answers = p.answers.map((a) => ({ kept: a.kept && { lng: a.kept.lng, lat: a.kept.lat }, when: a.when, made: a.made })) as unknown as ScorePayload['answers'];
    const text = canonicalPayload({ ...reordered, answers });
    expect(text).toBe(canonicalPayload(p));
    expect(Object.keys(JSON.parse(text))).toEqual([...PAYLOAD_FIELDS]);
    expect(text).not.toContain('turnstile');
    expect(text.indexOf('"made"')).toBeLessThan(text.indexOf('"when"'));
  });

  it('reads at most 4096 streamed bytes, whatever Content-Length claims [V12-83]', async () => {
    const big = new Request('https://x/', { method: 'POST', body: 'x'.repeat(5000) });
    expect(await readBody(big, 4096)).toBe('too_large');
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 10; i++) c.enqueue(new Uint8Array(1000));
        c.close();
      },
    });
    const lying = new Request('https://x/', { method: 'POST', body: stream, headers: { 'Content-Length': '10' }, duplex: 'half' } as RequestInit);
    expect(await readBody(lying, 4096)).toBe('too_large');
    expect(await readBody(new Request('https://x/', { method: 'POST', body: '{}' }), 4096)).toBe('{}');
  });
});

describe('answer revisions and rescoring', () => {
  it('lower revisions or retired ids need update_page, higher revisions or unknown ids try_later, equal ones rescore [V12-88]', () => {
    const p = valid();
    const ids = p.item_ids;
    const ones = ids.map(() => 1);
    expect(checkRevisions(ids, ones)).toBe('ok');
    expect(checkRevisions(ids, [2, ...ones.slice(1)])).toBe('try_later');
    expect(checkRevisions(['999', ...ids.slice(1)], ones)).toBe('try_later');
    expect(checkRevisions(['999', ...ids.slice(1)], ones, undefined, new Set(['999']))).toBe('update_page');
    const table = new Map([...ids].map((id) => [id, { key: { id, kept: { lat: 0, lng: 0 }, keptFullMarksKm: 50, made: { lat: 0, lng: 0 }, madeFullMarksKm: 50, start: 1, end: 2 }, rev: 3 }]));
    expect(checkRevisions(ids, ones, table)).toBe('update_page');
    expect(checkRevisions(ids, ones.map(() => 4), table)).toBe('try_later');
    expect(checkRevisions(ids, ones.map(() => 3), table)).toBe('ok');
  });

  it('the server scores with the shared scorer: perfect answers 1,000 each, timed-out questions and skipped rounds 0 [V12-89]', () => {
    expect(rescore(h.payload(30000))).toMatchObject({ total: 30000 });
    expect(rescore(h.payload(17000))).toMatchObject({ total: 17000 });
    const p = h.payload(30000);
    expect(rescore({ ...p, skipped: [true, true, ...p.skipped.slice(2)] as unknown as ScorePayload['skipped'] }).total).toBe(24000);
    const points = rescore(h.payload(4000)).points;
    expect(points).toEqual([3000, 1000, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('credentials and addresses', () => {
  it('only a 128-bit base64url bearer key is a credential; the IP limit keys IPv4 addresses and IPv6 /64 prefixes [V12-82] [V12-84]', () => {
    const req = (auth?: string) => new Request('https://x/', { headers: auth ? { Authorization: auth } : {} });
    expect(bearer(req())).toEqual({ kind: 'none' });
    expect(bearer(req('Bearer AAAAAAAAAAAAAAAAAAAAAA'))).toEqual({ kind: 'key', key: 'AAAAAAAAAAAAAAAAAAAAAA' });
    for (const bad of ['Bearer AAAAAAAAAAAAAAAAAAAAAB', 'Bearer AAAA', 'Basic AAAAAAAAAAAAAAAAAAAAAA', 'Bearer  AAAAAAAAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA']) expect(bearer(req(bad)).kind, bad).toBe('bad');
    expect(ipKey('203.0.113.7')).toBe('v4:203.0.113.7');
    expect(ipKey('2001:db8:1:2:aaaa::1')).toBe('v6:2001:0db8:0001:0002');
    expect(ipKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe(ipKey('2001:db8:1:2::9'));
    expect(ipKey('2001:db8:1:3::9')).not.toBe(ipKey('2001:db8:1:2::9'));
    expect(ipKey('::ffff:198.51.100.4')).toBe('v4:198.51.100.4');
    expect(ipKey('fe80::1%eth0')).toBe('v6:fe80:0000:0000:0000');
    for (const bad of [null, '', 'nonsense', '1:2:3:4:5:6:7:8:9', '256.1.1.1', '1::2::3']) expect(ipKey(bad), String(bad)).toBe('unknown');
  });
});

describe('retired objects', () => {
  it('a retired id never ranks (update_page), and its recorded key stays available for 14 days for diagnostics only [V12-137]', async () => {
    const { retiredKey } = await import('../src/answers');
    const p = valid();
    const key = { id: '07', difficulty: 1 as const, kept: { city: 'X', lat: 1, lng: 2 }, made: { lat: 3, lng: 4, precision: 'city' as const, full_marks_km: null, country: 'XX' }, when: { start: 1500, end: 1600 }, answers_rev: 2 };
    const entries = [{ id: '07', retired: '2026-10-10', key }];
    expect(retiredKey('07', Date.UTC(2026, 9, 23), entries)).toMatchObject({ rev: 2, key: { id: '07', start: 1500 } });
    expect(retiredKey('07', Date.UTC(2026, 9, 24), entries)).toBeNull();
    expect(retiredKey('08', Date.UTC(2026, 9, 12), entries)).toBeNull();
    expect(checkRevisions(['998', ...p.item_ids.slice(1)], p.answers_revs, undefined, new Set(['998']))).toBe('update_page');
  });
});
