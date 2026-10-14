import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = 'docs/design/directions/';
const read = (path) => readFileSync(`${root}${path}`, 'utf8');
const screens = ['start', 'round-kept', 'round-when', 'reveal', 'end'];
function document(html) {
  const window = new Window({ settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableJavaScriptEvaluation: true } });
  window.document.write(html);
  return window.document;
}
test('all generated compositions and token/font styles are current', () => {
  execFileSync(process.execPath, ['scripts/design-directions.mjs', '--check'], { cwd: root });
});
test('index links directly to all ten compositions', () => {
  const doc = document(read(`${dir}index.html`));
  for (const direction of ['a', 'b']) for (const screen of screens) assert.ok(doc.querySelector(`a[href="${direction}/${screen}.html"]`));
});
for (const direction of ['a', 'b']) {
  test(`${direction}: fonts are local, Latin only, installed, and OFL licensed`, () => {
    const path = `${dir}${direction}/fonts.css`;
    const css = read(path);
    assert.doesNotMatch(css, /https?:|latin-ext|vietnamese|cyrillic/);
    for (const match of css.matchAll(/url\('([^']+)'\)/g)) {
      assert.match(match[1], /-latin-(400|500|700)-normal\.woff2$/);
      const font = resolve(root, dirname(path), match[1]);
      assert.ok(existsSync(font), font);
      const license = readFileSync(resolve(dirname(font), '../LICENSE'), 'utf8');
      assert.match(license, /SIL Open Font License, Version 1\.1/);
    }
  });
  for (const screen of screens) {
    test(`${direction}/${screen}: two frames, no raster/executable/network assets, exact required copy`, () => {
      const html = read(`${dir}${direction}/${screen}.html`);
      const doc = document(html);
      assert.equal(doc.querySelectorAll('.frame').length, 2);
      assert.equal(doc.querySelectorAll('.phone').length, 1);
      assert.equal(doc.querySelectorAll('.desktop').length, 1);
      assert.equal(doc.querySelectorAll('script,img,image,iframe,canvas').length, 0);
      assert.equal(doc.querySelectorAll('svg.combined').length, 0, 'no combined glyph without coincident answer coordinates');
      assert.doesNotMatch(html, /data:image|https?:[^"']+\.(png|jpe?g|webp|gif)|url\(https?:/i);
      const ids = [...doc.querySelectorAll('[id]')].map((node) => node.id);
      assert.equal(new Set(ids).size, ids.length, 'duplicate HTML IDs');
      for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) assert.ok(existsSync(resolve(root, dir, direction, link.getAttribute('href'))));
      for (const frame of doc.querySelectorAll('.frame')) {
        assert.ok(frame.querySelector('h1'));
        assert.ok(frame.querySelector('.primary'));
        if (screen.startsWith('round')) {
          assert.ok(frame.textContent.includes('Round 1/10'));
          assert.ok(frame.textContent.includes('0 pts'));
          assert.equal(frame.querySelectorAll('.step').length, 3);
          assert.equal(frame.querySelectorAll('.primary').length, 1);
          assert.equal(frame.querySelector('.primary').textContent.replace('→', ''), 'Confirm');
        }
        if (screen === 'round-kept') {
          assert.ok(frame.textContent.includes('Kept = the city of the museum that holds it today.'));
          assert.ok(frame.textContent.includes('Near Berlin, Germany'));
          assert.equal(frame.querySelectorAll('.map-tools button').length, 3);
          assert.equal(frame.querySelector('.primary').disabled, false);
        }
        if (screen === 'round-when') {
          assert.ok(frame.textContent.includes("Inside the museum's date range scores full marks."));
          assert.ok(frame.textContent.includes('1450 CE'));
          assert.ok(frame.textContent.includes('Recent centuries get more room'));
          assert.equal(frame.querySelectorAll('.era input').length, 2);
          assert.equal(frame.querySelectorAll('.ticks .tick').length, 6);
          assert.equal(frame.querySelector('.primary').disabled, true);
        }
        if (screen === 'start') {
          assert.equal(frame.querySelector('h1').textContent, 'Made here.Kept there.Guess both.');
          assert.ok(frame.textContent.includes('10 objects · about 10 min · real photos of real museum objects, credited'));
          assert.ok(frame.textContent.includes('No cookies. Anonymous play counts via PostHog (EU).'));
        }
        if (screen === 'reveal') {
          const children = [...frame.querySelector('.reveal-layout').children].map((node) => node.className);
          assert.deepEqual(children, ['wall-label', 'journey', 'reveal-map-region', 'score-block', 'facts', 'credit', 'actionbar']);
          assert.equal(frame.querySelectorAll('.score-row').length, 3);
          for (const text of ['Lamassu', 'Made in Nimrud, 883–859 BCE → Now in The Metropolitan Museum of Art, New York', 'Excavated by Austen Henry Layard in the 1840s; given to the museum in 1932.', '2,352 / 3,000', 'Kept 1,000 · Spot on', 'Made 742 · 310 km off', 'When 610 · 120 years off', 'Photo: The Metropolitan Museum of Art, CC0']) assert.ok(frame.textContent.includes(text), text);
          assert.equal(frame.querySelectorAll('.map-pin').length, 4);
          assert.ok(frame.querySelector('.reason-timeline'));
          assert.equal(frame.querySelector('.score-block').getAttribute('tabindex'), '-1');
        }
        if (screen === 'end') {
          assert.equal(frame.querySelectorAll('.recap li').length, 10);
          const total = [...frame.querySelectorAll('.recap-points')].reduce((sum, node) => sum + Number(node.textContent.replaceAll(',', '')), 0);
          assert.equal(total, 21480);
          for (const text of ['21,480 / 30,000', 'Curator', 'Copy result', 'Copied', 'Most fun:', "That's the whole collection for now: 10 objects, the same for everyone", 'Replay the same 10']) assert.ok(frame.textContent.includes(text), text);
        }
      }
      assert.equal(doc.querySelectorAll('.test-badge').length, screen === 'start' ? 1 : 0);
      if (screen === 'reveal') assert.equal(doc.querySelectorAll('.difficulty').length, 1);
    });
  }
}
test('composition CSS consumes only defined custom properties and has no hardcoded palette', () => {
  const css = read(`${dir}compositions.css`);
  const tokens = JSON.parse(read(`${dir}a/tokens.json`));
  const defined = new Set(Object.entries(tokens).flatMap(([group, values]) => typeof values === 'object' ? Object.keys(values).map((key) => `${group}-${key}`) : []));
  for (const [, name] of css.matchAll(/var\(--([a-z0-9-]+)/g)) assert.ok(defined.has(name), name);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(|--[a-z0-9-]+\s*:/i);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.phone \{ width: 390px; height: 844px; \}/);
  assert.match(css, /\.desktop \{ width: 1280px; height: 800px; \}/);
});
