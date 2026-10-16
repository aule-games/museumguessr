// The item core (V1-02): the fields the main bundle needs before a round is
// shown (ids, difficulty, Kept city and every answer field), built from
// data/items.json at build time. Titles, captions, facts and credits stay in
// the full records, which load as a lazy chunk (src/content/items.ts).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ITEMS_CORE_ID = 'virtual:museumguessr/items-core';
const RESOLVED = `\0${ITEMS_CORE_ID}`;
const ITEMS_FILE = fileURLToPath(new URL('../../data/items.json', import.meta.url));

/** One record's core, in the shape `CoreItem` in src/content/items.ts declares. */
export function coreOf(it) {
  return {
    id: it.id,
    difficulty: it.difficulty,
    kept: { city: it.kept.city, lat: it.kept.lat, lng: it.kept.lng },
    made: { lat: it.made.lat, lng: it.made.lng, precision: it.made.precision, full_marks_km: it.made.full_marks_km ?? null },
    when: { start: it.when.start, end: it.when.end },
  };
}

/** Vite plugin serving `virtual:museumguessr/items-core` (used by vite.config.ts and vitest.config.ts). */
export function itemsCore() {
  return {
    name: 'museumguessr:items-core',
    resolveId(source) {
      return source === ITEMS_CORE_ID ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      this.addWatchFile(ITEMS_FILE);
      const items = JSON.parse(readFileSync(ITEMS_FILE, 'utf8')).items;
      return `export default ${JSON.stringify(items.map(coreOf))};\n`;
    },
  };
}
