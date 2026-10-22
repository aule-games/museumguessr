import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
// @ts-expect-error plain ESM guard
import { retiredRuleHits } from '../../scripts/lib/retired-rules.mjs';

const root = join(import.meta.dirname, '../..');
function files(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? files(path) : /\.(md|json|ts|css|mjs)$/.test(path) ? [path] : [];
  });
}

it('active specifications and source contain no retired release rules [V12-02]', () => {
  const hits = [...files('docs'), ...files('src')].flatMap(path => retiredRuleHits(path, readFileSync(join(root, path), 'utf8')));
  expect(hits).toEqual([]);
});

it('retired rules are detected without erasing the historical replacement ledger [V12-02]', () => {
  for (const text of ['BOARD_ENABLED', 'VITE_API_HOST', 'name_rejected', 'Board unavailable', 'adding it in a minute', "Add to this week's board", 'Replace your', 'moved page', 'keep_vars for BOARD_MODE', 'smoke rows in scores', 'pre-agreed fallback']) {
    expect(retiredRuleHits('docs/example.md', text), text).not.toEqual([]);
  }
  for (const text of ['nickname', 'secret_sha256']) expect(retiredRuleHits('src/api/contract.ts', text)).not.toEqual([]);
  const m = { requirements: [{ text: 'The current rule', replaces: 'BOARD_ENABLED' }] };
  expect(retiredRuleHits('docs/requirements.json', JSON.stringify(m))).toEqual([]);
  m.requirements[0]!.text = 'BOARD_ENABLED';
  expect(retiredRuleHits('docs/requirements.json', JSON.stringify(m))).not.toEqual([]);
});
