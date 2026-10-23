import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrast, v12GeometryIssues } from './v12-geometry.mjs';

// Synthetic boxes test the rules, not the layout; review-built measures the built pages.
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const base = (width, height) => ({ viewport: { width, height }, visual: { height, top: 0 }, screen: null, dialog: false, cues: [], reveal: null, end: null, dialogs: [], topbar: null, paused: null, year: null });
const tokens = JSON.parse(readFileSync(new URL('../../src/design/tokens.json', import.meta.url), 'utf8'));
const rgb = (hex) => { const [r, g, b] = hex.slice(1).match(/../g).map((v) => parseInt(v, 16)); return { r, g, b, a: 1 }; };

test('[V12-161] The cue contrast rule accepts 4.5:1 and rejects a pale or translucent cue', () => {
  const m = base(390, 844);
  m.cues = [{ text: 'Hurry up · 9', color: { r: 0, g: 0, b: 0, a: 1 }, background: { r: 255, g: 255, b: 255 } }];
  assert.deepEqual(v12GeometryIssues(m), []);
  m.cues[0].color = { r: 150, g: 150, b: 150, a: 1 };
  assert.deepEqual(v12GeometryIssues(m), ['[V12-161] The warning cue keeps at least 4.5:1 contrast']);
  m.cues[0].color = { r: 0, g: 0, b: 0, a: 0.5 };
  assert.equal(v12GeometryIssues(m).length, 1);
  m.cues[0].color = null;
  assert.equal(v12GeometryIssues(m).length, 1);
  assert.ok(Math.abs(contrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }) - 21) < 1e-9);
});

test('[V12-161] The warning colour token itself clears 4.5:1 on the top bar wall', () => {
  // the browser check measures the rendered cue; this pins the tokens it is drawn from
  assert.ok(contrast(rgb(tokens.color.warning), rgb(tokens.color.bg)) >= 4.5);
});

test('[V12-162] The reveal fold rule needs the total and the hard mark above the action bar on the named phones', () => {
  const m = base(375, 667);
  m.screen = 'reveal';
  m.reveal = { atTop: true, body: box(0, 48, 375, 619), footer: box(0, 587, 375, 80), total: box(16, 480, 343, 56), hard: box(200, 490, 140, 24) };
  assert.deepEqual(v12GeometryIssues(m, { fold: true }), []);
  m.reveal.hard = box(200, 590, 140, 24);
  assert.deepEqual(v12GeometryIssues(m, { fold: true }), ['[V12-162] The hard-one mark is above the phone action bar']);
  m.reveal.total = box(16, 560, 343, 56);
  assert.equal(v12GeometryIssues(m, { fold: true }).length, 2);
  // not checked: another state of the screen, a scrolled body, or a viewport the rule does not name
  assert.deepEqual(v12GeometryIssues(m, { fold: false }), []);
  assert.deepEqual(v12GeometryIssues({ ...m, reveal: { ...m.reveal, atTop: false } }, { fold: true }), []);
  assert.deepEqual(v12GeometryIssues({ ...m, viewport: { width: 844, height: 390 } }, { fold: true }), []);
});

test('[V12-162] The end fold rule needs total, tier and Share above the fold, and Play another 10 too at 390x844', () => {
  for (const [w, h] of [[375, 667], [390, 844], [390, 664]]) {
    const m = base(w, h);
    m.screen = 'end';
    m.end = { atTop: true, total: box(16, 80, w - 32, 60), tier: box(16, 140, 100, 24), share: box(16, 300, w - 32, 52), another: box(16, 364, w - 32, 48) };
    assert.deepEqual(v12GeometryIssues(m, { fold: true }), []);
    m.end.share = box(16, h - 20, w - 32, 52);
    assert.deepEqual(v12GeometryIssues(m, { fold: true }), ['[V12-162] The end total, tier and Share are above the fold']);
  }
  const tall = base(390, 844);
  tall.screen = 'end';
  tall.end = { atTop: true, total: box(16, 80, 358, 60), tier: box(16, 140, 100, 24), share: box(16, 300, 358, 52), another: box(16, 830, 358, 48) };
  assert.deepEqual(v12GeometryIssues(tall, { fold: true }), ['[V12-162] Play another 10 is above the fold on the tall phone']);
  const small = { ...tall, viewport: { width: 375, height: 667 }, end: { ...tall.end, another: box(16, 700, 343, 48) } };
  assert.deepEqual(v12GeometryIssues(small, { fold: true }), []);
  assert.deepEqual(v12GeometryIssues({ ...tall, dialog: true }, { fold: true }), []);
});

test('[V12-71] The keyboard rule keeps the year field, both eras, the cue and Confirm inside the visual viewport', () => {
  const m = base(390, 844);
  m.visual = { height: 508, top: 0 };
  m.year = { field: box(16, 300, 200, 48), eras: [box(220, 300, 70, 48), box(296, 300, 70, 48)], confirm: box(16, 440, 358, 52), cue: box(16, 12, 140, 24) };
  assert.deepEqual(v12GeometryIssues(m, { keyboard: true }), []);
  for (const part of ['field', 'confirm', 'cue']) {
    const bad = { ...m, year: { ...m.year, [part]: box(16, 520, 100, 48) } };
    assert.deepEqual(v12GeometryIssues(bad, { keyboard: true }), ['[V12-71] With the keyboard open, the year field, era, cue and Confirm stay above the keyboard']);
  }
  assert.equal(v12GeometryIssues({ ...m, year: { ...m.year, eras: [m.year.eras[0]] } }, { keyboard: true }).length, 1);
  assert.deepEqual(v12GeometryIssues({ ...m, year: { ...m.year, confirm: box(16, 600, 358, 52) } }), []);
});

test('[V12-42] The paused-clock note must not sit on the map credits or a map control', () => {
  const m = base(390, 844);
  m.paused = { note: box(12, 732, 366, 36), blockers: [box(301, 776, 89, 24), box(327, 386, 50, 44)] };
  assert.deepEqual(v12GeometryIssues(m), []);
  m.paused.blockers[0] = box(301, 755, 89, 24);
  assert.deepEqual(v12GeometryIssues(m), ['[V12-42] The paused-clock note stays clear of the map credits and controls']);
});

test('[DS31] A row whose points break across lines is reported', () => {
  const m = base(390, 844);
  m.points = [{ text: '730', lines: 1 }, { text: '1,000', lines: 1 }];
  assert.deepEqual(v12GeometryIssues(m), []);
  m.points[1].lines = 2;
  assert.deepEqual(v12GeometryIssues(m), ["[DS31] Each row's points stay on one line"]);
});

test('[V12-59] A dialog header whose Close or cue leaves the dialog, or overlaps the title, and dialog content cut off at its side, are reported', () => {
  const m = base(390, 844);
  m.dialogs = [{ box: box(20, 264, 350, 312), parts: [box(36, 280, 164, 36), box(210, 288, 104, 20), box(326, 278, 40, 40)], clipped: 0 }];
  assert.deepEqual(v12GeometryIssues(m), []);
  assert.deepEqual(v12GeometryIssues({ ...m, dialogs: [{ ...m.dialogs[0], clipped: 3 }] }), ['[V12-161] Dialog content stays inside the dialog instead of being cut off at its side']);
  m.dialogs[0].parts[2] = box(350, 278, 44, 44);
  assert.deepEqual(v12GeometryIssues(m), ['[V12-59] A dialog header keeps its title, cue and Close inside the dialog without overlap']);
  m.dialogs[0].parts[2] = box(326, 278, 40, 40);
  m.dialogs[0].parts[1] = box(180, 288, 104, 20);
  assert.equal(v12GeometryIssues(m).length, 1);
});

test('[V12-62] A time-up notice wider than the score table, or past its side margin, is reported', () => {
  const m = base(390, 844);
  m.screen = 'reveal';
  m.reveal = { atTop: true, scores: box(16, 150, 358, 440), notes: [box(16, 120, 300, 20), box(16, 600, 358, 20)], body: null, footer: null, total: null, hard: null };
  assert.deepEqual(v12GeometryIssues(m), []);
  m.reveal.notes[1] = box(0, 600, 330, 20);
  assert.deepEqual(v12GeometryIssues(m), ["[V12-62] The time-up notices (away, tip) keep the score table's side margins"]);
});

test('[V12-60] A top bar whose total wraps or whose parts leave one row is reported, except at doubled text', () => {
  const m = base(375, 667);
  m.topbar = { totalLines: 1, parts: [box(16, 12, 150, 24), box(176, 18, 40, 12), box(230, 8, 80, 32), box(320, 2, 44, 44)] };
  assert.deepEqual(v12GeometryIssues(m), []);
  const rule = '[V12-60] The top bar keeps the counter or cue, the pips, the total and the menu on one line';
  assert.deepEqual(v12GeometryIssues({ ...m, topbar: { ...m.topbar, totalLines: 2 } }), [rule]);
  const wrapped = { ...m, topbar: { ...m.topbar, parts: [...m.topbar.parts.slice(0, 3), box(320, 60, 44, 44)] } };
  assert.deepEqual(v12GeometryIssues(wrapped), [rule]);
  assert.deepEqual(v12GeometryIssues(wrapped, { large: true }), []);
});

test('[V12-161] An end total or round score whose number breaks across lines is reported', () => {
  const m = base(390, 844);
  m.totals = [{ text: '19,066', lines: 1 }];
  assert.deepEqual(v12GeometryIssues(m), []);
  m.totals[0].lines = 2;
  assert.deepEqual(v12GeometryIssues(m), ['[V12-161] A total never breaks inside its number, at any text size']);
});
