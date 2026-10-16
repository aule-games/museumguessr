// items_version (DX4, ENG10): a hash of the ordered ids plus the kept, made
// and when answer fields only, computed from the bundled data, never typed by
// hand. A fact typo fix leaves it unchanged; an answer change resets games.

import type { CoreItem } from './items.ts';

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function itemsVersion(items: readonly CoreItem[]): string {
  const answers = items.map((it) => [
    it.id,
    it.kept.lat,
    it.kept.lng,
    it.made.lat,
    it.made.lng,
    it.made.precision,
    it.made.full_marks_km ?? null,
    it.when.start,
    it.when.end,
  ]);
  return fnv1a(JSON.stringify(answers));
}
