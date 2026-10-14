// Minimal DOM builder. Text always goes through text nodes (SEC1: no
// innerHTML anywhere), and external links always get rel="noopener noreferrer".

type Child = Node | string | number | null | undefined | false;
type Handler = (ev: never) => void;
export type Attrs = Record<string, string | number | boolean | null | undefined | Handler>;

function apply(el: Element, attrs: Attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  if (el instanceof HTMLAnchorElement && el.target === '_blank') el.rel = 'noopener noreferrer';
}

function append(el: Element, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

/** External link: opens in a new tab with rel="noopener noreferrer". */
export function ext(href: string, text: string, attrs: Attrs = {}): HTMLAnchorElement {
  return h('a', { href, target: '_blank', ...attrs }, text);
}

export function clear(el: Element) {
  while (el.firstChild) el.firstChild.remove();
}

/** Move focus without scrolling; used on every step advance (DS13). */
export function focus(el: HTMLElement | null | undefined) {
  if (!el) return;
  if (!el.hasAttribute('tabindex') && !(el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLAnchorElement)) {
    el.setAttribute('tabindex', '-1');
  }
  el.focus({ preventScroll: true });
}

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** "1,234 / 3,000" with the " / 3,000" part in its own span (same text content). */
export function scoreText(text: string): Node[] {
  const at = text.indexOf(' / ');
  if (at < 0) return [document.createTextNode(text)];
  return [document.createTextNode(text.slice(0, at)), h('span', { class: 'score-max' }, text.slice(at))];
}
