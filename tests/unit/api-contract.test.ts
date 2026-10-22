import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, expectTypeOf, it } from 'vitest';
import { ENDPOINTS, ERRORS, PAYLOAD_FIELDS, RETAINED_WEEKS, SMOKE_READ_HEADER, type DarkBoard, type DarkDeviceBoard, type PublicRow, type Receipt, type ScorePayload, type ScoreRequest } from '../../src/api/contract';
import { COPY } from '../../src/copy';

const root = join(import.meta.dirname, '../..');
const api = readFileSync(join(root, 'docs/api.md'), 'utf8');
function table(tag: string) {
  const body = api.split(`<!-- ${tag} -->`)[1]!.split(`<!-- /${tag} -->`)[0]!;
  return body.trim().split('\n').slice(2).map(line => line.split(/(?<!\\)\|/).slice(1, -1).map(cell => cell.trim().replace(/`/g, '').replace(/\\\|/g, '|')));
}

it('the API reference exactly matches endpoint paths authentication and response types [V12-03]', () => {
  expect(table('endpoint-table')).toEqual(ENDPOINTS.map(e => [e.method, e.path, e.auth, e.request, e.success, e.errors.join(', ')]));
  expect(table('error-table')).toEqual(Object.entries(ERRORS).map(([reason, e]) => [reason, String(e.status), String(e.retryable), e.copy, e.analytics]));
  for (const e of Object.values(ERRORS)) expect(COPY).toHaveProperty(e.copy);
});

it('the shared contract compiles with no DOM library or ambient package types [V12-05]', () => {
  const program = ts.createProgram([join(root, 'src/api/contract.ts')], {
    noEmit: true, strict: true, types: [], lib: ['lib.es2023.d.ts'],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  });
  expect(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
});

it('canonical score fields exclude credentials and time and public rows exclude private identities [V12-06]', () => {
  expectTypeOf<(typeof PAYLOAD_FIELDS)[number]>().toEqualTypeOf<keyof ScorePayload>();
  expectTypeOf<Exclude<keyof ScoreRequest, keyof ScorePayload>>().toEqualTypeOf<'turnstile_token'>();
  expectTypeOf<keyof PublicRow>().toEqualTypeOf<'row_id' | 'name' | 'total' | 'rank' | 'date'>();
  const fields = api.split('<!-- payload-fields -->')[1]!.split('<!-- /payload-fields -->')[0]!;
  expect([...fields.matchAll(/^- `([^`]+)`$/gm)].map(m => m[1])).toEqual([...PAYLOAD_FIELDS]);
  expect(PAYLOAD_FIELDS).toHaveLength(new Set(PAYLOAD_FIELDS).size);
  for (const field of ['key', 'player_hash', 'seconds_left', 'active_ms', 'finished_at', 'turnstile_token']) expect(PAYLOAD_FIELDS).not.toContain(field);
  expect(api).toContain('Time and test mode are client-declared and are not a security boundary.');
});

it('smoke reads have explicit unranked context and bounded owner history in the contract [V12-03]', () => {
  expect(SMOKE_READ_HEADER).toBe('X-MuseumGuessr-Test');
  expect(RETAINED_WEEKS).toBe(8);
  expectTypeOf<keyof DarkBoard>().toEqualTypeOf<'smoke' | 'week' | 'resets_at'>();
  expectTypeOf<keyof DarkDeviceBoard['personal']>().toEqualTypeOf<'name' | 'best' | 'weeks'>();
  expectTypeOf<Receipt['receipt_rank']>().toEqualTypeOf<number | null>();
  for (const text of ['X-MuseumGuessr-Test: 1', 'at most one best per retained week', 'no history paging', 'ordinary dark reads remain disabled']) {
    expect(api.toLowerCase()).toContain(text.toLowerCase());
  }
});
