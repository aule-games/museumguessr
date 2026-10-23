// One stub harness for the operations scripts (ENG24): git, gh, npm, node
// and wrangler answer from a table, and HTTP answers from recorded
// responses. The real runner (scripts/lib/ops.mjs) runs on a fake spawn,
// so the tests also exercise its environment rules.
// @ts-expect-error plain ESM helper without types
import { parseJsonc } from '../../../scripts/lib/jsonc.mjs';
// @ts-expect-error plain ESM helper without types
import { createRunner } from '../../../scripts/lib/ops.mjs';

export interface Answer { status?: number; stdout?: string; stderr?: string }
export type Rule = [RegExp, Answer | ((line: string, input: string | undefined, env: Record<string, string>) => Answer)];
export interface Call { cmd: string; args: string[]; line: string; credentials: boolean; env: Record<string, string>; input?: string }

const short = (cmd: string) => (cmd.endsWith('/wrangler') ? 'wrangler' : cmd === process.execPath ? 'node' : cmd);

/** A runner whose children answer from `rules` (first match wins; unmatched commands succeed silently). */
export function stubRunner(root: string, rules: Rule[], env: Record<string, string> = {}) {
  const lines: string[] = [];
  const spawn = (cmd: string, args: string[], opts: { input?: string; env: Record<string, string> }) => {
    const line = [short(cmd), ...args].join(' ');
    lines.push(line);
    const hit = rules.find(([re]) => re.test(line));
    const answer = hit ? (typeof hit[1] === 'function' ? hit[1](line, opts.input, opts.env) : hit[1]) : {};
    return { status: answer.status ?? 0, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '' };
  };
  const runner = createRunner({ root, env: { PATH: '/usr/bin', HOME: '/home/op', ...env }, spawn });
  return {
    runner,
    lines,
    calls: () => (runner.calls as Omit<Call, 'line'>[]).map((c) => ({ ...c, cmd: short(c.cmd), line: [short(c.cmd), ...c.args].join(' ') })) as Call[],
  };
}

export interface Recorded { status: number; headers?: Record<string, string>; body?: string; json?: unknown }

/** fetch from recorded responses keyed by "METHOD url" or url; anything else is a network error. */
export function recordedFetch(responses: Record<string, Recorded>) {
  const requests: { method: string; url: string; headers: Record<string, string>; body?: string }[] = [];
  const impl = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    requests.push({ method, url, headers: (init.headers ?? {}) as Record<string, string>, body: init.body as string | undefined });
    const r = responses[`${method} ${url}`] ?? responses[url];
    if (!r) throw new TypeError(`fetch failed: no recorded response for ${method} ${url}`);
    const body = r.json !== undefined ? JSON.stringify(r.json) : (r.body ?? '');
    return new Response(r.status === 204 || r.status === 304 ? null : body, { status: r.status, headers: r.headers ?? {} });
  };
  return { impl: impl as unknown as typeof fetch, requests };
}

/** Collects output lines. */
export function sink() {
  const lines: string[] = [];
  const text = { write: (s: string) => lines.push(s) };
  return { out: (l: string) => lines.push(l), err: text, lines, all: () => lines.join('\n') };
}

/** The repository's wrangler.jsonc as it was before the board (no D1 binding), as plain JSON. */
export function preBoardConfig(text: string): string {
  const { d1_databases: _d1, ratelimits: _rl, triggers: _tr, ...rest } = parseJsonc(text) as Record<string, unknown>;
  void _d1;
  void _rl;
  void _tr;
  return `${JSON.stringify(rest, null, 2)}\n`;
}
