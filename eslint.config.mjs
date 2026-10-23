// Code and copy rules on owned source (ENG34, SEC1, DX30, DS30).
import tseslint from 'typescript-eslint';

const EVENT_NAMES = '^(\\$pageview|game_start|round_started|step_completed|round_completed|game_completed|client_error|feedback|result_shared|challenge_opened|challenge_completed|tour_ended|step_back|week_active|board_submitted|board_viewed)$';

const SOURCE_RULES = [
  {
    selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
    message: 'SEC1: render text with textContent or the h() helper, never innerHTML.',
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: 'SEC1: never insert HTML strings.',
  },
  {
    selector: `Literal[value=/${EVENT_NAMES}/]`,
    message: 'DX30: use the EVENTS constant from src/analytics/events.ts, not an event-name string.',
  },
  {
    selector: 'Literal[value=/\\?src=/]',
    message: 'PH3: channel links use utm_source, never ?src=.',
  },
];

export default tseslint.config(
  { ignores: ['dist/**', 'dist-board/**', 'node_modules/**', 'worker/node_modules/**', '.wrangler/**', 'test-results/**', 'playwright-report/**', 'src/types/item.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'worker/src/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...SOURCE_RULES] },
  },
  {
    // A game plays its own deck: screens never index the whole pool by round (V1-04).
    files: ['src/app.ts', 'src/ui/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...SOURCE_RULES,
        {
          selector: 'MemberExpression[computed=true][object.name=/^(ITEMS|ANSWER_KEYS)$/]',
          message: "V1-04: read a round's item from the game's deck (deckItems(state.item_ids)), never ITEMS[...] or ANSWER_KEYS[...].",
        },
      ],
    },
  },
  {
    files: ['src/analytics/events.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['src/copy.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'Literal[value=/\\bowns?\\b/i]', message: 'DS30: museums "hold" objects; never "own".' },
        { selector: 'Literal[value=/\\?src=/]', message: 'PH3: channel links use utm_source, never ?src=.' },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'worker/tests/**/*.ts', 'scripts/**/*.mjs'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
