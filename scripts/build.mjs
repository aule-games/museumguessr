#!/usr/bin/env node
// Build the deploy profile (H1, N6; V12-18, V12-23): the public values come
// only from deploy/profile.json, a shell variable that differs is refused,
// and no CLOUDFLARE_* credential reaches the build. CI's verify build and
// `npm run deploy` both run exactly this.
//
// Usage: node scripts/build.mjs [--build-id <id>] [--board-test]   (default id: HEAD's short SHA)
//
// --board-test builds the board-test profile (the deploy profile with the
// board UI on and Cloudflare's always-pass Turnstile test key) into
// dist-board/, for the board's browser tests (V12-125). It never deploys.

import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boardTestValues, loadProfile, resolveBuild, switchProblems } from './lib/profile.mjs';
import { printProblems } from './lib/report.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The environment and values verify and deploy build with. */
export function profileBuild({ root = ROOT, buildId, shellEnv = process.env, deploy = false } = {}) {
  return resolveBuild({ profile: loadProfile(root), buildId, shellEnv, deploy });
}

/** The board-test build: the deploy profile's environment with the board-test switches (shell overrides are still refused). */
export function boardTestBuild({ root = ROOT, buildId, shellEnv = process.env } = {}) {
  const r = profileBuild({ root, buildId, shellEnv });
  const values = boardTestValues(r.values);
  const purpose = r.problems.filter((p) => p.key !== 'VITE_BUILD_PURPOSE');
  return { env: { ...r.env, ...values }, values, problems: [...purpose, ...switchProblems(values)] };
}

/** The vite build command, run with the resolved environment. */
export const VITE_BUILD = ['node_modules/vite/bin/vite.js', 'build'];
export const BOARD_TEST_DIR = 'dist-board';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--build-id');
  const buildId = at >= 0 ? args[at + 1] : execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const boardTest = args.includes('--board-test');
  const { env, values, problems } = boardTest ? boardTestBuild({ buildId }) : profileBuild({ buildId });
  if (problems.length) {
    printProblems(problems.map((p) => ({ where: p.key, problem: p.problem, why: 'the deployed page is built from the tracked profile only', id: 'H1', fix: p.fix, docs: 'docs/ops.md#switches' })));
    process.exit(2);
  }
  const shown = Object.entries(values).map(([k, v]) => `${k}=${k.includes('TOKEN') ? (v ? `${v.slice(0, 8)}…` : '(empty)') : v || '(empty)'}`);
  console.log(`build: ${boardTest ? `board-test profile into ${BOARD_TEST_DIR}/` : 'deploy profile'}, build id ${buildId}\n  ${shown.join('\n  ')}`);
  const r = spawnSync(process.execPath, boardTest ? [...VITE_BUILD, '--outDir', BOARD_TEST_DIR, '--emptyOutDir'] : VITE_BUILD, { cwd: ROOT, env, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
