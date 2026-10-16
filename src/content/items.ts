// Bundled content (ENG10): items are imported at build time and images are
// content-hashed by Vite, so a redeploy never mixes old and new files.

import itemsFile from '../../data/items.json';
import sampleFile from '../../data/sample.json';
import type { DeckItem } from '../deck/planner.ts';
import { answerKey, type AnswerKey } from '../scoring/game.ts';
import type { Pool } from '../state/schema.ts';
import type { Item } from '../types/item.ts';
import { itemsVersion } from './version.ts';

const images = import.meta.glob('/images/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>;

export const ITEMS: readonly Item[] = (itemsFile as unknown as { items: Item[] }).items;
export const SAMPLE: Item = (sampleFile as unknown as { items: Item[] }).items[0] as Item;
export const ITEM_IDS: readonly string[] = ITEMS.map((it) => it.id);
export const ITEMS_VERSION = itemsVersion(ITEMS);

export function imageUrl(id: string): string {
  return images[`/images/${id}.jpg`] ?? '';
}

export { answerKey };

/** Answer keys of the whole live pool; the reducer looks a round's key up by item id (V1-04). */
export const ANSWER_KEYS: readonly AnswerKey[] = ITEMS.map(answerKey);

const BY_ID: ReadonlyMap<string, Item> = new Map(ITEMS.map((it) => [it.id, it]));

export function itemById(id: string): Item | undefined {
  return BY_ID.get(id);
}

/** The items of a deck, in deck order; throws on an id that is not in the pool. */
export function deckItems(ids: readonly string[]): Item[] {
  return ids.map((id) => {
    const it = BY_ID.get(id);
    if (!it) throw new Error(`unknown item id ${id}`);
    return it;
  });
}

/** A pool as the saved-state parser sees it: a deck's hash, or null for an unknown id (V1-05). */
export function poolOf(items: readonly Item[]): Pool {
  const byId = new Map(items.map((it) => [it.id, it]));
  return {
    deckHash(ids) {
      const deck = ids.map((id) => byId.get(id));
      return deck.every((it) => it !== undefined) ? itemsVersion(deck as Item[]) : null;
    },
  };
}

export const POOL: Pool = poolOf(ITEMS);

/** The pool as the deck planner sees it: difficulty and Kept city per object (V1-08). */
export const DECK_ITEMS: readonly DeckItem[] = ITEMS.map((it) => ({ id: it.id, difficulty: it.difficulty, kept: it.kept.city }));
