#!/usr/bin/env node
// npm run board:<command> (ENG3, ENG4, ENG20, E8, N7, M9; V12-103 to V12-106,
// V12-110, V12-112, V12-136). The board's operations, on the shared runner:
//
//   board:off | board:dark | board:on      write the D1 settings row (on needs
//                                          contentApproved and first purges the
//                                          smoke rows, printing the count)
//   board:list [--smoke] [--week <week>]   this week's top 50, hidden rows and
//                                          the saturation tripwire (29,500+)
//   board:hide --week <week> --min-total <n> --since <date> [--reason <r>]
//   board:unhide <row-id> [--reason <r>]
//   board:purge-smoke                      remove every dark-mode test row
//   board:tail                             the Worker's redacted error lines
//
// Every command runs against the remote database (the founder's credentials,
// and --yes for a change) or, with --local [--persist-to <dir>], the local one
// that wrangler dev uses. SQL comes only from fixed statement files and fixed
// templates; an argument reaches SQL only after it matched a strict pattern
// (week id, whole number, date, row id, reason word). Nothing here prints a
// key, a request body or an IP.

import { spawn as nodeSpawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contentApproved } from './lib/content-gate.mjs';
import { WRANGLER_CONFIG } from './lib/jsonc.mjs';
import { cleanEnv, createRunner, refuse, runMain, wranglerBin } from './lib/ops.mjs';
import { isCredential } from './lib/profile.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const A = 'board-operations';
const WORKER = 'museumguessr';

/** The strict patterns an argument must match before it can reach SQL. */
export const PATTERNS = {
  week: /^\d{4}-W\d{2}$/,
  int: /^(?:0|[1-9]\d{0,4})$/,
  since: /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?Z?)?$/,
  row: /^[A-Za-z0-9_-]{12}$/,
  reason: /^[a-z][a-z-]{0,31}$/,
  dir: /^(?!-)[\w./-]{1,200}$/,
};

const usage = (what, why, fix = 'npm run board:list (see docs/ops.md "Board operations")') => refuse({ kind: 'usage', what, why, fix, anchor: A });

/** The SQL literal of a validated value; anything that does not match its pattern is a usage refusal. */
export function literal(kind, value) {
  const text = String(value ?? '');
  if (kind === 'now') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)) throw new Error('bad clock value');
    return `'${text}'`;
  }
  if (!PATTERNS[kind]?.test(text)) usage(`${kind} "${text.slice(0, 40)}" is not valid`, `a ${kind} must match ${PATTERNS[kind] ?? 'a known pattern'}`);
  return kind === 'int' ? text : `'${text}'`;
}

/** Fills {{name}} slots of a fixed template with validated literals. */
export function render(template, slots) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!(name in slots)) throw new Error(`template slot ${name} has no value`);
    return slots[name];
  });
}

/** Parses `--flag value` pairs and positionals against an allowlist. */
export function parseArgs(rest, spec) {
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) {
      opts._.push(a);
      continue;
    }
    const name = a.slice(2);
    if (!(name in spec)) usage(`unknown option ${a.slice(0, 40)}`, `this command takes ${Object.keys(spec).map((k) => `--${k}`).join(', ') || 'no options'}`);
    if (spec[name] === 'flag') opts[name] = true;
    else {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith('--')) usage(`--${name} needs a value`, `got ${v ?? 'nothing'}`);
      opts[name] = v;
      i += 1;
    }
  }
  return opts;
}

/** The top-50 rows at or above the saturation threshold (E8). */
export function saturation(rows, threshold = 29500) {
  return rows.slice(0, 50).filter((r) => r.total >= threshold).length;
}

/** Splits streamed text into complete top-level JSON objects (wrangler tail --format json). */
export function jsonObjects(text) {
  const objects = [];
  let depth = 0;
  let inString = false;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i += 1;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (c === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        try {
          objects.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          // not an object we understand; skip it
        }
        start = -1;
      }
    }
  }
  return { objects, rest: depth > 0 && start >= 0 ? text.slice(start) : '' };
}

/** The redacted lines of one tail event: only the Worker's own { request_id, route, error_name } log lines. */
export function tailLines(event) {
  const when = Number.isFinite(event?.eventTimestamp) ? new Date(event.eventTimestamp).toISOString() : '?';
  const out = [];
  for (const log of event?.logs ?? []) {
    for (const m of log?.message ?? []) {
      let line;
      try {
        line = typeof m === 'string' ? JSON.parse(m) : m;
      } catch {
        continue;
      }
      const keys = line && typeof line === 'object' ? Object.keys(line).sort().join() : '';
      if (keys !== 'error_name,request_id,route') continue;
      const safe = [line.request_id, line.route, line.error_name].map((v) => String(v).replace(/[^\w./<>:-]/g, '?').slice(0, 80));
      out.push(`${when} ${safe.join(' ')}`);
    }
  }
  return out;
}

export async function boardCommand({ root = ROOT, args, runner = createRunner({ root }), out = (l) => process.stdout.write(`${l}\n`), env = process.env, now = Date.now(), spawn = nodeSpawn, gate = contentApproved }) {
  const [command, ...rest] = args;
  const common = { local: 'flag', 'persist-to': 'value', yes: 'flag' };
  const specs = {
    off: common,
    dark: common,
    on: common,
    'purge-smoke': common,
    list: { ...common, smoke: 'flag', week: 'value' },
    hide: { ...common, week: 'value', 'min-total': 'value', since: 'value', reason: 'value' },
    unhide: { ...common, reason: 'value' },
    tail: {},
  };
  if (!(command in specs)) usage(`unknown board command ${String(command).slice(0, 40)}`, `commands: ${Object.keys(specs).join(', ')}`);
  const opts = parseArgs(rest, specs[command]);
  if (opts._.length > (command === 'unhide' ? 1 : 0)) usage(`unexpected argument ${opts._.at(-1).slice(0, 40)}`, `board:${command} takes no positional argument${command === 'unhide' ? ' besides the row id' : ''}`);
  const wrangler = wranglerBin(root);
  const iso = new Date(now).toISOString();
  const { weekId } = await import(pathToFileURL(join(root, 'src/api/week.ts')).href);

  if (command === 'tail') return tail({ root, out, env, spawn, wrangler });

  if (opts['persist-to'] && !opts.local) usage('--persist-to needs --local', 'it names a local database directory');
  if (opts['persist-to']) literal('dir', opts['persist-to']);
  const remote = !opts.local;
  const where = remote ? 'the remote board database' : `the local board database${opts['persist-to'] ? ` in ${opts['persist-to']}` : ''}`;
  const target = remote ? ['--remote'] : ['--local', ...(opts['persist-to'] ? ['--persist-to', opts['persist-to']] : [])];

  const scratch = mkdtempSync(join(tmpdir(), 'mg-board-'));
  let files = 0;
  const execute = (sql, label) => {
    const file = join(scratch, `${String((files += 1)).padStart(2, '0')}-${label}.sql`);
    writeFileSync(file, sql);
    return run(file, label);
  };
  const run = (file, label) => exec(['--file', file], label);
  // Reads pass their SQL with --command: on the remote database `--file` runs
  // as an import and answers with a summary of the run, never the rows.
  const query = (sql, label) => exec(['--command', sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n').trim()], label);
  const exec = (args, label) => {
    const r = runner.run(wrangler, ['d1', 'execute', 'DB', ...target, ...args, '--json', ...(remote ? ['--yes'] : []), '--config', WRANGLER_CONFIG], { credentials: remote });
    if (r.status !== 0) refuse({ kind: 'remote', what: `wrangler d1 execute (${label}) failed on ${where}`, why: `it answered ${r.status}${r.stderr ? `: ${r.stderr.trim().split('\n').at(-1).slice(0, 160)}` : ''}`, fix: remote ? 'npm run setup:check -- --deploy, then repeat the command' : 'npm run worker:dev applies the local migrations first', anchor: A });
    try {
      const parsed = JSON.parse(r.stdout);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  };
  const fixed = (name) => run(join(root, 'scripts/sql', `${name}.sql`), name);
  const fixedQuery = (name) => query(readFileSync(join(root, 'scripts/sql', `${name}.sql`), 'utf8'), name);
  const rows = (sets, i) => sets?.[i]?.results ?? [];
  const needYes = (what) => {
    if (remote && !opts.yes) refuse({ kind: 'approval', what: `${what} changes ${where}`, why: 'board changes on the live database need an explicit yes', fix: `npm run board:${command} -- ${[...rest, '--yes'].join(' ')}`, anchor: A });
  };

  try {
    if (command === 'off' || command === 'dark' || command === 'on') {
      if (command === 'on') {
        const approval = gate(root);
        if (!approval.ok) refuse({ kind: 'approval', what: 'board:on needs the content gate (contentApproved)', why: approval.why, fix: 'keep the board dark until batches F and T are promoted (docs/content.md); npm run board:dark', anchor: A });
      }
      needYes(`board:${command}`);
      if (command === 'on') {
        const count = rows(fixedQuery('smoke-count'), 0)[0]?.n ?? 0;
        fixed('purge-smoke');
        out(`removed ${count} dark-mode test row(s) before ranking goes public`);
      }
      fixed(`board-${command}`);
      out(`board mode is now ${command} on ${where}; Workers see it within 30 seconds`);
      return 0;
    }

    if (command === 'purge-smoke') {
      needYes('board:purge-smoke');
      const count = rows(fixedQuery('smoke-count'), 0)[0]?.n ?? 0;
      fixed('purge-smoke');
      out(`removed ${count} dark-mode test row(s) from ${where}`);
      return 0;
    }

    if (command === 'list') {
      const week = literal('week', opts.week ?? weekId(now));
      if (opts.smoke) {
        const sets = query(render(LIST_SMOKE, { week }), 'list-smoke');
        const list = rows(sets, 0);
        out(`dark-mode test rows, week ${week.slice(1, -1)}: ${list.length} shown, ${rows(sets, 1)[0]?.n ?? 0} in all weeks`);
        for (const r of list) out(`  ${String(r.total).padStart(6)}  ${r.date}  ${r.row_id}`);
        return 0;
      }
      const sets = query(render(LIST, { week }), 'list');
      const mode = rows(sets, 0)[0]?.board_mode ?? 'off (no settings row)';
      const top = rows(sets, 1);
      const hidden = rows(sets, 2);
      const count = rows(sets, 3)[0]?.n ?? 0;
      out(`board mode: ${mode}`);
      out(`week ${week.slice(1, -1)}: ${count} device(s) on the board, ${hidden.length} hidden`);
      top.forEach((r, i) => out(`  ${String(i + 1).padStart(2)}  ${String(r.total).padStart(6)}  ${r.date}  ${r.row_id}  ${r.name}`));
      for (const r of hidden) out(`  hidden  ${String(r.total).padStart(6)}  ${r.date}  ${r.row_id}`);
      const sat = saturation(top);
      out(`saturation: ${sat} of the top 50 at 29,500 or more${sat > 10 ? ' — more than 10: review ranking (docs/ops.md); never with seconds, which are not stored' : ''}`);
      return 0;
    }

    const { rebuildSql, CUTOFF_SQL } = await import(pathToFileURL(join(root, 'worker/src/projection.ts')).href);
    const reason = literal('reason', opts.reason ?? (command === 'hide' ? 'bulk' : 'restored'));
    const now_ = literal('now', iso);
    if (command === 'hide') {
      for (const need of ['week', 'min-total', 'since']) if (!opts[need]) usage(`board:hide needs --${need}`, 'bulk hiding is bounded by week, minimum total and start time', 'npm run board:hide -- --week 2026-W43 --min-total 29000 --since 2026-10-21');
      const slots = { week: literal('week', opts.week), min: literal('int', opts['min-total']), since: literal('since', opts.since), reason, now: now_ };
      const would = rows(query(render(HIDE_COUNT, slots), 'hide-count'), 0)[0]?.n ?? 0;
      if (remote && !opts.yes) {
        out(`would hide ${would} row(s) in week ${opts.week} at ${opts['min-total']}+ since ${opts.since}`);
        needYes('board:hide');
      }
      const projection = render(`${rebuildSql().replaceAll('?1', '{{week}}').replaceAll('?2', '{{now}}')};\n${CUTOFF_SQL.replaceAll('?1', '{{week}}')};`, slots);
      execute(`${render(HIDE, slots)}\n${projection}\n`, 'hide');
      out(`hid ${would} row(s); the public board drops them now, cached copies within 60 seconds`);
      return 0;
    }

    // unhide
    if (opts._.length !== 1) usage('board:unhide needs one row id', 'the public row id from board:list', 'npm run board:unhide -- <row-id>');
    const row = literal('row', opts._[0]);
    needYes('board:unhide');
    const weekOf = `(SELECT week FROM scores WHERE row_id = ${row})`;
    const projection = `${rebuildSql().replaceAll('?1', weekOf).replaceAll('?2', now_)};\n${CUTOFF_SQL.replaceAll('?1', weekOf)};`;
    execute(`${render(UNHIDE, { row, reason, now: now_ })}\n${projection}\n`, 'unhide');
    out(`unhid ${opts._[0]} if it was hidden; the public board shows it now, cached copies within 60 seconds`);
    return 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const LIST = `SELECT board_mode FROM settings WHERE id = 1;
SELECT row_id, name, total, substr(created_at, 1, 10) AS date FROM scores WHERE week = {{week}} AND hidden = 0 ORDER BY total DESC, seq LIMIT 50;
SELECT row_id, total, substr(created_at, 1, 10) AS date FROM scores WHERE week = {{week}} AND hidden = 1 ORDER BY total DESC LIMIT 50;
SELECT COALESCE((SELECT n FROM board_weeks WHERE week = {{week}}), 0) AS n;
`;

const LIST_SMOKE = `SELECT row_id, total, substr(created_at, 1, 10) AS date FROM smoke_scores WHERE week = {{week}} ORDER BY total DESC LIMIT 50;
SELECT COUNT(*) AS n FROM smoke_scores;
`;

const HIDE_WHERE = 'week = {{week}} AND total >= {{min}} AND created_at >= {{since}} AND hidden = 0';
const HIDE_COUNT = `SELECT COUNT(*) AS n FROM scores WHERE ${HIDE_WHERE};\n`;
const HIDE = `INSERT INTO moderation (row_id, week, action, reason, at) SELECT row_id, week, 'hide', {{reason}}, {{now}} FROM scores WHERE ${HIDE_WHERE};
UPDATE scores SET hidden = 1 WHERE ${HIDE_WHERE};`;
const UNHIDE = `INSERT INTO moderation (row_id, week, action, reason, at) SELECT row_id, week, 'unhide', {{reason}}, {{now}} FROM scores WHERE row_id = {{row}} AND hidden = 1;
UPDATE scores SET hidden = 0 WHERE row_id = {{row}} AND hidden = 1;`;

/** board:tail: wrangler tail, keeping only the Worker's redacted error lines. */
function tail({ out, env, spawn, wrangler }) {
  const childEnv = { ...cleanEnv(env), ...Object.fromEntries(Object.entries(env).filter(([k]) => isCredential(k))), WRANGLER_SEND_METRICS: 'false' };
  out(`tailing ${WORKER} for error lines (request id, route, error name); Ctrl-C stops`);
  return new Promise((resolve) => {
    const child = spawn(wrangler, ['tail', WORKER, '--format', 'json', '--search', 'error_name', '--config', WRANGLER_CONFIG], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';
    child.stdout.on('data', (d) => {
      const { objects, rest } = jsonObjects(buffer + d);
      buffer = rest;
      for (const event of objects) for (const line of tailLines(event)) out(line);
    });
    child.stderr.on('data', () => {});
    child.on('close', (code) => resolve(code === 0 || code === null ? 0 : 9));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runMain(() => boardCommand({ args: process.argv.slice(2) }));
}
