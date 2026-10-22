#!/usr/bin/env node
// npm run deploy [-- --yes] (E2, H1, C1, N6, N10, ENG21; V12-15, V12-16,
// V12-17, V12-23, V12-29). Runs from the founder's machine only, after the
// founder's yes on the exact URL:
//
//  1. Node major equals .nvmrc; with --yes, the Cloudflare credentials are set.
//  2. git fetch; the tree is clean; HEAD equals origin/main; the GitHub
//     `verify` check for that exact SHA is green (gh api).
//  3. npm ci --ignore-scripts for the game and the Worker, then the deploy
//     profile build with build id = HEAD (no CLOUDFLARE_* in these children).
//  4. The build id equals HEAD; source maps move aside; check-build and the
//     release scan of the exact output pass.
//  5. Without --yes it stops here and prints the command. With --yes:
//     remote D1 migrations when a D1 binding exists, then one wrangler deploy
//     (page and API together) whose message records the SHA and the state,
//     scoring, contract and migration versions; then live:check.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileBuild, VITE_BUILD } from './build.mjs';
import { readWranglerConfig, WRANGLER_CONFIG } from './lib/jsonc.mjs';
import { createRunner, gitOut, originRepo, refuse, runMain, SITE_URL, wranglerBin } from './lib/ops.mjs';
import { deployMessage, releaseVersions } from './lib/versions.mjs';
import { liveCheck } from './live-check.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const A = 'deploy-and-rollback';

/** Move every dist/**\/*.map below `to`, keeping relative paths; returns how many moved. */
export function moveSourceMaps(dist, to) {
  let moved = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.map')) {
        const target = join(to, relative(dist, p));
        mkdirSync(dirname(target), { recursive: true });
        renameSync(p, target);
        moved += 1;
      }
    }
  };
  if (existsSync(dist)) walk(dist);
  return moved;
}

/** Board switch line; step 3 reads the D1 settings row here. */
const boardSwitch = (config) => (config.d1_databases?.length ? 'stored in D1 (npm run board:list shows it)' : 'off (the board arrives in step 3)');

export async function deploy({
  root = ROOT,
  args = [],
  env = process.env,
  runner = createRunner({ root, env }),
  fetchImpl = fetch,
  out = (l) => console.log(l),
  nodeVersion = process.versions.node,
  versions = null,
  liveCheckImpl = liveCheck,
} = {}) {
  const yes = args.includes('--yes');
  const unknown = args.filter((a) => a !== '--yes');
  if (unknown.length) refuse({ kind: 'usage', what: `unknown argument ${unknown.join(' ')}`, why: 'deploy takes only --yes', fix: 'npm run deploy (checks only) or npm run deploy -- --yes', anchor: A });

  // 1. Runtime and credentials.
  const want = readFileSync(join(root, '.nvmrc'), 'utf8').trim();
  if (nodeVersion.split('.')[0] !== want) refuse({ kind: 'environment', what: `Node ${nodeVersion} is not Node ${want}`, why: `CI builds with the Node major in .nvmrc (${want}); the deploy must build the same way`, fix: `switch to Node ${want} (nvm use ${want}), then npm run deploy`, anchor: A });
  if (yes) {
    const missing = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((k) => !env[k]);
    if (missing.length) refuse({ kind: 'environment', what: `${missing.join(' and ')} not set`, why: 'wrangler deploy needs the account token from your secure environment', fix: 'export them in this shell (never in a file in the repository), then npm run deploy -- --yes', anchor: 'preflight-and-credentials' });
  }
  const run = (cmd, argv, opts) => runner.run(cmd, argv, opts);

  // 2. The exact commit: fetched, clean, equal to origin/main, verified by CI.
  if (run('git', ['fetch', '--quiet', 'origin', 'main']).status !== 0) refuse({ kind: 'git', what: 'git fetch origin main failed', why: 'deploy compares HEAD with the freshly fetched origin/main', fix: 'check the network and git remote -v, then npm run deploy', anchor: A });
  const status = run('git', ['status', '--porcelain']);
  const dirty = status.status === 0 ? status.stdout.split('\n').filter(Boolean) : ['?? (git status failed)'];
  if (dirty.length) refuse({ kind: 'git', what: `the working tree has ${dirty.length} uncommitted change(s)`, why: `the deployed build must be exactly a commit; changed: ${dirty.slice(0, 5).map((l) => l.slice(3)).join(', ')}${dirty.length > 5 ? ', …' : ''}`, fix: 'commit or stash the changes, then npm run deploy', anchor: A });
  const head = gitOut(runner, ['rev-parse', 'HEAD']);
  const main = gitOut(runner, ['rev-parse', 'origin/main']);
  if (!head || !main) refuse({ kind: 'git', what: 'HEAD or origin/main could not be read', why: 'deploy needs both commits', fix: 'git fetch origin main, then npm run deploy', anchor: A });
  const sha = head.slice(0, 7);
  if (head !== main) {
    const [behind, ahead] = (gitOut(runner, ['rev-list', '--left-right', '--count', `origin/main...HEAD`]) ?? '? ?').split(/\s+/);
    refuse({ kind: 'git', what: `HEAD ${sha} is not origin/main ${main.slice(0, 7)}`, why: `HEAD is ${ahead} commit(s) ahead of and ${behind} behind origin/main; only the pushed main commit may deploy`, fix: 'git checkout main && git pull --ff-only (or push with the founder\'s yes), wait for verify, then npm run deploy', anchor: A });
  }
  const repo = originRepo(runner);
  const checks = repo ? run('gh', ['api', `repos/${repo}/commits/${head}/check-runs?check_name=verify`]) : { status: 1, stdout: '' };
  let runs = null;
  try {
    runs = JSON.parse(checks.stdout).check_runs;
  } catch {
    runs = null;
  }
  if (checks.status !== 0 || !Array.isArray(runs)) refuse({ kind: 'ci', what: `the verify check for ${sha} could not be read`, why: `gh api answered ${checks.status}${repo ? '' : ' (origin is not a GitHub repository)'}`, fix: 'gh auth status, then npm run deploy', anchor: A });
  const latest = [...runs].sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0];
  if (!latest) refuse({ kind: 'ci', what: `no verify check has run for ${sha}`, why: 'deploy needs a green verify run on this exact commit', fix: 'push the commit (with the founder\'s yes) and wait for the verify workflow, then npm run deploy', anchor: A });
  if (latest.status !== 'completed' || latest.conclusion !== 'success') {
    refuse({ kind: 'ci', what: `the verify check for ${sha} is ${latest.status === 'completed' ? latest.conclusion : latest.status}`, why: 'deploy needs a green verify run on this exact commit', fix: `see https://github.com/${repo}/commit/${head}/checks; wait for it or fix forward, then npm run deploy`, anchor: A });
  }
  out(`deploy: ${sha} is origin/main and verify is green`);

  // 3. Locked install and the deploy profile build, without credentials.
  if (run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { stream: true }).status !== 0) refuse({ kind: 'build', what: 'npm ci failed', why: 'deploy installs the locked dependencies before building', fix: 'run npm ci to see the error, fix it on main, then npm run deploy', anchor: A });
  if (run('npm', ['ci', '--prefix', 'worker', '--ignore-scripts', '--no-audit', '--no-fund'], { stream: true }).status !== 0) refuse({ kind: 'build', what: 'npm ci --prefix worker failed', why: 'wrangler is installed from the Worker lockfile', fix: 'run npm ci --prefix worker to see the error, then npm run deploy', anchor: A });
  const { env: buildEnv, problems } = profileBuild({ root, buildId: sha, shellEnv: env, deploy: true });
  if (problems.length) refuse({ kind: 'build', what: `the deploy profile is not ready: ${problems.map((p) => p.key).join(', ')}`, why: problems.map((p) => `${p.key} ${p.problem}`).join('; '), fix: problems[0].fix, anchor: 'switches' });
  if (run(process.execPath, VITE_BUILD, { env: buildEnv, stream: true }).status !== 0) refuse({ kind: 'build', what: 'the deploy build failed', why: 'vite build exited with an error', fix: 'npm run build:deploy to see it, fix forward, then npm run deploy', anchor: A });

  // 4. The exact artifact.
  const dist = join(root, 'dist');
  const built = existsSync(join(dist, 'build.txt')) ? readFileSync(join(dist, 'build.txt'), 'utf8').trim() : null;
  if (built !== sha) refuse({ kind: 'build', what: `the build id is ${built ?? '(missing)'}, HEAD is ${sha}`, why: 'the deployed page must say which commit it is', fix: 'npm run deploy again from a clean tree', anchor: A });
  const maps = moveSourceMaps(dist, join(root, 'node_modules/.cache/deploy', sha, 'sourcemaps'));
  out(`deploy: built ${sha}; ${maps} source map(s) moved to node_modules/.cache/deploy/${sha}/sourcemaps`);
  if (run(process.execPath, ['scripts/check-build.mjs'], { stream: true }).status !== 0) refuse({ kind: 'artifact', what: 'check-build failed on the deploy build', why: 'the exact output must pass the build checks before anything remote changes', fix: 'fix forward on main, then npm run deploy', anchor: A });
  const scan = run(process.execPath, ['scripts/release-scan.mjs', '--dist', 'dist'], { stream: true });
  if (scan.status !== 0) {
    refuse({ kind: 'artifact', what: scan.status === 2 ? 'the release scan of dist/ could not run' : 'the release scan found a confidential term in dist/', why: scan.status === 2 ? 'the built output is scanned before every deploy; it needs .denylist (or MG_DENYLIST) and exiftool' : 'the deployed files must never carry a confidential name', fix: scan.status === 2 ? 'set MG_DENYLIST and install exiftool, then npm run deploy' : 'remove the term from its source, commit, push, then npm run deploy', anchor: A });
  }

  // 5. Remote steps, only with --yes.
  out(`deploy: build ${sha} is ready for ${SITE_URL}`);
  if (!yes) {
    out(`All checks passed; nothing was deployed. To publish build ${sha} at ${SITE_URL}: npm run deploy -- --yes`);
    return 0;
  }
  const config = readWranglerConfig(root);
  const wrangler = wranglerBin(root);
  out(`board switch before: ${boardSwitch(config)}`);
  const v = versions ?? (await releaseVersions(root));
  let migrations = 0;
  const d1 = config.d1_databases?.[0];
  if (d1) {
    const dir = join(root, d1.migrations_dir ?? 'migrations');
    migrations = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sql')).length : 0;
    if (run(wrangler, ['d1', 'migrations', 'apply', d1.binding, '--remote', '--config', WRANGLER_CONFIG], { credentials: true, stream: true }).status !== 0) {
      refuse({ kind: 'remote', what: 'remote D1 migrations failed; nothing was deployed', why: 'migrations run before the deploy and are additive', fix: 'read the wrangler error, then npm run deploy -- --yes again at the same SHA', anchor: A });
    }
  }
  const message = deployMessage({ sha, state: v.state, scoring: v.scoring, contract: v.contract, migrations });
  if (run(wrangler, ['deploy', '--config', WRANGLER_CONFIG, '--message', message, '--var', `WORKER_VERSION:${sha}`], { credentials: true, stream: true }).status !== 0) {
    refuse({ kind: 'remote', what: 'wrangler deploy failed', why: `the page and API were not published${migrations ? '; migrations already ran and stay compatible with the live code' : ''}`, fix: 'read the wrangler error, then npm run deploy -- --yes again at the same SHA', anchor: A });
  }
  out(`deployed: ${message}`);
  out(`board switch after: ${boardSwitch(config)}`);
  const live = await liveCheckImpl({ root, sha, fetchImpl, env });
  for (const l of live.lines) out(`  ${l}`);
  if (live.failed) refuse({ kind: 'live', what: `live check: ${live.failed} check(s) failed after deploying ${sha}`, why: `${SITE_URL} does not match the build just deployed`, fix: 'npm run rollback -- --yes to the previous deployment, or fix forward', anchor: 'live-check' });
  out(`${SITE_URL} now serves ${sha}${live.warned ? ` (${live.warned} warning(s) above)` : ''}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await runMain(() => deploy({ args: process.argv.slice(2) })));
