// What the built-screen matrix must show for v1.2 (V12-160, V12-161): each
// item names the capture states (file names after the viewport) that show
// it. review-built.mjs writes this to report.json with any state missing.
export const CHECKLIST = [
  { item: 'clock line full and static before the start (photo still loading)', states: ['timer-idle'] },
  { item: 'clock line draining mid-round, with "Round 1/10 · Hard" and pips', states: ['timer-draining'] },
  { item: 'warning at 10 s or less: "Hurry up · n" and the warning line', states: ['timer-warning', 'timer-warning-text200'] },
  { item: 'paused line: first-visit tour open', states: ['tour-1', 'tour-2', 'tour-3', 'tour-4', 'tour-5', 'tour-6', 'tour-7'] },
  { item: 'paused line: failed map note', states: ['timer-paused-map'] },
  { item: '"Time\'s up" hold', states: ['timer-time-up'] },
  { item: 'cue in the photo viewer', states: ['timer-cue-photo-viewer'] },
  { item: 'cue in a dialog header', states: ['timer-cue-menu', 'timer-cue-dialog'] },
  { item: '"Time ran out while you were away" (every row timed out, no guess pins)', states: ['reveal-timed-out-away'] },
  { item: 'timed-out reveal rows', states: ['reveal-time-up-tip', 'reveal-counted-previous', 'reveal-timed-out-text200'] },
  { item: '"Counted at time-up"', states: ['reveal-time-up-tip', 'reveal-counted-previous'] },
  { item: 'the one-time tip', states: ['reveal-time-up-tip'] },
  { item: 'recap "Time ran out on n of 3"', states: ['end-timed-out-recap', 'end-hard-timed-out-text200'] },
  { item: '"Previous answer … used if time runs out" under the year control', states: ['when-previous-answer'] },
  { item: 'difficulty label and pips in the top bar: Easy, Medium, Hard', states: ['difficulty-easy', 'difficulty-medium', 'difficulty-hard', 'difficulty-medium-text200'] },
  { item: '"Object: Hard" on the wall label and "Hard one nailed" on the reveal total', states: ['reveal-hard-nailed', 'reveal-hard-nailed-text200'] },
  { item: 'hard ones nailed on the end summary', states: ['end-hard-nailed', 'end-hard-timed-out-text200'] },
  { item: 'year control "≤ 4000 BCE" end cap selected, and not selected', states: ['when-early-stop', 'when-early-stop-text200', 'when-empty', 'when-set'] },
  { item: "the reveal's broken axis for an early object; distance from 4000 BCE for a younger one", states: ['reveal-early-axis', 'reveal-early-distance'] },
  { item: 'keyboard-open year step (simulated visual viewport), cue showing', states: ['when-keyboard-hurry'] },
  {
    item: 'board card: every state of the board-state table a finished game can reach',
    states: [
      'board-loading', 'board-first-add', 'board-checking', 'board-adding', 'board-added', 'board-new-best', 'board-not-best',
      'board-replaced', 'board-hidden', 'board-last-rank', 'board-pending', 'board-tap-to-finish', 'board-verification-failed',
      'board-unavailable', 'board-sent-unavailable', 'board-update-page', 'board-unknown-week', 'board-last-week', 'board-auto-off',
      'board-not-ranked-replay', 'board-not-ranked-test', 'board-added-low-count', 'board-added-below-top50', 'board-added-distance',
      'board-removed', 'board-first-add-text200', 'board-added-text200', 'board-not-best-text200',
    ],
  },
  {
    item: 'board overlay: top 50 with the You row, own row below the list, ties, empty, low count, cached, unavailable',
    states: [
      'board-overlay-top50', 'board-overlay-top50-you', 'board-overlay-below-top50', 'board-overlay-tied-below', 'board-overlay-empty',
      'board-overlay-low-count', 'board-overlay-cached', 'board-overlay-unavailable', 'board-overlay-top50-text200',
    ],
  },
  {
    item: '"Your board scores" with the switch, the remove dialogs and removal',
    states: [
      'board-scores', 'board-scores-auto-off', 'board-remove-this-week', 'board-remove-older-week', 'board-remove-all', 'board-removing',
      'board-scores-removed', 'board-scores-empty', 'board-scores-text200', 'board-remove-this-week-text200',
    ],
  },
  { item: "the start screen's standing line", states: ['start-standing', 'start-standing-text200'] },
  { item: 'the 404 page', states: ['not-found', 'not-found-text200'] },
];
