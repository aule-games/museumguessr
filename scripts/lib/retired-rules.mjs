// Active source/specifications cannot revive superseded behaviour. Historical
// replacement text is inspected separately and never treated as an active rule.
const GLOBAL_RULES = [
  /\bBOARD_ENABLED\b/,
  /\bVITE_API_HOST\b/,
  /\bname_rejected\b/,
  /Board unavailable/,
  /adding it in a minute/i,
  /Add to this week's board/,
  /Replace your/,
  /(?:moved[- ]page|["“]moved["”] page)/i,
  /(?:keep_vars[^\n]{0,120}BOARD_MODE|BOARD_MODE[^\n]{0,120}keep_vars)/,
  /(?:smoke[^\n]{0,80}(?:in|into)\s+`?scores`?(?!_)\b)/i,
  /(?:pre-agreed fallback|fallback[- ]constant rule)/i,
];

export function retiredRuleHits(path, text) {
  if (path === 'docs/verification.md') return [];
  if (path === 'docs/requirements.json') {
    const manifest = JSON.parse(text);
    text = JSON.stringify({ ...manifest, requirements: manifest.requirements.map(rule => Object.fromEntries(Object.entries(rule).filter(([key]) => key !== 'replaces'))) });
  }
  const patterns = path === 'src/api/contract.ts'
    ? [...GLOBAL_RULES, /\bnickname\b/, /\bsecret_sha256\b/]
    : GLOBAL_RULES;
  return patterns.flatMap(pattern => pattern.test(text) ? [`${path}: retired rule ${pattern.source}`] : []);
}
