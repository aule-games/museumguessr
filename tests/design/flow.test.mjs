import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flowGeometryIssues } from './flow-geometry.mjs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
function measured(step = 'when', width = 375, height = 667) {
  const portrait = width < 900 && height > width;
  const available = height - 48 - 56 - 44 - 64;
  const photo = portrait ? available * (step === 'when' ? 0.3 : 0.4) : height - 48 - 44;
  const image = box(0, 104, width, photo);
  return {
    viewport: { width, height }, page: { width, height }, step, ready: true,
    image, imageFit: 'contain',
    caption: box(0, image.bottom, width - 100, 44), hint: box(width - 100, image.bottom, 100, 44),
    lines: [box(12, image.bottom + 8, width - 124, 14)],
    captionFont: 12, captionOverflow: false, captionEllipsis: false,
    answer: box(0, image.bottom + 44, width, available - photo),
    back: step === 'made' ? null : box(16, height - 56, 70, 48),
    confirm: box(step === 'made' ? 16 : 94, height - 56, width - (step === 'made' ? 32 : 110), 48),
    primaryCount: 1, dimmed: null, mapReady: false, tour: null,
  };
}

test('[DS37] The rail check rejects caption or View photo overlap with the image', () => {
  assert.deepEqual(flowGeometryIssues(measured()), []);
  for (const part of ['caption', 'hint']) {
    const m = measured(); m[part].top -= 20;
    assert.ok(flowGeometryIssues(m).some((s) => s.includes('separate rail')));
  }
  for (const key of ['captionOverflow', 'captionEllipsis']) {
    const m = measured(); m[key] = true;
    assert.ok(flowGeometryIssues(m).some((s) => s.includes('full caption')));
  }
  const m = measured(); m.lines[0].right = m.caption.right + 10;
  assert.ok(flowGeometryIssues(m).some((s) => s.includes('full caption')));
});

test('[DS36] The action check rejects offscreen, undersized, overlapping or competing buttons at all five viewports', () => {
  for (const [w, h] of [[390, 844], [375, 667], [844, 390], [1280, 800], [390, 664]]) {
    const base = measured('when', w, h);
    const actionIssues = (m) => flowGeometryIssues(m).filter((s) => s.startsWith('[DS36]'));
    assert.deepEqual(actionIssues(base), []);
    for (const part of ['back', 'confirm']) {
      for (const bad of [{ width: 43 }, { height: 43 }, { bottom: h + 2 }, { left: -2 }]) {
        assert.ok(actionIssues({ ...base, [part]: { ...base[part], ...bad } }).length > 0);
      }
    }
    assert.ok(actionIssues({ ...base, back: { ...base.back, right: base.confirm.left } }).length > 0);
    assert.ok(actionIssues({ ...base, primaryCount: 2 }).length > 0);
  }
});

test('[DS19] The photo share check measures the image rather than counting the caption as artwork', () => {
  for (const step of ['made', 'when', 'kept']) {
    const m = measured(step);
    assert.deepEqual(flowGeometryIssues(m), []);
    m.image.height -= 44;
    assert.ok(flowGeometryIssues(m).some((s) => s.includes('caption rail excluded')));
  }
});

test('[DS35] A carried guess must be hollow and explicitly named as the player guess', () => {
  const m = measured('kept'); m.mapReady = true;
  m.dimmed = { hollow: true, label: 'Your Made guess', accessible: 'Your Made guess', inert: true };
  assert.deepEqual(flowGeometryIssues(m), []);
  for (const bad of [{ hollow: false }, { label: 'Made' }, { accessible: 'Made' }, { inert: false }]) {
    assert.ok(flowGeometryIssues({ ...m, dimmed: { ...m.dimmed, ...bad } }).some((s) => s.startsWith('[DS35]')));
  }
});

test('[DS34] The tour check rejects a misplaced spotlight or a card covering its target', () => {
  const m = measured();
  m.tour = { target: box(0, 48, 375, 56), spot: box(-6, 42, 387, 68), card: box(12, 122, 351, 200) };
  assert.deepEqual(flowGeometryIssues(m), []);
  m.tour.card.top = 100;
  assert.ok(flowGeometryIssues(m).some((s) => s.startsWith('[DS34]')));
  m.tour.card.top = 122; m.tour.spot.top = 60;
  assert.ok(flowGeometryIssues(m).some((s) => s.startsWith('[DS34]')));
});

test('[DS37] Caption and photo affordance use flow tracks, not absolute overlays', () => {
  const css = read('src/styles/app.css');
  for (const name of ['caption', 'hint']) {
    const rule = css.match(new RegExp(`\\.photo__${name} \\{([^}]+)\\}`))[1];
    assert.match(rule, /grid-area: 2 \/ /);
    assert.doesNotMatch(rule, /position: absolute|ellipsis|overflow: hidden|max-width: 62%/);
  }
  assert.match(css, /grid-template-areas: 'top' 'prompt' 'photo' 'caption' 'answer' 'action'/);
  const round = read('src/ui/screens/round.ts');
  assert.match(round, /class: 'photo round__photo'/);
  assert.match(round, /t\(p.step === 'kept' \? 'confirm.last' : 'confirm'\)/);
  assert.match(read('src/copy.ts'), /'confirm.last': 'Reveal answers'/);
});

test('[DS35] The carried pin uses the hollow asset and keeps readable ink without opacity dimming', () => {
  const map = read('src/map/map.ts');
  const css = read('src/styles/app.css');
  assert.match(map, /pinElement\(step === 'made' \? 'guess-made' : 'guess-kept', label, 'pin--dimmed'\)/);
  assert.match(map, /t\('map.previousGuess', \{ step: t\(`step\.\$\{step\}`\) \}\)/);
  const rule = css.match(/\.pin--dimmed \{([^}]+)\}/)[1];
  assert.match(rule, /color: var\(--color-ink-muted\)/);
  assert.match(rule, /pointer-events: none/);
  assert.doesNotMatch(rule, /opacity/);
  const tokens = JSON.parse(read('src/design/tokens.json'));
  const light = (hex) => hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => (Math.max(light(a), light(b)) + 0.05) / (Math.min(light(a), light(b)) + 0.05);
  for (const surface of ['water', 'land', 'landcover']) assert.ok(ratio(tokens.color['ink-muted'], tokens.map[surface]) >= 3);
  assert.ok(ratio(tokens.color['ink-muted'], tokens.color.surface) >= 4.5);
});
