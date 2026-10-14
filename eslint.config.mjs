// Code and copy rules on owned source (ENG34, SEC1, DX30, DS30).
import tseslint from 'typescript-eslint';

const EVENT_NAMES = '^(\\$pageview|game_start|round_started|step_completed|round_completed|game_completed|client_error|feedback|result_copied)$';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'src/types/item.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
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
    files: ['tests/**/*.ts', 'scripts/**/*.mjs'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
