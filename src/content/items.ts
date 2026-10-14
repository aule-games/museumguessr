// Bundled content (ENG10): items are imported at build time and images are
// content-hashed by Vite, so a redeploy never mixes old and new files.

import itemsFile from '../../data/items.json';
import sampleFile from '../../data/sample.json';
import { DISTANCE } from '../scoring/config.ts';
import { madeFullMarksKm } from '../scoring/score.ts';
import type { AnswerKey } from '../state/reducer.ts';
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

export function answerKey(it: Item): AnswerKey {
  return {
    id: it.id,
    kept: { lat: it.kept.lat, lng: it.kept.lng },
    keptFullMarksKm: DISTANCE.keptFullMarksKm,
    made: { lat: it.made.lat, lng: it.made.lng },
    madeFullMarksKm: madeFullMarksKm(it.made.precision, it.made.full_marks_km),
    start: it.when.start,
    end: it.when.end,
  };
}

export const ANSWER_KEYS: readonly AnswerKey[] = ITEMS.map(answerKey);
