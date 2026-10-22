import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../..');
const read = (name: string) => readFileSync(join(ROOT, name), 'utf8');
const SITE = 'https://museumguessr.com/';
const OLD = /aule-games\.github\.io|\/museumguessr\//;

describe('the public address', () => {
  it('everything that names the address uses https://museumguessr.com/ at the root path [V12-172] [V12-11]', () => {
    const html = read('index.html');
    expect(html).toContain(`<link rel="canonical" href="${SITE}" />`);
    expect(html).toContain(`<meta property="og:url" content="${SITE}" />`);
    expect(html).toContain(`<meta property="og:image" content="${SITE}og.png" />`);
    const config = read('src/config.ts');
    expect(config).toContain(`VITE_SITE_URL || '${SITE}'`);
    expect(config).toContain("VITE_ANALYTICS_HOSTS ?? 'museumguessr.com'");
    expect(read('vite.config.ts')).toContain("process.env.BASE_PATH ?? '/'");
    expect(read('scripts/check-build.mjs')).toContain("process.env.BASE_PATH ?? '/'");
    const playwright = read('playwright.config.ts');
    expect(playwright).toContain(`baseURL: '${SITE}'`);
    expect(playwright).toContain('MAP museumguessr.com 127.0.0.1:${PORT}');
    expect(read('tests/e2e/serve.mjs')).toContain("const BASE = '/';");
    expect(read('README.md')).toContain(`**Play:** <${SITE}>`);
    expect(read('scripts/lib/denylist.mjs')).toContain(`'${SITE}'`);
  });

  it('the old Pages address survives only where the ledger quotes the replaced rule [V12-172]', () => {
    const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const allowed = new Set(['docs/requirements.json', 'docs/verification.md', 'scripts/lib/denylist.mjs']);
    // The GitHub repository URL github.com/aule-games/museumguessr stays.
    const hits = files.filter((f) => !/\.(jpg|png|woff2?)$/.test(f) && !allowed.has(f) && OLD.test(read(f).replaceAll('github.com/aule-games/museumguessr', '')));
    expect(hits).toEqual([]);
  });

  it('docs/ops.md lists what a domain move changes and leaves the PostHog setting to the founder [V12-172]', () => {
    const ops = read('docs/ops.md');
    const section = ops.slice(ops.indexOf('## Moving to another domain'), ops.indexOf('## Local board loop'));
    for (const item of ['BASE_PATH', 'VITE_SITE_URL', 'ANALYTICS_HOSTS', 'index.html', 'canonical', 'og:url', 'Playwright', 'README', "release scan's exemptions", 'Worker route', 'www redirect', 'live:check']) {
      expect(section, item).toContain(item);
    }
    expect(section.replace(/\s+/g, ' ')).toContain("The founder confirms PostHog's authorised URLs");
  });
});
