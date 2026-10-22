import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION } from '../../src/api/contract';
import { ITEMS_VERSION } from '../../src/content/items';
import { SCORING_VERSION } from '../../src/scoring/config';
import { STATE_VERSION } from '../../src/state/schema';
// @ts-expect-error plain ESM helper without types
import { deployMessage, parseDeployMessage, releaseVersions } from '../../scripts/lib/versions.mjs';

const ROOT = join(import.meta.dirname, '../..');

describe('release versions', () => {
  it('the deployment message records the SHA and the state, scoring, contract and migration versions the page uses [V12-17]', async () => {
    const v = await releaseVersions(ROOT);
    expect(v).toEqual({ state: STATE_VERSION, scoring: SCORING_VERSION, contract: CONTRACT_VERSION, poolHash: ITEMS_VERSION });
    const message = deployMessage({ sha: 'abc1234', ...v, migrations: 0 });
    expect(message).toBe(`abc1234 state:${STATE_VERSION} scoring:${SCORING_VERSION} contract:${CONTRACT_VERSION} migrations:0`);
    expect(parseDeployMessage(message)).toEqual({ sha: 'abc1234', state: STATE_VERSION, scoring: SCORING_VERSION, contract: CONTRACT_VERSION, migrations: 0 });
    for (const other of ['', 'hand deploy', 'abc1234 state:3', 'zzz state:1 scoring:1 contract:1 migrations:0']) expect(parseDeployMessage(other)).toBeNull();
  });
});
