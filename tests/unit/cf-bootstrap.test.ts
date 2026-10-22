import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { bootstrap } from '../../scripts/cf-bootstrap.mjs';
// @ts-expect-error plain ESM helper without types
import { cloudflare } from '../../scripts/lib/cloudflare.mjs';
// @ts-expect-error plain ESM helper without types
import { runMain } from '../../scripts/lib/ops.mjs';
// @ts-expect-error plain ESM helper without types
import { DASHBOARD, RATE_RULE, REDIRECT_RULE, SCANNER_RULE } from '../../scripts/lib/zone-rules.mjs';
import { type Recorded, recordedFetch, type Rule, sink, stubRunner } from './helpers/ops-stubs';

const ROOT = join(import.meta.dirname, '../..');
const API = 'https://api.cloudflare.com/client/v4';
const CREDS = { CLOUDFLARE_API_TOKEN: 'cf-token', CLOUDFLARE_ACCOUNT_ID: 'acct' };
const SECRET = 'TURNSTILE-SECRET-0x4AAAAAAA-never-printed';
const ok = (result: unknown) => ({ status: 200, json: { success: true, result } });
const forbidden = { status: 403, json: { success: false, errors: [{ code: 10000 }] } };

/** An empty zone: nothing exists yet, the token may do everything. */
function emptyZone(): Record<string, Recorded> {
  return {
    [`GET ${API}/zones?name=museumguessr.com`]: ok([{ id: 'z1', name: 'museumguessr.com', status: 'active' }]),
    [`GET ${API}/zones/z1/dns_records?name=www.museumguessr.com`]: ok([]),
    [`GET ${API}/zones/z1/rulesets/phases/http_request_dynamic_redirect/entrypoint`]: { status: 404, json: { success: false } },
    [`GET ${API}/zones/z1/rulesets/phases/http_ratelimit/entrypoint`]: ok({ id: 'rl1', rules: [] }),
    [`GET ${API}/zones/z1/rulesets/phases/http_request_firewall_custom/entrypoint`]: { status: 404, json: { success: false } },
    [`GET ${API}/zones/z1/settings/always_use_https`]: ok({ value: 'off' }),
    [`GET ${API}/zones/z1/settings/security_header`]: ok({ value: { strict_transport_security: { enabled: false, max_age: 0 } } }),
    [`POST ${API}/zones/z1/dns_records`]: ok({ id: 'r1' }),
    [`PUT ${API}/zones/z1/rulesets/phases/http_request_dynamic_redirect/entrypoint`]: ok({ id: 'rd1' }),
    [`POST ${API}/zones/z1/rulesets/rl1/rules`]: ok({ id: 'rl1' }),
    [`PUT ${API}/zones/z1/rulesets/phases/http_request_firewall_custom/entrypoint`]: ok({ id: 'fw1' }),
    [`PATCH ${API}/zones/z1/settings/always_use_https`]: ok({ value: 'on' }),
    [`PATCH ${API}/zones/z1/settings/security_header`]: ok({}),
    [`GET ${API}/accounts/acct/challenges/widgets`]: ok([]),
    [`POST ${API}/accounts/acct/challenges/widgets`]: ok({ sitekey: '0x4AAAAAAAsitekey', secret: SECRET }),
    [`POST ${API}/accounts/acct/challenges/widgets/0x4AAAAAAAsitekey/rotate_secret`]: ok({ sitekey: '0x4AAAAAAAsitekey', secret: SECRET }),
  };
}

/** The same zone after a full bootstrap. */
function finishedZone(): Record<string, Recorded> {
  return {
    ...emptyZone(),
    [`GET ${API}/zones/z1/dns_records?name=www.museumguessr.com`]: ok([{ type: 'AAAA', content: '100::', proxied: true }]),
    [`GET ${API}/zones/z1/rulesets/phases/http_request_dynamic_redirect/entrypoint`]: ok({ id: 'rd1', rules: [REDIRECT_RULE] }),
    [`GET ${API}/zones/z1/rulesets/phases/http_ratelimit/entrypoint`]: ok({ id: 'rl1', rules: [RATE_RULE] }),
    [`GET ${API}/zones/z1/rulesets/phases/http_request_firewall_custom/entrypoint`]: ok({ id: 'fw1', rules: [SCANNER_RULE] }),
    [`GET ${API}/zones/z1/settings/always_use_https`]: ok({ value: 'on' }),
    [`GET ${API}/zones/z1/settings/security_header`]: ok({ value: { strict_transport_security: { enabled: true, max_age: 31536000, preload: false } } }),
    [`GET ${API}/accounts/acct/challenges/widgets`]: ok([{ name: 'museumguessr', sitekey: '0x4AAAAAAAsitekey' }]),
  };
}

const wranglerRules = (dbs: unknown[] = [], secrets: unknown[] = []): Rule[] => [
  [/^wrangler d1 list --json/, { stdout: JSON.stringify(dbs) }],
  [/^wrangler d1 create museumguessr/, { stdout: 'Created your new D1 database.\n"database_id": "12345678-1234-4234-8234-123456789abc"\n' }],
  [/^wrangler secret list/, { stdout: JSON.stringify(secrets) }],
  [/^wrangler secret put TURNSTILE_SECRET/, {}],
];

async function attempt(args: string[], responses: Record<string, Recorded>, rules: Rule[] = wranglerRules(), env: Record<string, string> = CREDS) {
  const m = stubRunner(ROOT, rules, env);
  const http = recordedFetch(responses);
  const io = sink();
  const code = await runMain(() => bootstrap({ root: ROOT, args, env, runner: m.runner, fetchImpl: http.impl, out: io.out }), io.err);
  const writes = http.requests.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.url.replace(API, '')}`);
  return { code, out: io.all(), writes, calls: m.calls(), requests: http.requests };
}

describe('npm run cf:bootstrap', () => {
  it('creates only missing resources and a second run changes nothing [V12-22]', async () => {
    const dry = await attempt([], emptyZone());
    expect(dry.code).toBe(0);
    expect(dry.writes).toEqual([]);
    expect(dry.out).toContain('cf:bootstrap: 0 created, 6 to create (rerun with --yes)');
    const first = await attempt(['--yes'], emptyZone());
    expect(first.writes).toEqual([
      'POST /zones/z1/dns_records',
      'PUT /zones/z1/rulesets/phases/http_request_dynamic_redirect/entrypoint',
      'POST /zones/z1/rulesets/rl1/rules',
      'PUT /zones/z1/rulesets/phases/http_request_firewall_custom/entrypoint',
      'PATCH /zones/z1/settings/always_use_https',
      'PATCH /zones/z1/settings/security_header',
    ]);
    const bodies = first.requests.filter((r) => r.method !== 'GET').map((r) => JSON.parse(r.body ?? 'null'));
    expect(bodies[0]).toMatchObject({ type: 'AAAA', name: 'www.museumguessr.com', content: '100::', proxied: true });
    expect(bodies[2]).toMatchObject({ action: 'block', ratelimit: { requests_per_period: 20, period: 10, mitigation_timeout: 10 } });
    expect(bodies[5]).toEqual({ value: { strict_transport_security: { enabled: true, max_age: 31536000, include_subdomains: false, preload: false, nosniff: false } } });
    const again = await attempt(['--yes'], finishedZone());
    expect(again.writes).toEqual([]);
    expect(again.out).toContain('cf:bootstrap: 0 created, 0 to create, 0 for the dashboard');
  });

  it('without zone permissions it prints the exact dashboard values instead of guessing [V12-22]', async () => {
    const r = emptyZone();
    for (const k of Object.keys(r)) if (k.includes('/zones/z1/')) r[k] = forbidden;
    const res = await attempt(['--yes'], r);
    expect(res.code).toBe(0);
    expect(res.writes).toEqual([]);
    for (const value of Object.values(DASHBOARD) as string[]) expect(res.out).toContain(value);
    expect(res.out).toContain('6 for the dashboard');
  });

  it('with --board it creates D1 once and pipes a new Turnstile secret into wrangler through stdin, never printing it [V12-22]', async () => {
    const res = await attempt(['--yes', '--board'], finishedZone(), wranglerRules([], []), CREDS);
    const widgets = { ...finishedZone(), [`GET ${API}/accounts/acct/challenges/widgets`]: ok([]) };
    const fresh = await attempt(['--yes', '--board'], widgets);
    expect(fresh.code).toBe(0);
    const put = fresh.calls.find((c) => c.line.startsWith('wrangler secret put TURNSTILE_SECRET'))!;
    expect(put.input).toBe(`${SECRET}\n`);
    expect(put.args).not.toContain(SECRET);
    expect(fresh.out).not.toContain(SECRET);
    expect(fresh.out).toContain('put site key 0x4AAAAAAAsitekey into deploy/profile.json');
    expect(fresh.out).toContain('+ D1 database: created museumguessr (12345678-1234-4234-8234-123456789abc)');
    expect(fresh.writes).toEqual(['POST /accounts/acct/challenges/widgets']);
    // An existing widget without the Worker secret gets its secret rotated, not a second widget.
    expect(res.writes).toEqual(['POST /accounts/acct/challenges/widgets/0x4AAAAAAAsitekey/rotate_secret']);
    const done = await attempt(['--yes', '--board'], finishedZone(), wranglerRules([{ name: 'museumguessr', uuid: 'u1' }], [{ name: 'TURNSTILE_SECRET' }]));
    expect(done.writes).toEqual([]);
    expect(done.calls.some((c) => /d1 create|secret put/.test(c.line))).toBe(false);
  });

  it('API helpers refuse every zone other than museumguessr.com before any request [V12-22]', async () => {
    const http = recordedFetch(emptyZone());
    const cf = cloudflare({ env: CREDS, fetchImpl: http.impl });
    await expect(cf.zone('example.com')).rejects.toMatchObject({ kind: 'scope', exit: 11, what: 'zone example.com is not museumguessr.com' });
    expect(http.requests).toEqual([]);
    expect(await cf.zone()).toBe('z1');
    const r = emptyZone();
    r[`GET ${API}/zones?name=museumguessr.com`] = ok([{ id: 'z9', name: 'museumguessr.com.example.org' }]);
    const io = sink();
    expect(await runMain(() => bootstrap({ root: ROOT, args: [], env: CREDS, runner: stubRunner(ROOT, []).runner, fetchImpl: recordedFetch(r).impl, out: io.out }), io.err)).toBe(9);
  });

  it('only wrangler receives the credentials, and refusals carry their class and fix [V12-23] [V12-28]', async () => {
    const res = await attempt(['--yes', '--board'], { ...finishedZone(), [`GET ${API}/accounts/acct/challenges/widgets`]: ok([]) });
    for (const c of res.calls) expect(c.credentials, c.line).toBe(c.cmd === 'wrangler');
    const auth = res.requests.map((q) => q.headers.Authorization);
    expect(new Set(auth)).toEqual(new Set(['Bearer cf-token']));
    const noEnv = await attempt([], emptyZone(), [], {});
    expect(noEnv.code).toBe(3);
    expect(noEnv.out).toContain('docs: docs/ops.md#preflight-and-credentials');
    const badArg = await attempt(['--zone', 'example.com'], emptyZone());
    expect(badArg.code).toBe(2);
  });
});
