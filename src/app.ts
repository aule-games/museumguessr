// The app controller: runs the pure reducer, persists state, sends events,
// and renders screens. Every game-code entry point goes through `guard`, so
// a bug shows the recovery screen instead of a blank page (E8, ENG11).

import type { Analytics } from './analytics/core.ts';
import { EVENTS, STEPS, type FeedbackQ } from './analytics/events.ts';
import { ANSWER_KEYS, DECK_ITEMS, ITEMS_VERSION, ITEM_IDS, POOL, SAMPLE, deckItems, hasItem, imageUrl, itemsLoaded, loadItems } from './content/items.ts';
import { challengeUrl, parseChallenge, type ChallengeLink, type ParsedChallenge, type ShareKind } from './challenge/link.ts';
import { SITE_URL } from './config.ts';
import { formatNumber, t } from './copy.ts';
import { drawDeck, seededRng } from './deck/planner.ts';
import { stripMessage, takeErrorBudget, toReport, type ErrorReport } from './errors/boundary.ts';
import { newGameId } from './game/ids.ts';
import type { WriterLock } from './game/lock.ts';
import { hardNailedCount } from './game/hard.ts';
import { isListed, nameList } from './game/names.ts';
import { shareHook, shareText } from './game/text.ts';
import { SeenLists } from './game/seen.ts';
import type { TabSession } from './game/session.ts';
import { testGuess } from './game/testplay.ts';
import { GameMap, hasWebGL2, prefetchMap, type MapState } from './map/map.ts';
import type { LatLng } from './scoring/geo.ts';
import { ledgerKey, reduce, seenBucket, totalPoints, type Action, type Deck, type Effect, type ShareMethod, type StartContext } from './state/reducer.ts';
import { KEYS, parseSave, parseSnapshot, serialize, type GameState, type ParsedSnapshot, type RoundResult } from './state/schema.ts';
import type { KV } from './storage/guarded.ts';
import { clear, focus } from './ui/dom.ts';
import { endScreen, resultLine, collectionLine } from './ui/screens/end.ts';
import { confirmNewGame, errorScreen, frozenScreen, openMenu, aboutPrivacy, testBadge } from './ui/screens/misc.ts';
import { revealScreen } from './ui/screens/reveal.ts';
import { PhotoRegion, roundScreen, type RoundView } from './ui/screens/round.ts';
import { startScreen, type StartMode } from './ui/screens/start.ts';
import type { ShareSetup } from './ui/share.ts';
import { startTour } from './ui/tour.ts';

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
}

const START_IMAGE_WAIT_MS = 4000;

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

  constructor(private d: AppDeps) {
    this.webgl = hasWebGL2();
    this.seenLists = new SeenLists(d.local, new Set(ITEM_IDS), () => crypto.getRandomValues(new Uint32Array(1))[0] as number);
    d.lock.onLost(() => this.guard(() => this.show('frozen')));
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
    const resume = !!this.state && !this.d.tab.landing && linked.kind === 'none';
    if (this.d.analytics.testMode) this.badge = testBadge(() => this.d.analytics.inspect(), () => void this.finishForTest());
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

  /** The friend's score, unless the answers of that deck changed since the link was made (V1-16). */
  private comparableScore(link: ChallengeLink): number | null {
    return link.hash === null || link.hash === POOL.deckHash(link.ids) ? link.score : null;
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
      this.dropChallenge();
      // Re-draw under the lock: another tab may have shown some of the offered objects (V1-10).
      const offered = this.pending;
      this.pending = null;
      const deck = this.pendingDeck();
      const first = deck.ids[0];
      if (first && offered?.ids[0] !== first) new Image().src = imageUrl(first);
      if (deck.restart) this.seenLists.restart(deck.ids);
      const committed: Deck = { ids: deck.ids, kind: deck.kind, hash: deck.hash, firstSeen: deck.firstSeen, challenge: deck.challenge };
      this.begin(committed);
    });
  }

  async continueGame() {
    if (!(await this.d.lock.acquire(true))) return;
    this.guard(() => {
      this.state = parseSave(this.d.local.get(KEYS.save), POOL);
      this.show(this.state && !this.state.finished ? 'play' : 'start');
    });
  }

  /** Test mode only: finish the game in progress, or a new one, with random answers and show the end screen. */
  async finishForTest() {
    if (!this.state || this.state.finished) await this.startGame();
    this.guard(() => {
      const skills = new Map<number, number>();
      for (let i = 0; i < 100 && this.state && !this.state.finished; i++) {
        const s = this.state;
        const key = ANSWER_KEYS.find((k) => k.id === s.item_ids[s.round]);
        if (!key) return;
        if (!skills.has(s.round)) skills.set(s.round, Math.random());
        const action: Action =
          s.phase === 'reveal'
            ? { type: 'next', round: s.round }
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
    this.dispatch({ type: 'start', gameId: this.id(), src: this.d.tab.src, itemsVersion: ITEMS_VERSION, deck, context });
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
    if (this.state && !this.state.finished) confirmNewGame(opener, go);
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
      this.records(() => {
        if (this.view === view) this.show(view);
      });
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
        if (link.hash !== null && score === null && link.score !== null) notes.push(t('challenge.changed'));
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
      mode = { kind: 'continue', round: this.state.round + 1, challenge: this.state.deck_kind === 'challenge' };
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
      onAbout: (opener) => aboutPrivacy(opener),
    });
  }

  private renderReview(): HTMLElement {
    const snap = this.snapshot;
    const game = snap?.snapshot;
    const kind: ShareKind = game?.deck_kind === 'challenge' ? 'reply' : 'challenge';
    return endScreen({
      items: snap?.current && game ? deckItems(game.item_ids) : [],
      results: snap?.current && game ? game.results : null,
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
    });
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
      openMenu(opener, {
        items: credited,
        sample: SAMPLE,
        inGame: !s.finished,
        onNewGame: () => this.newGame(),
        onTour: !s.finished && s.phase === 'answering' ? () => this.openTour(true) : undefined,
      });

    if (s.finished) {
      const asked = s.sent.includes(ledgerKey(s.game_id, EVENTS.feedback, 'most_fun'));
      const kind: ShareKind = s.deck_kind === 'challenge' ? 'reply' : 'challenge';
      const w = this.waiting;
      return {
        screen: endScreen({
          items,
          results: s.results,
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
        toBeat: s.deck_kind === 'challenge' ? (s.challenge?.score ?? null) : null,
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
