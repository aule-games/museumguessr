#!/usr/bin/env node
// npm run cf:bootstrap [-- --yes] [--board] (H5, N6, ENG16; V12-22).
// Idempotent: it reads what exists and creates only what is missing. Zone
// work (the www record, the www redirect, the API burst rule, the scanner
// rule, Always Use HTTPS and HSTS) goes through the API when the token
// may; otherwise it prints the exact dashboard values from docs/ops.md.
// With --board (step 3) it also creates the D1 database and the Turnstile
// widget, and pipes a new Turnstile secret into `wrangler secret put`
// through stdin: the secret is never printed, written or passed as an
// argument. Without --yes nothing changes; it prints what it would do.
// Every zone call refuses any zone other than museumguessr.com.

import { fileURLToPath } from 'node:url';
import { cloudflare } from './lib/cloudflare.mjs';
import { readWranglerConfig, WRANGLER_CONFIG } from './lib/jsonc.mjs';
import { createRunner, refuse, runMain, wranglerBin, ZONE } from './lib/ops.mjs';
import { DASHBOARD, HSTS, RATE_RULE, REDIRECT_RULE, SCANNER_RULE, WWW_HOST, WWW_RECORD } from './lib/zone-rules.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const A = 'preflight-and-credentials';
export const D1_NAME = 'museumguessr';
export const WIDGET_NAME = 'museumguessr';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** A ruleset phase task: present when a rule with our description or expression exists. */
function rulesetTask(name, phase, rule) {
  return {
    name,
    zone: true,
    dashboard: name,
    async inspect({ cf }) {
      const r = await cf.zoneCall('GET', `/rulesets/phases/${phase}/entrypoint`);
      if (r.status === 403 || r.status === 401) return { state: 'forbidden', detail: `HTTP ${r.status}` };
      if (r.status === 404) return { state: 'missing', detail: 'no rules in this phase yet', entrypoint: null };
      if (!r.ok) return { state: 'error', detail: `HTTP ${r.status}` };
      const found = (r.result?.rules ?? []).find((x) => x.description === rule.description || x.expression === rule.expression);
      if (!found) return { state: 'missing', detail: 'no matching rule', entrypoint: r.result.id };
      const same = found.expression === rule.expression && found.action === rule.action && JSON.stringify(found.ratelimit ?? null) === JSON.stringify(rule.ratelimit ?? null) && found.enabled !== false;
      return same ? { state: 'present', detail: found.description ?? found.expression } : { state: 'different', detail: `the existing rule "${found.description ?? found.id}" differs` };
    },
    async create({ cf }, found) {
      return found.entrypoint ? cf.zoneCall('POST', `/rulesets/${found.entrypoint}/rules`, rule) : cf.zoneCall('PUT', `/rulesets/phases/${phase}/entrypoint`, { rules: [rule] });
    },
  };
}

function settingTask(name, setting, isWanted, value) {
  return {
    name,
    zone: true,
    dashboard: 'Transport',
    async inspect({ cf }) {
      const r = await cf.zoneCall('GET', `/settings/${setting}`);
      if (r.status === 403 || r.status === 401) return { state: 'forbidden', detail: `HTTP ${r.status}` };
      if (!r.ok) return { state: 'error', detail: `HTTP ${r.status}` };
      return isWanted(r.result?.value) ? { state: 'present', detail: 'set' } : { state: 'missing', detail: `currently ${JSON.stringify(r.result?.value)}` };
    },
    async create({ cf }) {
      return cf.zoneCall('PATCH', `/settings/${setting}`, { value });
    },
  };
}

export const ZONE_TASKS = [
  {
    name: 'www DNS record',
    zone: true,
    dashboard: 'www DNS',
    async inspect({ cf }) {
      const r = await cf.zoneCall('GET', `/dns_records?name=${WWW_HOST}`);
      if (r.status === 403 || r.status === 401) return { state: 'forbidden', detail: `HTTP ${r.status}` };
      if (!r.ok) return { state: 'error', detail: `HTTP ${r.status}` };
      const rec = (r.result ?? [])[0];
      if (!rec) return { state: 'missing', detail: 'no www record' };
      return rec.proxied ? { state: 'present', detail: `${rec.type} ${rec.content}, proxied` } : { state: 'different', detail: `${rec.type} ${rec.content} is not proxied` };
    },
    async create({ cf }) {
      return cf.zoneCall('POST', '/dns_records', WWW_RECORD);
    },
  },
  rulesetTask('www redirect rule', 'http_request_dynamic_redirect', REDIRECT_RULE),
  rulesetTask('API burst rule', 'http_ratelimit', RATE_RULE),
  rulesetTask('scanner rule', 'http_request_firewall_custom', SCANNER_RULE),
  settingTask('Always Use HTTPS', 'always_use_https', (v) => v === 'on', 'on'),
  settingTask('HSTS', 'security_header', (v) => v?.strict_transport_security?.enabled === true && v.strict_transport_security.max_age === HSTS.max_age && !v.strict_transport_security.preload, { strict_transport_security: HSTS }),
];

const DASHBOARD_FOR = { 'www DNS record': 'www DNS', 'www redirect rule': 'Redirect rule', 'API burst rule': 'API WAF rate rule', 'scanner rule': 'Scanner WAF custom rule', 'Always Use HTTPS': 'Transport', HSTS: 'Transport' };

export async function bootstrap({ root = ROOT, args = [], env = process.env, runner = createRunner({ root, env }), fetchImpl = fetch, out = (l) => console.log(l) } = {}) {
  const yes = args.includes('--yes');
  const board = args.includes('--board');
  const unknown = args.filter((a) => a !== '--yes' && a !== '--board');
  if (unknown.length) refuse({ kind: 'usage', what: `unknown argument ${unknown.join(' ')}`, why: 'cf:bootstrap takes --yes and --board', fix: 'npm run cf:bootstrap (dry run), then npm run cf:bootstrap -- --yes', anchor: A });
  const missing = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((k) => !env[k]);
  if (missing.length) refuse({ kind: 'environment', what: `${missing.join(' and ')} not set`, why: 'bootstrap reads and creates resources in the founder\'s account', fix: 'export them in this shell, then npm run cf:bootstrap', anchor: A });
  const cf = cloudflare({ env, fetchImpl });
  await cf.zone(ZONE);
  const ctx = { cf };
  const founder = [];
  let created = 0;
  let wouldCreate = 0;
  out(`cf:bootstrap for ${ZONE}${yes ? '' : ' (dry run: nothing changes without --yes)'}`);

  for (const task of ZONE_TASKS) {
    const found = await task.inspect(ctx);
    const dash = DASHBOARD[DASHBOARD_FOR[task.name]];
    if (found.state === 'present') out(`✓ ${task.name}: ${found.detail}`);
    else if (found.state === 'forbidden') {
      out(`! ${task.name}: the token may not manage it (${found.detail}); set it in the dashboard: ${dash}`);
      founder.push(`${task.name}: ${dash}`);
    } else if (found.state === 'different') {
      out(`≠ ${task.name}: ${found.detail}; left unchanged. Expected: ${dash}`);
      founder.push(`${task.name}: ${dash}`);
    } else if (found.state === 'error') refuse({ kind: 'remote', what: `reading ${task.name} failed (${found.detail})`, why: 'bootstrap reads every resource before creating anything', fix: 'npm run setup:check -- --deploy, then npm run cf:bootstrap', anchor: A });
    else if (!yes) {
      wouldCreate += 1;
      out(`+ ${task.name}: would create (${found.detail})`);
    } else {
      const r = await task.create(ctx, found);
      if (!r.ok) refuse({ kind: 'remote', what: `creating ${task.name} failed (HTTP ${r.status})`, why: 'the API refused the change; nothing else was changed after it', fix: `set it in the dashboard: ${dash}`, anchor: 'hosting-and-limits' });
      created += 1;
      out(`+ ${task.name}: created`);
    }
  }

  if (!board) out('- D1 and Turnstile: not needed until step 3 (run with --board then)');
  else {
    const config = readWranglerConfig(root);
    const wrangler = wranglerBin(root);
    // D1: list, then create only when missing; the id is a public config value to review and commit.
    const list = runner.run(wrangler, ['d1', 'list', '--json', '--config', WRANGLER_CONFIG], { credentials: true });
    const dbs = list.status === 0 ? parseJson(list.stdout) : null;
    if (!Array.isArray(dbs)) refuse({ kind: 'remote', what: 'wrangler d1 list failed', why: `it answered ${list.status}`, fix: 'npm run setup:check -- --deploy, then npm run cf:bootstrap -- --board', anchor: A });
    const db = dbs.find((d) => d.name === D1_NAME);
    if (db) out(`✓ D1 database: ${D1_NAME} (${db.uuid})`);
    else if (!yes) {
      wouldCreate += 1;
      out(`+ D1 database: would create ${D1_NAME}`);
    } else {
      const made = runner.run(wrangler, ['d1', 'create', D1_NAME, '--config', WRANGLER_CONFIG], { credentials: true });
      const id = made.stdout.match(UUID)?.[0];
      if (made.status !== 0 || !id) refuse({ kind: 'remote', what: 'wrangler d1 create failed', why: `it answered ${made.status}`, fix: 'read the wrangler error, then npm run cf:bootstrap -- --board --yes', anchor: A });
      created += 1;
      out(`+ D1 database: created ${D1_NAME} (${id}); put this database_id into wrangler.jsonc and commit it (a public config value)`);
    }
    // Turnstile: one widget for the game's domain; a new secret goes only to wrangler's stdin.
    const widgets = await cf.accountCall('GET', '/challenges/widgets');
    if (!widgets.ok) refuse({ kind: 'remote', what: `listing Turnstile widgets failed (HTTP ${widgets.status})`, why: 'bootstrap reads before it creates', fix: 'add Account > Turnstile > Edit to the token, then npm run cf:bootstrap -- --board', anchor: A });
    const widget = (widgets.result ?? []).find((w) => w.name === WIDGET_NAME);
    const secrets = config.d1_databases?.length || widget ? runner.run(wrangler, ['secret', 'list', '--format', 'json', '--config', WRANGLER_CONFIG], { credentials: true }) : { status: 0, stdout: '[]' };
    const hasSecret = (parseJson(secrets.stdout) ?? []).some((s) => s.name === 'TURNSTILE_SECRET');
    const putSecret = (secret) => {
      const r = runner.run(wrangler, ['secret', 'put', 'TURNSTILE_SECRET', '--config', WRANGLER_CONFIG], { credentials: true, input: `${secret}\n` });
      if (r.status !== 0) refuse({ kind: 'remote', what: 'wrangler secret put TURNSTILE_SECRET failed', why: `it answered ${r.status}; the secret was not stored or shown anywhere`, fix: 'npm run cf:bootstrap -- --board --yes (it rotates the widget secret and tries again)', anchor: A });
    };
    if (widget && hasSecret) out(`✓ Turnstile: widget ${WIDGET_NAME} (site key ${widget.sitekey}) and TURNSTILE_SECRET`);
    else if (!yes) {
      wouldCreate += 1;
      out(`+ Turnstile: would ${widget ? 'rotate the secret of' : 'create'} widget ${WIDGET_NAME} and store TURNSTILE_SECRET`);
    } else {
      const r = widget
        ? await cf.accountCall('POST', `/challenges/widgets/${widget.sitekey}/rotate_secret`, { invalidate_immediately: false })
        : await cf.accountCall('POST', '/challenges/widgets', { name: WIDGET_NAME, domains: [ZONE], mode: 'managed' });
      if (!r.ok || !r.result?.secret) refuse({ kind: 'remote', what: `the Turnstile widget call failed (HTTP ${r.status})`, why: 'no secret came back', fix: 'npm run cf:bootstrap -- --board --yes', anchor: A });
      putSecret(r.result.secret);
      created += 1;
      out(`+ Turnstile: widget ${WIDGET_NAME} ready, TURNSTILE_SECRET stored; put site key ${r.result.sitekey ?? widget.sitekey} into deploy/profile.json (VITE_TURNSTILE_SITEKEY)`);
    }
  }

  out(`cf:bootstrap: ${created} created, ${wouldCreate} to create${wouldCreate ? ' (rerun with --yes)' : ''}, ${founder.length} for the dashboard`);
  if (founder.length) out(`Founder tasks (docs/ops.md#hosting-and-limits):\n${founder.map((f) => `  - ${f}`).join('\n')}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await runMain(() => bootstrap({ args: process.argv.slice(2) })));
