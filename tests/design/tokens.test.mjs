import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { optimize } from 'svgo';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, 'utf8');
const base = JSON.parse(read('src/design/tokens.json'));
const keys = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) =>
  value && typeof value === 'object' ? [prefix + key, ...keys(value, `${prefix}${key}.`)] : [prefix + key]);
function luminance(hex) {
  const rgb = hex.match(/[a-f0-9]{2}/gi).map((v) => parseInt(v, 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
export const contrast = (a, b) => {
  const l = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l[0] + 0.05) / (l[1] + 0.05);
};
for (const direction of ['a', 'b']) {
  const token = JSON.parse(read(`docs/design/directions/${direction}/tokens.json`));
  test(`${direction}: token contract keeps every key and type`, () => {
    assert.deepEqual(keys(token).sort(), keys(base).sort());
    for (const [group, value] of Object.entries(base)) {
      assert.equal(typeof token[group], typeof value);
      if (typeof value === 'object') for (const key of Object.keys(value)) assert.equal(typeof token[group][key], typeof value[key]);
    }
    assert.equal(token.placeholder, false);
    assert.equal(token.layout.topbar, '48px');
    assert.equal(token.layout.prompt, '56px');
    assert.equal(token.layout.actionbar, '64px');
    assert.equal(token.layout.tap, '44px');
  });
  test(`${direction}: text, controls, focus and map pins meet contrast thresholds`, () => {
    const c = token.color;
    for (const fg of ['ink', 'ink-muted']) for (const bg of ['bg', 'surface', 'surface-raised', 'matte']) {
      assert.ok(contrast(c[fg], c[bg]) >= 4.5, `${fg}/${bg}: ${contrast(c[fg], c[bg])}`);
    }
    for (const [fg, bg] of [['accent-ink', 'accent'], ['accent-ink', 'accent-hover'], ['badge-ink', 'badge'], ['disabled-ink', 'disabled'], ['success', 'surface-raised']]) {
      assert.ok(contrast(c[fg], c[bg]) >= 4.5, `${fg}/${bg}`);
    }
    for (const fg of ['line', 'focus']) for (const bg of ['bg', 'surface', 'surface-raised', 'matte']) {
      assert.ok(contrast(c[fg], c[bg]) >= 3, `${fg}/${bg}: ${contrast(c[fg], c[bg])}`);
    }
    for (const fg of ['kept', 'made', 'guess', 'answer-line', 'guess-line']) for (const bg of ['water', 'land', 'landcover']) {
      assert.ok(contrast(c[fg], token.map[bg]) >= 3, `${fg}/map.${bg}`);
    }
    for (const fg of ['label', 'label-city']) for (const bg of ['water', 'land', 'landcover']) {
      assert.ok(contrast(token.map[fg], token.map[bg]) >= 4.5, `map.${fg}/map.${bg}`);
    }
  });
  test(`${direction}: generated CSS faithfully represents the token copy`, () => {
    const css = read(`docs/design/directions/${direction}/tokens.css`);
    for (const [group, values] of Object.entries(token)) if (typeof values === 'object') {
      for (const [key, value] of Object.entries(values)) assert.ok(css.includes(`--${group}-${key}: ${value};`));
    }
  });
}
test('five SVG glyphs are portable, shape-distinct and use currentColor only', () => {
  const names = ['kept', 'made', 'combined', 'guess-kept', 'guess-made'];
  const paths = [];
  for (const name of names) {
    const svg = read(`src/assets/pins/${name}.svg`);
    assert.match(svg, /viewBox="0 0 32 40"/);
    assert.match(svg, /currentColor/);
    assert.doesNotMatch(svg, /#[a-f0-9]{3,8}|<metadata|<image|<script|file:|\/Users\/|inkscape|sodipodi/i);
    if (name.startsWith('guess-')) {
      assert.match(svg, /fill="none"/);
      assert.match(svg, /stroke="currentColor"/);
    }
    assert.ok(optimize(svg, { multipass: true }).data.startsWith('<svg'));
    paths.push(svg.match(/ d="([^"]+)"/)[1]);
  }
  assert.notEqual(paths[0], paths[1]);
  assert.notEqual(paths[2], paths[0]);
});
