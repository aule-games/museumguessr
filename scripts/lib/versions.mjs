// The versions a deploy records and a rollback compares (N10, V12-17,
// V12-19): saved-state, scoring and API contract versions, plus the pool
// hash the health check reports. Read from the shared sources so the
// deployment message and /api/v1/health use the same numbers as the page.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** STATE_VERSION is read from the source text; its module pulls in browser code. A unit test pins it to the import. */
export function stateVersion(root) {
  const m = readFileSync(join(root, 'src/state/schema.ts'), 'utf8').match(/^export const STATE_VERSION = (\d+);$/m);
  if (!m) throw new Error('STATE_VERSION not found in src/state/schema.ts');
  return Number(m[1]);
}

export async function releaseVersions(root) {
  const load = (p) => import(pathToFileURL(join(root, p)).href);
  const [{ SCORING_VERSION }, { CONTRACT_VERSION }, { itemsVersion }] = await Promise.all([
    load('src/scoring/config.ts'),
    load('src/api/contract.ts'),
    load('src/content/version.ts'),
  ]);
  const items = JSON.parse(readFileSync(join(root, 'data/items.json'), 'utf8')).items;
  return { state: stateVersion(root), scoring: SCORING_VERSION, contract: CONTRACT_VERSION, poolHash: itemsVersion(items) };
}

/** The deployment message: Cloudflare's deployment history is the release log. */
export function deployMessage({ sha, state, scoring, contract, migrations }) {
  return `${sha} state:${state} scoring:${scoring} contract:${contract} migrations:${migrations}`;
}

const MESSAGE = /^([0-9a-f]{7,40}) state:(\d+) scoring:(\d+) contract:(\d+) migrations:(\d+)$/;

/** The versions a deployment message records, or null for a message this script did not write. */
export function parseDeployMessage(text) {
  const m = String(text ?? '').trim().match(MESSAGE);
  return m ? { sha: m[1], state: Number(m[2]), scoring: Number(m[3]), contract: Number(m[4]), migrations: Number(m[5]) } : null;
}
