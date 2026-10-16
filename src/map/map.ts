// The one map (ENG9, ENG32, DS4, DS11, DS22, DS33). MapLibre GL JS v6 is
// loaded from self-hosted, unbundled ES modules; a single instance is moved
// between the round and reveal containers. Pins are DOM markers and survive
// style changes; lines and areas are GeoJSON layers re-added on style.load.

import type * as ML from 'maplibre-gl';
import { MAPLIBRE_URL } from '../config.ts';
import { t } from '../copy.ts';
import { greatCircle, distanceKm, unwrapAround, type LatLng } from '../scoring/geo.ts';
import { h, reducedMotion } from '../ui/dom.ts';
import tokens from '../design/tokens.json';
import combinedSvg from '../assets/pins/combined.svg?raw';
import guessKeptSvg from '../assets/pins/guess-kept.svg?raw';
import guessMadeSvg from '../assets/pins/guess-made.svg?raw';
import keptSvg from '../assets/pins/kept.svg?raw';
import madeSvg from '../assets/pins/made.svg?raw';
import { dropLabel, revealCountries, snapTarget, type DropLabel, type Place } from './places.ts';
import { fallbackStyle, mainStyle } from './styles.ts';
import { fallbackRank, overlaps, revealPadding, type Box } from './layout.ts';

type MapLibre = typeof ML;
export type MapState = 'loading' | 'ready' | 'fallback' | 'context-lost' | 'failed';
export type PinKind = 'kept' | 'made' | 'combined' | 'guess-kept' | 'guess-made';

export const FALLBACK_AFTER_MS = 4000;
/** Reveal styling: the world fades behind a veil; the answer countries take their pin colour. */
export const VEIL_OPACITY = 0.78;
export const COUNTRY_OPACITY = 0.28;
/** Base-map layers hidden on the reveal (labels and road/minor-border detail). */
const BASE_DETAIL_LAYERS = ['label-country', 'label-city', 'roads-major', 'boundary-minor'];
const REVEAL_LAYERS = ['reveal-veil', 'reveal-countries-fill', 'reveal-countries-line', 'reveal-area-fill', 'reveal-area-line', 'reveal-guesses', 'reveal-answer'];
const VEIL: GeoJSON.Feature = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-180, -85],
        [180, -85],
        [180, 85],
        [-180, 85],
        [-180, -85],
      ],
    ],
  },
};
export const REVEAL_MAX_ZOOM = 6;
const WORLD: [[number, number], [number, number]] = [
  [-170, -58],
  [190, 75],
];
const SVG: Record<PinKind, string> = {
  kept: keptSvg,
  made: madeSvg,
  combined: combinedSvg,
  'guess-kept': guessKeptSvg,
  'guess-made': guessMadeSvg,
};

export function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

/** Parse our own static SVG into a node (no innerHTML). */
export function pinElement(kind: PinKind, label: string, extraClass = ''): HTMLElement {
  const doc = new DOMParser().parseFromString(SVG[kind], 'image/svg+xml');
  const svg = document.importNode(doc.documentElement, true);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const el = h('div', { class: `pin pin--${kind} ${extraClass}`.trim(), role: 'img', 'aria-label': label });
  el.append(svg);
  return el;
}

export function labelText(l: DropLabel): string {
  if (l.kind === 'near') return t('map.near', { place: `${l.place}, ${l.country}` });
  if (l.kind === 'country') return l.country;
  return t('map.openSea');
}

let libPromise: Promise<MapLibre> | null = null;
function loadLib(): Promise<MapLibre> {
  if (!libPromise) {
    if (!document.querySelector('link[data-maplibre]')) {
      document.head.append(h('link', { rel: 'stylesheet', href: `${MAPLIBRE_URL}maplibre-gl.css`, 'data-maplibre': true }));
    }
    libPromise = import(/* @vite-ignore */ `${MAPLIBRE_URL}maplibre-gl.mjs`).then((lib: MapLibre) => {
      lib.setWorkerUrl(`${MAPLIBRE_URL}maplibre-gl-worker.mjs`);
      return lib;
    });
    libPromise.catch(() => {
      libPromise = null;
    });
  }
  return libPromise;
}

let dataPromise: Promise<{ places: Place[]; countries: GeoJSON.FeatureCollection }> | null = null;
export function loadMapData() {
  dataPromise ??= Promise.all([import('./data/places.json'), import('./data/countries.json')]).then(([p, c]) => ({
    places: (p.default as unknown as { places: Place[] }).places,
    countries: c.default as unknown as GeoJSON.FeatureCollection,
  }));
  return dataPromise;
}

/** Prefetch the map modules and data on the start screen (ENG21). */
export function prefetchMap(): void {
  void loadLib().catch(() => {});
  void loadMapData().catch(() => {});
}

export interface GuessOptions {
  step: 'kept' | 'made';
  pin: LatLng | null;
  /** The other map question's confirmed pin, shown dimmed (the Made pin during Kept, DS35). */
  dimmed: { step: 'kept' | 'made'; at: LatLng } | null;
}

export interface RevealOptions {
  kept: LatLng;
  made: LatLng;
  keptLabel: string;
  madeLabel: string;
  guessKept: LatLng | null;
  guessMade: LatLng | null;
  /** Full-marks area for region- or country-level origins. */
  madeArea: { km: number; label: string } | null;
  animate: boolean;
}

export interface MapEvents {
  onPin: (p: LatLng, label: string) => void;
  onState: (s: MapState) => void;
  onError: (name: string, message: string) => void;
}

function circle(center: LatLng, km: number, steps = 72): [number, number][] {
  const out: [number, number][] = [];
  const R = 6371.0088;
  const d = km / R;
  const φ1 = (center.lat * Math.PI) / 180;
  const λ1 = (center.lng * Math.PI) / 180;
  for (let i = 0; i <= steps; i++) {
    const θ = (2 * Math.PI * i) / steps;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    out.push([(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI]);
  }
  return out;
}

const line = (coords: [number, number][]): GeoJSON.Feature => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: coords },
});

export class GameMap {
  readonly element: HTMLElement;
  state: MapState = 'loading';
  private map: ML.Map | null = null;
  private lib: MapLibre | null = null;
  private places: Place[] = [];
  private countries: GeoJSON.FeatureCollection | null = null;
  private markers: ML.Marker[] = [];
  private answerLabelResize: ResizeObserver | null = null;
  private answerMarkerMove: MutationObserver | null = null;
  /** Until when the answer labels are re-fitted every frame (see settleLabels). */
  private settleUntil = 0;
  private settling = false;
  private pin: ML.Marker | null = null;
  private fallbackLabels: ML.Marker[] = [];
  private revealData: { answer: GeoJSON.Feature; guesses: GeoJSON.Feature[]; area: GeoJSON.Feature | null; countries: GeoJSON.Feature[] } | null = null;
  private mode: 'idle' | 'guess' | 'reveal' = 'idle';
  /** Re-fits the reveal view while its host settles; dropped once the player moves the map. */
  private revealFit: (() => void) | null = null;
  private guessStep: 'kept' | 'made' = 'kept';
  private label: HTMLElement;
  private overlay: HTMLElement;
  private canvasHost: HTMLElement;
  private events: MapEvents;
  private errorCount = 0;

  private constructor(events: MapEvents) {
    this.events = events;
    this.canvasHost = h('div', { class: 'map__canvas' });
    this.label = h('div', { class: 'map__label', 'aria-live': 'polite' });
    this.overlay = h('div', { class: 'map__overlay', role: 'status' }, t('map.loading'));
    const zoomIn = h('button', { type: 'button', class: 'map__btn', 'aria-label': t('map.zoomIn'), onclick: () => this.map?.zoomIn() }, '+');
    const zoomOut = h('button', { type: 'button', class: 'map__btn', 'aria-label': t('map.zoomOut'), onclick: () => this.map?.zoomOut() }, '−');
    const world = h('button', { type: 'button', class: 'map__btn map__btn--world', onclick: () => this.fitWorld() }, t('map.world'));
    this.element = h(
      'div',
      { class: 'map', 'data-state': 'loading' },
      this.canvasHost,
      h('div', { class: 'map__crosshair', 'aria-hidden': 'true' }),
      h('div', { class: 'map__controls' }, zoomIn, zoomOut, world),
      this.label,
      this.overlay,
    );
  }

  static create(events: MapEvents): GameMap {
    const gm = new GameMap(events);
    void gm.start();
    return gm;
  }

  private setState(s: MapState) {
    this.state = s;
    this.element.dataset.state = s;
    this.overlay.hidden = s === 'ready' || s === 'fallback';
    if (s === 'failed') {
      this.overlay.replaceChildren(
        h('p', {}, t('map.failed')),
        h('button', { type: 'button', class: 'btn btn--secondary', onclick: () => location.reload() }, t('map.reload')),
      );
    }
    this.events.onState(s);
  }

  private async start() {
    let lib: MapLibre;
    try {
      [lib] = await Promise.all([
        loadLib(),
        loadMapData().then((d) => {
          this.places = d.places;
          this.countries = d.countries;
        }),
      ]);
    } catch (e) {
      // A failed map chunk import shows the error screen (DS23); the app decides.
      this.events.onError('map_chunk_failed', e instanceof Error ? e.message : String(e));
      this.setState('failed');
      return;
    }
    this.lib = lib;
    let map: ML.Map;
    try {
      map = new lib.Map({
        container: this.canvasHost,
        style: mainStyle(),
        bounds: WORLD,
        renderWorldCopies: true,
        attributionControl: { compact: false, customAttribution: 'Natural Earth' },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxZoom: 12,
        minZoom: 0,
        fadeDuration: 0,
      });
    } catch (e) {
      this.events.onError('map_init_failed', e instanceof Error ? e.name : 'unknown');
      this.setState('failed');
      return;
    }
    this.map = map;
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();

    // Tile metadata can lengthen the credit after the first fit. Re-measure
    // its rail when it wraps, including font loading and viewport changes.
    const attribution = this.element.querySelector('.maplibregl-ctrl-attrib');
    if (attribution) {
      const observer = new ResizeObserver(() => {
        this.updateFallbackLabels();
        this.revealFit?.();
      });
      observer.observe(attribution);
      map.once('remove', () => observer.disconnect());
    }

    let idle = false;
    const timer = setTimeout(() => {
      if (!idle) this.switchToFallback();
    }, FALLBACK_AFTER_MS);
    map.once('idle', () => {
      idle = true;
      clearTimeout(timer);
      if (this.state === 'loading') this.setState('ready');
    });
    map.on('error', (e: ML.ErrorEvent & { sourceId?: string }) => {
      const msg = String(e.error?.message ?? '');
      const tile404 = /\b404\b/.test(msg);
      if (tile404) return;
      if (this.state === 'loading' || (this.state === 'ready' && e.sourceId === 'openmaptiles')) this.switchToFallback();
      if (this.errorCount < 3) {
        this.errorCount += 1;
        this.events.onError('map_error', msg);
      }
    });
    map.on('style.load', () => this.redrawLayers());
    map.on('click', (e) => this.handleTap(e.lngLat, e.point));
    map.on('zoomend', () => this.updateFallbackLabels());
    map.on('moveend', () => this.updateFallbackLabels());
    map.on('resize', () => this.revealFit?.());
    map.on('render', () => this.settleLabels());
    map.on('movestart', (e: { originalEvent?: Event }) => {
      if (e.originalEvent) this.revealFit = null;
    });
    // Collision boxes and fit padding use the real label font, not its fallback.
    void document.fonts.ready.then(() => {
      this.updateFallbackLabels();
      this.revealFit?.();
    });

    const canvas = map.getCanvas();
    canvas.setAttribute('aria-label', t('map.label'));
    canvas.addEventListener('keydown', (ev) => this.handleKey(ev));
    canvas.addEventListener('webglcontextlost', () => {
      this.setState('context-lost');
      setTimeout(() => {
        if (this.state === 'context-lost') this.setState('failed');
      }, 3000);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      if (this.state === 'context-lost') this.setState(this.countries && this.isFallback ? 'fallback' : 'ready');
    });
  }

  private isFallback = false;

  /** Switch once per page load to the bundled map; waits for a drag to finish (ENG32). */
  private switchToFallback() {
    if (this.isFallback || !this.map || !this.countries) return;
    const map = this.map;
    const go = () => {
      this.isFallback = true;
      map.setStyle(fallbackStyle(this.countries as GeoJSON.FeatureCollection));
      this.setState('fallback');
      this.updateFallbackLabels();
    };
    if (map.isMoving()) map.once('moveend', go);
    else go();
  }

  private updateFallbackLabels() {
    if (!this.isFallback || !this.map || !this.lib) return;
    for (const m of this.fallbackLabels) m.remove();
    this.fallbackLabels = [];
    // the reveal shows only its own pins and labels (the rest of the world is faded)
    if (this.mode === 'reveal') return;
    const zoom = this.map.getZoom();
    const bounds = this.map.getBounds();
    const maxRank = fallbackRank(zoom);
    const frame = this.canvasHost.getBoundingClientRect();
    const occupied: Box[] = [...this.element.querySelectorAll<HTMLElement>('.map__controls, .map__label, .maplibregl-ctrl-attrib, .pin--dimmed .pin__label')]
      .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    const gap = parseFloat(tokens.space['2']);
    for (const p of [...this.places].sort((a, b) => a[4] - b[4])) {
      if (this.fallbackLabels.length >= 60) break;
      if (p[4] > maxRank) continue;
      if (!bounds.contains([p[3], p[2]])) continue;
      const el = h('div', { class: 'map__city', 'aria-hidden': 'true' }, p[0]);
      const marker = new this.lib.Marker({ element: el, anchor: 'left' }).setLngLat([p[3], p[2]]).addTo(this.map);
      const box = el.getBoundingClientRect();
      if (box.left < frame.left || box.right > frame.right || box.top < frame.top || box.bottom > frame.bottom || occupied.some((other) => overlaps(box, other, gap))) {
        marker.remove();
        continue;
      }
      occupied.push(box);
      this.fallbackLabels.push(marker);
    }
  }

  attach(parent: HTMLElement) {
    if (this.element.parentElement !== parent) parent.append(this.element);
    requestAnimationFrame(() => this.map?.resize());
  }

  fitWorld() {
    this.map?.fitBounds(WORLD, { animate: !reducedMotion(), padding: 8 });
  }

  /** Guess mode: a tap places the pin, a drag adjusts it, Enter drops it at the centre. */
  guess(opts: GuessOptions) {
    this.mode = 'guess';
    this.revealFit = null;
    this.guessStep = opts.step;
    this.clearMarkers();
    this.revealData = null;
    this.redrawLayers();
    this.element.dataset.mode = 'guess';
    if (opts.dimmed && this.lib && this.map) {
      const { step, at } = opts.dimmed;
      const label = t('map.previousGuess', { step: t(`step.${step}`) });
      const el = pinElement(step === 'made' ? 'guess-made' : 'guess-kept', label, 'pin--dimmed');
      el.append(h('span', { class: 'pin__label' }, label));
      this.markers.push(new this.lib.Marker({ element: el, anchor: 'bottom' }).setLngLat([at.lng, at.lat]).addTo(this.map));
      this.updateFallbackLabels(); // city names give way to the carried label (DS35)
    }
    this.label.textContent = '';
    if (opts.pin) this.placePin(opts.pin, false);
  }

  private handleTap(lngLat: ML.LngLat, point: ML.Point) {
    if (this.mode !== 'guess' || !this.map) return;
    const p = { lat: lngLat.lat, lng: lngLat.wrap().lng };
    const snapped = snapTarget(p, this.places, (q) => {
      const s = this.map?.project([q.lng, q.lat]);
      return s ? Math.hypot(s.x - point.x, s.y - point.y) : Infinity;
    });
    this.placePin(snapped ?? p, true);
  }

  private handleKey(ev: KeyboardEvent) {
    if (!this.map) return;
    if (ev.key === 'Enter' && this.mode === 'guess') {
      ev.preventDefault();
      const c = this.map.getCenter().wrap();
      this.placePin({ lat: c.lat, lng: c.lng }, true);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      this.map.getCanvas().blur();
      this.element.dispatchEvent(new CustomEvent('map-escape', { bubbles: true }));
    }
  }

  private placePin(p: LatLng, announce: boolean) {
    if (!this.map || !this.lib) return;
    const kind: PinKind = this.guessStep === 'kept' ? 'guess-kept' : 'guess-made';
    if (!this.pin) {
      const el = pinElement(kind, t(this.guessStep === 'kept' ? 'step.kept' : 'step.made'));
      this.pin = new this.lib.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat([p.lng, p.lat]).addTo(this.map);
      this.pin.on('dragend', () => {
        const ll = this.pin?.getLngLat().wrap();
        if (ll) this.placePin({ lat: ll.lat, lng: ll.lng }, true);
      });
    } else {
      this.pin.setLngLat([p.lng, p.lat]);
    }
    const text = labelText(dropLabel(p, this.places, this.countries));
    this.label.textContent = text;
    this.updateFallbackLabels();
    if (announce) this.events.onPin(p, text);
  }

  private clearMarkers() {
    this.answerLabelResize?.disconnect();
    this.answerMarkerMove?.disconnect();
    this.answerLabelResize = null;
    this.answerMarkerMove = null;
    for (const m of this.markers) m.remove();
    this.markers = [];
    this.pin?.remove();
    this.pin = null;
  }

  /**
   * Re-fit the answer labels on every frame for a short while after anything
   * on the reveal map moved. Markers can settle a frame or more after the
   * event that moved them, and a fit that ran before that would leave a label
   * outside the map. The fit is cheap and gives the same answer for the same
   * layout, so repeating it never makes a label jump.
   */
  private settleLabels(ms = 1500) {
    this.settleUntil = performance.now() + ms;
    if (this.settling) return;
    this.settling = true;
    const step = () => {
      if (this.mode !== 'reveal' || performance.now() > this.settleUntil) {
        this.settling = false;
        return;
      }
      this.fitAnswerLabels();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /**
   * Keep every answer label inside the reveal map (DS22, V1-26). Labels wrap to
   * the frame instead of shrinking, then each one takes the nearest of a few
   * spots next to its pin that clears the map controls, the credits and the
   * labels already placed. Bounded (a few dozen spots per label) and
   * idempotent: the label sizes and the map height never change here, so the
   * observers that call it settle after one pass.
   */
  private fitAnswerLabels() {
    if (this.mode !== 'reveal') return;
    const frame = this.canvasHost.getBoundingClientRect();
    if (!frame.width || !frame.height) return;
    const gap = parseFloat(tokens.space['2']);
    const controls = this.element.querySelector('.map__controls')?.getBoundingClientRect();
    const compactEnlarged = frame.height < parseFloat(tokens.layout['map-min']) &&
      parseFloat(getComputedStyle(this.element).fontSize) > parseFloat(tokens.text.md);
    // A tall, narrow origin label cannot clear the credits in a short map.
    // Use the strip beside World to trade wrapping height for available width.
    if (compactEnlarged) {
      this.element.style.setProperty('--map-label-max-width', `${Math.max(0, frame.width - (controls?.width ?? 0) - 3 * gap)}px`);
    } else {
      this.element.style.removeProperty('--map-label-max-width');
    }
    this.element.style.setProperty('--map-label-width', `${Math.max(0, frame.width - 2 * gap)}px`);
    const labels = [...this.element.querySelectorAll<HTMLElement>('.pin:not(.pin--guess) .pin__label:not(:empty)')];
    for (const label of labels) {
      label.style.removeProperty('--pin-label-x');
      label.style.removeProperty('--pin-label-y');
    }
    const boxes = (selector: string): Box[] => [...this.element.querySelectorAll(selector)]
      .map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height);
    const fixed = boxes('.map__controls, .maplibregl-ctrl-attrib');
    const pins = boxes('.pin svg');
    const inner = { left: frame.left + gap, top: frame.top + gap, right: frame.right - gap, bottom: frame.bottom - gap };
    const placed: Box[] = [];
    for (const label of labels) {
      const r = label.getBoundingClientRect();
      const clampX = (x: number) => Math.max(inner.left, Math.min(x, inner.right - r.width));
      const clampY = (y: number) => Math.max(inner.top, Math.min(y, inner.bottom - r.height));
      const hard = [...fixed, ...placed];
      const xs = [clampX(r.left), ...hard.flatMap((b) => [clampX(b.left - gap - r.width), clampX(b.right + gap)])];
      const ys = [clampY(r.top), inner.top, clampY(inner.bottom - r.height),
        ...hard.flatMap((b) => [clampY(b.top - gap - r.height), clampY(b.bottom + gap)])];
      let best: Box = { left: xs[0] as number, top: ys[0] as number, right: (xs[0] as number) + r.width, bottom: (ys[0] as number) + r.height };
      let bestCost = Infinity;
      for (const left of xs) {
        for (const top of ys) {
          const b = { left, top, right: left + r.width, bottom: top + r.height };
          // Text never covers a control, the credits or another label; it
          // covers a pin only when nothing else fits; then the nearest spot wins.
          const cost = hard.filter((o) => overlaps(b, o, gap)).length * 1e6 +
            pins.filter((o) => overlaps(b, o, 0)).length * 1e3 + Math.hypot(left - r.left, top - r.top);
          if (cost < bestCost) {
            best = b;
            bestCost = cost;
          }
        }
      }
      label.style.setProperty('--pin-label-x', `${best.left - r.left}px`);
      label.style.setProperty('--pin-label-y', `${best.top - r.top}px`);
      placed.push(best);
    }
  }

  reveal(o: RevealOptions) {
    if (!this.map || !this.lib) return;
    const map = this.map;
    const lib = this.lib;
    this.mode = 'reveal';
    this.element.dataset.mode = 'reveal';
    this.clearMarkers();
    this.label.textContent = '';
    const animate = o.animate && !reducedMotion();

    // Marker transforms can change on idle, AFTER the last map render. Observe
    // the markers themselves (not label styles) so the final DOM positions are
    // fitted before paint, without a self-triggering mutation loop. Resizing a
    // label also catches text-size changes that do not render the WebGL map.
    this.answerMarkerMove = new MutationObserver(() => this.settleLabels());
    this.answerLabelResize = new ResizeObserver(() => this.settleLabels());
    for (const el of this.element.querySelectorAll('.map__canvas, .map__controls, .maplibregl-ctrl-attrib')) {
      this.answerLabelResize.observe(el);
    }

    // Unwrap longitudes so everything sits on one side of the antimeridian (ENG25).
    const unwrap = (p: LatLng): LatLng => unwrapAround(p, o.made.lng);
    const made = unwrap(o.made);
    const kept = unwrap(o.kept);
    const coincide = distanceKm(o.made, o.kept) < 1;

    const add = (kind: PinKind, p: LatLng, label: string, cls = '') => {
      const el = pinElement(kind, label, `${cls}${animate ? ' pin--drop' : ''}`);
      el.append(h('span', { class: 'pin__label' }, label));
      this.markers.push(new lib.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map));
      this.answerMarkerMove?.observe(el, { attributes: true, attributeFilter: ['style'] });
      if (label) this.answerLabelResize?.observe(el.querySelector('.pin__label')!);
    };
    const guesses: GeoJSON.Feature[] = [];
    if (o.guessKept) {
      const g = unwrap(o.guessKept);
      add('guess-kept', g, '', 'pin--guess');
      guesses.push(line(greatCircle(g, kept, 32)));
    }
    if (o.guessMade) {
      const g = unwrap(o.guessMade);
      add('guess-made', g, '', 'pin--guess');
      guesses.push(line(greatCircle(g, made, 32)));
    }
    if (coincide) add('combined', made, o.madeLabel);
    else {
      add('made', made, o.madeLabel);
      add('kept', kept, o.keptLabel);
    }

    const full = coincide ? [] : greatCircle(made, kept);
    this.revealData = {
      answer: line(animate ? full.slice(0, 1) : full),
      guesses,
      area: o.madeArea ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle(made, o.madeArea.km)] } } : null,
      countries: this.countries ? revealCountries(o.kept, o.made, this.countries) : [],
    };
    this.redrawLayers();

    const pts = [made, kept, ...(o.guessKept ? [unwrap(o.guessKept)] : []), ...(o.guessMade ? [unwrap(o.guessMade)] : [])];
    const lngs = pts.map((p) => p.lng);
    const lats = pts.map((p) => p.lat);
    const fit = () => {
      const frame = this.canvasHost.getBoundingClientRect();
      const box = (selector: string): Box | null => {
        const r = this.element.querySelector(selector)?.getBoundingClientRect();
        return r && r.width && r.height ? { left: r.left - frame.left, top: r.top - frame.top, right: r.right - frame.left, bottom: r.bottom - frame.top } : null;
      };
      const labels = [...this.element.querySelectorAll<HTMLElement>('.pin__label')];
      const pinSize = parseFloat(tokens.pin.size);
      const padding = revealPadding(
        { w: frame.width, h: frame.height },
        {
          height: pinSize * 1.25,
          labelWidth: Math.max(pinSize, ...labels.map((el) => el.offsetWidth)),
          labelHeight: Math.max(0, ...labels.map((el) => el.offsetHeight)),
          gap: parseFloat(tokens.space['2']),
          labelGap: parseFloat(tokens.space['1']),
        },
        box('.map__controls'),
        box('.maplibregl-ctrl-attrib'),
      );
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding, maxZoom: REVEAL_MAX_ZOOM, animate: false },
      );
      this.settleLabels();
    };
    // The reveal host is mounted after this call: fit now, then again on each
    // resize until the player moves the map.
    fit();
    this.revealFit = fit;

    if (animate && full.length > 1) {
      const start = performance.now() + 150;
      const step = (now: number) => {
        const f = Math.min(1, Math.max(0, (now - start) / 600));
        const n = Math.max(1, Math.round(f * full.length));
        if (this.revealData) this.revealData.answer = line(full.slice(0, n));
        (map.getSource('reveal-answer') as ML.GeoJSONSource | undefined)?.setData(this.revealData?.answer ?? line([]));
        if (f < 1 && this.mode === 'reveal') requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  /**
   * Re-add the reveal layers after any style change; the reveal fades the base
   * map and hides its labels. `data-reveal="drawn"` marks the map once they
   * have rendered.
   */
  private redrawLayers() {
    const map = this.map;
    if (!map) return;
    delete this.element.dataset.reveal;
    try {
      this.drawLayers(map);
    } catch {
      // Only the style document itself can still be loading here, and its
      // style.load event runs this again. (isStyleLoaded() is also false while
      // tiles load, which would skip the reveal layers for good.)
      return;
    }
    if (this.revealData) {
      map.once('idle', () => {
        if (this.mode === 'reveal' && this.revealData) this.element.dataset.reveal = 'drawn';
      });
    }
  }

  private drawLayers(map: ML.Map) {
    for (const id of REVEAL_LAYERS) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of ['reveal-veil', 'reveal-countries', 'reveal-area', 'reveal-guesses', 'reveal-answer']) {
      if (map.getSource(id)) map.removeSource(id);
    }
    const d = this.revealData;
    for (const id of BASE_DETAIL_LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', d ? 'none' : 'visible');
    }
    this.updateFallbackLabels();
    if (!d) return;
    const css = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    map.addSource('reveal-veil', { type: 'geojson', data: VEIL });
    map.addLayer({ id: 'reveal-veil', type: 'fill', source: 'reveal-veil', paint: { 'fill-color': color('--map-land', '#fff'), 'fill-opacity': VEIL_OPACITY } });
    const byRole = (kept: string, made: string, both: string): ML.ExpressionSpecification => ['match', ['get', 'role'], 'kept', kept, 'made', made, both];
    const kept = color('--color-kept', '#234fba');
    const made = color('--color-made', '#8b3653');
    map.addSource('reveal-countries', { type: 'geojson', data: { type: 'FeatureCollection', features: d.countries } });
    map.addLayer({ id: 'reveal-countries-fill', type: 'fill', source: 'reveal-countries', paint: { 'fill-color': byRole(kept, made, made), 'fill-opacity': COUNTRY_OPACITY } });
    map.addLayer({ id: 'reveal-countries-line', type: 'line', source: 'reveal-countries', paint: { 'line-color': byRole(kept, made, made), 'line-width': 2, 'line-opacity': 1 } });
    if (d.area) {
      map.addSource('reveal-area', { type: 'geojson', data: d.area });
      map.addLayer({ id: 'reveal-area-fill', type: 'fill', source: 'reveal-area', paint: { 'fill-color': color('--color-full-marks-area', 'rgba(0,0,0,0.12)') } });
      map.addLayer({
        id: 'reveal-area-line',
        type: 'line',
        source: 'reveal-area',
        paint: { 'line-color': color('--color-made', '#666'), 'line-width': 1, 'line-dasharray': [2, 2] },
      });
    }
    map.addSource('reveal-guesses', { type: 'geojson', data: { type: 'FeatureCollection', features: d.guesses } });
    map.addLayer({
      id: 'reveal-guesses',
      type: 'line',
      source: 'reveal-guesses',
      paint: { 'line-color': color('--color-guess-line', '#555'), 'line-width': 2, 'line-dasharray': [2, 2] },
    });
    map.addSource('reveal-answer', { type: 'geojson', data: d.answer });
    map.addLayer({
      id: 'reveal-answer',
      type: 'line',
      source: 'reveal-answer',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': color('--color-answer-line', '#222'), 'line-width': 3 },
    });
  }

  focus() {
    this.map?.getCanvas().focus();
  }
}
