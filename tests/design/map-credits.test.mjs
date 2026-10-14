// Tests the acceptance check itself with supplied boxes, not browser layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { phoneGeometryIssues } from './phone-geometry.mjs';
import { creditFixtures } from './map-credit-fixtures.mjs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const node = (rect) => ({ getBoundingClientRect: () => rect });
function issues({ mode = 'guess', viewport = [844, 390], overlap = false, hidden = false, clipped = false, font = 12, pinOverlap = false } = {}) {
  const frame = box(0, 0, 375, 174);
  const credit = box(0, 131, 375, 43);
  const inner = {
    textContent: creditFixtures.long, scrollWidth: 359, clientWidth: 359,
    querySelectorAll: () => [],
  };
  const attribution = { ...node(credit), querySelector: () => inner };
  const map = {
    ...node(frame), dataset: { state: 'fallback', mode },
    querySelector: () => attribution,
    querySelectorAll: (selector) => selector === '.map__btn'
      ? [node(box(8, overlap ? 122 : 8, 52, 44))]
      : [node(box(120, pinOverlap ? 125 : 60, 100, 20))],
  };
  return Array.from(runInNewContext(`(${phoneGeometryIssues.toString()})('credits')`, {
    document: {
      querySelector: (selector) => selector === '.map' ? map : null,
      createRange: () => ({ selectNodeContents() {}, getClientRects: () => hidden ? [] : [box(8, 135, clipped ? 380 : 300, 17)] }),
    },
    innerWidth: viewport[0], innerHeight: viewport[1],
    getComputedStyle: () => ({ textOverflow: 'clip', fontSize: `${font}px` }),
  }));
}

test('[DS22] The credit check rejects control overlap in both map modes at every review viewport', () => {
  for (const viewport of [[390, 844], [1280, 800], [375, 667], [844, 390], [390, 664]]) {
    for (const mode of ['guess', 'reveal']) {
      assert.deepEqual(issues({ mode, viewport }), []);
      assert.ok(issues({ mode, viewport, overlap: true }).includes('[DS22] No map control overlaps the map credits'));
    }
  }
});

test('[DS22] The credit check rejects hidden, clipped or undersized provider text', () => {
  for (const options of [{ hidden: true }, { clipped: true }, { font: 11 }]) {
    assert.ok(issues(options).length > 0);
  }
});

test('[DS22] The credit check rejects fitted reveal pins on the attribution rail', () => {
  assert.ok(issues({ mode: 'reveal', pinOverlap: true }).includes('[DS22] Fitted reveal pins and labels stay clear of the map credits'));
});

test('[DS22] Attribution stays expanded and production fixtures preserve every provider name', () => {
  const map = read('src/map/map.ts');
  const custom = map.match(/customAttribution: '([^']+)'/)[1];
  assert.match(map, /attributionControl: \{ compact: false,/);
  assert.equal(creditFixtures.production, `${custom} | OpenFreeMap © OpenMapTiles Data from OpenStreetMap`);
  assert.equal(creditFixtures.long, `Fallback map: ${creditFixtures.production}`);
  assert.ok(creditFixtures.long.length > creditFixtures.production.length);
  assert.match(map, /new ResizeObserver\(\(\) => \{\s*this.updateFallbackLabels\(\);\s*this.revealFit\?\.\(\);/);
  assert.match(map, /observer.observe\(attribution\)/);
});

test('[DS22] Credit styling uses readable tokens without suppressing text or provider links', () => {
  const css = read('src/styles/app.css');
  const rule = css.match(/\.map \.maplibregl-ctrl\.maplibregl-ctrl-attrib \{([^}]+)\}/)[1];
  assert.match(rule, /font-size: var\(--text-xs\)/);
  assert.match(rule, /font-family: var\(--font-body\)/);
  assert.match(rule, /line-height: var\(--leading-normal\)/);
  assert.match(rule, /background: var\(--color-surface\)/);
  assert.match(rule, /color: var\(--color-ink\)/);
  assert.doesNotMatch(rule, /nowrap|ellipsis|hidden|scale\(/);
  assert.match(css, /\.map \.maplibregl-ctrl-attrib a \{\s*color: inherit;\s*text-decoration: underline;/);
});
