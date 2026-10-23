import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM helper without types
import { formatPreflight, preflight } from '../../scripts/lib/preflight.mjs';
import { type Recorded, recordedFetch, type Rule, stubRunner, preBoardConfig } from './helpers/ops-stubs';

const REPO = join(import.meta.dirname, '../..');
const API = 'https://api.cloudflare.com/client/v4';
const CREDS = { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acct' };
const pinned = JSON.parse(readFileSync(join(REPO, 'worker/package.json'), 'utf8')).devDependencies.wrangler as string;
let root: string;

function installWrangler(version = pinned) {
  mkdirSync(join(root, 'worker/node_modules/wrangler'), { recursive: true });
  mkdirSync(join(root, 'worker/node_modules/.bin'), { recursive: true });
  writeFileSync(join(root, 'worker/node_modules/wrangler/package.json'), JSON.stringify({ version }));
  writeFileSync(join(root, 'worker/node_modules/.bin/wrangler'), '');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mg-preflight-'));
  mkdirSync(join(root, 'worker'));
  for (const f of ['.nvmrc', 'wrangler.jsonc', 'worker/package.json']) cpSync(join(REPO, f), join(root, f));
  // These tests start from the pre-board config; the board cases add their own D1 binding.
  writeFileSync(join(root, 'wrangler.jsonc'), preBoardConfig(readFileSync(join(REPO, 'wrangler.jsonc'), 'utf8')));
  installWrangler();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ok = { status: 200, json: { success: true, result: [] } };
function api(over: Record<string, Recorded> = {}): Record<string, Recorded> {
  return {
    [`GET ${API}/zones?per_page=50`]: { status: 200, json: { success: true, result: [{ id: 'z1', name: 'museumguessr.com', status: 'active' }] } },
    [`GET ${API}/zones?name=museumguessr.com`]: { status: 200, json: { success: true, result: [{ id: 'z1', name: 'museumguessr.com', status: 'active' }] } },
    [`GET ${API}/accounts/acct/workers/scripts`]: ok,
    [`GET ${API}/zones/z1/workers/routes`]: ok,
    [`GET ${API}/zones/z1/dns_records?name=www.museumguessr.com`]: ok,
    [`GET ${API}/zones/z1/rulesets`]: ok,
    [`GET ${API}/zones/z1/settings/always_use_https`]: { status: 200, json: { success: true, result: { value: 'on' } } },
    [`GET ${API}/accounts/acct/d1/database`]: ok,
    [`GET ${API}/accounts/acct/challenges/widgets`]: ok,
    'GET https://www.museumguessr.com/': { status: 301, headers: { Location: 'https://museumguessr.com/' } },
    ...over,
  };
}
const machine = (over: Rule[] = []): Rule[] => [...over, [/^gh auth status/, {}], [/^wrangler whoami --json/, { stdout: JSON.stringify({ accounts: [{ id: 'acct', name: 'x' }] }) }], [/^wrangler secret list/, { stdout: JSON.stringify([{ name: 'TURNSTILE_SECRET', type: 'secret_text' }]) }]];

async function check({ rules = [] as Rule[], responses = {} as Record<string, Recorded>, env = CREDS as Record<string, string>, nodeVersion = '24.20.0' } = {}) {
  const { runner } = stubRunner(root, machine(rules), env);
  const lines = (await preflight({ root, env, runner, fetchImpl: recordedFetch(api(responses)).impl, nodeVersion })) as { status: string; name: string; detail: string; fix?: string }[];
  const by = Object.fromEntries(lines.map((l) => [l.name, l]));
  return { lines, by, text: formatPreflight(lines) as string };
}

describe('npm run setup:check -- --deploy', () => {
  it('passes on a ready machine and skips the step-3 board checks until the config has a board [V12-21]', async () => {
    const { lines, by } = await check();
    expect(lines.filter((l) => l.status === 'fail')).toEqual([]);
    expect(by['zone scope']!.detail).toBe('limited to museumguessr.com');
    expect(by['D1 binding']!.status).toBe('skip');
    expect(by['TURNSTILE_SECRET']!.status).toBe('skip');
    expect(by['www redirect']!.status).toBe('ok');
  });

  it('each missing prerequisite prints a failing line with its fix [V12-21]', async () => {
    const cases: [string, Parameters<typeof check>[0], string, string][] = [
      ['node', { nodeVersion: '22.1.0' }, 'Node 22.1.0, expected 24.x', 'nvm use 24'],
      ['gh', { rules: [[/^gh auth status/, { status: 1 }]] }, 'gh is not authenticated', 'gh auth login'],
      ['credentials', { env: {} }, 'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID not set', 'export them from your secure environment'],
      ['wrangler whoami', { rules: [[/^wrangler whoami/, { status: 1 }]] }, 'wrangler could not authenticate', 'wrangler whoami'],
      ['zone', { responses: { [`GET ${API}/zones?per_page=50`]: { status: 200, json: { success: true, result: [{ id: 'z1', name: 'museumguessr.com', status: 'pending' }] } } } }, 'museumguessr.com is pending', 'finish the zone setup'],
      ['zone scope', { responses: { [`GET ${API}/zones?per_page=50`]: { status: 200, json: { success: true, result: [{ id: 'z1', name: 'museumguessr.com', status: 'active' }, { id: 'z2', name: 'example.org', status: 'active' }] } } } }, 'the token can read 1 other zone(s)', "limit the token's zone resources to museumguessr.com"],
      ['Workers Scripts', { responses: { [`GET ${API}/accounts/acct/workers/scripts`]: { status: 403, json: { success: false } } } }, 'HTTP 403: the token lacks this permission', 'Workers Scripts > Edit'],
      ['Workers Routes', { responses: { [`GET ${API}/zones/z1/workers/routes`]: { status: 403, json: { success: false } } } }, 'HTTP 403', 'Workers Routes > Edit'],
      ['www redirect', { responses: { 'GET https://www.museumguessr.com/': { status: 200, body: 'parked' } } }, 'https://www.museumguessr.com/ answered 200', 'npm run cf:bootstrap -- --yes'],
    ];
    for (const [name, input, detail, fix] of cases) {
      const { by, text } = await check(input);
      expect(by[name]?.status, name).toBe('fail');
      expect(by[name]?.detail, name).toContain(detail);
      expect(by[name]?.fix, name).toContain(fix);
      expect(text, name).toContain(`✖ ${name}: `);
    }
    rmSync(join(root, 'worker/node_modules'), { recursive: true });
    const { by } = await check();
    expect(by['worker deps']).toMatchObject({ status: 'fail', detail: 'wrangler is not installed', fix: 'npm ci --prefix worker' });
    installWrangler('4.0.0');
    expect((await check()).by['worker deps']!.detail).toBe(`wrangler 4.0.0 installed, ${pinned} pinned`);
  });

  it('optional automation permissions only warn: bootstrap prints the dashboard values instead [V12-21]', async () => {
    const { by } = await check({ responses: { [`GET ${API}/zones/z1/rulesets`]: { status: 403, json: { success: false } } } });
    expect(by['Rules and WAF']).toMatchObject({ status: 'warn' });
    expect(by['Rules and WAF']!.detail).toContain('cf:bootstrap will print the dashboard values instead');
  });

  it('once the config has a board, the D1 binding, D1 and Turnstile permissions and TURNSTILE_SECRET are required [V12-21]', async () => {
    const config = readFileSync(join(root, 'wrangler.jsonc'), 'utf8').replace('"workers_dev": false,', '"workers_dev": false, "d1_databases": [{ "binding": "DB", "database_name": "museumguessr", "database_id": "REPLACE" }],');
    writeFileSync(join(root, 'wrangler.jsonc'), config);
    const { by } = await check({ rules: [[/^wrangler secret list/, { stdout: '[]' }]], responses: { [`GET ${API}/accounts/acct/challenges/widgets`]: { status: 403, json: { success: false } } } });
    expect(by['D1 binding']).toMatchObject({ status: 'fail', fix: 'npm run cf:bootstrap -- --board --yes, then commit the id it prints' });
    expect(by['TURNSTILE_SECRET']).toMatchObject({ status: 'fail', fix: 'npm run cf:bootstrap -- --board --yes' });
    expect(by['Turnstile']).toMatchObject({ status: 'fail' });
    expect(by['D1']).toMatchObject({ status: 'ok' });
  });
});
