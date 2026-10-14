// No raw colour values outside the generated tokens.css (DS2, DX32).
export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['src/styles/tokens.css', 'dist/**', 'docs/**'],
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch'],
    'selector-class-pattern': null,
    'no-descending-specificity': null,
    'custom-property-pattern': null,
    'keyframes-name-pattern': null,
  },
};
