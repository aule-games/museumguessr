// The event catalogue (DX11, DX18, PH2, PH4, ENG28). Event names exist only
// here; the lint rule forbids event-name string literals elsewhere.
// docs/analytics.md and the About & privacy screen are generated from this.

export const EVENTS = {
  pageview: '$pageview',
  gameStart: 'game_start',
  roundStarted: 'round_started',
  stepCompleted: 'step_completed',
  stepBack: 'step_back',
  roundCompleted: 'round_completed',
  gameCompleted: 'game_completed',
  clientError: 'client_error',
  feedback: 'feedback',
  resultCopied: 'result_copied',
  tourEnded: 'tour_ended',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** Question order inside a round (DS35): made → when → kept, a story from making to today. */
export const STEPS = ['made', 'when', 'kept'] as const;
export type Step = (typeof STEPS)[number];

export const FEEDBACK = {
  difficulty: ['too_hard', 'about_right', 'too_easy'],
  most_fun: ['made', 'when', 'kept'],
} as const;
export type FeedbackQ = keyof typeof FEEDBACK;

/** Properties sent with every event (PH6). */
export interface SuperProps {
  project_id: 'museumguessr';
  build_id: string;
}

export interface EventProps {
  $pageview: { src: string; landing: boolean; resumed: boolean };
  game_start: { src: string };
  round_started: { src: string; round: number };
  step_completed: { src: string; round: number; step: Step };
  step_back: { src: string; round: number; from: Step };
  round_completed: { src: string; round: number; skipped: boolean; answered_count: number; points: number };
  game_completed: { src: string; total: number; answered_count: number };
  client_error: { name: string; message: string; frame: string };
  feedback: { src: string; q: FeedbackQ; a: string };
  result_copied: { src: string; total: number; method: 'clipboard' | 'manual' };
  tour_ended: { src: string; outcome: 'done' | 'skipped'; step: number; replay: boolean };
}

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
    props: 'src: channel captured at the start of the game',
    fires: 'when a new game starts (Start, New game, Replay)',
    dedupe: 'once per game',
    feeds: 'share of visitors who start a game',
  },
  {
    name: EVENTS.roundStarted,
    props: 'src; round: 1-10',
    fires: 'when a round is shown for the first time',
    dedupe: 'once per game and round',
    feeds: 'drop-off by round',
  },
  {
    name: EVENTS.stepCompleted,
    props: 'src; round: 1-10; step: made | when | kept',
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
    props: 'src; round: 1-10; skipped: boolean; answered_count: answered rounds so far; points: 0-3000',
    fires: 'when the reveal is shown (or a round is skipped after an image failure)',
    dedupe: 'once per game and round',
    feeds: 'KPI step 2 (answered_count = 3); median time per round',
  },
  {
    name: EVENTS.gameCompleted,
    props: 'src; total: 0-30000; answered_count',
    fires: 'after the round-10 reveal, when the end screen opens',
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
    name: EVENTS.resultCopied,
    props: 'src; total; method: clipboard | manual',
    fires: 'when the player copies the result text',
    dedupe: 'none',
    feeds: 'sharing interest',
  },
  {
    name: EVENTS.tourEnded,
    props: 'src; outcome: done | skipped; step: the last step shown (1-7); replay: opened from the menu (boolean)',
    fires: 'when the game tour closes (first visit, or from the menu)',
    dedupe: 'none',
    feeds: 'whether the tour is finished or skipped, and its effect on the KPI',
  },
];
