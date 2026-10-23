// Answer revisions (V1-answers-rev; V12-88, V12-137). DOM-free, shared by
// the page (each submission's answers_revs, from the deck's full records)
// and the Worker (which refuses lower revisions and waits on higher ones).

import type { CoreItem } from './core.ts';
import { itemsVersion } from './version.ts';

/** An item's answer revision; an item without one is at revision 1. */
export const answersRev = (it: { answers_rev?: number | null }): number => it.answers_rev ?? 1;

/** A hash of one item's id and kept, made and when answers: what data/answer-revs.json records. */
export const answersHash = (it: CoreItem): string => itemsVersion([it]);
