import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { itemsCore } from './scripts/lib/items-core.mjs';
import { switchProblems, switchValues } from './scripts/lib/profile.mjs';
import { notFoundHtml } from './src/not-found.ts';
import { headersFile, metaCspFor } from './src/security/headers.ts';

const require = createRequire(import.meta.url);
const MAPLIBRE_DIR = dirname(require.resolve('maplibre-gl/package.json'));
const MAPLIBRE_VERSION: string = JSON.parse(readFileSync(join(MAPLIBRE_DIR, 'package.json'), 'utf8')).version;
const MAPLIBRE_FILES = ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css'];

const BASE = process.env.BASE_PATH ?? '/';
const BUILD_ID = process.env.VITE_BUILD_ID || 'dev';
const SWITCHES = switchValues(process.env);
const PURPOSE = SWITCHES.VITE_BUILD_PURPOSE as string;
/** The board UI is built in (V12-125): its card, and Turnstile in the CSP. */
const BOARD = SWITCHES.VITE_BOARD_UI === 'true';
/** `npm run dev:board` points the dev server's /api at the local Worker (H4). */
const API_ORIGIN = process.env.MG_API_ORIGIN ?? '';
const THEME_COLOR: string = JSON.parse(readFileSync(new URL('./src/design/tokens.json', import.meta.url), 'utf8')).color.bg;

// DX30, M3: only the public project token may enter the build, never a
// personal key, and invalid switch combinations stop the build.
const SWITCH_PROBLEMS = switchProblems(SWITCHES);
if (SWITCH_PROBLEMS.length) {
  throw new Error(
    SWITCH_PROBLEMS.map((p) => `✖ ${p.key} ${p.problem}\n  why: the build refuses invalid public switches [DX30] [M3]\n  fix: ${p.fix}\n  docs: docs/ops.md#switches`).join('\n'),
  );
}

/** The meta CSP; the header form in `_headers` adds frame-ancestors (src/security/headers.ts). Turnstile only with the board UI. */
export const CSP = metaCspFor(BOARD);

/** MapLibre's three ES modules are served unbundled from a versioned folder, so the page and the worker share one module (ENG32). */
function maplibreFiles(): Plugin {
  const prefix = `maplibre/${MAPLIBRE_VERSION}/`;
  return {
    name: 'museumguessr:maplibre-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        const at = url.indexOf(`/${prefix}`);
        if (at < 0) return next();
        const file = url.slice(at + prefix.length + 1).split('?')[0] ?? '';
        if (!MAPLIBRE_FILES.includes(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(readFileSync(join(MAPLIBRE_DIR, 'dist', file)));
      });
    },
    generateBundle() {
      for (const file of MAPLIBRE_FILES) {
        this.emitFile({ type: 'asset', fileName: `${prefix}${file}`, source: readFileSync(join(MAPLIBRE_DIR, 'dist', file)) });
      }
    },
  };
}

/** Build id and purpose in meta tags, the id also in build.txt (DX8, M3); theme colour from the tokens (DX32); CSP meta in production builds only (ENG23). */
function buildMeta(): Plugin {
  return {
    name: 'museumguessr:build-meta',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const tags = [
          { tag: 'meta', attrs: { name: 'build-id', content: BUILD_ID }, injectTo: 'head-prepend' as const },
          { tag: 'meta', attrs: { name: 'build-purpose', content: PURPOSE }, injectTo: 'head' as const },
          { tag: 'meta', attrs: { name: 'board-ui', content: BOARD ? 'on' : 'off' }, injectTo: 'head' as const },
          { tag: 'meta', attrs: { name: 'theme-color', content: THEME_COLOR }, injectTo: 'head' as const },
        ];
        if (!ctx.server) {
          tags.unshift({ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP } as never, injectTo: 'head-prepend' });
        }
        return { html, tags };
      },
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build.txt', source: `${BUILD_ID}\n` });
    },
  };
}

/** Every runtime dependency's licence text ships with the site as licenses.txt (MIT, BSD, Apache and OFL all ask for it). */
function licenceNotices(): Plugin {
  return {
    name: 'museumguessr:licence-notices',
    generateBundle() {
      const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
      const parts = ['Third-party software and fonts in this site, with their licences.', ''];
      for (const name of Object.keys(pkg.dependencies).sort()) {
        const dir = join(dirname(fileURLToPath(import.meta.url)), 'node_modules', name);
        const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        const file = readdirSync(dir).find((f) => /^licen[sc]e(\.(md|txt))?$/i.test(f));
        if (!file) throw new Error(`no licence file for ${name}`);
        parts.push('='.repeat(72), `${name} ${meta.version} (${String(meta.license).replace(/^\((.*)\)$/, '$1')})`, '', readFileSync(join(dir, file), 'utf8').trim(), '');
      }
      this.emitFile({ type: 'asset', fileName: 'licenses.txt', source: parts.join('\n') });
    },
  };
}

/** The assets `_headers` file: the security headers as real HTTP headers (V12-13, V12-170). */
function securityHeaders(): Plugin {
  return {
    name: 'museumguessr:security-headers',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile(BOARD) });
    },
  };
}

/**
 * The asset 404 page (ENG13, V12-10): the Worker and `not_found_handling`
 * answer every unknown address with it. Its text is the notFound.* copy
 * (src/not-found.ts); its stylesheet is tokens.css plus not-found.css.
 */
function notFoundPage(): Plugin {
  return {
    name: 'museumguessr:not-found-page',
    generateBundle() {
      const css = ['tokens.css', 'not-found.css'].map((f) => readFileSync(new URL(`./src/styles/${f}`, import.meta.url), 'utf8')).join('\n');
      const ref = this.emitFile({ type: 'asset', name: '404.css', source: css });
      const html = notFoundHtml({ base: BASE, csp: CSP, themeColor: THEME_COLOR, stylesheet: this.getFileName(ref) });
      this.emitFile({ type: 'asset', fileName: '404.html', source: html });
    },
  };
}

/** The share raster exists only in the built artifact, never in source control. */
function shareImage(): Plugin {
  return {
    name: 'museumguessr:share-image',
    async generateBundle() {
      // @ts-expect-error The Node-only renderer is shared with the design tests.
      const { renderOg } = await import('./scripts/og.mjs');
      this.emitFile({ type: 'asset', fileName: 'og.png', source: renderOg() });
    },
  };
}

export default defineConfig({
  base: BASE,
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __MAPLIBRE_VERSION__: JSON.stringify(MAPLIBRE_VERSION),
  },
  plugins: [itemsCore(), maplibreFiles(), buildMeta(), securityHeaders(), notFoundPage(), shareImage(), licenceNotices()],
  server: { port: 5173, strictPort: false, proxy: API_ORIGIN ? { '/api': { target: API_ORIGIN, changeOrigin: true } } : undefined },
  preview: { port: 4173 },
  build: {
    target: 'es2022',
    sourcemap: 'hidden',
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
});
