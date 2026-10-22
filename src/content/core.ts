// The item core type (V1-02): the fields the main bundle carries for every
// item. Kept apart from items.ts, which needs Vite, so DOM-free code (the
// Worker, the pool hash) can use it.

import type { Item } from '../types/item.ts';

/** The fields of an item the main bundle carries; a full `Item` is one too. */
export interface CoreItem {
  id: string;
  difficulty: Item['difficulty'];
  kept: Pick<Item['kept'], 'city' | 'lat' | 'lng'>;
  made: Pick<Item['made'], 'lat' | 'lng' | 'precision' | 'full_marks_km' | 'country'>;
  when: Pick<Item['when'], 'start' | 'end'>;
}
