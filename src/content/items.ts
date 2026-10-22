// Bundled content (ENG10, V1-02): items are imported at build time and images
// are content-hashed by Vite, so a redeploy never mixes old and new files.
// The main bundle carries only the item core (ids, difficulty, Kept city and
// the answer fields), enough to draw, check and score a deck. The full
// records (titles, captions, facts, credits) load as one lazy chunk, started
// when the app boots; screens that show an object wait for it.

import core from 'virtual:museumguessr/items-core';
import sampleFile from '../../data/sample.json';
import type { DeckItem } from '../deck/planner.ts';
import { answerKey, type AnswerKey } from '../scoring/game.ts';
import type { Pool } from '../state/schema.ts';
import type { Item } from '../types/item.ts';
import type { CoreItem } from './core.ts';
import { itemsVersion } from './version.ts';

export type { CoreItem } from './core.ts';

const images = import.meta.glob('/images/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>;

export const CORE: readonly CoreItem[] = core;
export const SAMPLE: Item = (sampleFile as unknown as { items: Item[] }).items[0] as Item;
export const ITEM_IDS: readonly string[] = CORE.map((it) => it.id);
export const ITEMS_VERSION = itemsVersion(CORE);
const LIVE: ReadonlySet<string> = new Set(ITEM_IDS);

export function imageUrl(id: string): string {
  return images[`/images/${id}.jpg`] ?? '';
}

/** Whether an id is in the live pool (a challenge link names only live ids). */
export function hasItem(id: string): boolean {
  return LIVE.has(id);
}

export { answerKey };

/** Answer keys of the whole live pool; the reducer looks a round's key up by item id (V1-04). */
export const ANSWER_KEYS: readonly AnswerKey[] = CORE.map(answerKey);

/** A pool as the saved-state parser sees it: a deck's hash, or null for an unknown id (V1-05). */
export function poolOf(items: readonly CoreItem[]): Pool {
  const byId = new Map(items.map((it) => [it.id, it]));
  return {
    deckHash(ids) {
      const deck = ids.map((id) => byId.get(id));
      return deck.every((it) => it !== undefined) ? itemsVersion(deck as CoreItem[]) : null;
    },
  };
}

export const POOL: Pool = poolOf(CORE);

/** The pool as the deck planner sees it: difficulty, Kept city and country of making per object (V1-08, ENG12). */
export const DECK_ITEMS: readonly DeckItem[] = CORE.map((it) => ({ id: it.id, difficulty: it.difficulty, kept: it.kept.city, made_country: it.made.country }));

// ----- full records (lazy) -----

let byId: ReadonlyMap<string, Item> | null = null;
let loading: Promise<void> | null = null;

/** Load the full records once; a failed load can be retried. */
export function loadItems(): Promise<void> {
  loading ??= import('../../data/items.json').then(
    (m) => {
      const items = (m.default as unknown as { items: Item[] }).items;
      // Both halves come from the same build; a mismatch means a broken deploy.
      if (items.length !== ITEM_IDS.length || items.some((it, i) => it.id !== ITEM_IDS[i])) throw new Error('item records do not match the item core');
      byId = new Map(items.map((it) => [it.id, it]));
    },
    (err: unknown) => {
      loading = null;
      throw err;
    },
  );
  return loading;
}

export function itemsLoaded(): boolean {
  return byId !== null;
}

/** The items of a deck, in deck order; throws before the records have loaded or on an id that is not in the pool. */
export function deckItems(ids: readonly string[]): Item[] {
  const all = byId;
  if (!all) throw new Error('item records are not loaded');
  return ids.map((id) => {
    const it = all.get(id);
    if (!it) throw new Error(`unknown item id ${id}`);
    return it;
  });
}
