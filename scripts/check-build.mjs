#!/usr/bin/env node
// Post-build checks on the artifact (S2, DX21, ENG23, ENG32, ENG34, DX31).
// Only what the artifact itself can show: the deployed-file inventory, no
// source maps, asset URLs under the base path, the CSP meta, the build id,
// the PostHog chunk name, the main-bundle size budget, no dated tile URLs
// and no secret patterns.
//
// Usage: node scripts/check-build.mjs [distDir]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainBundleProblem } from './lib/budget.mjs';
import { printProblems } from './lib/report.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, process.argv[2] ?? 'dist');
const BASE = process.env.BASE_PATH ?? '/museumguessr/';
const DOCS = 'docs/release.md#build-checks';
const problems = [];
const fail = (where, problem, why, id, fix) => problems.push({ where, problem, why, id, fix, docs: DOCS });

if (!existsSync(DIST)) {
  fail('dist', 'build output is missing', 'the checks run on the built site', 'S2', 'run npm run build first');
  printProblems(problems);
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [relative(DIST, p)];
  });
}
const files = walk(DIST);

// Deployed-file inventory (S2, DX7, DX31)
const ALLOWED = [
  /^index\.html$/,
  /^build\.txt$/,
  /^favicon\.(svg|ico|png)$/,
  /^og\.png$/,
  /^apple-touch-icon\.png$/,
  /^licenses\.txt$/,
  /^assets\/[\w.-]+-[\w-]{8}\.(js|css|jpg|svg|png|woff2?)$/,
  /^maplibre\/\d+\.\d+\.\d+\/maplibre-gl(-shared|-worker)?\.(mjs|css)$/,
];
for (const f of files) {
  if (f.endsWith('.map')) fail(f, 'source map in the deployed files', 'source maps stay a CI artifact', 'DX31', 'move *.map out of dist before upload');
  else if (!ALLOWED.some((re) => re.test(f))) fail(f, 'unexpected file in the deployed site', 'only the built site may deploy: no tests, scripts, reserve data or dev fixtures', 'S2', 'remove it or extend the allowlist in scripts/check-build.mjs');
}
const bundle = mainBundleProblem(files, (f) => readFileSync(join(DIST, f)));
if (bundle) fail(bundle.where, bundle.problem, 'every page load downloads the main bundle; the item pool must not bloat it', 'V1-02', 'move the item data into a lazy chunk (see scripts/lib/budget.mjs)');
if (!files.some((f) => /^assets\/posthog-[\w-]{8}\.js$/.test(f))) {
  fail('assets/posthog-*.js', 'PostHog chunk not found under its fixed prefix', 'telemetry filters rely on the chunk name', 'PH1', 'check the dynamic import of src/analytics/posthog.ts');
}

// Licence notices: every runtime dependency, with its licence text (S2)
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const notices = existsSync(join(DIST, 'licenses.txt')) ? readFileSync(join(DIST, 'licenses.txt'), 'utf8') : null;
if (!notices) fail('licenses.txt', 'licence notices missing', 'MIT, BSD, Apache and OFL licences ask for their text to ship with the code', 'S2', 'check the licence-notices plugin in vite.config.ts');
else {
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    const meta = JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8'));
    if (!notices.includes(`${name} ${meta.version} (${String(meta.license).replace(/^\((.*)\)$/, '$1')})`)) fail('licenses.txt', `no notice for ${name} ${meta.version}`, 'every runtime dependency ships its licence', 'S2', 'rebuild; the plugin reads package.json dependencies');
  }
}

// index.html: CSP, build id, base path
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1]?.replace(/&#39;/g, "'");
if (!csp) fail('index.html', 'no Content-Security-Policy meta', 'the CSP limits where the page can connect', 'ENG23', 'check the build-meta plugin in vite.config.ts');
else {
  const connect = csp.match(/connect-src ([^;]+)/)?.[1] ?? '';
  const hosts = connect.split(/\s+/).filter((h) => h.startsWith('https://'));
  const expected = ['https://tiles.openfreemap.org', 'https://eu.i.posthog.com'];
  if (hosts.sort().join() !== [...expected].sort().join()) fail('index.html CSP', `connect-src hosts are ${hosts.join(', ')}`, 'only the tiles and the EU PostHog host may be reached', 'ENG32', 'fix CSP in vite.config.ts');
  if (/unsafe-eval/.test(csp)) fail('index.html CSP', 'allows unsafe-eval', 'no eval in the CSP', 'ENG23', 'remove it');
  if (/posthog/.test(csp.replace(connect, ''))) fail('index.html CSP', 'lists PostHog outside connect-src', 'no PostHog script host is allowed', 'PH1', 'remove it');
  if (!/worker-src 'self'/.test(csp)) fail('index.html CSP', "lacks worker-src 'self'", 'the map worker is self-hosted', 'ENG32', 'add it');
}
const buildMeta = html.match(/<meta name="build-id" content="([^"]+)"/)?.[1];
const buildTxt = existsSync(join(DIST, 'build.txt')) ? readFileSync(join(DIST, 'build.txt'), 'utf8').trim() : null;
if (!buildMeta || buildMeta !== buildTxt) fail('index.html / build.txt', `build ids differ (${buildMeta} vs ${buildTxt})`, 'DEP1 compares the live build id with the published commit', 'DX8', 'check VITE_BUILD_ID');
for (const m of html.matchAll(/(?:src|href)="(\/[^"]*)"/g)) {
  if (!m[1].startsWith(BASE)) fail('index.html', `asset URL ${m[1]} is outside ${BASE}`, 'GitHub Pages serves the site under the base path', 'DX12', 'use Vite base / import.meta.env.BASE_URL');
}

// Text scans of shipped files
for (const f of files.filter((x) => /\.(js|mjs|css|html|txt|json|svg)$/.test(x))) {
  const text = readFileSync(join(DIST, f), 'utf8');
  if (/phx_[A-Za-z0-9]{8,}/.test(text)) fail(f, 'contains a PostHog personal API key pattern (phx_)', 'personal keys never ship', 'PH1', 'remove the key and rotate it');
  if (/tiles\.openfreemap\.org\/planet\/\d{8}/.test(text)) fail(f, 'contains a dated tile URL', 'use the TileJSON URL so tiles update', 'ENG9', 'reference https://tiles.openfreemap.org/planet');
  if (f.startsWith('assets/index-') && /__mgDev|dev\/fixtures/.test(text)) fail(f, 'contains development fixtures', 'dev fixtures never ship', 'DX7', 'import them only under import.meta.env.DEV');
}

if (problems.length) {
  printProblems(problems);
  console.error(`check:build: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`check:build: ${files.length} files OK (build ${buildMeta})`);
