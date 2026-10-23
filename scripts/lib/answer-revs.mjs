// The reviewed answer baseline (V1-answers-rev; V12-137). data/answer-revs.json
// records, per pool item, its answer revision and a hash of its kept, made
// and when answers. items:check fails when an item's answers differ from the
// baseline without a higher answers_rev (the board would otherwise score
// pending games against answers their players never saw); npm run
// items:record writes the baseline after review.

import { answersHash, answersRev } from '../../src/content/revs.ts';
import { coreOf } from './items-core.mjs';

export const REVS_FILE = 'data/answer-revs.json';
const ANCHOR = 'answer-edits-and-saved-games';

/** The baseline for a pool. */
export function baselineOf(items) {
  return {
    note: 'Reviewed answer revisions (npm run items:record). An item whose kept, made or when changes needs a higher answers_rev before this file is recorded again.',
    items: Object.fromEntries(items.map((it) => [it.id, { rev: answersRev(it), answers: answersHash(coreOf(it)) }])),
  };
}

/** Problems and warnings of a pool against its baseline (`problem` builds the report row). */
export function revisionRules(items, baseline, problem) {
  const problems = [];
  const warnings = [];
  if (!baseline) {
    warnings.push(problem(REVS_FILE, 'is missing', 'answer changes are checked against the recorded baseline', 'V12-137', 'npm run items:record', ANCHOR));
    return { problems, warnings };
  }
  for (const it of items) {
    if (!it?.id || !it.kept || !it.made || !it.when) continue;
    const was = baseline.items?.[it.id];
    const rev = answersRev(it);
    if (!was) {
      warnings.push(problem(`item ${it.id} · answers_rev`, `is not in ${REVS_FILE} yet`, 'new items start at their own revision', 'V12-137', 'npm run items:record after the contact-sheet review', ANCHOR));
      continue;
    }
    if (rev < was.rev) problems.push(problem(`item ${it.id} · answers_rev`, `is ${rev}, lower than the recorded ${was.rev}`, 'a revision never goes down', 'V12-137', `set answers_rev back to at least ${was.rev}`, ANCHOR));
    else if (answersHash(coreOf(it)) !== was.answers && rev <= was.rev) {
      problems.push(problem(`item ${it.id} · answers_rev`, `kept, made or when changed but answers_rev is still ${rev}`, 'the board must not score games against answers their players never saw', 'V12-137', `set answers_rev to ${was.rev + 1}, then npm run items:record`, ANCHOR));
    }
  }
  return { problems, warnings };
}
