#!/usr/bin/env node
// Writes src/styles/tokens.css from src/design/tokens.json (DX32).
// `node scripts/tokens.mjs --check` exits non-zero when the CSS is stale.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tokens = JSON.parse(readFileSync(`${root}src/design/tokens.json`, 'utf8'));
const out = `${root}src/styles/tokens.css`;

export function renderTokensCss(t) {
  const lines = [
    '/* Generated from src/design/tokens.json by `npm run tokens`. Do not edit. */',
    ':root {',
  ];
  for (const [group, values] of Object.entries(t)) {
    if (group.startsWith('$') || typeof values !== 'object') continue;
    for (const [key, value] of Object.entries(values)) lines.push(`  --${group}-${key}: ${value};`);
  }
  lines.push('}', '');
  return lines.join('\n');
}

const css = renderTokensCss(tokens);
if (process.argv.includes('--check')) {
  const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (current !== css) {
    console.error('✖ src/styles/tokens.css is stale\n  why: tokens.css is generated from src/design/tokens.json [DX32]\n  fix: run npm run tokens\n  docs: DESIGN.md#tokens');
    process.exit(1);
  }
} else {
  writeFileSync(out, css);
  console.log(`wrote ${out.slice(root.length)}`);
}
