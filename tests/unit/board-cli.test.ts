import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { boardCommand, jsonObjects, literal, saturation, tailLines } from '../../scripts/board.mjs';
// @ts-expect-error plain ESM script without types
import { parse as parseWorkerDev, workerDev } from '../../scripts/worker-dev.mjs';
// @ts-expect-error plain ESM helper without types
import { contentApproved } from '../../scripts/lib/content-gate.mjs';
// @ts-expect-error plain ESM helper without types
import { EXIT, runMain } from '../../scripts/lib/ops.mjs';
import { sqliteD1 } from '../../worker/tests/helpers/sqlite-d1';
import { type Call, type Rule, sink, stubRunner } from './helpers/ops-stubs';

const REPO = join(import.meta.dirname, '../..');
const CREDS = { CLOUDFLARE_API_TOKEN: 'cf-token', CLOUDFLARE_ACCOUNT_ID: 'acct' };
const NOW = Date.UTC(2026, 9, 21, 10); // Wednesday of 2026-W43
const approved = () => ({ ok: true, why: 'batches F and T are promoted' });
const notApproved = () => ({ ok: false, why: 'data/content-approval.json does not exist yet (batches F and T are not promoted)' });

/** The SQL text of each executed file, read while the stub runs (the script deletes its scratch files). */
function machine(rules: Rule[] = []) {
  const sql: string[] = [];
  const capture: Rule = [
    /^wrangler d1 execute/,
    (line) => {
      const file = line.match(/--file (\S+)/)?.[1];
      if (file) sql.push(readFileSync(file, 'utf8'));
      const command = line.match(/--command ([\s\S]*?) --json/)?.[1];
      if (command) sql.push(command);
      return { stdout: '[]' };
    },
  ];
  const m = stubRunner(REPO, [...rules.map(([re, a]): Rule => [re, (line, input, env) => {
    const file = line.match(/--file (\S+)/)?.[1];
    if (file) sql.push(readFileSync(file, 'utf8'));
    const command = line.match(/--command ([\s\S]*?) --json/)?.[1];
    if (command) sql.push(command);
    return typeof a === 'function' ? a(line, input, env) : a;
  }]), capture], CREDS);
  return { ...m, sql };
}

async function board(args: string[], options: { rules?: Rule[]; gate?: () => { ok: boolean; why: string }; spawn?: unknown } = {}) {
  const m = machine(options.rules);
  const io = sink();
  const code = await runMain(() => boardCommand({ root: REPO, args, runner: m.runner, out: io.out, env: { PATH: '/usr/bin', ...CREDS }, now: NOW, gate: options.gate ?? notApproved, spawn: options.spawn }), io.err);
  return { code, out: io.all(), calls: m.calls(), sql: m.sql };
}

const d1Calls = (calls: Call[]) => calls.filter((c) => c.line.startsWith('wrangler d1 execute'));

describe('npm run board:off / board:dark / board:on', () => {
  it('writes the D1 settings row from a fixed statement file, remote only with --yes and the credentials, local without either [V12-103] [V12-110]', async () => {
    const dry = await board(['dark']);
    expect(dry.code).toBe(EXIT.approval);
    expect(dry.out).toContain('next: npm run board:dark -- --yes');
    expect(d1Calls(dry.calls)).toEqual([]);
    const live = await board(['dark', '--yes']);
    expect(live.code).toBe(0);
    expect(d1Calls(live.calls).map((c) => [c.line, c.credentials])).toEqual([[`wrangler d1 execute DB --remote --file ${join(REPO, 'scripts/sql/board-dark.sql')} --json --yes --config wrangler.jsonc`, true]]);
    expect(live.out).toContain('board mode is now dark on the remote board database; Workers see it within 30 seconds');
    const local = await board(['off', '--local', '--persist-to', '.wrangler/state']);
    expect(local.code).toBe(0);
    const [call] = d1Calls(local.calls);
    expect(call!.line).toBe(`wrangler d1 execute DB --local --persist-to .wrangler/state --file ${join(REPO, 'scripts/sql/board-off.sql')} --json --config wrangler.jsonc`);
    expect(call!.credentials).toBe(false);
    expect(Object.keys(call!.env).filter((k) => k.startsWith('CLOUDFLARE_'))).toEqual([]);
    for (const m of ['off', 'dark', 'on']) expect(readFileSync(join(REPO, `scripts/sql/board-${m}.sql`), 'utf8')).toContain(`VALUES (1, '${m}',`);
  });

  it('board:on refuses until contentApproved, then purges every smoke row first, prints the count and switches on [V12-106]', async () => {
    const refused = await board(['on', '--yes']);
    expect(refused.code).toBe(EXIT.approval);
    expect(refused.out).toContain('✖ board:on needs the content gate (contentApproved)');
    expect(refused.out).toContain('why: data/content-approval.json does not exist yet');
    expect(d1Calls(refused.calls)).toEqual([]);
    const on = await board(['on', '--yes'], { gate: approved, rules: [[/--command SELECT COUNT\(\*\) AS n FROM smoke_scores;/, { stdout: JSON.stringify([{ results: [{ n: 7 }], success: true }]) }]] });
    expect(on.code).toBe(0);
    expect(d1Calls(on.calls).map((c) => c.line.match(/scripts\/sql\/([\w-]+)\.sql/)?.[1] ?? (c.line.includes('--command SELECT COUNT(*) AS n FROM smoke_scores;') ? 'smoke-count (read)' : c.line))).toEqual(['smoke-count (read)', 'purge-smoke', 'board-on']);
    expect(on.out).toContain('removed 7 dark-mode test row(s) before ranking goes public');
  });

  it('the content gate needs both batches promoted, or F with an approved F-only fallback [V12-106]', () => {
    const root = mkdtempSync(join(tmpdir(), 'mg-gate-'));
    try {
      mkdirSync(join(root, 'data'));
      expect(contentApproved(root).ok).toBe(false);
      const write = (v: unknown) => writeFileSync(join(root, 'data/content-approval.json'), JSON.stringify(v));
      write({ F: { promoted: '2026-11-01' } });
      expect(contentApproved(root)).toMatchObject({ ok: false });
      write({ F: { promoted: '2026-11-01' }, T: { promoted: '2026-11-02' } });
      expect(contentApproved(root)).toMatchObject({ ok: true });
      write({ F: { promoted: '2026-11-01' }, fallback: { approved: '2026-11-03' } });
      expect(contentApproved(root)).toMatchObject({ ok: true, why: 'batch F is promoted under the approved F-only fallback' });
      writeFileSync(join(root, 'data/content-approval.json'), '{');
      expect(contentApproved(root)).toMatchObject({ ok: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('npm run board:list', () => {
  it('lists this week\'s top 50 and hidden rows and reports how many top-50 totals reach 29,500, prompting a ranking review above ten [V12-136]', async () => {
    const top = Array.from({ length: 50 }, (_, i) => ({ row_id: `row${String(i).padStart(9, '0')}`, name: 'Some Name', total: i < 12 ? 29600 - i : 25000, date: '2026-10-20' }));
    const result = [
      { results: [{ board_mode: 'dark' }] },
      { results: top },
      { results: [{ row_id: 'hiddenrow001', total: 29999, date: '2026-10-20' }] },
      { results: [{ n: 340 }] },
    ];
    const listed = await board(['list'], { rules: [[/--command SELECT board_mode FROM settings/, { stdout: JSON.stringify(result) }]] });
    expect(listed.code).toBe(0);
    expect(listed.out).toContain('board mode: dark');
    expect(listed.out).toContain('week 2026-W43: 340 device(s) on the board, 1 hidden');
    expect(listed.out).toContain('saturation: 12 of the top 50 at 29,500 or more — more than 10: review ranking');
    expect(listed.sql[0]).toContain("WHERE week = '2026-W43' AND hidden = 0 ORDER BY total DESC, seq LIMIT 50");
    // reads go through --command: on the remote database --file answers with a run summary, not the rows
    expect(d1Calls(listed.calls).map((c) => c.line.includes(' --command SELECT board_mode FROM settings'))).toEqual([true]);
    expect(saturation(top.map((r, i) => ({ ...r, total: i < 10 ? 29500 : 29499 })))).toBe(10);
    const smoke = await board(['list', '--smoke', '--week', '2026-W42', '--local']);
    expect(smoke.sql[0]).toContain("FROM smoke_scores WHERE week = '2026-W42'");
  });
});

describe('npm run board:hide / board:unhide', () => {
  it('refuses hostile or malformed arguments before any wrangler call, so no argument text reaches SQL unchecked [V12-110]', async () => {
    const hostile: string[][] = [
      ['hide', '--week', "2026-W43' OR '1'='1", '--min-total', '0', '--since', '2026-10-01'],
      ['hide', '--week', '2026-W43', '--min-total', '0; DROP TABLE scores', '--since', '2026-10-01'],
      ['hide', '--week', '2026-W43', '--min-total', '-1', '--since', '2026-10-01'],
      ['hide', '--week', '2026-W43', '--min-total', '29000', '--since', "2026-10-01'--"],
      ['hide', '--week', '2026-W43', '--min-total', '29000'],
      ['hide', '--week', '2026-W43', '--min-total', '29000', '--since', '2026-10-01', '--reason', 'Name Of A Person'],
      ['hide', '--week', '2026-W43', '--min-total', '29000', '--since', '2026-10-01', '--command', 'DELETE FROM scores'],
      ['unhide', "abc'); DELETE"],
      ['unhide'],
      ['unhide', 'AAAAAAAAAAAA', 'BBBBBBBBBBBB'],
      ['list', '--week'],
      ['list', '--local', '--persist-to', '--yes'],
      ['list', '--local', '--persist-to', '../$(rm -rf ~)'],
      ['drop'],
    ];
    for (const args of hostile) {
      const r = await board([...args, '--yes']);
      expect(r.code, args.join(' ')).toBe(EXIT.usage);
      expect(r.out, args.join(' ')).toMatch(/✖ .*\n {2}why: .*\n {2}next: .*\n {2}docs: docs\/ops\.md#board-operations/);
      expect(d1Calls(r.calls), args.join(' ')).toEqual([]);
    }
    expect(() => literal('int', '30001x')).toThrow();
    expect(literal('week', '2026-W43')).toBe("'2026-W43'");
    expect(literal('int', '29000')).toBe('29000');
  });

  it('a bulk hide counts first, needs --yes, logs a reason without personal data, hides the rows and rebuilds the projection with the Worker\'s own SQL [V12-110] [V12-99]', async () => {
    const dry = await board(['hide', '--week', '2026-W43', '--min-total', '29000', '--since', '2026-10-20'], { rules: [[/--command SELECT COUNT\(\*\) AS n FROM scores WHERE/, { stdout: JSON.stringify([{ results: [{ n: 3 }] }]) }]] });
    expect(dry.code).toBe(EXIT.approval);
    expect(dry.out).toContain('would hide 3 row(s) in week 2026-W43 at 29000+ since 2026-10-20');
    const done = await board(['hide', '--week', '2026-W43', '--min-total', '29000', '--since', '2026-10-20', '--reason', 'abuse', '--yes'], { rules: [[/--command SELECT COUNT\(\*\) AS n FROM scores WHERE/, { stdout: JSON.stringify([{ results: [{ n: 3 }] }]) }]] });
    expect(done.code).toBe(0);
    const sql = done.sql[1]!;
    // Run the generated statements on the real schema: three of four rows hide, buckets and projection follow.
    const db = sqliteD1();
    db.raw.exec("INSERT INTO board_weeks (week, updated_at) VALUES ('2026-W43', 'x')");
    const ins = db.raw.prepare("INSERT INTO scores (week, player_hash, row_id, name, game_id, payload_sha256, total, points, item_ids, deck_kind, fresh, hidden, seq, created_at) VALUES ('2026-W43', ?, ?, 'N', ?, 'h', ?, '[]', '[]', 'random', 1, 0, ?, ?)");
    [[29500, '2026-10-20T09:00:00.000Z'], [29100, '2026-10-21T09:00:00.000Z'], [29000, '2026-10-22T09:00:00.000Z'], [28900, '2026-10-22T09:00:00.000Z']].forEach(([t, at], i) => ins.run(`p${i}`, `row${String(i).padStart(9, '0')}`, `g${i}`, t!, i + 1, at!));
    db.raw.exec(sql);
    expect(db.raw.prepare('SELECT row_id FROM scores WHERE hidden = 1 ORDER BY row_id').all().map((r) => r.row_id)).toEqual(['row000000000', 'row000000001', 'row000000002']);
    expect(db.raw.prepare('SELECT action, reason FROM moderation').all().map((r) => [r.action, r.reason])).toEqual([['hide', 'abuse'], ['hide', 'abuse'], ['hide', 'abuse']]);
    expect(JSON.parse(String(db.raw.prepare("SELECT top_json FROM board_weeks WHERE week = '2026-W43'").get()!.top_json)).map((r: { total: number }) => r.total)).toEqual([28900]);
    expect(db.raw.prepare("SELECT n FROM board_weeks WHERE week = '2026-W43'").get()!.n).toBe(1);
    // Unhide one row by id: it returns to the projection.
    const un = await board(['unhide', 'row000000001', '--yes']);
    db.raw.exec(un.sql[0]!);
    expect(JSON.parse(String(db.raw.prepare("SELECT top_json FROM board_weeks WHERE week = '2026-W43'").get()!.top_json)).map((r: { total: number }) => r.total)).toEqual([29100, 28900]);
    expect(db.raw.prepare("SELECT reason FROM moderation WHERE action = 'unhide'").all().map((r) => r.reason)).toEqual(['restored']);
  });
});

describe('npm run board:tail', () => {
  it('streams only the Worker\'s redacted error lines: request id, route and error name, never a URL, header, body or IP [V12-112]', async () => {
    const event = {
      eventTimestamp: Date.UTC(2026, 9, 21, 10, 5),
      event: { request: { url: 'https://museumguessr.com/api/v1/scores', headers: { authorization: 'Bearer AAAAAAAAAAAAAAAAAAAAAA', 'cf-connecting-ip': '203.0.113.9' } } },
      logs: [
        { level: 'error', message: [JSON.stringify({ request_id: '1b4e28ba-2fa1-11d2-883f-0016d3cca427', route: '/api/v1/scores', error_name: 'D1Error' })] },
        { level: 'log', message: ['something else 203.0.113.9'] },
      ],
    };
    const text = JSON.stringify(event, null, 2);
    const { objects, rest } = jsonObjects(`${text}\n${text.slice(0, 40)}`);
    expect(objects).toHaveLength(1);
    expect(rest).toBe(text.slice(0, 40));
    expect(tailLines(event)).toEqual(['2026-10-21T10:05:00.000Z 1b4e28ba-2fa1-11d2-883f-0016d3cca427 /api/v1/scores D1Error']);
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    let spawned: { cmd: string; args: string[]; env: Record<string, string> } | null = null;
    const spawn = (cmd: string, args: string[], opts: { env: Record<string, string> }) => {
      spawned = { cmd, args, env: opts.env };
      setTimeout(() => {
        child.stdout.emit('data', text.slice(0, 100));
        child.stdout.emit('data', text.slice(100));
        child.emit('close', 0);
      }, 0);
      return child;
    };
    const r = await board(['tail'], { spawn });
    expect(r.code).toBe(0);
    expect(spawned!.args).toEqual(['tail', 'museumguessr', '--format', 'json', '--search', 'error_name', '--config', 'wrangler.jsonc']);
    expect(spawned!.env.CLOUDFLARE_API_TOKEN).toBe('cf-token');
    expect(r.out).toContain('/api/v1/scores D1Error');
    for (const secret of ['203.0.113.9', 'AAAAAAAAAAAAAAAAAAAAAA', 'something else']) expect(r.out).not.toContain(secret);
  });
});

describe('npm run worker:dev', () => {
  it('migrates the local D1, writes the local board mode (dark by default) and serves dist/ on 127.0.0.1 with the always-pass test secret, without credentials [V12-126] [V12-127]', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mg-worker-dev-'));
    try {
      mkdirSync(join(root, 'worker/node_modules/.bin'), { recursive: true });
      writeFileSync(join(root, 'worker/node_modules/.bin/wrangler'), '');
      const io = sink();
      const m = stubRunner(root, [], CREDS);
      expect(await runMain(() => workerDev({ root, runner: m.runner, out: io.out, env: { PATH: '/usr/bin', ...CREDS } }), io.err)).toBe(EXIT.build);
      mkdirSync(join(root, 'dist'));
      writeFileSync(join(root, 'dist/build.txt'), 'e2e\n');
      let spawned: { args: string[]; env: Record<string, string> } | null = null;
      const spawn = (_cmd: string, args: string[], opts: { env: Record<string, string> }) => {
        spawned = { args, env: opts.env };
        const child = new EventEmitter();
        setTimeout(() => child.emit('close', 0), 0);
        return child;
      };
      expect(await runMain(() => workerDev({ root, args: ['--port', '8794'], runner: m.runner, out: io.out, env: { PATH: '/usr/bin', ...CREDS }, spawn }), io.err)).toBe(0);
      expect(m.calls().map((c) => c.line)).toEqual([
        'wrangler d1 migrations apply DB --local --config wrangler.jsonc',
        `wrangler d1 execute DB --local --file ${join(root, 'scripts/sql/board-dark.sql')} --config wrangler.jsonc`,
      ]);
      expect(m.calls().every((c) => !c.credentials)).toBe(true);
      expect(spawned!.args).toEqual(['dev', '--config', 'wrangler.jsonc', '--ip', '127.0.0.1', '--port', '8794', '--var', 'WORKER_VERSION:e2e', '--var', 'TURNSTILE_SECRET:1x0000000000000000000000000000000AA', '--var', 'TURNSTILE_HOSTNAME:example.com', '--var', 'TURNSTILE_TEST_KEYS:1']);
      expect(Object.keys(spawned!.env).filter((k) => k.startsWith('CLOUDFLARE_'))).toEqual([]);
      expect(() => parseWorkerDev(['--port', 'abc'])).toThrow();
      expect(() => parseWorkerDev(['--mode', 'public'])).toThrow();
      expect(parseWorkerDev([])).toEqual({ port: '8787', mode: 'dark', persist: null });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
