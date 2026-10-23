// The app controller: runs the pure reducer, persists state, sends events,
// and renders screens. Every game-code entry point goes through `guard`, so
// a bug shows the recovery screen instead of a blank page (E8, ENG11).

import type { Analytics } from './analytics/core.ts';
import { EVENTS, STEPS, type FeedbackQ } from './analytics/events.ts';
import { weekActive } from './analytics/week-active.ts';
import { ANSWER_KEYS, DECK_ITEMS, ITEMS_VERSION, ITEM_IDS, POOL, SAMPLE, deckItems, hasItem, imageUrl, itemsLoaded, loadItems } from './content/items.ts';
import { challengeUrl, parseChallenge, scoreToBeat, type ChallengeLink, type ParsedChallenge, type ShareKind } from './challenge/link.ts';
import type { BoardEnv, CardProps } from './board/board.ts';
import type { Shown } from './board/session.ts';
import { startLine } from './board/standing-line.ts';
import { BOARD_UI, SITE_URL } from './config.ts';
import { formatNumber, t } from './copy.ts';
import { drawDeck, seededRng } from './deck/planner.ts';
import { stripMessage, takeErrorBudget, toReport, type ErrorReport } from './errors/boundary.ts';
import { newGameId } from './game/ids.ts';
import { ClockRunner } from './game/clock-runner.ts';
import { DraftQueue, type PendingDraft } from './game/drafts.ts';
import type { WriterLock } from './game/lock.ts';
import { hardNailedCount } from './game/hard.ts';
import { isListed, nameList } from './game/names.ts';
import { collectionLine, resultLine, shareHook, shareText } from './game/text.ts';
import { SeenLists } from './game/seen.ts';
import type { TabSession } from './game/session.ts';
import { testSurface, type TestSurface } from './game/test-surface.ts';
import { testGuess } from './game/testplay.ts';
import { DEFAULT_TIMER, type ClockToken, type Draft, type LiveRound } from './game/timer.ts';
import { GameMap, hasWebGL2, prefetchMap, type MapState } from './map/map.ts';
import type { LatLng } from './scoring/geo.ts';
import { expiredUnseen, ledgerKey, reduce, roundClock, seenBucket, totalPoints, type Action, type Deck, type Effect, type ShareMethod, type StartContext } from './state/reducer.ts';
import { KEYS, isNewerRecord, parseSave, parseSnapshot, serialize, type GameState, type ParsedSnapshot, type RoundResult } from './state/schema.ts';
import type { KV } from './storage/guarded.ts';
import { announce, currentClockFace, renderClockFace, timerCopy } from './ui/clock.ts';
import { clear, focus, reducedMotion } from './ui/dom.ts';
import { testBadge } from './ui/badge.ts';
import { CHUNKS, loaded, preload, whenIdle, withModule, type Lazy } from './ui/lazy.ts';
import { overlayGeneration } from './ui/overlay.ts';
import type { EndProps } from './ui/screens/end.ts';
import { errorScreen, frozenScreen } from './ui/screens/error.ts';
import type { RevealProps } from './ui/screens/reveal.ts';
import { PhotoRegion, roundScreen, type RoundView } from './ui/screens/round.ts';
import { startScreen, type StartMode } from './ui/screens/start.ts';
import type { ShareSetup } from './ui/share.ts';
import { presentTimeUp } from './ui/timeup.ts';

export type View = 'start' | 'play' | 'review' | 'error' | 'frozen';

export interface AppDeps {
  root: HTMLElement;
  analytics: Analytics;
  local: KV;
  session: KV;
  lock: WriterLock;
  tab: TabSession;
  /** The landing URL's query, read once for a challenge link (V1-16). */
  params?: URLSearchParams;
  newId?: () => string;
  /** Development only (`?clock=off`): untimed rounds; always false in production builds (M4). */
  devClockOff?: boolean;
  /** Test mode only: publish the one test surface (window.__mgTest, M4). */
  exposeTest?: (surface: TestSurface) => void;
}

const START_IMAGE_WAIT_MS = 4000;

type Menu = NonNullable<typeof CHUNKS.menu.module>;
type Board = NonNullable<typeof CHUNKS.board.module>;

// The reveal and end screens are lazy chunks; show() loads a screen's chunk before drawing it (V1-02).
const revealScreen = (p: RevealProps) => loaded(CHUNKS.reveal).revealScreen(p);
const endScreen = (p: EndProps) => loaded(CHUNKS.end).endScreen(p);

/** A drawn deck, and whether committing it restarts the seen list (it had to reuse seen objects). */
type PendingDeck = Deck & { restart: boolean };

/** The ids a game has shown so far: every round up to the current one. */
const shownIds = (s: GameState) => s.item_ids.slice(0, s.finished ? s.item_ids.length : s.round + 1);

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** A challenge kept in sessionStorage, re-checked against the live pool on read. */
function readChallenge(kv: KV, key: string): ParsedChallenge | null {
  try {
    const v = JSON.parse(kv.get(key) ?? 'null') as ParsedChallenge | null;
    if (v?.kind === 'broken') return v;
    if (v?.kind === 'ok' && Array.isArray(v.link?.ids) && v.link.ids.every(hasItem)) return v;
  } catch {
    // a damaged entry is no challenge
  }
  return null;
}

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
  /** The item whose round-1 photo the start screen has preloaded (or waited 4 s for). */
  private readyFor = '';
  private preloading = '';
  private readonly webgl: boolean;
  private errorReport: ErrorReport | null = null;
  private badge: HTMLElement | null = null;
  private tourOpen = false;
  private readonly seenLists: SeenLists;
  /** The deck the start screen preloads and Start commits (V1-10); cleared whenever the seen lists change. */
  private pending: PendingDeck | null = null;
  /** A challenge link opened in this tab and not yet played (V1-16). */
  private challenge: ParsedChallenge | null = null;
  /** A challenge set aside with "Continue my game" (V1-17). */
  private waiting: ChallengeLink | null = null;
  /** Checked friend names: the name, or null when it matched the word list (V1-20). */
  private checkedNames = new Map<string, string | null>();
  /** The open tour was replayed from the menu (it does not pause the clock, D4). */
  private tourReplay = false;
  /** Test mode's "Pause clock" (M4). */
  private testPause = false;
  /** The round whose view opened in this page, and when (monotonic ms): ready_ms (ENG9). */
  private opened: { key: string; at: number } | null = null;
  private readonly runner: ClockRunner;
  private readonly drafts: DraftQueue;
  /** The last server week this page learned; a game freezes it when its round-ten reveal opens (V12-108). */
  private serverWeek: string | null = null;
  /** The game whose round-ten week context this page asked for. */
  private weekAsked = '';

  constructor(private d: AppDeps) {
    this.webgl = hasWebGL2();
    this.seenLists = new SeenLists(d.local, new Set(ITEM_IDS), () => crypto.getRandomValues(new Uint32Array(1))[0] as number);
    d.lock.onLost(() => this.guard(() => this.show('frozen')));
    this.runner = new ClockRunner({
      now: () => Date.now(),
      mono: () => performance.now(),
      hidden: () => document.visibilityState === 'hidden',
      reducedMotion,
      state: () => this.state,
      live: () => this.liveRound(),
      writable: () => this.d.lock.held && this.view !== 'frozen',
      readyMs: () => (this.opened ? performance.now() - this.opened.at : 0),
      config: () => DEFAULT_TIMER,
      untimed: () => this.d.devClockOff === true,
      dispatch: (a) => this.dispatch(a),
      flushDraft: () => this.drafts.flush(),
      face: renderClockFace,
      announce: (kind) => announce(kind === 'warning' ? timerCopy(0).warning : timerCopy(0).timeUp),
      expired: (info) => this.timeUp(info),
      setInterval: (fn, ms) => setInterval(() => this.guard(fn), ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    });
    this.drafts = new DraftQueue((draft) => this.saveDraft(draft), {
      set: (fn, ms) => setTimeout(() => this.guard(fn), ms),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
    // The full item records load while the start screen shows; Start waits for them (V1-02).
    this.records();
  }

  /** Load the item records; the waiting screen re-renders once they arrive, and a failed load shows the error screen. */
  private records(then?: () => void) {
    void loadItems().then(
      () =>
        this.guard(() => {
          if (then) then();
          else if (this.view === 'start') this.show('start');
        }),
      (err: unknown) => this.fail(err),
    );
  }

  /** Decide the first screen (DS8, DS24): same-tab reload resumes silently; a later visit sees Continue. */
  boot(): { resumed: boolean } {
    this.state = parseSave(this.d.local.get(KEYS.save), POOL);
    if (this.state?.finished) this.state = null;
    // A deadline that passed while the page was closed is applied before anything else (ENG7, R1).
    this.expireOnLoad();
    this.snapshot = parseSnapshot(this.d.local.get(KEYS.last), POOL);
    // Repair the seen lists from the save, the commit point (V1-07).
    if (this.state) this.seenLists.add(shownIds(this.state));
    if (this.snapshot) this.seenLists.add(this.snapshot.snapshot.item_ids);
    const linked = this.d.params ? parseChallenge(this.d.params, hasItem) : { kind: 'none' as const };
    if (linked.kind !== 'none') this.d.session.set(KEYS.challenge, JSON.stringify(linked));
    this.challenge = readChallenge(this.d.session, KEYS.challenge);
    const waiting = readChallenge(this.d.session, KEYS.waiting);
    this.waiting = waiting?.kind === 'ok' ? waiting.link : null;
    for (const c of [this.challenge?.kind === 'ok' ? this.challenge.link : null, this.waiting]) if (c?.name) this.checkName(c.name);
    // A challenge link just opened shows its screen, even over a game this tab could resume.
    // A round with time left reopens directly, even on a later visit, so no hidden seconds
    // are lost; a round whose time ran out while away lands on Start (R1).
    const s = this.state;
    const timeLeft = !!s && !s.finished && this.timedRound(s);
    const resume = !!s && linked.kind === 'none' && !expiredUnseen(s) && (!this.d.tab.landing || timeLeft);
    if (this.d.analytics.testMode) {
      const surface = this.testSurface();
      this.badge = testBadge(() => this.d.analytics.inspect(), surface);
      this.d.exposeTest?.(surface);
    }
    if (!this.webgl) this.telemetry({ name: 'webgl_unavailable', message: '', frame: '' });
    if (resume && this.d.lock.held) this.show('play');
    else if (resume) this.show('frozen');
    else this.show('start');
    // pending board submissions retry on load, in the background (V12-113)
    if (BOARD_UI && (this.d.local.get(KEYS.board) ?? '').includes('"pending"')) whenIdle(() => this.board((m) => void m.resume(this.boardEnv())));
    return { resumed: resume && this.d.lock.held };
  }

  /** Discard a saved game that crashes on resume (ENG11), keeping the test flag; a newer page version's save stays (N10). */
  discardSave() {
    if (!isNewerRecord(this.d.local.get(KEYS.save))) this.d.local.remove(KEYS.save);
    this.state = null;
  }

  // ----- the round clock (W3): src/game/timer.ts decides, src/game/clock-runner.ts runs it -----

  /** The current round has a started, timed clock (with time left, or paused). */
  private timedRound(s: GameState): boolean {
    const c = roundClock(s);
    return !!c && !c.stopped && c.limit_ms !== null;
  }

  /** On load or takeover, an expired deadline is applied first, as an away expiry (R1). */
  private expireOnLoad() {
    const s = this.state;
    if (s && !s.finished && roundClock(s) && this.d.lock.held) this.dispatch({ type: 'expire', gameId: s.game_id, round: s.round, now: Date.now(), away: true });
  }

  /** The live page, from which the pause causes are derived on every check (N8). */
  private liveRound(): LiveRound | null {
    const s = this.state;
    const step = s?.step ?? STEPS[0];
    const base = { autoTour: false, step, mapState: null, photoReady: false, testPause: this.testPause };
    if (this.view === 'error') return { ...base, view: 'error' };
    if (this.view !== 'play' || !s || s.phase !== 'answering' || !this.roundView) return this.testPause ? { ...base, view: 'other' } : null;
    return {
      ...base,
      view: 'round',
      autoTour: this.tourOpen && !this.tourReplay,
      mapState: step === 'when' ? null : (this.map?.state ?? null),
      photoReady: this.photo?.ready ?? false,
    };
  }

  /** Re-check the clock: on focus, pageshow and visibility changes (ENG7), and after state changes. */
  clockEvent(kind: 'visible' | 'hidden' | 'pageshow' | 'focus' | 'pagehide') {
    this.guard(() => {
      if (kind === 'hidden' || kind === 'pagehide') this.drafts.flush();
      if (kind !== 'pagehide') this.runner.check();
      if (kind === 'visible' || kind === 'pageshow') this.revealOpened();
    });
  }

  /** Save an edit of the active question (throttled), including empty and invalid ones (ENG7). */
  private saveDraft(d: PendingDraft) {
    const s = this.state;
    if (!s || s.game_id !== d.gameId || s.round !== d.round || s.step !== d.step || s.phase !== 'answering') return;
    this.dispatch({ type: 'draft', round: d.round, step: d.step, value: d.value, now: d.at });
  }

  private queueDraft(value: Draft) {
    const s = this.state;
    if (s) this.drafts.push({ gameId: s.game_id, round: s.round, step: s.step, value, at: Date.now() });
  }

  /** The photo changed state: the clock may start, or stop for good when the photo fails (N9). */
  private photoChanged(region: PhotoRegion) {
    if (this.photo !== region) return;
    const s = this.state;
    const c = s ? roundClock(s) : null;
    if (s && c && !c.stopped && region.isFailed) this.dispatch({ type: 'clockStop', round: s.round, now: Date.now() });
    this.runner.check();
  }

  /**
   * Time is up (D2). The expiry is already saved; now the transition: freeze
   * the controls, close overlays, hold "Time's up", then open the reveal. On
   * any other screen the expiry waits for Continue.
   */
  private timeUp({ away, token }: { away: boolean; token: ClockToken }) {
    const ours = () => this.state?.game_id === token.gameId && this.state.round === token.round && this.state.phase === 'reveal';
    if (this.view !== 'play') {
      this.runner.release(token);
      if (this.view === 'start') this.show('start');
      return;
    }
    void presentTimeUp({
      freeze: this.roundView ? () => this.roundView?.freeze() : null,
      away,
      reducedMotion: reducedMotion(),
      showCue: () => renderClockFace({ ...currentClockFace(), mode: 'timeup', remaining: 0, warning: true }),
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      reveal: () =>
        this.guard(() => {
          this.runner.release(token);
          if (ours() && this.view === 'play') this.show('play');
        }),
    });
  }

  /** The reveal on screen visibly opened: record it once (N5); a hidden tab waits until it is visible. */
  private revealOpened() {
    const s = this.state;
    if (!s || s.finished || s.phase !== 'reveal' || this.view !== 'play' || !CHUNKS.reveal.module) return;
    // a reveal rendered in a hidden tab counts once the tab is visible again (clockEvent)
    if (document.visibilityState === 'hidden') return;
    this.dispatch({ type: 'revealShown', gameId: s.game_id, round: s.round, now: Date.now(), boardWeek: this.serverWeek });
  }

  /** The first time-up reveal on this device shows a one-time tip; the same reveal keeps it after a reload (V12-63). */
  private timeUpTip(s: GameState): boolean {
    if (!s.timed_out[s.round]) return false;
    const key = `${s.game_id}:${s.round}`;
    const shown = this.d.local.get(KEYS.timeUpTip);
    if (shown === null) this.d.local.set(KEYS.timeUpTip, key);
    return shown === null || shown === key;
  }

  /** The device's first game completed this week sends week_active once (ENG6). */
  private weekCompleted(at: number, src: string) {
    const r = weekActive(this.d.local.get(KEYS.weekActive), at);
    if (!r.send) return;
    this.d.local.set(KEYS.weekActive, r.marker);
    this.d.analytics.track(EVENTS.weekActive, { src, week: r.week, active_last_week: r.active_last_week });
  }

  private testSurface(): TestSurface {
    return testSurface({
      state: () => this.state,
      dispatch: (a) => this.dispatch(a),
      check: () => this.runner.check(),
      paused: () => this.testPause,
      setPaused: (on) => {
        this.testPause = on;
      },
      finish: () => this.finishForTest(),
      now: () => Date.now(),
    });
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
      countryCapMissed: draw.countryCapMissed,
      restart: !draw.fresh,
    };
    return this.pending;
  }

  /** Check a friend's name against the public word list, which loads on first use (V1-20). */
  private checkName(name: string) {
    if (this.checkedNames.has(name)) return;
    void nameList()
      .then((list) => this.checkedNames.set(name, isListed(name, list) ? null : name))
      .catch(() => this.checkedNames.set(name, null))
      .then(() => {
        if (this.view === 'start' || (this.view === 'play' && this.state?.finished)) this.guard(() => this.show(this.view));
      });
  }

  /** A friend's name as the page shows it: undefined while it is being checked. */
  private shownName(name: string | null): string | null | undefined {
    if (name === null) return null;
    return this.checkedNames.has(name) ? (this.checkedNames.get(name) ?? null) : undefined;
  }

  /** The friend's score, unless the deck's answers or the rules changed since the link was made (V1-16, ENG11). */
  private comparableScore(link: ChallengeLink): number | null {
    return scoreToBeat(link, POOL.deckHash(link.ids)).score;
  }

  private challengeDeck(link: ChallengeLink): Deck {
    const ever = this.seenLists.ever();
    return {
      ids: [...link.ids],
      kind: 'challenge',
      hash: POOL.deckHash(link.ids) ?? ITEMS_VERSION,
      firstSeen: link.ids.map((id) => !ever.has(id)),
      challenge: { score: this.comparableScore(link), name: this.shownName(link.name) ?? null },
    };
  }

  /** The share block for a finished deck; shares go through `onShared`. */
  private shareSetup(game: { item_ids: string[]; deck_hash: string; total: number; results: readonly (RoundResult | null)[]; replay: boolean; kind: ShareKind }, onShared: (method: ShareMethod) => void): ShareSetup {
    const hard = hardNailedCount(deckItems(game.item_ids), game.results);
    return {
      kind: game.kind,
      storedName: this.d.local.get(KEYS.name),
      onName: (name) => (name ? this.d.local.set(KEYS.name, name) : this.d.local.remove(KEYS.name)),
      link: (medium, name) => {
        const url = challengeUrl(SITE_URL, { ids: game.item_ids, score: game.total, name, hash: game.deck_hash }, medium, game.kind);
        const p = { total: game.total, url, replay: game.replay, kind: game.kind, hard };
        return { url, hook: shareHook(p), text: shareText(p) };
      },
      onShared,
    };
  }

  /** "You have seen N of M objects", or null when this device keeps no list (V1-15). */
  private collection(): { seen: number; total: number } | null {
    return this.d.local.persistent ? { seen: this.seenLists.ever().size, total: ITEM_IDS.length } : null;
  }

  dispatch(action: Action) {
    this.guard(() => {
      const prev = this.state;
      const { state, effects } = reduce(prev, action, ANSWER_KEYS);
      if (state === prev && effects.length === 0) return;
      if (!this.persist(prev, state, effects, action.type === 'start')) return;
      this.state = state;
      // A late Confirm, Back or draft lost to the deadline: present the expiry, not the action (ENG7).
      if (action.type !== 'expire' && prev && state && prev.phase === 'answering' && state.round === prev.round && state.timed_out[state.round] && !prev.timed_out[prev.round]) {
        announce(timerCopy(0).timeUp);
        this.timeUp({ away: false, token: this.runner.hold(state.game_id, state.round) });
        return;
      }
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
      } else if (e.type === 'completed') {
        this.weekCompleted(e.at, next?.src ?? this.d.tab.src);
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
      this.dropChallenge();
      // Re-draw under the lock: another tab may have shown some of the offered objects (V1-10).
      const offered = this.pending;
      this.pending = null;
      const deck = this.pendingDeck();
      const first = deck.ids[0];
      if (first && offered?.ids[0] !== first) new Image().src = imageUrl(first);
      if (deck.restart) this.seenLists.restart(deck.ids);
      const committed: Deck = { ids: deck.ids, kind: deck.kind, hash: deck.hash, firstSeen: deck.firstSeen, challenge: deck.challenge, countryCapMissed: deck.countryCapMissed };
      this.begin(committed);
    });
  }

  async continueGame() {
    if (!(await this.d.lock.acquire(true))) return;
    this.guard(() => {
      // a tab that takes over reads the other tab's drafts and clock, and derives its own pause causes (N8)
      this.state = parseSave(this.d.local.get(KEYS.save), POOL);
      this.expireOnLoad();
      this.show(this.state && !this.state.finished ? 'play' : 'start');
    });
  }

  /** Test mode only: finish the game in progress, or a new one, with random answers and show the end screen. */
  async finishForTest() {
    if (!this.state || this.state.finished) await this.startGame();
    this.dispatch({ type: 'testAssist' });
    this.guard(() => {
      const skills = new Map<number, number>();
      for (let i = 0; i < 100 && this.state && !this.state.finished; i++) {
        const s = this.state;
        const key = ANSWER_KEYS.find((k) => k.id === s.item_ids[s.round]);
        if (!key) return;
        if (!skills.has(s.round)) skills.set(s.round, Math.random());
        const action: Action =
          s.phase === 'reveal'
            ? { type: 'next', round: s.round, boardWeek: this.serverWeek }
            : { type: 'confirm', round: s.round, step: s.step, value: testGuess(s.step, key, skills.get(s.round) ?? 1, Math.random) };
        const { state, effects } = reduce(s, action, ANSWER_KEYS);
        if (!this.persist(s, state, effects, false)) return;
        this.state = state;
      }
      if (this.state?.finished) this.show('play');
    });
  }

  newGame() {
    void this.startGame();
  }

  /** Commit a deck: game_start carries the tab's game count and a rough seen count, read before the deck is shown (V1-27). */
  private begin(deck: Deck) {
    const n = Number(this.d.session.get(KEYS.gamesInTab) ?? '0') + 1;
    this.d.session.set(KEYS.gamesInTab, String(n));
    const context: StartContext = { gameInTab: n >= 3 ? '3+' : n === 2 ? '2' : '1', seenBefore: seenBucket(this.seenLists.ever().size) };
    this.dispatch({ type: 'start', gameId: this.id(), src: this.d.tab.src, itemsVersion: ITEMS_VERSION, deck, context, testAssisted: this.d.analytics.testMode });
  }

  private dropChallenge() {
    this.challenge = null;
    this.d.session.remove(KEYS.challenge);
  }

  /** Play a friend's deck (V1-16); with a game in progress, the Start-over dialog asks first (V1-17). */
  playChallenge(opener: HTMLElement | null) {
    const c = this.challenge;
    if (c?.kind !== 'ok') return;
    const go = () =>
      void this.d.lock.acquire(true).then((ok) => {
        if (!ok) return;
        this.guard(() => {
          const deck = this.challengeDeck(c.link);
          this.dropChallenge();
          if (this.waiting && sameIds(this.waiting.ids, c.link.ids)) this.setWaiting(null);
          this.begin(deck);
        });
      });
    if (this.state && !this.state.finished) this.overlay((m) => m.confirmNewGame(opener, go));
    else go();
  }

  /** "Continue my game": keep the challenge for after this game (V1-17). */
  private continueMine() {
    const c = this.challenge;
    if (c?.kind === 'ok') this.setWaiting(c.link);
    this.dropChallenge();
    void this.continueGame();
  }

  private setWaiting(link: ChallengeLink | null) {
    this.waiting = link;
    if (link) this.d.session.set(KEYS.waiting, JSON.stringify({ kind: 'ok', link }));
    else this.d.session.remove(KEYS.waiting);
  }

  /** Play the same deck again; a replay is never fresh (V1-22). */
  replayDeck(ids: readonly string[]) {
    void this.d.lock.acquire(true).then((ok) => {
      if (!ok) return;
      this.guard(() => {
        this.dropChallenge();
        const deck: Deck = { ids: [...ids], kind: 'replay', hash: POOL.deckHash(ids) ?? ITEMS_VERSION, firstSeen: ids.map(() => false), challenge: null };
        this.begin(deck);
      });
    });
  }

  /** Send challenge_opened once per link in this tab session (V1-27). */
  private challengeOpened(c: ParsedChallenge, own: boolean) {
    const key = c.kind === 'ok' ? JSON.stringify(c.link) : 'broken';
    let sent: string[] = [];
    try {
      sent = JSON.parse(this.d.session.get(KEYS.challengeOpened) ?? '[]') as string[];
    } catch {
      sent = [];
    }
    if (sent.includes(key)) return;
    this.d.session.set(KEYS.challengeOpened, JSON.stringify([...sent, key]));
    this.d.analytics.track(EVENTS.challengeOpened, {
      src: this.d.tab.src,
      valid: c.kind === 'ok',
      has_score: c.kind === 'ok' && c.link.score !== null,
      own_deck: own,
    });
  }

  // ----- rendering -----

  show(view: View) {
    this.view = view;
    // Rounds, reveals and the end screen show the item records, a lazy chunk (V1-02).
    if ((view === 'play' || view === 'review') && !itemsLoaded()) {
      void this.screenChunk(view)?.load();
      this.records(() => {
        if (this.view === view) this.show(view);
      });
      return;
    }
    // The reveal and end screens are lazy chunks too; the screen on display stays until its chunk has loaded.
    const chunk = this.screenChunk(view);
    if (chunk && !chunk.module) {
      void chunk.load().then((m) =>
        this.guard(() => {
          if (this.view !== view) return;
          if (!m) throw new Error('chunk load failed');
          this.show(view);
        }),
      );
      return;
    }
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
    if (view === 'play' && this.state?.phase === 'reveal') this.revealOpened();
    if (view === 'play') this.askWeek();
    this.runner.check();
    this.preload(view);
  }

  /** The lazy chunk a view draws with: the end screen for a finished game or a review, the reveal for a round's reveal. */
  private screenChunk(view: View): Lazy<unknown> | null {
    const s = this.state;
    if (view === 'review' || (view === 'play' && s?.finished)) return CHUNKS.end;
    if (view === 'play' && s?.phase === 'reveal') return CHUNKS.reveal;
    return null;
  }

  /** Fetch at idle time the chunks this screen may open next, so they open at once (V1-02). */
  private preload(view: View) {
    if (this.tourDue()) preload(CHUNKS.tour);
    if (view === 'play' || view === 'review') preload(CHUNKS.reveal, CHUNKS.menu, CHUNKS.end);
  }

  /** Open an overlay from the menu chunk; if time runs out or the view changes while the chunk loads, it stays closed (ENG7). */
  private overlay(open: (m: Menu) => void) {
    const gen = overlayGeneration();
    const view = this.view;
    withModule(CHUNKS.menu, (m) =>
      this.guard(() => {
        if (gen === overlayGeneration() && this.view === view) open(m);
      }),
    );
  }

  // ----- the weekly board (W6): its code is a lazy chunk; only the start line is in the main bundle -----

  private boardEnv(): BoardEnv {
    return { kv: this.d.local, src: this.d.tab.src, track: (name, props) => this.d.analytics.track(name, props) };
  }

  private board(use: (m: Board) => void) {
    withModule(CHUNKS.board, (m) => this.guard(() => use(m)));
  }

  /** "See the board" and the start screen's link: a deliberate open (G4). */
  private openBoard(opener: HTMLElement) {
    this.board((m) => m.openBoard(opener, this.boardEnv()));
  }

  /** The end card for a finished game, when the board is built in (G2). */
  private boardCard(shown: Shown): CardProps | null {
    return BOARD_UI ? { shown, env: this.boardEnv(), onView: (opener) => this.openBoard(opener) } : null;
  }

  /**
   * When round ten opens, ask the server's week once, anonymously and without
   * blocking play; skipped when the switch is off. The reveal freezes the last
   * week learned; a later answer cannot change a finished game (V12-108).
   */
  private askWeek() {
    const s = this.state;
    if (!BOARD_UI || !s || s.finished || s.finished_at !== null || s.round !== s.item_ids.length - 1) return;
    if (this.weekAsked === s.game_id || this.d.local.get(KEYS.boardAuto) === 'off') return;
    this.weekAsked = s.game_id;
    this.board((m) =>
      void m.weekContext(this.boardEnv(), s.test_assisted).then((c) => {
        if (c.week) this.serverWeek = c.week;
      }),
    );
  }

  /** The first-visit tour is still to come: once per browser, not for a player who has finished a game (DS34). */
  private tourDue(): boolean {
    return this.d.local.get(KEYS.tour) == null && !this.snapshot;
  }

  /** The first-visit tour (DS34): once per browser, on round 1's first question; not for a player who has finished a game. */
  private maybeTour() {
    const s = this.state;
    if (this.view !== 'play' || this.tourOpen || !s || s.finished || s.phase !== 'answering' || s.round !== 0 || s.step !== STEPS[0]) return;
    if (!this.tourDue()) return;
    this.openTour(false);
  }

  openTour(replay: boolean) {
    if (this.tourOpen) return;
    this.tourOpen = true;
    // only the automatic first-visit tour pauses the clock (D4), also while its chunk loads
    this.tourReplay = replay;
    const gen = overlayGeneration();
    const skip = () => {
      this.tourOpen = false;
      this.runner.check();
    };
    withModule(
      CHUNKS.tour,
      (m) =>
        this.guard(() => {
          // time ran out or the round moved on while the chunk loaded; without its chunk the game goes on
          if (gen !== overlayGeneration() || this.view !== 'play' || this.state?.phase !== 'answering') return skip();
          m.startTour({
            onEnd: (outcome, step) => {
              this.tourOpen = false;
              this.d.local.set(KEYS.tour, outcome);
              this.d.analytics.track(EVENTS.tourEnded, { src: this.d.tab.src, outcome, step, replay });
              this.runner.check();
            },
          });
          this.runner.check();
        }),
      () => this.guard(skip),
    );
    if (!CHUNKS.tour.module) this.runner.check();
  }

  private renderStart(): HTMLElement {
    let mode: StartMode = { kind: 'new' };
    let firstId = '';
    const c = this.challenge;
    if (c?.kind === 'broken') {
      mode = { kind: 'broken' };
      this.challengeOpened(c, false);
    } else if (c?.kind === 'ok') {
      const link = c.link;
      firstId = link.ids[0] ?? '';
      const name = this.shownName(link.name);
      const shown = name ?? t('challenge.friend');
      const score = this.comparableScore(link);
      const snap = this.snapshot;
      const own = !!snap?.current && sameIds(snap.snapshot.item_ids, link.ids);
      if (own && score !== null && snap && name !== undefined) {
        const you = snap.snapshot.total;
        mode = { kind: 'reply', line: t('reply.line', { name: shown, them: formatNumber(score), you: formatNumber(you), result: resultLine(you, shown, score) }) };
      } else {
        const ever = this.seenLists.ever();
        const seen = link.ids.filter((id) => ever.has(id)).length;
        const notes: string[] = [];
        const beat = scoreToBeat(link, POOL.deckHash(link.ids));
        if (beat.rulesChanged) notes.push(t('challenge.rulesChanged'));
        if (beat.answersChanged) notes.push(t('challenge.changed'));
        if (seen > 0) notes.push(t('challenge.seenSome', { count: seen }));
        mode = {
          kind: 'challenge',
          line: name === undefined ? null : score !== null ? t('challenge.line', { name: shown, score: formatNumber(score) }) : t('challenge.lineNoScore'),
          meta: name ? t('challenge.meta', { name }) : t('challenge.metaFriend'),
          notes,
          unfinished: !!this.state && !this.state.finished,
        };
      }
      this.challengeOpened(c, own);
    } else if (this.state && !this.state.finished) {
      mode = { kind: 'continue', round: this.state.round + 1, challenge: this.state.deck_kind === 'challenge', expired: expiredUnseen(this.state) };
    } else if (this.snapshot) {
      mode = { kind: 'finished', total: this.snapshot.snapshot.total, canReview: this.snapshot.current };
    }
    if (!firstId && mode.kind !== 'continue' && mode.kind !== 'reply') firstId = this.pendingDeck().ids[0] ?? '';

    if (this.webgl) prefetchMap();
    const first = hasItem(firstId) ? firstId : '';
    if (first && this.readyFor !== first && this.preloading !== first) {
      // Preload the offered deck's round-1 photo; Start waits for it at most 4 s (DS9, DS23, V1-10).
      const id = first;
      this.preloading = id;
      const img = new Image();
      const ready = () => {
        if (this.readyFor === id || this.preloading !== id) return;
        this.readyFor = id;
        if (this.view === 'start') this.guard(() => this.show('start'));
      };
      img.onload = ready;
      img.onerror = ready;
      setTimeout(ready, START_IMAGE_WAIT_MS);
      img.src = imageUrl(id);
    }
    const collection = this.collection();
    return startScreen({
      sample: SAMPLE,
      mode,
      ready: (!first || this.readyFor === first) && itemsLoaded(),
      webgl: this.webgl,
      collection: mode.kind === 'finished' && collection ? collectionLine(collection) : null,
      poolSize: ITEM_IDS.length,
      onStart: () => void this.startGame(),
      onContinue: () => (mode.kind === 'challenge' ? this.continueMine() : void this.continueGame()),
      onNew: () => void this.startGame(),
      onReview: () => this.guard(() => this.show('review')),
      onChallenge: (opener) => this.guard(() => this.playChallenge(opener)),
      onReplay: () => this.replayDeck(this.snapshot?.snapshot.item_ids ?? []),
      onAbout: (opener) => this.overlay((m) => m.aboutPrivacy(opener)),
      board: this.startBoard(mode),
    });
  }

  /** The start screen's board line from the device's last confirmed rank, without a request (R5, N15). */
  private startBoard(mode: StartMode): { line: string; onOpen(opener: HTMLElement): void } | null {
    if (!BOARD_UI || !['new', 'finished', 'continue'].includes(mode.kind)) return null;
    const line = startLine(this.d.local, Date.now());
    return line ? { line, onOpen: (opener) => this.openBoard(opener) } : null;
  }

  private renderReview(): HTMLElement {
    const snap = this.snapshot;
    const game = snap?.snapshot;
    const kind: ShareKind = game?.deck_kind === 'challenge' ? 'reply' : 'challenge';
    return endScreen({
      items: snap?.current && game ? deckItems(game.item_ids) : [],
      results: snap?.current && game ? game.results : null,
      timedOut: snap?.current && game ? game.timed_out : null,
      total: game?.total ?? 0,
      detailed: !!snap?.current,
      askMostFun: false,
      onMostFun: () => {},
      share:
        snap?.current && game
          ? this.shareSetup({ ...game, replay: game.deck_kind === 'replay', kind }, (method) => this.sharedFromReview(game.game_id, method, kind))
          : null,
      challenge: game ? this.endChallenge(game) : null,
      collection: this.collection(),
      waiting: null,
      onAnother: () => this.newGame(),
      onReplay: () => this.replayDeck(game?.item_ids ?? []),
      board: game && snap?.current ? this.boardCard({ game_id: game.game_id, total: game.total, game: this.finishedSave(game.game_id) }) : null,
    });
  }

  /** The finished game's own save, while it is still the one stored (the board needs its full record). */
  private finishedSave(gameId: string): GameState | null {
    const saved = parseSave(this.d.local.get(KEYS.save), POOL);
    return saved?.game_id === gameId && saved.finished ? saved : null;
  }

  /** A share from "Review your 10": the finished game's own save still holds its ledger. */
  private sharedFromReview(gameId: string, method: ShareMethod, kind: ShareKind) {
    const saved = parseSave(this.d.local.get(KEYS.save), POOL);
    if (saved?.game_id === gameId) {
      const r = reduce(saved, { type: 'shared', method, kind }, ANSWER_KEYS);
      this.persist(saved, r.state, r.effects, false);
    } else {
      this.d.analytics.track(EVENTS.resultShared, { src: this.d.tab.src, total: this.snapshot?.snapshot.total ?? 0, method, kind, first_in_game: false });
    }
  }

  /** The friend's side of a finished challenge game, for the end screen. */
  private endChallenge(g: { deck_kind: string; challenge: { score: number | null; name: string | null } | null }) {
    if (g.deck_kind !== 'challenge' || !g.challenge) return null;
    return { name: g.challenge.name ?? t('challenge.friend'), score: g.challenge.score };
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
        // a map that cannot take an answer pauses the clock; a ready one may start or resume it (ENG8)
        this.guard(() => this.runner.check());
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
    // During a game, Credits lists only the photos already revealed, never a future round (V1-24).
    const credited = s.finished ? items : items.filter((_, i) => s.results[i] != null);
    const onMenu = (opener: HTMLElement) =>
      this.overlay((m) =>
        m.openMenu(opener, {
          items: credited,
          sample: SAMPLE,
          inGame: !s.finished,
          onNewGame: () => this.newGame(),
          onTour: !s.finished && s.phase === 'answering' ? () => this.openTour(true) : undefined,
          onScores: BOARD_UI ? (opener: HTMLElement) => this.board((b) => b.openScores(opener, this.boardEnv())) : undefined,
        }),
      );

    if (s.finished) {
      const asked = s.sent.includes(ledgerKey(s.game_id, EVENTS.feedback, 'most_fun'));
      const kind: ShareKind = s.deck_kind === 'challenge' ? 'reply' : 'challenge';
      const w = this.waiting;
      return {
        screen: endScreen({
          items,
          results: s.results,
          timedOut: s.timed_out,
          total,
          detailed: true,
          askMostFun: !asked,
          onMostFun: (a) => this.dispatch({ type: 'pulse', q: 'most_fun', a }),
          share: this.shareSetup({ ...s, total, replay: s.deck_kind === 'replay', kind }, (method) => this.dispatch({ type: 'shared', method, kind })),
          challenge: this.endChallenge(s),
          collection: this.collection(),
          waiting: w
            ? {
                name: this.shownName(w.name) ?? null,
                onPlay: () =>
                  this.guard(() => {
                    this.challenge = { kind: 'ok', link: w };
                    this.d.session.set(KEYS.challenge, JSON.stringify(this.challenge));
                    this.setWaiting(null);
                    this.show('start');
                  }),
                onDismiss: () =>
                  this.guard(() => {
                    this.setWaiting(null);
                    this.show('play');
                  }),
              }
            : null,
          onAnother: () => this.newGame(),
          onReplay: () => this.replayDeck(s.item_ids),
          board: this.boardCard({ game_id: s.game_id, total, game: s }),
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
        if (this.photo === region) this.dispatch({ type: 'skip', round, now: Date.now() });
      });
      region.onChange(() => this.guard(() => this.photoChanged(region)));
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
        toBeat: s.deck_kind === 'challenge' ? (s.challenge?.score ?? null) : null,
        timeUp: s.timed_out[s.round] ?? null,
        tip: this.timeUpTip(s),
        onPulse: (a) => this.dispatch({ type: 'pulse', q: 'difficulty' as FeedbackQ, a }),
        onNext: () => this.dispatch({ type: 'next', round: s.round, now: Date.now(), boardWeek: this.serverWeek }),
        onMenu,
      });
      const round = s.round;
      setTimeout(() => {
        if (this.state?.round === round && this.state.phase === 'reveal' && document.activeElement === document.body) focus(view.score);
      }, 1200);
      return { screen: view.element, focus: view.score };
    }

    const key = `${s.game_id}:${s.round}`;
    if (this.opened?.key !== key) this.opened = { key, at: performance.now() };
    // A saved edit reopens as the draft: a value, or an empty field with the confirmed answer shown as the fallback (D8).
    const confirmed = s.answers[s.round]?.[s.step] ?? null;
    const draft = s.drafts[s.step];
    const view = roundScreen({
      item,
      round: s.round,
      step: s.step,
      total,
      answer: draft === undefined ? confirmed : draft,
      previous: typeof confirmed === 'number' ? confirmed : null,
      madePin: s.answers[s.round]?.made ?? null,
      photo: this.photo,
      map: s.step === 'when' ? this.map : this.ensureMap(),
      webgl: this.webgl,
      onConfirm: (value) => {
        this.drafts.flush();
        this.dispatch({ type: 'confirm', round: s.round, step: s.step, value, now: Date.now() });
      },
      onBack:
        STEPS.indexOf(s.step) > 0
          ? () => {
              this.drafts.flush();
              this.dispatch({ type: 'back', round: s.round, step: s.step, now: Date.now() });
            }
          : undefined,
      onDraft: (value) => this.queueDraft(value),
      onMenu,
    });
    this.roundView = view;
    return { screen: view.element, focus: view.prompt };
  }
}
