// @vitest-environment happy-dom
// The year control's early stop (D11): a separate "≤ 4000 BCE" end cap with
// defined typing, era, keyboard and drag behaviour.
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy';
import { SLIDER } from '../../src/scoring/config';
import { parseYearInput, pointerYear, stepYear, yearControl } from '../../src/ui/year';

const STOP = SLIDER.earlyStop;

function mount(initial: number | null = null) {
  const changes: (number | null)[] = [];
  const control = yearControl(initial, (y) => changes.push(y));
  document.body.replaceChildren(control.element);
  const el = control.element;
  const field = el.querySelector<HTMLInputElement>('.year__field')!;
  const [bce, ce] = [...el.querySelectorAll<HTMLButtonElement>('.year__era')] as [HTMLButtonElement, HTMLButtonElement];
  const track = el.querySelector<HTMLElement>('[role=slider]')!;
  const type = (text: string) => {
    field.value = text;
    field.dispatchEvent(new Event('input'));
  };
  const key = (k: string) => track.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const readout = () => el.querySelector('.year__readout')?.textContent;
  const suffix = () => el.querySelector<HTMLElement>('[data-test=year-suffix]')!;
  const cap = () => el.querySelector<HTMLElement>('[data-test=year-cap]')!;
  return { control, el, field, bce, ce, track, type, key, readout, suffix, cap, changes };
}

/** The accessible name a button gets from its visible text (hidden parts excluded). */
const visibleText = (el: HTMLElement) =>
  [...el.childNodes].map((n) => (n instanceof HTMLElement ? (n.hidden ? '' : n.textContent) : n.textContent)).join('');

describe('the year control’s early stop', () => {
  it('typing any BCE year of 4000 or more selects the stop, shown as 4000 with BCE or earlier [V12-70]', () => {
    for (const text of ['4000', '4001', '5000', '9999']) expect(parseYearInput(text, 'BCE'), text).toEqual({ year: STOP, problem: null });
    expect(parseYearInput('3999', 'BCE')).toEqual({ year: -3999, problem: null });
    const c = mount();
    c.bce.click();
    c.type('5000');
    expect(c.changes.at(-1)).toBe(STOP);
    expect(c.field.value).toBe('4000');
    expect(c.readout()).toBe(COPY['year.earlyStop']);
    expect(c.suffix().hidden).toBe(false);
    expect(visibleText(c.bce).trim()).toBe(`${COPY['year.bce']} ${COPY['year.earlierSuffix']}`);
    expect(c.bce.getAttribute('aria-pressed')).toBe('true');
    expect(c.cap().dataset.selected).toBe('true');
  });

  it('the stop’s accessible value reads 4000 BCE or earlier and the field and slider describe the range with the stop [V12-70]', () => {
    const c = mount(STOP);
    expect(c.track.getAttribute('aria-valuenow')).toBe(String(STOP));
    expect(c.track.getAttribute('aria-valuetext')).toBe('4000 BCE or earlier');
    expect(c.track.getAttribute('aria-valuemin')).toBe(String(STOP));
    for (const el of [c.field, c.track]) {
      const id = el.getAttribute('aria-describedby') ?? '';
      expect(document.getElementById(id)?.textContent).toBe(COPY['year.rangeWithStop']);
    }
    expect(COPY['year.rangeWithStop']).toContain('4000 BCE or earlier');
    expect(c.cap().textContent).toBe(COPY['year.earlyCap']);
  });

  it('a CE year after 2025 shows the range message that names the stop [V12-70]', () => {
    expect(parseYearInput('4000', 'CE')).toEqual({ year: null, problem: 'outOfRange' });
    const c = mount();
    c.type('3000');
    expect(c.el.querySelector('.year__message')?.textContent).toBe(COPY['year.rangeWithStop']);
    expect(c.changes.at(-1)).toBeNull();
  });

  it('choosing CE leaves the stop and clears the field [V12-70]', () => {
    const c = mount(STOP);
    expect(c.field.value).toBe('4000');
    c.ce.click();
    expect(c.changes.at(-1)).toBeNull();
    expect(c.control.value()).toBeNull();
    expect(c.field.value).toBe('');
    expect(c.readout()).toBe('—');
    expect(c.suffix().hidden).toBe(true);
    expect(c.ce.getAttribute('aria-pressed')).toBe('true');
    expect(c.track.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('switching era re-reads the field and never keeps a year outside the range [V12-70]', () => {
    const c = mount();
    c.bce.click();
    c.type('3000');
    expect(c.control.value()).toBe(-3000);
    c.ce.click();
    expect(c.control.value()).toBeNull();
    expect(c.el.querySelector('.year__message')?.textContent).toBe(COPY['year.rangeWithStop']);
    c.bce.click();
    expect(c.control.value()).toBe(-3000);
  });

  it('Left or Down from 3999 BCE and Home select the stop; Right or Up from the stop select 3999 BCE [V12-70]', () => {
    expect(stepYear(-3999, -1)).toBe(STOP);
    expect(stepYear(STOP, -1)).toBe(STOP);
    expect(stepYear(STOP, 1)).toBe(-3999);
    expect(stepYear(-3950, -100)).toBe(STOP);
    expect(stepYear(STOP, 100)).toBe(-3900);
    expect(stepYear(-2, 1)).toBe(-1);
    expect(stepYear(-1, 1)).toBe(1);
    for (const [down, up] of [['ArrowLeft', 'ArrowRight'], ['ArrowDown', 'ArrowUp']] as const) {
      const c = mount(-3999);
      c.key(down);
      expect(c.control.value(), down).toBe(STOP);
      expect(c.readout()).toBe('4000 BCE or earlier');
      c.key(up);
      expect(c.control.value(), up).toBe(-3999);
      expect(c.readout()).toBe('3999 BCE');
    }
    const c = mount(1450);
    c.key('Home');
    expect(c.control.value()).toBe(STOP);
    c.key('End');
    expect(c.control.value()).toBe(SLIDER.max);
  });

  it('dragging snaps across the gap: left of its middle is the stop, right of it the scale from 3999 BCE [V12-70]', () => {
    const cap = { right: 60 };
    const track = { left: 76, width: 300 };
    expect(pointerYear(10, cap, track)).toBe(STOP);
    expect(pointerYear(67.9, cap, track)).toBe(STOP);
    expect(pointerYear(68, cap, track)).toBe(-3999);
    expect(pointerYear(76, cap, track)).toBe(-3999);
    expect(pointerYear(376, cap, track)).toBe(SLIDER.max);
    expect(pointerYear(76 + 100, cap, track)).toBe(1);
    // A drag from the scale onto the cap and back moves between the stop and the scale.
    const c = mount(-500);
    const box = (el: HTMLElement, left: number, width: number) =>
      (el.getBoundingClientRect = () => ({ left, right: left + width, width, top: 0, bottom: 44, height: 44, x: left, y: 0, toJSON: () => ({}) }) as DOMRect);
    box(c.cap(), 0, 60);
    box(c.track, 76, 300);
    const slider = c.el.querySelector<HTMLElement>('.year__slider')!;
    let captured = false;
    slider.setPointerCapture = () => (captured = true);
    slider.hasPointerCapture = () => captured;
    c.track.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, pointerId: 1, bubbles: true }));
    expect(c.control.value()).toBeGreaterThan(-3999);
    slider.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, pointerId: 1, bubbles: true }));
    expect(c.control.value()).toBe(STOP);
    slider.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, pointerId: 1, bubbles: true }));
    expect(c.control.value()).toBe(-3999);
  });
});
