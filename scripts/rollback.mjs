#!/usr/bin/env node
// npm run rollback [-- <version-id>] [--yes] [--force] (C1, N10; V12-19).
// Lists the Worker's deployments, defaults to the previous deployed
// version, prints the exact URL and needs an explicit --yes. It accepts
// only a version that was deployed before (it is exempt from HEAD =
// origin/main for that reason). Crossing a state, scoring or contract
// version warns and needs --force. It never changes the board mode and
// never undoes D1 migrations (they are additive).

import { fileURLToPath } from 'node:url';
import { WRANGLER_CONFIG } from './lib/jsonc.mjs';
import { createRunner, refuse, runMain, SITE_URL, wranglerBin } from './lib/ops.mjs';
import { parseDeployMessage } from './lib/versions.mjs';
import { liveCheck } from './live-check.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const A = 'deploy-and-rollback';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** The fully deployed version of a deployment (its largest traffic share). */
const liveVersion = (d) => [...(d.versions ?? [])].sort((a, b) => b.percentage - a.percentage)[0]?.version_id ?? null;

/** Version changes between the live deployment and the target; null info means unknown. */
export function crossings(current, target) {
  if (!current || !target) return ['the versions of one deployment are unknown (its message was not written by npm run deploy)'];
  return ['state', 'scoring', 'contract'].filter((k) => current[k] !== target[k]).map((k) => `${k} ${current[k]} → ${target[k]}`);
}

export async function rollback({ root = ROOT, args = [], env = process.env, runner = createRunner({ root, env }), fetchImpl = fetch, out = (l) => console.log(l), liveCheckImpl = liveCheck } = {}) {
  const yes = args.includes('--yes');
  const force = args.includes('--force');
  const rest = args.filter((a) => a !== '--yes' && a !== '--force');
  if (rest.length > 1 || (rest[0] && !UUID.test(rest[0]))) refuse({ kind: 'usage', what: `"${rest.join(' ')}" is not one version id`, why: 'rollback takes at most one Worker version id (a UUID from the list it prints)', fix: 'npm run rollback (to list and pick the previous deployment)', anchor: A });
  const missing = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((k) => !env[k]);
  if (missing.length) refuse({ kind: 'environment', what: `${missing.join(' and ')} not set`, why: 'reading and changing deployments needs the account token from your secure environment', fix: 'export them in this shell, then npm run rollback', anchor: 'preflight-and-credentials' });
  const wrangler = wranglerBin(root);
  const list = (what) => {
    const r = runner.run(wrangler, [what, 'list', '--json', '--config', WRANGLER_CONFIG], { credentials: true });
    const json = r.status === 0 ? parseJson(r.stdout) : null;
    if (!Array.isArray(json)) refuse({ kind: 'remote', what: `wrangler ${what} list failed`, why: `it answered ${r.status}${r.stderr ? `: ${r.stderr.trim().split('\n').pop()}` : ''}`, fix: 'npm run setup:check -- --deploy, then npm run rollback', anchor: A });
    return json;
  };
  const deployments = list('deployments').sort((a, b) => String(a.created_on).localeCompare(String(b.created_on)));
  const versions = new Map(list('versions').map((v) => [v.id, v]));
  const messageOf = (versionId, deployment) => versions.get(versionId)?.annotations?.['workers/message'] ?? deployment?.annotations?.['workers/message'] ?? null;
  const current = deployments.at(-1);
  if (!current) refuse({ kind: 'remote', what: 'the Worker has no deployments', why: 'there is nothing to roll back to', fix: 'npm run deploy -- --yes', anchor: A });
  const currentId = liveVersion(current);
  const history = [];
  for (const d of [...deployments].reverse()) {
    const id = liveVersion(d);
    if (id && id !== currentId && !history.some((h) => h.id === id)) history.push({ id, deployment: d });
  }
  const info = (id, d) => ({ id, message: messageOf(id, d), parsed: parseDeployMessage(messageOf(id, d)), created: d?.created_on });
  const now = info(currentId, current);
  out(`live now: ${now.id} (${now.message ?? 'no message'})`);
  for (const h of history) out(`  deployed before: ${h.id} (${messageOf(h.id, h.deployment) ?? 'no message'}, ${h.deployment.created_on})`);
  const pick = rest[0] ? history.find((h) => h.id === rest[0]) : history[0];
  if (rest[0] && rest[0] === currentId) refuse({ kind: 'usage', what: `${rest[0]} is already live`, why: 'rolling back to the live version changes nothing', fix: 'npm run rollback (to list the earlier deployments)', anchor: A });
  if (!pick) {
    refuse({ kind: 'usage', what: rest[0] ? `${rest[0]} was never deployed` : 'there is no earlier deployment', why: `rollback accepts only a version from the deployment history (${history.length} earlier version(s) listed above)`, fix: history.length ? `npm run rollback -- ${history[0].id}` : 'fix forward with npm run deploy', anchor: A });
  }
  const target = info(pick.id, pick.deployment);
  const changes = crossings(now.parsed, target.parsed);
  out(`rollback: ${SITE_URL} from ${now.parsed?.sha ?? now.id} to ${target.parsed?.sha ?? target.id} (version ${target.id}, deployed ${target.created})`);
  if (changes.length) {
    out(`warning: this crosses a version change: ${changes.join(', ')}. Pages already open keep their saves; the board mode and D1 schema stay as they are.`);
    if (!force) refuse({ kind: 'approval', what: 'the rollback crosses a state, scoring or contract version', why: changes.join('; '), fix: `npm run rollback -- ${target.id} --yes --force (after the founder agrees to the crossing)`, anchor: A });
  }
  if (!yes) refuse({ kind: 'approval', what: `rolling back ${SITE_URL} needs an explicit yes`, why: `the target is version ${target.id}${target.parsed ? ` (build ${target.parsed.sha})` : ''}`, fix: `npm run rollback -- ${target.id} --yes${changes.length ? ' --force' : ''}`, anchor: A });
  const message = `rollback to ${target.parsed?.sha ?? target.id} from ${now.parsed?.sha ?? now.id}`;
  const r = runner.run(wrangler, ['rollback', target.id, '--message', message, '--yes', '--config', WRANGLER_CONFIG], { credentials: true, stream: true });
  if (r.status !== 0) refuse({ kind: 'remote', what: 'wrangler rollback failed', why: `the live version is still ${now.id}`, fix: `read the wrangler error, then npm run rollback -- ${target.id} --yes${changes.length ? ' --force' : ''}`, anchor: A });
  out(`rolled back: ${message}`);
  if (!target.parsed) {
    out('live check skipped: the target build is unknown; run npm run live:check -- --sha <its SHA>');
    return 0;
  }
  const live = await liveCheckImpl({ root, sha: target.parsed.sha, fetchImpl, env });
  for (const l of live.lines) out(`  ${l}`);
  if (live.failed) refuse({ kind: 'live', what: `live check: ${live.failed} check(s) failed after the rollback`, why: `${SITE_URL} does not match build ${target.parsed.sha}`, fix: `npm run live:check -- --sha ${target.parsed.sha} to see it again, then fix forward`, anchor: 'live-check' });
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await runMain(() => rollback({ args: process.argv.slice(2) })));
