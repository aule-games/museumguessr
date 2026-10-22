#!/usr/bin/env node
// Verification run and index (DX14, DX21, DX24). Runs every automated check
// in CI order, then writes docs/verification.md from the test titles: each
// test title carries its requirement IDs in brackets and states the rule in
// plain language. Privileged rows print SKIPPED (<missing prerequisite>);
// manual rows stay pending, never passed.
//
// Usage: npm run verify                       run everything, then write the index
//        node scripts/verify.mjs --index-only  rewrite the index from the last reports

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requirementLedger, renderRequirementLedger } from './lib/requirements.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Playwright empties test-results/ when it starts, so verify keeps its own
// outputs (the unit report, the moved source maps) in an ignored cache.
const CACHE = join(ROOT, 'node_modules/.cache/verify');
const UNIT_JSON = join(CACHE, 'unit.json');
const E2E_JSON = join(ROOT, 'test-results/e2e.json');
const INDEX = join(ROOT, 'docs/verification.md');
const REQUIREMENTS = join(ROOT, 'docs/requirements.json');

/** Checks that cannot run here; they stay pending until their owner records a dated result. */
export const MANUAL = [
  { id: 'DX2', rule: 'A fresh clone reaches round 1 in under 2 minutes (npm ci, npm run dev, open the URL)', owner: 'agent', how: 'timed run from an empty directory with an empty npm cache', result: 'passed: 9 s on 2026-10-14 (clone, npm ci, dev server, Start, round 1 in Chromium)' },
  { id: 'ENG21', rule: 'The built site meets the mobile performance budget', owner: 'agent', how: 'Lighthouse mobile run on the deployed site' },
  { id: 'A1', rule: 'Screen-reader pass: every step, the reveal and the end screen read in order', owner: 'agent', how: 'VoiceOver on iOS Safari and macOS' },
  { id: 'DS1', rule: 'Real devices: an iPhone (Safari), an Android phone (Chrome) and one in-app browser play a full round', owner: 'founder', how: 'play one round on each, report anything odd' },
  { id: 'G2', rule: 'Release scan of the public repository: no confidential term anywhere', owner: 'agent', how: 'npm run release:check after the repository is public' },
  { id: 'PH7', rule: 'Smoke visits arrive as two visitors with every KPI event, and the KPI funnel converts', owner: 'founder', how: 'docs/ops.md#smoke-test-before-launch' },
  { id: 'V9', rule: 'Launch posts lead with the journey ("made here, kept there")', owner: 'founder', how: 'the post drafts' },
  { id: 'LIC1', rule: 'The founder decides whether the code gets a licence', owner: 'founder', how: 'README "Licence" section reflects the decision', result: 'decided 2026-10-14: no licence for now (all rights reserved)' },
  { id: 'AUDIT', rule: 'Content, game, visual and release audits pass (no open P0/P1)', owner: 'design agent', how: 'notes under docs/audits/' },
];

const sh = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
const has = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'ignore' });
  return !r.error && r.status === 0;
};

function moveSourceMaps() {
  const out = join(CACHE, 'sourcemaps');
  mkdirSync(out, { recursive: true });
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.map')) renameSync(p, join(out, name));
    }
  };
  walk(join(ROOT, 'dist'));
  return { status: 0 };
}

const STEPS = [
  { name: 'type check', run: () => sh('npm', ['run', '-s', 'typecheck']) },
  { name: 'generated files are current', run: () => sh('node', ['scripts/types.mjs', '--check']).status || sh('node', ['scripts/tokens.mjs', '--check']) },
  { name: 'item check', run: () => sh('node', ['scripts/items.mjs', 'check']) },
  { name: 'unit tests', run: () => sh('npx', ['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${UNIT_JSON}`]) },
  { name: 'design checks', run: () => sh('npm', ['run', '-s', 'test:design']) },
  { name: 'lint', run: () => sh('npm', ['run', '-s', 'lint']) },
  { name: 'build', run: () => sh('npm', ['run', '-s', 'build:e2e']) },
  { name: 'build checks', needs: 'build', run: () => moveSourceMaps().status || sh('node', ['scripts/check-build.mjs']) },
  { name: 'browser tests (5 viewports)', needs: 'build', run: () => sh('npx', ['playwright', 'test']) },
  {
    name: 'release scan (publish candidate)',
    skip: () => {
      if (!existsSync(process.env.MG_DENYLIST || join(ROOT, '.denylist'))) return 'no denylist';
      if (!has(process.env.MG_EXIFTOOL || 'exiftool', ['-ver'])) return 'exiftool missing';
      return null;
    },
    run: () => sh('node', ['scripts/release-scan.mjs', '--candidate']),
  },
];

/** A failed/blocked runner must not borrow a previous run's passing report. */
export function clearReports(paths = [UNIT_JSON, E2E_JSON]) {
  for (const path of paths) rmSync(path, { force: true });
}

function runSteps() {
  clearReports();
  const results = [];
  for (const step of STEPS) {
    const dep = step.needs && results.find((r) => r.name === step.needs);
    const reason = dep && dep.status !== 'passed' ? `${step.needs} did not pass` : step.skip?.();
    if (reason) {
      results.push({ name: step.name, status: 'skipped', note: reason, ms: 0 });
      continue;
    }
    process.stdout.write(`\n▶ ${step.name}\n`);
    const t0 = Date.now();
    const r = step.run();
    const code = typeof r === 'number' ? r : r.status;
    results.push({ name: step.name, status: code === 0 ? 'passed' : 'failed', note: '', ms: Date.now() - t0 });
  }
  return results;
}

// Requirement ids: a capital prefix and a number (R2, DS12) or a
// release-scoped number (V1-01).
export const IDS = /\[([A-Z]+\d+(?:-\d+)?[A-Z]?)\]/g;
const strip = (s) => s.replace(IDS, '').replace(/@\w+/g, '').replace(/\s+/g, ' ').trim();

/** Rows from the unit (vitest JSON) and browser (Playwright JSON) reports. */
export function collectRows(unit, e2e) {
  const rows = [];
  for (const file of unit?.testResults ?? []) {
    for (const a of file.assertionResults ?? []) {
      const titles = [...(a.ancestorTitles ?? []), a.title];
      rows.push({ ids: [...new Set([...titles.join(' ').matchAll(IDS)].map((m) => m[1]))], title: strip(a.title), rule: titles.map(strip).filter(Boolean).join(' › '), file: relative(ROOT, file.name), status: a.status });
    }
  }
  const walk = (suite, titles) => {
    for (const s of suite.suites ?? []) walk(s, s.file && s.title === s.file ? titles : [...titles, s.title]);
    for (const spec of suite.specs ?? []) {
      const all = [...titles, spec.title];
      const outcomes = spec.tests.flatMap((t) => t.results.map((r) => r.status));
      const projects = [...new Set(spec.tests.map((t) => t.projectName))];
      const status = outcomes.length && outcomes.every((s) => s === 'passed') ? 'passed' : outcomes.some((s) => s === 'failed' || s === 'timedOut') ? 'failed' : 'skipped';
      rows.push({ ids: [...new Set([...all.join(' ').matchAll(IDS)].map((m) => m[1]))], title: strip(spec.title), rule: `${all.map(strip).filter(Boolean).join(' › ')} (${projects.join(', ')})`, file: `tests/e2e/${spec.file}`, status });
    }
  };
  if (e2e) walk(e2e, []);
  return rows;
}

const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const cell = (s) => String(s).replace(/\|/g, '\\|');

function writeIndex(steps) {
  const rows = collectRows(read(UNIT_JSON), read(E2E_JSON));
  const byId = new Map();
  for (const r of rows) for (const id of r.ids.length ? r.ids : ['(none)']) byId.set(id, [...(byId.get(id) ?? []), r]);
  const order = [...byId.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const lines = [
    '# Verification index',
    '',
    'Generated by `npm run verify` (`scripts/verify.mjs`) from the test titles; do not edit by hand.',
    'Each test title states its rule in plain language; the bracketed code is the internal requirement ID.',
    `${steps ? 'Last run' : 'Index generated'}: ${new Date().toISOString().slice(0, 10)}.`,
    '',
  ];
  if (steps) {
    lines.push('## Run', '', '| Step | Result |', '| --- | --- |');
    for (const s of steps) lines.push(`| ${s.name} | ${s.status === 'skipped' ? `SKIPPED (${s.note})` : s.status}${s.ms ? ` (${Math.round(s.ms / 1000)} s)` : ''} |`);
    lines.push('');
  } else lines.push('Rebuilt from existing reports; this command did not run any checks.', '');
  const passed = rows.filter((r) => r.status === 'passed').length;
  lines.push('## Automated checks', '', `${rows.length} tests, ${passed} passed, ${byId.size} requirement IDs.`, '', '| ID | Rule | Test file | Result |', '| --- | --- | --- | --- |');
  for (const id of order) for (const r of byId.get(id)) lines.push(`| ${id} | ${cell(r.rule)} | \`${r.file}\` | ${r.status} |`);
  const ledger = requirementLedger(read(REQUIREMENTS), rows);
  lines.push('', ...renderRequirementLedger(ledger));
  lines.push('', '## Manual and founder checks', '', 'These stay pending until their owner records a dated result.', '', '| ID | Rule | Owner | How | Result |', '| --- | --- | --- | --- | --- |');
  for (const m of MANUAL) lines.push(`| ${m.id} | ${cell(m.rule)} | ${m.owner} | ${cell(m.how)} | ${cell(m.result ?? 'pending')} |`);
  writeFileSync(INDEX, `${lines.join('\n')}\n`);
  return { rows: rows.length, passed, ids: byId.size, failed: rows.some(r => r.status === 'failed' || r.status === 'timedOut'), missingReports: !existsSync(UNIT_JSON) || !existsSync(E2E_JSON), uncovered: ledger.filter(r => r.blocking).map(r => r.id) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const steps = process.argv.includes('--index-only') ? null : runSteps();
  const summary = writeIndex(steps);
  process.stdout.write('\nverify summary\n');
  for (const s of steps ?? []) process.stdout.write(`  ${s.status === 'passed' ? '✓' : s.status === 'failed' ? '✖' : '-'} ${s.name}${s.status === 'skipped' ? `: SKIPPED (${s.note})` : s.status === 'failed' ? ': FAILED' : ''}\n`);
  const pending = MANUAL.filter((m) => !m.result).length;
  process.stdout.write(`  ${summary.rows} tests (${summary.passed} passed) across ${summary.ids} requirement IDs; ${pending} manual rows pending\n  index: docs/verification.md\n`);
  if (summary.uncovered.length) process.stderr.write(`  FAILED requirement evidence: ${summary.uncovered.join(', ')}\n`);
  process.exit(steps?.some((s) => s.status === 'failed') || summary.failed || summary.missingReports || summary.uncovered.length ? 1 : 0);
}
