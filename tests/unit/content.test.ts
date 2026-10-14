import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { itemsVersion } from '../../src/content/version';
import type { Item } from '../../src/types/item';

const items: Item[] = JSON.parse(readFileSync(join(import.meta.dirname, '../../data/items.json'), 'utf8')).items;
const clone = () => JSON.parse(JSON.stringify(items)) as Item[];

describe('[ENG10] items_version', () => {
  it('ignores fact and text edits', () => {
    const edited = clone();
    (edited[0] as Item).facts[0].text = 'A typo fix.';
    (edited[0] as Item).title = 'Retitled';
    expect(itemsVersion(edited)).toBe(itemsVersion(items));
  });
  it('changes when an answer changes', () => {
    const edited = clone();
    (edited[0] as Item).when.start -= 1;
    expect(itemsVersion(edited)).not.toBe(itemsVersion(items));
    const moved = clone();
    (moved[1] as Item).kept.lat += 0.5;
    expect(itemsVersion(moved)).not.toBe(itemsVersion(items));
  });
  it('changes when the order changes', () => {
    const swapped = clone();
    [swapped[0], swapped[1]] = [swapped[1] as Item, swapped[0] as Item];
    expect(itemsVersion(swapped)).not.toBe(itemsVersion(items));
  });
});
