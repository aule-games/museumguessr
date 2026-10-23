// The Worker and the modules it shares with the page (V12-129): its own
// dependencies and configuration, no DOM library, no runtime code
// evaluation, and its own type check.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../..');

/** Every source file the Worker entry reaches through relative imports. */
function graph(entry: string): string[] {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file) || !file.endsWith('.ts')) return;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(/^(?:import|export)\s[^'"]*?from\s+'(\.[^']+)'/gm)) walk(resolve(dirname(file), m[1]!));
  };
  walk(entry);
  return [...seen];
}

it('the Worker and every shared module it imports compile without the DOM library and contain no runtime code evaluation or browser globals [V12-129]', () => {
  const files = graph(join(ROOT, 'worker/src/index.ts'));
  const shared = files.filter((f) => f.startsWith(join(ROOT, 'src/')));
  expect(shared.map((f) => f.slice(ROOT.length + 1)).sort()).toEqual(expect.arrayContaining(['src/api/contract.ts', 'src/api/week.ts', 'src/board/names.ts', 'src/scoring/game.ts']));
  for (const f of files) {
    const text = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
    expect(text, f).not.toMatch(/\beval\s*\(|new\s+Function\s*\(|\bdocument\.|\bwindow\.|localStorage|import\.meta\.glob|virtual:/);
  }
  const program = ts.createProgram([join(ROOT, 'worker/src/index.ts')], {
    noEmit: true, strict: true, types: [], lib: ['lib.es2023.d.ts', 'lib.webworker.d.ts'], target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, resolveJsonModule: true,
    allowImportingTsExtensions: true, skipLibCheck: true, noUncheckedIndexedAccess: true,
  });
  expect(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  const worker = JSON.parse(readFileSync(join(ROOT, 'worker/tsconfig.json'), 'utf8'));
  expect(worker.compilerOptions.lib).toEqual(['ES2023', 'WebWorker']);
  expect(worker.compilerOptions.types).toEqual([]);
});
