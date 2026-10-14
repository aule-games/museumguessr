#!/usr/bin/env node
// Generates src/types/item.ts from data/items.schema.json (DX18).
// `--check` exits non-zero when the generated file is stale.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const schema = JSON.parse(readFileSync(`${root}data/items.schema.json`, 'utf8'));
const out = `${root}src/types/item.ts`;

const ts = await compile(schema, 'ItemsFile', {
  bannerComment: '/* Generated from data/items.schema.json by `npm run types`. Do not edit. */',
  additionalProperties: false,
  unreachableDefinitions: true,
  style: { singleQuote: true },
});

if (process.argv.includes('--check')) {
  if (!existsSync(out) || readFileSync(out, 'utf8') !== ts) {
    console.error('✖ src/types/item.ts is stale\n  why: the Item type is generated from data/items.schema.json [DX18]\n  fix: run npm run types\n  docs: docs/content.md#schema');
    process.exit(1);
  }
} else {
  writeFileSync(out, ts);
  console.log('wrote src/types/item.ts');
}
