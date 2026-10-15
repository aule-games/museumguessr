// Browser collector plus pure acceptance rules. Synthetic unit boxes test the
// rules, not the layout; only review-built supplies measured browser geometry.
export function measureFlow() {
  const round = document.querySelector('.round');
  if (!round) return null;
  const box = (node) => {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const rect = (selector) => box(round.querySelector(selector));
  const caption = round.querySelector('.photo__caption');
  const dimmed = round.querySelector('.pin--dimmed');
  const pinLabel = dimmed?.querySelector('.pin__label');
  const tour = document.querySelector('.tour');
  const targets = { photo: '[data-test=photo]', questions: '.prompt', map: '[data-test=map-region]', confirm: '[data-test=confirm]', score: '[data-test=total]', menu: '[data-test=menu]' };
  return {
    viewport: { width: innerWidth, height: innerHeight },
    page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    step: round.dataset.step,
    ready: round.querySelector('.photo').dataset.state === 'ready',
    photo: rect('[data-test=photo]'), image: rect('.photo__img'), hint: rect('.photo__hint'), answer: rect('.answer'),
    imageFit: getComputedStyle(round.querySelector('.photo__img')).objectFit,
    captionText: caption?.textContent?.trim() ?? '',
    back: rect('[data-test=back]'), confirm: rect('[data-test=confirm]'),
    primaryCount: round.querySelectorAll('.actionbar .btn--primary').length,
    dimmed: dimmed ? {
      hollow: dimmed.classList.contains('pin--guess-made') && !!dimmed.querySelector('path[fill="none"]'),
      label: pinLabel?.textContent, accessible: dimmed.getAttribute('aria-label'),
      inert: getComputedStyle(dimmed).pointerEvents === 'none',
      labelBox: box(pinLabel),
    } : null,
    mapReady: /^(ready|fallback)$/.test(round.querySelector('.map')?.dataset.state ?? ''),
    cities: [...round.querySelectorAll('.map__city')].map(box),
    tour: tour ? {
      card: box(tour.querySelector('.tour__card')),
      target: box(document.querySelector(targets[tour.dataset.step] ?? '[data-no-target]')),
      spot: box(tour.querySelector('.tour__spot')),
    } : null,
  };
}

export function flowGeometryIssues(m) {
  if (!m) return [];
  const issues = [];
  const check = (ok, rule) => { if (!ok) issues.push(rule); };
  const overlap = (a, b) => a && b && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
  const within = (a, b) => a && b && a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
  const viewport = { left: 0, top: 0, right: m.viewport.width, bottom: m.viewport.height };
  check(m.page.width <= m.viewport.width + 1 && m.page.height <= m.viewport.height + 1,
    '[DS19] The round has no page scroll');
  if (m.ready) {
    check(within(m.hint, m.photo) && m.hint.width <= 40 && m.hint.height <= 40 &&
      m.hint.right >= m.photo.right - 16 && m.hint.bottom >= m.photo.bottom - 16,
    '[DS37] The enlarge icon is a small corner mark inside the photo, not a text rail');
    check(m.imageFit === 'contain' && within(m.image, viewport), '[DS19] The whole object image fits on screen without cropping');
    check(m.captionText.length > 0, '[DS37] The neutral caption stays in the figure for screen readers');
  }
  const buttons = [m.confirm, ...(m.step === 'made' ? [] : [m.back])];
  check(buttons.every((r) => r && r.width >= 44 && r.height >= 44 && within(r, viewport)) &&
    (m.step !== 'made' || m.back === null),
  '[DS36] Back and the forward action stay on screen with at least 44 pixel targets');
  check(m.primaryCount === 1 && (m.step === 'made' || (m.back && m.confirm &&
    m.back.right + 8 <= m.confirm.left + 1 && Math.abs(m.back.top - m.confirm.top) <= 1)),
  '[DS36] Back stays left of the single primary action with an 8 pixel gap');
  if (m.viewport.width < 900 && m.viewport.height > m.viewport.width) {
    const share = m.image.height / (m.image.height + m.answer.height);
    check(share >= (m.step === 'when' ? 0.29 : 0.39),
      '[DS19] The image itself retains its photo share');
  }
  if (m.step === 'kept' && m.mapReady) {
    check(m.dimmed?.hollow && m.dimmed.label === 'Your Made guess' && m.dimmed.accessible === m.dimmed.label && m.dimmed.inert,
      '[DS35] The carried Made pin is hollow, labelled Your Made guess, and non-interactive');
    check(!(m.cities ?? []).some((c) => overlap(c, m.dimmed?.labelBox)),
      '[DS35] No fallback-map city name overlaps the Your Made guess label');
  }
  if (m.tour) {
    const gutters = { left: 12, top: 12, right: m.viewport.width - 12, bottom: m.viewport.height - 12 };
    check(within(m.tour.card, gutters), '[DS34] The tour card stays inside the viewport gutters');
    if (m.tour.target) {
      check(within(m.tour.target, m.tour.spot) && !overlap(m.tour.target, m.tour.card),
        '[DS34] The tour spot encloses the named target and its card leaves that target clear');
    }
  }
  return issues;
}
