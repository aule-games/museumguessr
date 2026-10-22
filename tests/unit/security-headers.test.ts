import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy';
import { notFoundHtml } from '../../src/not-found';
import { cspMismatch, HEADER_CSP, headersFile, META_CSP, parseHeadersFile, SECURITY_HEADERS } from '../../src/security/headers';
import { CSP } from '../../vite.config';
// @ts-expect-error plain ESM helper without types
import { buildPurpose, deployMarkerProblems, headerProblems, metaCsp } from '../../scripts/lib/artifact.mjs';

const page = (csp: string, extra = '') => `<html><head><meta http-equiv="Content-Security-Policy" content="${csp.replace(/'/g, '&#39;')}" />${extra}</head></html>`;

describe('security headers from one source', () => {
  it('one source writes the header and the meta CSP, which differ only by the header-only frame-ancestors [V12-13]', () => {
    expect(CSP).toBe(META_CSP);
    expect(HEADER_CSP).toBe(`${META_CSP}; frame-ancestors 'none'`);
    expect(cspMismatch(HEADER_CSP, META_CSP)).toEqual([]);
    const all = parseHeadersFile(headersFile()).get('/*');
    expect(all?.['Content-Security-Policy']).toBe(HEADER_CSP);
    expect(cspMismatch(HEADER_CSP, META_CSP.replace("'self' https://tiles", "'self' https://evil.example https://tiles"))).toEqual([
      "only the header has: connect-src 'self' https://tiles.openfreemap.org https://eu.i.posthog.com",
      "only the meta tag has: connect-src 'self' https://evil.example https://tiles.openfreemap.org https://eu.i.posthog.com",
    ]);
    expect(cspMismatch(META_CSP, META_CSP)).toEqual(["header CSP lacks frame-ancestors 'none'"]);
  });

  it('every path gets nosniff, a Referrer-Policy, a Permissions-Policy and the CSP, and the build check verifies the header file [V12-170]', () => {
    expect(Object.keys(SECURITY_HEADERS)).toEqual(['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']);
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['Permissions-Policy']).toContain('geolocation=()');
    const pages = [['index.html', page(META_CSP)], ['404.html', page(META_CSP)]];
    expect(headerProblems(headersFile(), pages)).toEqual([]);
    expect(headerProblems(null, pages)[0].problem).toMatch(/missing/);
    expect(headerProblems(headersFile().replace('  X-Content-Type-Options: nosniff\n', ''), pages).map((p: { problem: string }) => p.problem)).toEqual([
      'X-Content-Type-Options is missing, expected "nosniff"',
    ]);
    const drifted = headerProblems(headersFile(), [['404.html', page(META_CSP.replace("form-action 'none'", "form-action 'self'"))]]);
    expect(drifted.map((p: { where: string }) => p.where)).toEqual(['404.html / _headers', '404.html / _headers']);
    expect(headerProblems(headersFile(), [['index.html', '<html></html>']])[0].problem).toBe('no Content-Security-Policy meta');
    expect(metaCsp(page(META_CSP))).toBe(META_CSP);
  });
});

describe('the asset 404 page', () => {
  it('its text is the notFound copy, with the meta CSP, a link home and the built stylesheet [V12-10]', () => {
    const html = notFoundHtml({ base: '/', csp: META_CSP, themeColor: '#132036', stylesheet: 'assets/404-AbCd1234.css' });
    const text = (k: keyof typeof COPY) => COPY[k].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    expect(html).toContain(`<title>${text('notFound.title')} · ${text('app.name')}</title>`);
    expect(html).toContain(`<h1>${text('notFound.title')}</h1>`);
    expect(html).toContain(`<p>${text('notFound.body')}</p>`);
    expect(html).toContain(`<a href="/">${text('notFound.home')}</a>`);
    expect(html).toContain(`<p class="not-found__brand">${text('app.name')}</p>`);
    expect(html).toContain('<link rel="stylesheet" href="/assets/404-AbCd1234.css" />');
    expect(metaCsp(html)).toBe(META_CSP);
    expect(html).not.toMatch(/<script|<style|style=/);
  });
});

describe('build purpose (M3)', () => {
  it('a deploy-purpose build fails the build check when it ships development fixture code [V12-18]', () => {
    const read = (f: string) => (f === 'assets/index-AbCd1234.js' ? 'import("./dev/fixtures/end.ts")' : 'ok');
    const files = ['assets/index-AbCd1234.js', 'assets/items-AbCd1234.js', 'assets/x.css'];
    expect(deployMarkerProblems('deploy', files, read)).toEqual([{ where: 'assets/index-AbCd1234.js', problem: 'a deploy build contains the development fixture', id: 'DX7' }]);
    expect(deployMarkerProblems('dev', files, read)).toEqual([]);
    expect(buildPurpose('<meta name="build-purpose" content="deploy">')).toBe('deploy');
    expect(buildPurpose('<html>')).toBeNull();
  });
});
