#!/usr/bin/env node
// `npm ci` runs `prepare`, which points git at the committed hooks (DX17).
// `npm run setup:check` reports hook, identity and denylist status.

import { execFileSync } from 'node:child_process';
import { loadDenylist } from './lib/denylist.mjs';

const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

const root = git('rev-parse', '--show-toplevel');
const mode = process.argv[2] ?? 'prepare';

if (mode === 'prepare') {
  if (root) git('config', 'core.hooksPath', '.githooks');
  process.exit(0);
}

if (mode === 'check') {
  if (!root) {
    console.log('not inside a git work tree');
    process.exit(1);
  }
  let ok = true;
  const hooks = git('config', 'core.hooksPath');
  console.log(`hooks:     ${hooks === '.githooks' ? 'on (.githooks)' : `OFF (core.hooksPath=${hooks ?? 'unset'}; run npm ci)`}`);
  if (hooks !== '.githooks') ok = false;

  const email = git('config', 'user.email') ?? '';
  const noreply = /@users\.noreply\.github\.com$/.test(email);
  console.log(`identity:  ${noreply ? 'noreply address' : 'NOT a noreply address (see docs/release.md#commit-identity)'}`);
  if (!noreply) ok = false;

  const { terms } = loadDenylist(root);
  console.log(
    `denylist:  ${terms ? `${terms.length} terms loaded` : 'MISSING (no file at .denylist); hooks skip the scan and release:check fails'}`,
  );

  const major = Number(process.versions.node.split('.')[0]);
  console.log(`node:      ${process.versions.node}${major === 24 ? '' : ' (expected 24.x, see .nvmrc)'}`);
  process.exit(ok ? 0 : 1);
}

console.error('usage: node scripts/setup.mjs [prepare|check]');
process.exit(2);
