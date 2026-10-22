// Deploy preflight for `npm run setup:check -- --deploy` (H5, N6; V12-21):
// runtime, Worker dependencies, wrangler identity, the token's permissions
// and zone scope, the active zone, GitHub authentication, the www redirect,
// and the step-3 D1 binding and Turnstile secret once the config has a
// board. Every failing line names its fix.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloudflare } from './cloudflare.mjs';
import { readWranglerConfig, WRANGLER_CONFIG } from './jsonc.mjs';
import { Refusal, SITE_URL, wranglerBin, ZONE } from './ops.mjs';
import { WWW_HOST } from './zone-rules.mjs';

const json = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * Returns [{ status: 'ok' | 'fail' | 'warn' | 'skip', name, detail, fix? }].
 */
export async function preflight({ root, env, runner, fetchImpl = fetch, nodeVersion = process.versions.node }) {
  const lines = [];
  const ok = (name, detail) => lines.push({ status: 'ok', name, detail });
  const fail = (name, detail, fix) => lines.push({ status: 'fail', name, detail, fix });
  const warn = (name, detail, fix) => lines.push({ status: 'warn', name, detail, fix });
  const skip = (name, detail) => lines.push({ status: 'skip', name, detail });

  const want = readFileSync(join(root, '.nvmrc'), 'utf8').trim();
  if (nodeVersion.split('.')[0] === want) ok('node', `Node ${nodeVersion}`);
  else fail('node', `Node ${nodeVersion}, expected ${want}.x`, `nvm use ${want}`);

  const pinned = json(readFileSync(join(root, 'worker/package.json'), 'utf8'))?.devDependencies?.wrangler;
  const installedFile = join(root, 'worker/node_modules/wrangler/package.json');
  const installed = existsSync(installedFile) ? json(readFileSync(installedFile, 'utf8'))?.version : null;
  if (installed && installed === pinned && existsSync(wranglerBin(root))) ok('worker deps', `wrangler ${installed}`);
  else fail('worker deps', installed ? `wrangler ${installed} installed, ${pinned} pinned` : 'wrangler is not installed', 'npm ci --prefix worker');

  const gh = runner.run('gh', ['auth', 'status']);
  if (gh.status === 0) ok('gh', 'authenticated');
  else fail('gh', 'gh is not authenticated (deploy reads the verify check through it)', 'gh auth login');

  const config = readWranglerConfig(root);
  const board = !!config.d1_databases?.length;

  const missing = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((k) => !env[k]);
  if (missing.length) {
    fail('credentials', `${missing.join(' and ')} not set in this shell`, 'export them from your secure environment, never into a file in the repository');
    skip('cloudflare', 'identity, permissions and zone not checked without credentials');
  } else if (installed) {
    const who = runner.run(wranglerBin(root), ['whoami', '--json', '--config', WRANGLER_CONFIG], { credentials: true });
    const me = who.status === 0 ? json(who.stdout) : null;
    if (!me) fail('wrangler whoami', `wrangler could not authenticate (exit ${who.status})`, 'check CLOUDFLARE_API_TOKEN, then npx --prefix worker wrangler whoami');
    else if (Array.isArray(me.accounts) && !me.accounts.some((a) => a.id === env.CLOUDFLARE_ACCOUNT_ID)) fail('wrangler whoami', 'the token cannot reach CLOUDFLARE_ACCOUNT_ID', 'export the account id the token belongs to');
    else ok('wrangler whoami', 'the token authenticates');

    const cf = cloudflare({ env, fetchImpl });
    const probe = async (name, call, needed, fix) => {
      let r;
      try {
        r = await call();
      } catch (e) {
        if (e instanceof Refusal) return fail(name, e.what, e.fix);
        throw e;
      }
      if (r.ok) return ok(name, 'allowed');
      const say = `HTTP ${r.status}: the token lacks this permission`;
      return needed ? fail(name, say, fix) : warn(name, `${say}; cf:bootstrap will print the dashboard values instead`, fix);
    };
    const zones = await cf.call('GET', '/zones?per_page=50');
    const names = zones.ok ? (zones.result ?? []).map((z) => z.name) : [];
    const game = zones.ok ? (zones.result ?? []).find((z) => z.name === ZONE) : null;
    if (!zones.ok || !game) fail('zone', zones.ok ? `${ZONE} is not visible to the token` : `zone list answered HTTP ${zones.status}`, 'give the token Zone Read on museumguessr.com only');
    else {
      if (game.status === 'active') ok('zone', `${ZONE} is active`);
      else fail('zone', `${ZONE} is ${game.status}`, 'finish the zone setup in the Cloudflare dashboard');
      const others = names.filter((n) => n !== ZONE).length;
      if (others) fail('zone scope', `the token can read ${others} other zone(s)`, 'limit the token\'s zone resources to museumguessr.com (My Profile > API Tokens)');
      else ok('zone scope', `limited to ${ZONE}`);
      await probe('Workers Scripts', () => cf.accountCall('GET', '/workers/scripts'), true, 'add Account > Workers Scripts > Edit to the token');
      await probe('Workers Routes', () => cf.zoneCall('GET', '/workers/routes'), true, 'add Zone > Workers Routes > Edit for museumguessr.com');
      await probe('DNS', () => cf.zoneCall('GET', `/dns_records?name=${WWW_HOST}`), false, 'optional: Zone > DNS > Edit');
      await probe('Rules and WAF', () => cf.zoneCall('GET', '/rulesets'), false, 'optional: Zone > Single Redirect, Zone WAF and Config Rules edit');
      await probe('Zone settings', () => cf.zoneCall('GET', '/settings/always_use_https'), false, 'optional: Zone > Zone Settings > Edit');
      if (board) {
        await probe('D1', () => cf.accountCall('GET', '/d1/database'), true, 'add Account > D1 > Edit to the token');
        await probe('Turnstile', () => cf.accountCall('GET', '/challenges/widgets'), true, 'add Account > Turnstile > Edit to the token');
      }
    }
  } else skip('cloudflare', 'install the Worker dependencies first');

  if (!board) {
    skip('D1 binding', 'not needed until step 3 adds the board');
    skip('TURNSTILE_SECRET', 'not needed until step 3 adds the board');
  } else {
    const db = config.d1_databases[0];
    if (/^[0-9a-f-]{36}$/.test(db.database_id ?? '')) ok('D1 binding', `${db.binding} → ${db.database_name}`);
    else fail('D1 binding', `database_id "${db.database_id ?? ''}" is not a database id`, 'npm run cf:bootstrap -- --board --yes, then commit the id it prints');
    if (missing.length || !installed) skip('TURNSTILE_SECRET', 'not checked without credentials');
    else {
      const s = runner.run(wranglerBin(root), ['secret', 'list', '--format', 'json', '--config', WRANGLER_CONFIG], { credentials: true });
      const names = (json(s.stdout) ?? []).map((x) => x.name);
      if (names.includes('TURNSTILE_SECRET')) ok('TURNSTILE_SECRET', 'set on the Worker');
      else fail('TURNSTILE_SECRET', 'not set on the Worker', 'npm run cf:bootstrap -- --board --yes');
    }
  }

  let www = null;
  try {
    www = await fetchImpl(`https://${WWW_HOST}/`, { redirect: 'manual' });
  } catch {
    www = null;
  }
  const location = www?.headers.get('Location');
  if (www?.status === 301 && location === SITE_URL) ok('www redirect', `https://${WWW_HOST}/ → 301 ${location}`);
  else fail('www redirect', www ? `https://${WWW_HOST}/ answered ${www.status}${location ? ` → ${location}` : ''}` : `https://${WWW_HOST}/ did not answer`, 'npm run cf:bootstrap -- --yes, or set the www record and redirect rule from docs/ops.md#hosting-and-limits');
  return lines;
}

export function formatPreflight(lines) {
  const mark = { ok: '✓', fail: '✖', warn: '!', skip: '-' };
  return lines.map((l) => `${mark[l.status]} ${l.name}: ${l.detail}${l.fix && l.status !== 'ok' ? `\n    fix: ${l.fix}` : ''}`).join('\n');
}
