// The pool hash the page uses (ENG10): items_version over the bundled items'
// answer fields, computed by the same shared function as the page.

import items from '../../data/items.json';
import type { CoreItem } from '../../src/content/core.ts';
import { itemsVersion } from '../../src/content/version.ts';

export const POOL_HASH: string = itemsVersion((items as unknown as { items: readonly CoreItem[] }).items);
