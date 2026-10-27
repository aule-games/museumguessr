import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flowGeometryIssues } from './flow-geometry.mjs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
function measured(step = 'when', width = 375, height = 667) {
  const portrait = width < 900 && height > width;
  const available = height - 48 - 56 - 64;
  const photo = portrait ? available * 0.4 : height - 48;
  const image = box(0, 48, width, photo);
  return {
    viewport: { width, height }, page: { width, height }, step, ready: true,
    photo: image, image, imageFit: 'contain',
    hint: box(width - 40, image.bottom - 40, 32, 32),
    captionText: 'Colour print of a curling wave above three boats',
    answer: box(0, image.bottom + 56, width, available - photo),
    back: step === 'made' ? null : box(16, height - 56, 70, 48),
    confirm: box(step === 'made' ? 16 : 94, height - 56, width - (step === 'made' ? 32 : 110), 48),
    primaryCount: 1, dimmed: null, mapReady: false, tour: null,
  };
}

test('[DS37] The enlarge check rejects a text rail, a mark outside the photo corner, or a missing caption', () => {
  assert.deepEqual(flowGeometryIssues(measured()), []);
  const wide = measured(); wide.hint = box(0, wide.image.bottom, wide.viewport.width, 44);
  assert.ok(flowGeometryIssues(wide).some((s) => s.includes('corner mark')));
  const off = measured(); off.hint = box(8, 56, 32, 32);
  assert.ok(flowGeometryIssues(off).some((s) => s.includes('corner mark')));
  const bare = measured(); bare.captionText = '';
  assert.ok(flowGeometryIssues(bare).some((s) => s.includes('screen readers')));
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

test('[DS19] The photo share check measures the image itself', () => {
  for (const step of ['made', 'when', 'kept']) {
    const m = measured(step);
    assert.deepEqual(flowGeometryIssues(m), []);
    m.image.height -= 80;
    assert.ok(flowGeometryIssues(m).some((s) => s.includes('photo share')));
  }
});

test('[DS19] [V12-71] With the keyboard open, entry may take the photo share', () => {
  const m = measured('when');
  m.image.height -= 80;
  assert.ok(!flowGeometryIssues(m, { keyboard: true }).some((s) => s.includes('photo share')));
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

test('[DS37] The round spends no row on a caption: an icon marks the photo and the caption is visually hidden', () => {
  const css = read('src/styles/app.css');
  const hint = css.match(/\.photo__hint \{([^}]+)\}/)[1];
  assert.match(hint, /width: var\(--space-6\)/);
  assert.match(hint, /height: var\(--space-6\)/);
  assert.match(css.match(/\.photo__caption \{([^}]+)\}/)[1], /clip-path: inset\(50%\)/);
  assert.match(css, /grid-template-areas: 'top' 'photo' 'prompt' 'answer' 'action'/);
  assert.match(read('src/ui/lightbox.ts'), /registerElement\(\{ name: 'caption'/);
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
  assert.match(rule, /color: var\(--color-guess-line\)/);
  assert.match(rule, /pointer-events: none/);
  assert.doesNotMatch(rule, /opacity/);
  const tokens = JSON.parse(read('src/design/tokens.json'));
  const light = (hex) => hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => (Math.max(light(a), light(b)) + 0.05) / (Math.min(light(a), light(b)) + 0.05);
  for (const surface of ['water', 'land', 'landcover']) assert.ok(ratio(tokens.color['guess-line'], tokens.map[surface]) >= 3);
  // its label sits on a map-ground pill
  assert.ok(ratio(tokens.color['guess-line'], tokens.map.land) >= 4.5);
});

test('[DS19] The question row sits on the gallery wall with no box, and the year slider shows its handle before the first touch', () => {
  const css = read('src/styles/app.css');
  const prompt = css.match(/\n\.prompt \{([^}]+)\}/)[1];
  assert.match(prompt, /background: var\(--color-bg\)/);
  assert.match(prompt, /color: var\(--color-ink\)/);
  // the untouched handle looks like the touched one: no ghost style, never hidden
  assert.doesNotMatch(css, /\.year__track\[data-touched='false'\] \.year__thumb/);
  assert.match(read('src/ui/year.ts'), /thumb\.style\.left = '50%'/);
});

test('[DS12] The round total is the one vermilion panel, white on the accent, with large display-face points', () => {
  const css = read('src/styles/app.css');
  const total = css.match(/\n\.scores__total \{([^}]+)\}/)[1];
  assert.match(total, /background: var\(--color-accent\)/);
  assert.match(total, /color: var\(--color-accent-ink\)/);
  assert.match(css.match(/\n\.score__points \{([^}]+)\}/)[1], /font-family: var\(--font-display\)/);
  const score = css.match(/\n\.reveal__score \{([^}]+)\}/)[1];
  assert.match(score, /font-size: var\(--text-xl\)/);
  assert.match(score, /font-weight: 800/);
});
