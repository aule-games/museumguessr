// The app controller: runs the pure reducer, persists state, sends events,
// and renders screens. Every game-code entry point goes through `guard`, so
// a bug shows the recovery screen instead of a blank page (E8, ENG11).

import type { Analytics } from './analytics/core.ts';
import { EVENTS, type FeedbackQ } from './analytics/events.ts';
import { ANSWER_KEYS, ITEMS, ITEMS_VERSION, ITEM_IDS, SAMPLE, imageUrl } from './content/items.ts';
import { stripMessage, takeErrorBudget, toReport, type ErrorReport } from './errors/boundary.ts';
import type { WriterLock } from './game/lock.ts';
import type { TabSession } from './game/session.ts';
import { GameMap, hasWebGL2, prefetchMap, type MapState } from './map/map.ts';
import type { LatLng } from './scoring/geo.ts';
import { ledgerKey, reduce, totalPoints, type Action, type Effect } from './state/reducer.ts';
import { KEYS, parseSave, parseSnapshot, serialize, type GameState, type ParsedSnapshot } from './state/schema.ts';
import type { KV } from './storage/guarded.ts';
import { clear, focus } from './ui/dom.ts';
import { endScreen } from './ui/screens/end.ts';
import { errorScreen, frozenScreen, openMenu, aboutPrivacy, testBadge } from './ui/screens/misc.ts';
import { revealScreen } from './ui/screens/reveal.ts';
import { PhotoRegion, roundScreen, type RoundView } from './ui/screens/round.ts';
import { startScreen, type StartMode } from './ui/screens/start.ts';

export type View = 'start' | 'play' | 'review' | 'error' | 'frozen';

export interface AppDeps {
  root: HTMLElement;
  analytics: Analytics;
  local: KV;
  session: KV;
  lock: WriterLock;
  tab: TabSession;
  newId?: () => string;
}

const START_IMAGE_WAIT_MS = 4000;

export class App {
  state: GameState | null = null;
  snapshot: ParsedSnapshot | null = null;
  view: View = 'start';
  private map: GameMap | null = null;
  private mapEverReady = false;
  private photo: PhotoRegion | null = null;
  private photoRound = -1;
  private roundView: RoundView | null = null;
  private startReady = false;
  private readonly webgl: boolean;
  private errorReport: ErrorReport | null = null;
  private badge: HTMLElement | null = null;

  constructor(private d: AppDeps) {
    this.webgl = hasWebGL2();
    d.lock.onLost(() => this.guard(() => this.show('frozen')));
  }

  /** Decide the first screen (DS8, DS24): same-tab reload resumes silently; a later visit sees Continue. */
  boot(): { resumed: boolean } {
    this.state = parseSave(this.d.local.get(KEYS.save), ITEMS_VERSION, ITEM_IDS);
    if (this.state?.finished) this.state = null;
    this.snapshot = parseSnapshot(this.d.local.get(KEYS.last), ITEMS_VERSION);
    const resume = !!this.state && !this.d.tab.landing;
    if (this.d.analytics.testMode) this.badge = testBadge(() => this.d.analytics.inspect());
    if (!this.webgl) this.telemetry({ name: 'webgl_unavailable', message: '', frame: '' });
    if (resume && this.d.lock.held) this.show('play');
    else if (resume) this.show('frozen');
    else this.show('start');
    return { resumed: resume && this.d.lock.held };
  }

  /** Discard a saved game that crashes on resume (ENG11), keeping the test flag. */
  discardSave() {
    this.d.local.remove(KEYS.save);
    this.state = null;
  }

  guard(fn: () => void) {
    try {
      fn();
    } catch (err) {
      this.fail(err);
    }
  }

  fail(err: unknown) {
    const report = toReport(err);
    this.telemetry(report);
    this.errorReport = report;
    try {
      this.show('error');
    } catch {
      this.d.root.textContent = 'Something broke. Reload the page.';
    }
  }

  telemetry(r: ErrorReport) {
    // every report passes here; strip URLs and query strings whatever its source
    if (takeErrorBudget(this.d.session)) this.d.analytics.track(EVENTS.clientError, { ...r, message: stripMessage(r.message) });
  }

  private id(): string {
    return this.d.newId?.() ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 18);
  }

  dispatch(action: Action) {
    this.guard(() => {
      const prev = this.state;
      const { state, effects } = reduce(prev, action, ANSWER_KEYS);
      if (state === prev && effects.length === 0) return;
      if (!this.persist(prev, state, effects, action.type === 'start')) return;
      this.state = state;
      this.afterAction(action, prev);
    });
  }

  /** Save first, then send: an event is marked sent before the provider call (R3). */
  private persist(prev: GameState | null, next: GameState | null, effects: Effect[], isStart: boolean): boolean {
    for (const e of effects) {
      if (e.type === 'save' && next) {
        if (!this.d.lock.held) {
          this.show('frozen');
          return false;
        }
        if (!this.d.lock.supported && !isStart && prev) {
          // Without Web Locks: refuse to write over a newer save from another tab (ENG30).
          const stored = parseSave(this.d.local.get(KEYS.save), ITEMS_VERSION, ITEM_IDS);
          if (stored && (stored.game_id !== prev.game_id || stored.rev !== prev.rev)) {
            this.show('frozen');
            return false;
          }
        }
        this.d.local.set(KEYS.save, serialize(next));
      } else if (e.type === 'snapshot') {
        this.d.local.set(KEYS.last, serialize(e.snapshot));
        this.snapshot = { snapshot: e.snapshot, current: true };
      } else if (e.type === 'track') {
        this.d.analytics.track(e.name, e.props);
      }
    }
    return true;
  }

  private afterAction(action: Action, prev: GameState | null) {
    const s = this.state;
    if (!s) return;
    switch (action.type) {
      case 'start':
        this.show('play');
        break;
      case 'confirm':
      case 'skip':
      case 'next':
        if (!prev || prev.round !== s.round || prev.step !== s.step || prev.phase !== s.phase || prev.finished !== s.finished) {
          this.show('play');
        }
        break;
      default:
        break;
    }
  }

  // ----- user intents -----

  async startGame() {
    if (!(await this.d.lock.acquire(true))) return;
    this.dispatch({ type: 'start', gameId: this.id(), src: this.d.tab.src, itemsVersion: ITEMS_VERSION });
  }

  async continueGame() {
    if (!(await this.d.lock.acquire(true))) return;
    this.guard(() => {
      this.state = parseSave(this.d.local.get(KEYS.save), ITEMS_VERSION, ITEM_IDS);
      this.show(this.state && !this.state.finished ? 'play' : 'start');
    });
  }

  newGame() {
    void this.startGame();
  }

  // ----- rendering -----

  show(view: View) {
    this.view = view;
    const root = this.d.root;
    clear(root);
    this.roundView = null;
    let screen: HTMLElement;
    let focusTarget: HTMLElement | null = null;

    if (view === 'error') {
      const saved = !!this.state && this.d.local.persistent;
      screen = errorScreen(this.errorReport ?? { name: 'Error', message: '', frame: '' }, saved, () => {
        this.discardSave();
        this.newGame();
      });
    } else if (view === 'frozen') {
      screen = frozenScreen(() => {
        void this.d.lock.acquire(true).then((ok) => {
          if (ok) void this.continueGame();
        });
      });
    } else if (view === 'start') {
      screen = this.renderStart();
    } else if (view === 'review') {
      screen = this.renderReview();
    } else {
      const r = this.renderPlay();
      screen = r.screen;
      focusTarget = r.focus;
    }
    root.append(screen);
    if (this.badge) root.append(this.badge);
    if (focusTarget) focus(focusTarget);
  }

  private renderStart(): HTMLElement {
    let mode: StartMode = { kind: 'new' };
    if (this.state && !this.state.finished) mode = { kind: 'continue', round: this.state.round + 1 };
    else if (this.snapshot) mode = { kind: 'finished', total: this.snapshot.snapshot.total, canReview: this.snapshot.current };

    if (this.webgl) prefetchMap();
    const first = ITEMS[0];
    if (!this.startReady && first) {
      // Preload round 1's photo; Start waits for it at most 4 s (DS9, DS23).
      const img = new Image();
      const ready = () => {
        if (this.startReady) return;
        this.startReady = true;
        if (this.view === 'start') this.guard(() => this.show('start'));
      };
      img.onload = ready;
      img.onerror = ready;
      setTimeout(ready, START_IMAGE_WAIT_MS);
      img.src = imageUrl(first.id);
    }
    return startScreen({
      sample: SAMPLE,
      mode,
      ready: this.startReady,
      webgl: this.webgl,
      onStart: () => void this.startGame(),
      onContinue: () => void this.continueGame(),
      onNew: () => void this.startGame(),
      onReview: () => this.guard(() => this.show('review')),
      onAbout: (opener) => aboutPrivacy(opener),
    });
  }

  private renderReview(): HTMLElement {
    const snap = this.snapshot;
    return endScreen({
      items: ITEMS,
      results: snap?.current ? snap.snapshot.results : null,
      total: snap?.snapshot.total ?? 0,
      detailed: !!snap?.current,
      askMostFun: false,
      onMostFun: () => {},
      onCopied: (method) => this.d.analytics.track(EVENTS.resultCopied, { src: this.d.tab.src, total: snap?.snapshot.total ?? 0, method }),
      onReplay: () => this.newGame(),
    });
  }

  private ensureMap(): GameMap | null {
    if (!this.webgl) return null;
    this.map ??= GameMap.create({
      onPin: (p: LatLng) => this.roundView?.pinPlaced(p, ''),
      onState: (s: MapState) => {
        if (s === 'ready' || s === 'fallback') this.mapEverReady = true;
        if (s === 'failed' && !this.mapEverReady) {
          this.errorReport = { name: 'map_chunk_failed', message: '', frame: '' };
          this.guard(() => this.show('error'));
          return;
        }
        this.roundView?.refresh();
      },
      onError: (name, message) => this.telemetry({ name, message, frame: '' }),
    });
    return this.map;
  }

  private renderPlay(): { screen: HTMLElement; focus: HTMLElement | null } {
    const s = this.state;
    if (!s) return { screen: this.renderStart(), focus: null };
    const total = totalPoints(s);
    const onMenu = (opener: HTMLElement) =>
      openMenu(opener, { items: ITEMS, sample: SAMPLE, inGame: !s.finished, onNewGame: () => this.newGame() });

    if (s.finished) {
      const asked = s.sent.includes(ledgerKey(s.game_id, EVENTS.feedback, 'most_fun'));
      return {
        screen: endScreen({
          items: ITEMS,
          results: s.results,
          total,
          detailed: true,
          askMostFun: !asked,
          onMostFun: (a) => this.dispatch({ type: 'pulse', q: 'most_fun', a }),
          onCopied: (method) => this.dispatch({ type: 'copied', method, total }),
          onReplay: () => this.newGame(),
        }),
        focus: null,
      };
    }

    const item = ITEMS[s.round];
    if (!item) throw new Error('round out of range');
    if (this.photoRound !== s.round || !this.photo) {
      this.photo = new PhotoRegion(item, () => this.dispatch({ type: 'skip', round: s.round }));
      this.photoRound = s.round;
    }

    if (s.phase === 'reveal') {
      const result = s.results[s.round];
      if (!result) throw new Error('reveal without a result');
      const next = ITEMS[s.round + 1];
      if (next) new Image().src = imageUrl(next.id); // preload the next round's photo (R2)
      const pulse = s.round === 2 && !s.sent.includes(ledgerKey(s.game_id, EVENTS.feedback, 'difficulty'));
      const view = revealScreen({
        item,
        round: s.round,
        total,
        isLast: s.round === ITEMS.length - 1,
        answers: s.answers[s.round] ?? { kept: null, made: null, when: null },
        result,
        map: this.ensureMap(),
        pulse,
        onPulse: (a) => this.dispatch({ type: 'pulse', q: 'difficulty' as FeedbackQ, a }),
        onNext: () => this.dispatch({ type: 'next', round: s.round }),
        onMenu,
      });
      const round = s.round;
      setTimeout(() => {
        if (this.state?.round === round && this.state.phase === 'reveal' && document.activeElement === document.body) focus(view.score);
      }, 1200);
      return { screen: view.element, focus: view.score };
    }

    const view = roundScreen({
      item,
      round: s.round,
      step: s.step,
      total,
      keptPin: s.answers[s.round]?.kept ?? null,
      showHint: s.round === 0,
      photo: this.photo,
      map: s.step === 'when' ? this.map : this.ensureMap(),
      webgl: this.webgl,
      onConfirm: (value) => this.dispatch({ type: 'confirm', round: s.round, step: s.step, value }),
      onMenu,
    });
    this.roundView = view;
    return { screen: view.element, focus: view.prompt };
  }
}
