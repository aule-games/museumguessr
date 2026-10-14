// Offline visual-contract checks; these do not substitute for browser captures.
// Run: node --test docs/design/reveal-tour.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const tokens = JSON.parse(read('src/design/tokens.json'));
const css = read('src/styles/app.css');
const map = read('src/map/map.ts');
const rgb = (hex) => hex.slice(1).match(/../g).map((v) => parseInt(v, 16));
const over = (foreground, background, alpha) => foreground.map((v, i) => v * alpha + background[i] * (1 - alpha));
const luminance = (channels) => channels.map((v) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};
const rgba = (value) => {
  const parts = value.match(/^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  assert.ok(parts, 'expected an explicit full-marks-area RGBA token');
  return { channels: parts.slice(1, 4).map(Number), alpha: Number(parts[4]) };
};
const color = (key) => rgb(tokens.color[key]);
const area = rgba(tokens.color['full-marks-area']);
const veil = Number(map.match(/export const VEIL_OPACITY = ([\d.]+);/)[1]);
const tint = Number(map.match(/export const COUNTRY_OPACITY = ([\d.]+);/)[1]);
const rule = (selector) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} exists`);
  return css.slice(start, css.indexOf('}', start) + 1);
};

test('[DS22] Reveal pins and paths retain 3:1 on faded and tinted map surfaces, including the full-marks area', (t) => {
  let minimum = { ratio: Infinity, pair: '' };
  for (const base of ['background', 'water', 'land', 'landcover', 'border', 'border-minor', 'road', 'graticule']) {
    const faded = over(color('surface'), rgb(tokens.map[base]), veil);
    for (const role of [null, 'kept', 'made']) {
      const filled = role ? over(color(role), faded, tint) : faded;
      for (const withArea of [false, true]) {
        const background = withArea ? over(area.channels, filled, area.alpha) : filled;
        for (const foreground of ['kept', 'made', 'guess', 'answer-line', 'guess-line']) {
          const ratio = contrast(color(foreground), background);
          const pair = `${foreground}/${base}/${role ?? 'faded'}/area=${withArea}`;
          assert.ok(ratio >= 3, `${pair}: ${ratio.toFixed(3)}`);
          if (ratio < minimum.ratio) minimum = { ratio, pair };
        }
      }
    }
  }
  t.diagnostic(`Minimum composite contrast: ${minimum.ratio.toFixed(3)}:1 (${minimum.pair}). Antialiased edges and crossing outlines need raster review.`);
});

test('[DS31] Score text meets 4.5:1, including full-marks cells, and boundaries meet 3:1', (t) => {
  const fullRow = over(area.channels, color('surface'), area.alpha);
  const fullCell = over(area.channels, fullRow, area.alpha);
  const textPairs = [
    [color('ink'), color('surface-raised')],
    [color('ink-muted'), color('surface')],
    [color('ink-muted'), color('bg')],
    [color('ink-inverse'), color('ink')],
    [color('success'), fullRow],
    [color('success'), fullCell],
  ];
  const minimum = Math.min(...textPairs.map(([a, b]) => contrast(a, b)));
  assert.ok(minimum >= 4.5, `score text: ${minimum}`);
  for (const ink of ['line', 'focus', 'accent']) {
    for (const surface of ['surface', 'surface-raised', 'bg']) {
      assert.ok(contrast(color(ink), color(surface)) >= 3, `${ink}/${surface}`);
    }
  }
  t.diagnostic(`Minimum checked score-text contrast: ${minimum.toFixed(3)}:1.`);
});

test('[DS31] Hover explanations stay in scroll flow and disclosure is visible without hover', () => {
  assert.doesNotMatch(rule('.score__tip'), /position:\s*(absolute|fixed)|\b(bottom|top):/);
  assert.match(rule('.score__tip'), /overflow-wrap: anywhere/);
  assert.match(rule('.score__label::after'), /border-bottom:/);
  assert.match(rule('.score__row[aria-expanded=\'true\'] .score__label::after'), /rotate\(225deg\)/);
  assert.match(rule('.score__row'), /minmax\(0, 1fr\)/);
  assert.match(css, /\.score__row\[aria-expanded='true'\] ~ \.score__tip\s*\{\s*display: none;/);
});
