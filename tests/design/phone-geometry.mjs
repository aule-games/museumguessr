// Runs inside the built browser page, not against source text or a mock DOM.
// Keep this function self-contained so Playwright can serialize it.
export function phoneGeometryIssues(state) {
  const issues = [];
  const check = (ok, rule) => { if (!ok) issues.push(rule); };
  const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
  const visible = (r) => r && r.width > 0 && r.height > 0;
  const overlap = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
  const within = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
  const portrait = innerWidth < 900 && innerHeight > innerWidth;
  const landscape = innerWidth > innerHeight && innerHeight <= 500;
  const collapsed = /^reveal-(1|3)(-feedback-sent)?$/.test(state);
  // Check both guessing and reveal maps, not only the score screen. Synthetic
  // production-length credits are installed by review-built before measuring.
  const mapElement = document.querySelector('.map');
  if (mapElement && /^(ready|fallback)$/.test(mapElement.dataset.state)) {
    const map = mapElement.getBoundingClientRect();
    const attribution = mapElement.querySelector('.maplibregl-ctrl-attrib');
    const inner = attribution?.querySelector('.maplibregl-ctrl-attrib-inner');
    const credit = attribution?.getBoundingClientRect();
    check(visible(credit) && !!inner?.textContent.trim(), '[DS22] Map credits remain expanded in round and reveal modes');
    if (visible(credit) && inner) {
      const controls = [...mapElement.querySelectorAll('.map__btn')].map((node) => node.getBoundingClientRect()).filter(visible);
      check(controls.every((control) => !overlap(control, credit)), '[DS22] No map control overlaps the map credits');
      const range = document.createRange();
      range.selectNodeContents(inner);
      const lines = [...range.getClientRects()].filter(visible);
      check(within(credit, map) && lines.length > 0 && lines.every((line) => within(line, credit)) &&
        inner.scrollWidth <= inner.clientWidth + 1 && getComputedStyle(inner).textOverflow !== 'ellipsis',
      '[DS22] Complete map credits fit inside the map without clipping or collapsing');
      check([inner, ...inner.querySelectorAll('a')].every((node) => parseFloat(getComputedStyle(node).fontSize) >= 12),
        '[DS22] Map credits stay at least 12 pixels including provider links');
      if (mapElement.dataset.mode === 'reveal') {
        const pins = [...mapElement.querySelectorAll('.pin svg, .pin__label:not(:empty)')].map((node) => node.getBoundingClientRect());
        check(pins.every((pin) => !overlap(pin, credit)), '[DS22] Fitted reveal pins and labels stay clear of the map credits');
      }
    }
  }
  const scroll = document.querySelector('.reveal__scroll');
  if (scroll) {
    const body = scroll.getBoundingClientRect();
    const footer = rect('.actionbar--reveal');
    const usable = { left: body.left, right: body.right, top: body.top, bottom: Math.min(body.bottom, footer.top) };
    const total = rect('.scores__total');
    const rows = [...document.querySelectorAll('.score__row')];
    if (collapsed && portrait) {
      check(rows.length === 3 && rows.every((row) => within(row.getBoundingClientRect(), usable)) && within(total, usable),
        '[DS21] All three collapsed score rows and the round total are above the phone action bar');
    }
    if (collapsed && !portrait) {
      check(within(total, usable), '[DS21] The round total is visible before scrolling in the split reveal');
    }
    if (state === 'reveal-1' && innerWidth === 390 && innerHeight === 844) {
      const map = rect('.reveal__map');
      check(Math.min(map.bottom, usable.bottom) - Math.max(map.top, usable.top) >= 48,
        '[DS21] At least 48 pixels of the map remain visible below the phone score table');
    }
    if (collapsed && landscape) {
      const original = scroll.scrollTop;
      try {
        for (const row of rows) {
          scroll.scrollTop += row.getBoundingClientRect().bottom - usable.bottom;
          check(within(row.getBoundingClientRect(), usable), '[DS21] Each landscape score row can scroll fully above the action bar');
        }
      } finally { scroll.scrollTop = original; }
    }
    for (const row of rows) {
      const result = row.querySelector('.score__result');
      const points = row.querySelector('.score__points').getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(result);
      const bounds = row.getBoundingClientRect();
      check(getComputedStyle(result).textOverflow !== 'ellipsis' && result.scrollWidth <= result.clientWidth + 1 &&
        [...range.getClientRects()].every((line) => line.left >= bounds.left && line.right <= points.left && line.bottom <= bounds.bottom + 1),
      '[DS31] Score results wrap in full without ellipsis, clipping or entering the points column');
    }
    const map = rect('.reveal__map');
    const controls = [...document.querySelectorAll('.map__btn')].map((node) => node.getBoundingClientRect()).filter(visible);
    const labels = [...document.querySelectorAll('.pin__label:not(:empty)')].map((node) => node.getBoundingClientRect());
    const pins = [...document.querySelectorAll('.pin svg')].map((node) => node.getBoundingClientRect());
    check(controls.every((control) => [...pins, ...labels].every((pin) => !overlap(control, pin))),
      '[DS22] No reveal map control overlaps a fitted pin or its label');
    check(controls.every((control) => within(control, map)), '[DS22] Reveal map controls fit above the legend');
    check(labels.every((label) => within(label, map)), '[DS22] Fitted answer labels stay inside the reveal map');
    if (!portrait) {
      check(within(rect('.reveal__legend'), usable), '[DS22] The split reveal legend stays above the action bar');
    }
    const pulse = document.querySelector('.actionbar--reveal .pulse');
    const chips = [...(pulse?.querySelectorAll('.chip') ?? [])];
    if (chips.length) {
      const q = pulse.querySelector('.pulse__q').getBoundingClientRect();
      const centre = (q.top + q.bottom) / 2;
      check(chips.length === 3 && chips.every((node) => {
        const chip = node.getBoundingClientRect();
        return Math.abs((chip.top + chip.bottom) / 2 - centre) <= 1 && within(chip, footer);
      }), '[DS21] The difficulty label and all three choices share one line');
    }
  }
  if (portrait && innerHeight <= 700 && /^(kept|made|when)-empty$/.test(state)) {
    const photo = rect('.round__photo');
    const answer = rect('.answer');
    const share = photo.height / (photo.height + answer.height);
    check(share >= (state === 'when-empty' ? 0.29 : 0.39), '[DS19] Short phones retain the object photo share instead of a thumbnail strip');
  }
  if (/^(kept|made)-(empty|placed|zoomed)$/.test(state) && document.querySelector('.map[data-state="fallback"]')) {
    const cities = [...document.querySelectorAll('.map__city')].map((node) => node.getBoundingClientRect());
    check(cities.length > 0, '[DS4] The fallback guessing map retains useful city labels');
    check(cities.every((city, i) => cities.slice(i + 1).every((other) => !overlap(city, other))),
      '[DS4] Fallback city labels do not collide at world or zoomed views');
  }
  const tour = document.querySelector('.tour');
  if (tour) {
    const card = rect('.tour__card');
    check(within(card, { left: 12, right: innerWidth - 12, top: 12, bottom: innerHeight - 12 }),
      '[DS34] Tour cards stay within the viewport gutters');
    const target = tour.dataset.step === 'map' ? rect('[data-test="map-region"]') : tour.dataset.step === 'photo' ? rect('[data-test="photo"]') : null;
    if (target) check(!overlap(card, target), '[DS34] The photo and map tour cards do not cover their target');
  }
  return issues;
}
