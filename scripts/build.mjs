#!/usr/bin/env node
// Build the deploy profile (H1, N6; V12-18, V12-23): the public values come
// only from deploy/profile.json, a shell variable that differs is refused,
// and no CLOUDFLARE_* credential reaches the build. CI's verify build and
// `npm run deploy` both run exactly this.
//
// Usage: node scripts/build.mjs [--build-id <id>]   (default: HEAD's short SHA)

import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProfile, resolveBuild } from './lib/profile.mjs';
import { printProblems } from './lib/report.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The environment and values verify and deploy build with. */
export function profileBuild({ root = ROOT, buildId, shellEnv = process.env, deploy = false } = {}) {
  return resolveBuild({ profile: loadProfile(root), buildId, shellEnv, deploy });
}

/** The vite build command, run with the resolved environment. */
export const VITE_BUILD = ['node_modules/vite/bin/vite.js', 'build'];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--build-id');
  const buildId = at >= 0 ? args[at + 1] : execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const { env, values, problems } = profileBuild({ buildId });
  if (problems.length) {
    printProblems(problems.map((p) => ({ where: p.key, problem: p.problem, why: 'the deployed page is built from the tracked profile only', id: 'H1', fix: p.fix, docs: 'docs/ops.md#switches' })));
    process.exit(2);
  }
  const shown = Object.entries(values).map(([k, v]) => `${k}=${k.includes('TOKEN') ? (v ? `${v.slice(0, 8)}…` : '(empty)') : v || '(empty)'}`);
  console.log(`build: deploy profile, build id ${buildId}\n  ${shown.join('\n  ')}`);
  const r = spawnSync(process.execPath, VITE_BUILD, { cwd: ROOT, env, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
