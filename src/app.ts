// The app controller: runs the pure reducer, persists state, sends events,
// and renders screens. Every game-code entry point goes through `guard`, so
// a bug shows the recovery screen instead of a blank page (E8, ENG11).

import type { Analytics } from './analytics/core.ts';
import { EVENTS, STEPS, type FeedbackQ } from './analytics/events.ts';
import { ANSWER_KEYS, DECK_ITEMS, ITEMS_VERSION, ITEM_IDS, POOL, SAMPLE, deckItems, imageUrl, itemById } from './content/items.ts';
import { drawDeck, seededRng } from './deck/planner.ts';
import { stripMessage, takeErrorBudget, toReport, type ErrorReport } from './errors/boundary.ts';
import { newGameId } from './game/ids.ts';
import type { WriterLock } from './game/lock.ts';
import { SeenLists } from './game/seen.ts';
import type { TabSession } from './game/session.ts';
import { GameMap, hasWebGL2, prefetchMap, type MapState } from './map/map.ts';
import type { LatLng } from './scoring/geo.ts';
import { ledgerKey, reduce, totalPoints, type Action, type Deck, type Effect } from './state/reducer.ts';
import { KEYS, parseSave, parseSnapshot, serialize, type GameState, type ParsedSnapshot } from './state/schema.ts';
import type { KV } from './storage/guarded.ts';
import { clear, focus } from './ui/dom.ts';
import { endScreen } from './ui/screens/end.ts';
import { errorScreen, frozenScreen, openMenu, aboutPrivacy, testBadge } from './ui/screens/misc.ts';
import { revealScreen } from './ui/screens/reveal.ts';
import { PhotoRegion, roundScreen, type RoundView } from './ui/screens/round.ts';
import { startScreen, type StartMode } from './ui/screens/start.ts';
import { startTour } from './ui/tour.ts';

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

/** A drawn deck, and whether committing it restarts the seen list (it had to reuse seen objects). */
type PendingDeck = Deck & { restart: boolean };

/** The ids a game has shown so far: every round up to the current one. */
const shownIds = (s: GameState) => s.item_ids.slice(0, s.finished ? s.item_ids.length : s.round + 1);

export class App {
  state: GameState | null = null;
  snapshot: ParsedSnapshot | null = null;
  view: View = 'start';
  private map: GameMap | null = null;
  private mapEverReady = false;
  private photo: PhotoRegion | null = null;
  /** `${game_id}:${item id}` of the photo region on screen (V1-11). */
  private photoKey = '';
  private roundView: RoundView | null = null;
  private startReady = false;
  private readonly webgl: boolean;
  private errorReport: ErrorReport | null = null;
  private badge: HTMLElement | null = null;
  private tourOpen = false;
  private readonly seenLists: SeenLists;
  /** The deck the start screen preloads and Start commits (V1-10); cleared whenever the seen lists change. */
  private pending: PendingDeck | null = null;

  constructor(private d: AppDeps) {
    this.webgl = hasWebGL2();
    this.seenLists = new SeenLists(d.local, new Set(ITEM_IDS), () => crypto.getRandomValues(new Uint32Array(1))[0] as number);
    d.lock.onLost(() => this.guard(() => this.show('frozen')));
  }

  /** Decide the first screen (DS8, DS24): same-tab reload resumes silently; a later visit sees Continue. */
  boot(): { resumed: boolean } {
    this.state = parseSave(this.d.local.get(KEYS.save), POOL);
    if (this.state?.finished) this.state = null;
    this.snapshot = parseSnapshot(this.d.local.get(KEYS.last), POOL);
    // Repair the seen lists from the save, the commit point (V1-07).
    if (this.state) this.seenLists.add(shownIds(this.state));
    if (this.snapshot) this.seenLists.add(this.snapshot.snapshot.item_ids);
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
    return this.d.newId?.() ?? newGameId();
  }

  /**
   * The next random deck, drawn from the pool and the seen lists (V1-09).
   * The same lists always give the same deck, so the deck the start screen
   * preloads is the deck Start commits.
   */
  private pendingDeck(): PendingDeck {
    if (this.pending) return this.pending;
    const s = this.seenLists.seen();
    const ever = this.seenLists.ever();
    const draw = drawDeck(DECK_ITEMS, new Set(s.ids), seededRng((s.seed + Math.imul(s.epoch, 0x9e3779b1)) >>> 0));
    this.pending = {
      ids: draw.ids,
      kind: 'random',
      hash: POOL.deckHash(draw.ids) ?? ITEMS_VERSION,
      firstSeen: draw.ids.map((id) => !ever.has(id)),
      challenge: null,
      restart: !draw.fresh,
    };
    return this.pending;
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
          const stored = parseSave(this.d.local.get(KEYS.save), POOL);
          if (stored && (stored.game_id !== prev.game_id || stored.rev !== prev.rev)) {
            this.show('frozen');
            return false;
          }
        }
        this.d.local.set(KEYS.save, serialize(next));
        this.seenLists.add(shownIds(next));
        this.pending = null;
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
      case 'back':
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
    this.guard(() => {
      // Re-draw under the lock: another tab may have shown some of the offered objects (V1-10).
      const offered = this.pending;
      this.pending = null;
      const deck = this.pendingDeck();
      const first = itemById(deck.ids[0] ?? '');
      if (first && offered?.ids[0] !== deck.ids[0]) new Image().src = imageUrl(first.id);
      if (deck.restart) this.seenLists.restart(deck.ids);
      const committed: Deck = { ids: deck.ids, kind: deck.kind, hash: deck.hash, firstSeen: deck.firstSeen, challenge: deck.challenge };
      this.dispatch({ type: 'start', gameId: this.id(), src: this.d.tab.src, itemsVersion: ITEMS_VERSION, deck: committed });
    });
  }

  async continueGame() {
    if (!(await this.d.lock.acquire(true))) return;
    this.guard(() => {
      this.state = parseSave(this.d.local.get(KEYS.save), POOL);
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
    if (view === 'play') requestAnimationFrame(() => this.guard(() => this.maybeTour()));
  }

  /** The first-visit tour (DS34): once per browser, on round 1's first question; not for a player who has finished a game. */
  private maybeTour() {
    const s = this.state;
    if (this.view !== 'play' || this.tourOpen || !s || s.finished || s.phase !== 'answering' || s.round !== 0 || s.step !== STEPS[0]) return;
    if (this.d.local.get(KEYS.tour) != null || this.snapshot) return;
    this.openTour(false);
  }

  openTour(replay: boolean) {
    if (this.tourOpen) return;
    this.tourOpen = true;
    startTour({
      onEnd: (outcome, step) => {
        this.tourOpen = false;
        this.d.local.set(KEYS.tour, outcome);
        this.d.analytics.track(EVENTS.tourEnded, { src: this.d.tab.src, outcome, step, replay });
      },
    });
  }

  private renderStart(): HTMLElement {
    let mode: StartMode = { kind: 'new' };
    if (this.state && !this.state.finished) mode = { kind: 'continue', round: this.state.round + 1 };
    else if (this.snapshot) mode = { kind: 'finished', total: this.snapshot.snapshot.total, canReview: this.snapshot.current };

    if (this.webgl) prefetchMap();
    const first = itemById(this.pendingDeck().ids[0] ?? '');
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
      items: snap?.current ? deckItems(snap.snapshot.item_ids) : [],
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
    const items = deckItems(s.item_ids);
    const onMenu = (opener: HTMLElement) =>
      openMenu(opener, {
        items,
        sample: SAMPLE,
        inGame: !s.finished,
        onNewGame: () => this.newGame(),
        onTour: !s.finished && s.phase === 'answering' ? () => this.openTour(true) : undefined,
      });

    if (s.finished) {
      const asked = s.sent.includes(ledgerKey(s.game_id, EVENTS.feedback, 'most_fun'));
      return {
        screen: endScreen({
          items,
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

    const item = items[s.round];
    if (!item) throw new Error('round out of range');
    const photoKey = `${s.game_id}:${item.id}`;
    if (this.photoKey !== photoKey || !this.photo) {
      // A photo belongs to one game and one item; a late callback from an
      // older photo must not skip a round of the game now on screen (V1-11).
      const round = s.round;
      const region: PhotoRegion = new PhotoRegion(item, () => {
        if (this.photo === region) this.dispatch({ type: 'skip', round });
      });
      this.photo = region;
      this.photoKey = photoKey;
    }

    if (s.phase === 'reveal') {
      const result = s.results[s.round];
      if (!result) throw new Error('reveal without a result');
      const next = items[s.round + 1];
      if (next) new Image().src = imageUrl(next.id); // preload the next round's photo (R2)
      const pulse = s.round === 2 && !s.sent.includes(ledgerKey(s.game_id, EVENTS.feedback, 'difficulty'));
      const view = revealScreen({
        item,
        round: s.round,
        total,
        isLast: s.round === s.item_ids.length - 1,
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
      answer: s.answers[s.round]?.[s.step] ?? null,
      madePin: s.answers[s.round]?.made ?? null,
      photo: this.photo,
      map: s.step === 'when' ? this.map : this.ensureMap(),
      webgl: this.webgl,
      onConfirm: (value) => this.dispatch({ type: 'confirm', round: s.round, step: s.step, value }),
      onBack: STEPS.indexOf(s.step) > 0 ? () => this.dispatch({ type: 'back', round: s.round, step: s.step }) : undefined,
      onMenu,
    });
    this.roundView = view;
    return { screen: view.element, focus: view.prompt };
  }
}
