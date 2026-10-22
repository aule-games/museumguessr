#!/usr/bin/env node
// Post-build checks on the artifact (S2, DX21, ENG23, ENG32, ENG34, DX31,
// V12-13, V12-170, M3). Only what the artifact itself can show: the
// deployed-file inventory, no source maps, asset URLs under the base path,
// the CSP meta, the `_headers` file and its CSP against every page's meta
// CSP, the 404 page, the build id and purpose, no test code in a deploy
// build, the PostHog chunk name, the main-bundle size budget, the lazy item
// records chunk, no dated tile URLs and no secret patterns.
//
// Usage: node scripts/check-build.mjs [distDir]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPurpose, deployMarkerProblems, headerProblems } from './lib/artifact.mjs';
import { itemRecordsProblem, mainBundleProblem } from './lib/budget.mjs';
import { printProblems } from './lib/report.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, process.argv[2] ?? 'dist');
const BASE = process.env.BASE_PATH ?? '/';
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
  /^404\.html$/,
  /^_headers$/,
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
if (bundle) fail(bundle.where, bundle.problem, 'every page load downloads the main bundle; the item pool must not bloat it', 'V1-02', 'find what grew; the item records are already a lazy chunk (see scripts/lib/budget.mjs)');
const captions = JSON.parse(readFileSync(join(ROOT, 'data/items.json'), 'utf8')).items.map((it) => it.caption);
const records = itemRecordsProblem(files, (f) => readFileSync(join(DIST, f)), captions);
if (records) fail(records.where, records.problem, 'the item records load as a lazy chunk so the pool does not grow every page load', 'V1-02', 'import data/items.json only through loadItems() in src/content/items.ts');
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
// Security headers (V12-13, V12-170): `_headers` carries the one source's
// values and its CSP equals each page's meta CSP apart from frame-ancestors.
const notFound = existsSync(join(DIST, '404.html')) ? readFileSync(join(DIST, '404.html'), 'utf8') : null;
if (!notFound) fail('404.html', 'the asset 404 page is missing', 'unknown addresses are answered with it, with status 404', 'V12-10', 'check the not-found-page plugin in vite.config.ts');
else {
  if (!notFound.includes(`<a href="${BASE}">`)) fail('404.html', `no link home to ${BASE}`, 'the 404 page leads back to the game', 'V12-10', 'check the not-found-page plugin in vite.config.ts');
  for (const m of notFound.matchAll(/(?:src|href)="(\/[^"]*)"/g)) if (!m[1].startsWith(BASE)) fail('404.html', `URL ${m[1]} is outside ${BASE}`, 'the Worker serves the site under the base path', 'DX12', 'use the base path');
}
const headersText = existsSync(join(DIST, '_headers')) ? readFileSync(join(DIST, '_headers'), 'utf8') : null;
for (const p of headerProblems(headersText, [['index.html', html], ...(notFound ? [['404.html', notFound]] : [])])) {
  fail(p.where, p.problem, 'security headers come from one source as real HTTP headers; the meta CSP stays for local previews', 'V12-170', 'regenerate them from src/security/headers.ts (vite.config.ts writes both)');
}
// Build purpose (M3): a deploy build carries no test or development code.
const purpose = buildPurpose(html);
if (!purpose) fail('index.html', 'no build-purpose meta', 'the artifact names its build purpose', 'M3', 'check the build-meta plugin in vite.config.ts');
for (const p of deployMarkerProblems(purpose, files, (f) => readFileSync(join(DIST, f), 'utf8'))) {
  fail(p.where, p.problem, 'deploy builds never ship test-only code', p.id, 'compile it out of the deploy profile (import.meta.env checks)');
}

// Copy truthfulness (V1-14): every game draws its own 10, so the page never says they are the same for everyone.
const sameForEveryone = new RegExp(['same', '(10 objects )?', 'for everyone'].join(' ?'), 'i');
if (sameForEveryone.test(html)) fail('index.html', 'says the objects are the same for everyone', 'every game draws its own 10 objects', 'V1-14', 'say "a new ten every game"');
const buildMeta = html.match(/<meta name="build-id" content="([^"]+)"/)?.[1];
const buildTxt = existsSync(join(DIST, 'build.txt')) ? readFileSync(join(DIST, 'build.txt'), 'utf8').trim() : null;
if (!buildMeta || buildMeta !== buildTxt) fail('index.html / build.txt', `build ids differ (${buildMeta} vs ${buildTxt})`, 'DEP1 compares the live build id with the published commit', 'DX8', 'check VITE_BUILD_ID');
for (const m of html.matchAll(/(?:src|href)="(\/[^"]*)"/g)) {
  if (!m[1].startsWith(BASE)) fail('index.html', `asset URL ${m[1]} is outside ${BASE}`, 'the Worker serves the site under the base path', 'DX12', 'use Vite base / import.meta.env.BASE_URL');
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
console.log(`check:build: ${files.length} files OK (build ${buildMeta}, purpose ${purpose})`);
