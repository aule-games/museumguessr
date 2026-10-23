// The event catalogue (DX11, DX18, PH2, PH4, ENG28). Event names exist only
// here; the lint rule forbids event-name string literals elsewhere. Their
// human-readable descriptions, which docs/analytics.md and the About &
// privacy screen render, are in catalogue.ts.

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
  resultShared: 'result_shared',
  challengeOpened: 'challenge_opened',
  challengeCompleted: 'challenge_completed',
  tourEnded: 'tour_ended',
  weekActive: 'week_active',
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
  game_start: { game_ref: string; src: string; deck_kind: 'random' | 'challenge' | 'replay'; country_cap_missed: boolean; game_in_tab?: '1' | '2' | '3+'; seen_before?: '0' | '1-9' | '10-19' | '20-29' | '30+' };
  round_started: { game_ref: string; src: string; round: number; item_id: string };
  step_completed: { src: string; round: number; step: Step; item_id: string };
  step_back: { src: string; round: number; from: Step };
  round_completed: {
    game_ref: string;
    src: string;
    round: number;
    item_id: string;
    skipped: boolean;
    answered_count: number;
    points: number;
    made_points: number;
    when_points: number;
    kept_points: number;
    first_seen: boolean;
    /** Questions timed out in this round (0-3). */
    timed_out: number;
    /** Whole seconds left when the round ended; null for an untimed round. */
    seconds_left: number | null;
    /** Time the answer controls were usable. */
    active_ms: number;
    /** Round opened → photo and controls ready; null when they never were. */
    ready_ms: number | null;
  };
  game_completed: { game_ref: string; src: string; total: number; answered_count: number };
  client_error: { name: string; message: string; frame: string };
  feedback: { src: string; q: FeedbackQ; a: string };
  result_shared: { src: string; total: number; method: 'native' | 'whatsapp' | 'x' | 'copy' | 'manual'; kind: 'challenge' | 'reply'; first_in_game: boolean };
  challenge_opened: { src: string; valid: boolean; has_score: boolean; own_deck: boolean };
  challenge_completed: { game_ref: string; src: string; beat: boolean | null };
  tour_ended: { src: string; outcome: 'done' | 'skipped'; step: number; replay: boolean };
  week_active: { src: string; week: string; active_last_week: boolean };
}
