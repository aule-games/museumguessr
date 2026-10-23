// The human-readable event catalogue (DX11, DX18): what each event carries,
// when it fires, how it is deduplicated and what it feeds. docs/analytics.md
// and the About & privacy screen render it; it lives apart from the event
// names so it loads with that screen's chunk, not the main bundle (V1-02).

import { EVENTS, type EventName } from './events.ts';

export interface CatalogueEntry {
  name: EventName;
  props: string;
  fires: string;
  dedupe: string;
  feeds: string;
}

/** Human-readable catalogue; the docs table and the privacy screen render this. */
export const CATALOGUE: CatalogueEntry[] = [
  {
    name: EVENTS.pageview,
    props: 'src: channel; landing: first load in this tab session (boolean); resumed: a saved game was restored (boolean)',
    fires: 'once per page load, after the first screen renders',
    dedupe: 'none (every load counts)',
    feeds: 'KPI step 1; visits per channel',
  },
  {
    name: EVENTS.gameStart,
    props: 'game_ref: a random reference for this game only; src: channel captured at the start of the game; deck_kind: random | challenge | replay; country_cap_missed: the drawn deck could not keep every country of making to two (boolean); game_in_tab: 1 | 2 | 3+ (games started in this tab session); seen_before: 0 | 1-9 | 10-19 | 20-29 | 30+ (a rough count of objects this device had seen)',
    fires: 'when a new game starts (Start, New game, Replay)',
    dedupe: 'once per game',
    feeds: 'share of visitors who start a game',
  },
  {
    name: EVENTS.roundStarted,
    props: 'game_ref; src; round: 1-10; item_id: the object shown',
    fires: 'when a round is shown for the first time',
    dedupe: 'once per game and round',
    feeds: 'drop-off by round',
  },
  {
    name: EVENTS.stepCompleted,
    props: 'src; round: 1-10; step: made | when | kept; item_id',
    fires: 'when an answer is confirmed',
    dedupe: 'once per game, round and step (a changed answer after Back is not sent again)',
    feeds: 'drop-off inside a round',
  },
  {
    name: EVENTS.stepBack,
    props: 'src; round: 1-10; from: the step the player left (when | kept)',
    fires: 'when the player taps Back to change an earlier answer of the same round',
    dedupe: 'none (every Back counts)',
    feeds: 'how often players revise an answer',
  },
  {
    name: EVENTS.roundCompleted,
    props: 'game_ref; src; round: 1-10; item_id; skipped: boolean; answered_count: answered rounds so far; points: 0-3000; made_points, when_points, kept_points: 0-1000 each; first_seen: this device had not seen the object before this game (boolean); timed_out: questions that ran out of time (0-3); seconds_left: whole seconds left when the round ended; active_ms: time the answer controls were usable; ready_ms: time from the round opening to its photo and controls being ready',
    fires: 'when a round\'s reveal visibly opens (also after a time-out or a skip after an image failure)',
    dedupe: 'once per game and round',
    feeds: 'KPI step 2 (answered_count = 3); reveal reach; time-out share; active time per round',
  },
  {
    name: EVENTS.gameCompleted,
    props: 'game_ref; src; total: 0-30000; answered_count',
    fires: 'when the round-10 reveal first opens',
    dedupe: 'once per game',
    feeds: 'share who finish all 10 rounds',
  },
  {
    name: EVENTS.clientError,
    props: 'name; message: first 80 characters, URLs removed; frame: chunk:line:col',
    fires: 'on an uncaught error in game code, or when the map cannot run',
    dedupe: 'at most 3 per tab session',
    feeds: 'errors by build',
  },
  {
    name: EVENTS.feedback,
    props: 'src; q: difficulty | most_fun; a: too_hard | about_right | too_easy, or made | when | kept',
    fires: 'when the player answers the optional difficulty row (after round 3) or the "most fun" row (end screen)',
    dedupe: 'once per game and question',
    feeds: 'difficulty pulse',
  },
  {
    name: EVENTS.resultShared,
    props: 'src; total; method: native | whatsapp | x | copy | manual; kind: challenge | reply; first_in_game: the first share of this game (boolean)',
    fires: 'when a share sheet completes or a share button opens its target (not when the sheet is cancelled)',
    dedupe: 'none (first_in_game marks one per game)',
    feeds: 'share rate per finished game',
  },
  {
    name: EVENTS.challengeOpened,
    props: 'src; valid: the link named 10 known objects (boolean); has_score: it carried a score (boolean); own_deck: the deck is the one this device just finished (boolean)',
    fires: 'when a challenge link\'s screen first renders',
    dedupe: 'once per challenge link in a tab session',
    feeds: 'challenge funnel step 1',
  },
  {
    name: EVENTS.challengeCompleted,
    props: 'game_ref; src; beat: the player beat the friend\'s score (true | false), or null when the link had no comparable score',
    fires: 'when a challenge game ends (its round-10 reveal first opens)',
    dedupe: 'once per game',
    feeds: 'challenge funnel step 2',
  },
  {
    name: EVENTS.tourEnded,
    props: 'src; outcome: done | skipped; step: the last step shown (1-7); replay: opened from the menu (boolean)',
    fires: 'when the game tour closes (first visit, or from the menu)',
    dedupe: 'none',
    feeds: 'whether the tour is finished or skipped, and its effect on the KPI',
  },
  {
    name: EVENTS.weekActive,
    props: 'src; week: this ISO week (UTC, Monday start); active_last_week: this device also completed a game the week before (boolean), read from a marker kept on the device',
    fires: 'when this device completes its first game of the week',
    dedupe: 'once per device and week',
    feeds: 'week-2 return',
  },
];
