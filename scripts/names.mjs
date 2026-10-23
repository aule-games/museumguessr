#!/usr/bin/env node
// npm run names:block -- "<name or word pair>" (M7, N7; V12-109, V12-110).
// Adds a word sequence to the generated-name blocklist
// (src/board/name-blocklist.json). Only names that contain the sequence
// derive again with the next salt; every other name stays the same. The
// argument must be one to three words from the name lists in name order
// (quality, material, thing), so nothing else can reach the file.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { refuse, runMain } from './lib/ops.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BLOCKLIST = 'src/board/name-blocklist.json';
const A = 'board-names';

/** The validated, lower-case sequence, or a usage refusal. */
export function parseSequence(text, lists) {
  const raw = String(text ?? '');
  if (!/^[A-Za-z]+(?: +[A-Za-z]+){0,2}$/.test(raw.trim())) {
    refuse({ kind: 'usage', what: 'names:block takes one to three words of a generated name', why: `got ${JSON.stringify(raw.slice(0, 60))}`, fix: 'npm run names:block -- "Amber Heron" (a pair) or "Quiet Amber Heron" (a whole name)', anchor: A });
  }
  const words = raw.trim().toLowerCase().split(/ +/);
  const sets = lists.map((l) => new Set(l.map((w) => w.toLowerCase())));
  const fits = [0, 1, 2].some((start) => start + words.length <= 3 && words.every((w, i) => sets[start + i].has(w)));
  if (!fits) {
    refuse({ kind: 'usage', what: `"${words.join(' ')}" is not a run of words that a generated name can contain`, why: 'names are quality, material, thing, from src/board/name-words.ts', fix: 'copy the words from the name as the board shows it', anchor: A });
  }
  return words;
}

export async function namesBlock({ root = ROOT, args, out = (l) => process.stdout.write(`${l}\n`) }) {
  const [command, ...rest] = args;
  if (command !== 'block' || rest.length !== 1) {
    refuse({ kind: 'usage', what: 'usage: npm run names:block -- "<name or word pair>"', why: `got ${rest.length} argument(s) after ${command ?? 'nothing'}`, fix: 'quote the words as one argument', anchor: A });
  }
  const { QUALITIES, MATERIALS, THINGS } = await import(pathToFileURL(join(root, 'src/board/name-words.ts')).href);
  const words = parseSequence(rest[0], [QUALITIES, MATERIALS, THINGS]);
  const path = join(root, BLOCKLIST);
  const file = JSON.parse(readFileSync(path, 'utf8'));
  const entry = words.join(' ');
  if (file.entries.includes(entry)) {
    out(`"${entry}" is already blocked; nothing changed`);
    return 0;
  }
  file.entries.push(entry);
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  out(`blocked "${entry}": names containing it now derive again; every other name stays the same`);
  out(`next: npm test, commit ${BLOCKLIST}, then deploy (the page and the Worker share the list)`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runMain(() => namesBlock({ args: process.argv.slice(2) }));
}
