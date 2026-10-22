// Artifact checks shared by check-build and its tests (V12-13, V12-170, M3):
// the `_headers` file against the one header source, the meta CSP of every
// page against the header CSP, and deploy-purpose builds free of test code.

import { cspMismatch, parseHeadersFile, SECURITY_HEADERS } from '../../src/security/headers.ts';
import { DEPLOY_FORBIDDEN_MARKERS } from './profile.mjs';

const unescape = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** The meta CSP of an HTML page, or null. */
export function metaCsp(html) {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  return m ? unescape(m[1]) : null;
}

/** The build purpose a page declares (M3), or null. */
export function buildPurpose(html) {
  return html.match(/<meta name="build-purpose" content="([^"]+)"/)?.[1] ?? null;
}

/**
 * Problems with the `_headers` file: every path gets the security headers
 * with the source's exact values, and each page's meta CSP equals the header
 * CSP apart from the header-only frame-ancestors directive.
 * pages: [[name, html], ...]
 */
export function headerProblems(headersText, pages) {
  const out = [];
  if (headersText == null) return [{ where: '_headers', problem: 'the headers file is missing' }];
  const all = parseHeadersFile(headersText).get('/*');
  if (!all) return [{ where: '_headers', problem: 'no /* rule, so pages would ship without security headers' }];
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (all[name] !== value) out.push({ where: '_headers', problem: `${name} is ${all[name] === undefined ? 'missing' : `"${all[name]}"`}, expected "${value}"` });
  }
  for (const name of Object.keys(all)) if (!(name in SECURITY_HEADERS)) out.push({ where: '_headers', problem: `/* sets an unexpected header ${name}` });
  for (const [page, html] of pages) {
    const meta = metaCsp(html);
    if (!meta) {
      out.push({ where: page, problem: 'no Content-Security-Policy meta' });
      continue;
    }
    for (const p of cspMismatch(all['Content-Security-Policy'] ?? '', meta)) out.push({ where: `${page} / _headers`, problem: `CSPs differ: ${p}` });
  }
  return out;
}

/** Code a deploy-purpose build must not contain (M3). files: shipped paths; read(path) -> text. */
export function deployMarkerProblems(purpose, files, read) {
  if (purpose !== 'deploy') return [];
  const out = [];
  for (const f of files.filter((x) => /\.(js|mjs|html)$/.test(x))) {
    const text = read(f);
    for (const m of DEPLOY_FORBIDDEN_MARKERS) if (m.pattern.test(text)) out.push({ where: f, problem: `a deploy build contains ${m.what}`, id: m.id });
  }
  return out;
}
