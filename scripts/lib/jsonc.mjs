// Read wrangler.jsonc: JSON with // and /* */ comments and trailing commas.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function parseJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i < 0) throw new Error('unterminated comment');
      i += 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

export const WRANGLER_CONFIG = 'wrangler.jsonc';

export function readWranglerConfig(root) {
  return parseJsonc(readFileSync(join(root, WRANGLER_CONFIG), 'utf8'));
}
