// The asset 404 page (ENG13, V12-10; docs/screen-spec.md "Not-found page").
// vite.config.ts writes it to dist/404.html at build time; the Worker and
// the assets' 404 handling answer every unknown address with it. Its text is
// the notFound.* copy and the game's name.

import { COPY } from './copy.ts';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface NotFoundPage {
  /** The site base path, for the home link and asset URLs. */
  base: string;
  /** The meta CSP (src/security/headers.ts). */
  csp: string;
  themeColor: string;
  /** The built stylesheet's path below the base. */
  stylesheet: string;
}

export function notFoundHtml({ base, csp, themeColor, stylesheet }: NotFoundPage): string {
  const t = (k: 'notFound.title' | 'notFound.body' | 'notFound.home' | 'app.name') => escapeHtml(COPY[k]);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    `    <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}" />`,
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '    <meta name="robots" content="noindex" />',
    `    <meta name="theme-color" content="${escapeHtml(themeColor)}" />`,
    `    <title>${t('notFound.title')} · ${t('app.name')}</title>`,
    `    <link rel="icon" type="image/svg+xml" href="${base}favicon.svg" />`,
    `    <link rel="stylesheet" href="${base}${stylesheet}" />`,
    '  </head>',
    '  <body>',
    '    <main class="not-found">',
    `      <p class="not-found__brand">${t('app.name')}</p>`,
    `      <h1>${t('notFound.title')}</h1>`,
    `      <p>${t('notFound.body')}</p>`,
    `      <a href="${base}">${t('notFound.home')}</a>`,
    '    </main>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');
}
