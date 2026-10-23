// v1.2 checks for the built-screen matrix (V12-161, V12-162, V12-71): a browser
// collector plus pure rules, like flow-geometry.mjs. Synthetic boxes in
// v12-geometry.test.mjs test the rules; only review-built supplies measured
// browser geometry. These are geometry and contrast checks, not visual approval.

/** Runs inside the built page; self-contained so Playwright can serialize it. */
export function measureV12() {
  const box = (node) => {
    if (!node) return null;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || node.closest('[hidden]')) return null;
    const r = node.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const one = (selector) => box(document.querySelector(selector));
  const parse = (value) => {
    const m = /^rgba?\(([^)]+)\)$/.exec(value.trim());
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return p.length >= 3 && p.every(Number.isFinite) ? { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } : null;
  };
  // The colour under a node: its own and its ancestors' backgrounds, composited from the page up.
  const under = (node) => {
    const layers = [];
    for (let n = node; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    let base = { r: 255, g: 255, b: 255 };
    for (const c of layers.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) };
    return base;
  };
  const cues = [...document.querySelectorAll('[data-test="clock-cue"]')].filter((n) => box(n)).map((n) => {
    const text = n.querySelector('.clockcue__text') ?? n;
    return { text: text.textContent.trim(), color: parse(getComputedStyle(text).color), background: under(text) };
  });
  const screen = document.querySelector('[data-screen]')?.dataset.screen ?? null;
  const dialog = !!document.querySelector('dialog[open]') || !!document.querySelector('.pswp');
  const scroll = document.querySelector('.reveal__scroll');
  const vv = window.visualViewport;
  return {
    viewport: { width: innerWidth, height: innerHeight },
    visual: { height: vv ? vv.height : innerHeight, top: vv ? vv.offsetTop : 0 },
    screen,
    dialog,
    cues,
    reveal: scroll ? {
      atTop: scroll.scrollTop === 0 && scrollY === 0,
      body: one('.reveal__scroll'),
      footer: one('.actionbar--reveal'),
      total: one('.scores__total'),
      hard: one('[data-test="hard-nailed"]'),
    } : null,
    end: screen === 'end' ? {
      atTop: scrollY === 0,
      total: one('[data-test="end-total"]'),
      tier: one('.end__tier'),
      share: one('[data-test="share"]'),
      another: one('[data-test="play-another"]'),
    } : null,
    // lines each row's points take: a number must never break across lines
    points: [...document.querySelectorAll('.score__points')].filter((n) => box(n)).map((n) => {
      const range = document.createRange();
      range.selectNodeContents(n);
      return { text: n.textContent.trim(), lines: new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size };
    }),
    // each open dialog's header: the title, the clock cue and Close
    dialogs: [...document.querySelectorAll('dialog[open]')].map((d) => ({
      box: box(d),
      parts: [d.querySelector('.dialog__title'), d.querySelector('.dialog__head [data-test="clock-cue"]'), d.querySelector('.dialog__close')].map(box).filter(Boolean),
      // content cut off at the dialog's left or right edge
      clipped: (() => {
        const outer = d.getBoundingClientRect();
        return [...d.querySelectorAll('p, h2, table, th, td, li, button, label')].filter((n) => {
          if (n.closest('.visually-hidden')) return false;
          const r = box(n);
          return r && (r.right > outer.right + 1 || r.left < outer.left - 1);
        }).length;
      })(),
    })),
    paused: one('[data-test="clock-paused-map"]') ? {
      note: one('[data-test="clock-paused-map"]'),
      blockers: [...document.querySelectorAll('.map .maplibregl-ctrl-attrib, .map .map__btn')].map(box).filter(Boolean),
    } : null,
    year: document.querySelector('.year__field') ? {
      field: one('.year__field'),
      eras: [...document.querySelectorAll('.year__era')].map(box),
      confirm: one('[data-test="confirm"]'),
      cue: box(document.querySelector('.topbar [data-test="clock-cue"]')),
    } : null,
  };
}

const luminance = ({ r, g, b }) => [r, g, b].map((v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);

/** WCAG contrast of two opaque colours. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The phones whose fold V12-162 names for the reveal, and for the end screen. */
const REVEAL_FOLD = ['375x667', '390x844'];
const END_FOLD = ['375x667', '390x844', '390x664'];

/**
 * The rules. `opts.fold`: this state shows the screen as it first opens (no
 * expanded row, name field or chooser), so the fold rules apply.
 * `opts.keyboard`: an on-screen keyboard is simulated; the year controls
 * must stay inside the visual viewport.
 */
export function v12GeometryIssues(m, opts = {}) {
  const issues = [];
  const check = (ok, rule) => { if (!ok && !issues.includes(rule)) issues.push(rule); };
  const within = (a, b) => !!a && !!b && a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
  const size = `${m.viewport.width}x${m.viewport.height}`;

  for (const cue of m.cues) {
    check(!!cue.color && contrast(cue.color, cue.background) >= 4.5 && (cue.color.a ?? 1) >= 1,
      '[V12-161] The warning cue keeps at least 4.5:1 contrast');
  }

  if (opts.fold && m.reveal && m.reveal.atTop && !m.dialog && REVEAL_FOLD.includes(size)) {
    const r = m.reveal;
    const usable = r.body && { left: r.body.left, right: r.body.right, top: r.body.top, bottom: Math.min(r.body.bottom, r.footer ? r.footer.top : r.body.bottom) };
    check(within(r.total, usable), '[V12-162] The reveal round total is above the phone action bar');
    if (r.hard) check(within(r.hard, usable), '[V12-162] The hard-one mark is above the phone action bar');
  }

  if (opts.fold && m.end && m.end.atTop && !m.dialog && END_FOLD.includes(size)) {
    const e = m.end;
    const fold = { left: 0, right: m.viewport.width, top: 0, bottom: m.viewport.height };
    check([e.total, e.tier, e.share].every((b) => within(b, fold)), '[V12-162] The end total, tier and Share are above the fold');
    if (size === '390x844') check(within(e.another, fold), '[V12-162] Play another 10 is above the fold on the tall phone');
  }

  check((m.points ?? []).every((p) => p.lines <= 1), '[DS31] Each row\'s points stay on one line');

  for (const d of m.dialogs ?? []) {
    const clear = d.parts.every((a, i) => d.parts.slice(i + 1).every((b) => !(a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1)));
    check(!!d.box && d.parts.every((p) => within(p, d.box)) && clear, '[V12-59] A dialog header keeps its title, cue and Close inside the dialog without overlap');
    check(!d.clipped, '[V12-161] Dialog content stays inside the dialog instead of being cut off at its side');
  }

  if (m.paused) {
    const overlap = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    check(m.paused.blockers.every((b) => !overlap(b, m.paused.note)), '[V12-42] The paused-clock note stays clear of the map credits and controls');
  }

  if (opts.keyboard && m.year) {
    const visible = { left: 0, right: m.viewport.width, top: m.visual.top, bottom: m.visual.top + m.visual.height };
    const y = m.year;
    check([y.field, ...y.eras, y.confirm, ...(y.cue ? [y.cue] : [])].every((b) => within(b, visible)) && y.eras.length === 2,
      '[V12-71] With the keyboard open, the year field, era, cue and Confirm stay above the keyboard');
  }
  return issues;
}
