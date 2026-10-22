// Analytics core (E5, PH1, PH2, ENG13, ENG29, ENG38, DX3, DX29). It decides
// whether analytics is on, queues events until the provider chunk loads,
// and never throws into the game. Environment access is injected so the
// module is testable without a browser.

import type { KV } from '../storage/guarded.ts';
import { KEYS } from '../state/schema.ts';
import { EVENTS } from './events.ts';
import { sanitizeProps, sanitizeUrl } from './sanitize.ts';

export interface Provider {
  capture(name: string, props: Record<string, unknown>, timestamp: Date): void;
  stop(): void;
}

export type OffReason =
  | 'test flag'
  | 'no token'
  | 'invalid token'
  | 'host not allowed'
  | 'webdriver'
  | 'provider chunk import failed'
  | 'provider not ready after 10 s';

export interface AnalyticsEnv {
  token: string;
  hosts: readonly string[];
  buildId: string;
  /** Development build: with no token, events go to the console adapter. */
  dev: boolean;
  hostname: string;
  href: string;
  /** Value of the `test` query parameter at load, before it is removed from the address bar. */
  testParam: string | null;
  webdriver: boolean;
  storage: KV;
  log: (line: string, ...rest: unknown[]) => void;
  loadProvider: (superProps: Record<string, unknown>) => Promise<Provider>;
  now: () => Date;
  setTimer: (fn: () => void, ms: number) => unknown;
}

export const QUEUE_LIMIT = 100;
export const READY_TIMEOUT_MS = 10_000;
const PROTECTED = new Set<string>([EVENTS.pageview, EVENTS.roundCompleted]);

interface Queued {
  name: string;
  props: Record<string, unknown>;
  at: Date;
}

export interface Inspection {
  status: 'on' | 'off' | 'console';
  reason: OffReason | null;
  counts: { queued: number; dropped: number; handed: number };
  /** Sanitised payloads that would have been sent (test mode only, last 100). */
  payloads: { name: string; props: Record<string, unknown> }[];
}

export interface Analytics {
  /** Starts loading the provider (call after the first screen has painted). */
  start(): void;
  track(name: string, props: Record<string, unknown>): void;
  /** Another tab set or cleared the test flag (storage event). */
  testFlagChanged(): void;
  inspect(): Inspection;
  readonly testMode: boolean;
}

/** The browser test flag lasts 24 hours from `?test=1` (N11); game test provenance never expires (ENG5). */
export const TEST_FLAG_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Whether this browser's test flag is on at `now`. The flag holds the time
 * `?test=1` was opened; it lapses after 24 hours and is then removed. A flag
 * from before v1.2 ("1") starts its 24 hours now.
 */
export function testFlagOn(storage: KV, now: number): boolean {
  const v = storage.get(KEYS.test);
  if (v === null) return false;
  if (v === '1') {
    storage.set(KEYS.test, String(now));
    return true;
  }
  const at = Number(v);
  if (/^\d+$/.test(v) && Number.isFinite(at) && now >= at && now - at < TEST_FLAG_TTL_MS) return true;
  storage.remove(KEYS.test);
  return false;
}

/** Apply `?test=1` / `?test=0` to the stored flag; returns whether test mode is on. */
export function applyTestParam(storage: KV, testParam: string | null, now: number = Date.now()): boolean {
  if (testParam === '1') storage.set(KEYS.test, String(now));
  if (testParam === '0') storage.remove(KEYS.test);
  return testParam === '1' || testFlagOn(storage, now);
}

export function createAnalytics(env: AnalyticsEnv): Analytics {
  const testMode = applyTestParam(env.storage, env.testParam);
  const superProps = { project_id: 'museumguessr', build_id: env.buildId };
  const counts = { queued: 0, dropped: 0, handed: 0 };
  const payloads: Inspection['payloads'] = [];
  let queue: Queued[] = [];
  let provider: Provider | null = null;
  let started = false;

  let reason: OffReason | null = null;
  let consoleMode = false;
  if (testMode) reason = 'test flag';
  else if (env.webdriver) reason = 'webdriver';
  else if (!env.token) {
    if (env.dev) consoleMode = true;
    else reason = 'no token';
  } else if (!env.token.startsWith('phc_')) reason = 'invalid token';
  else if (!env.hosts.includes(env.hostname)) reason = 'host not allowed';

  const say = (line: string) => {
    try {
      env.log(line);
    } catch {
      /* logging never breaks the game */
    }
  };
  say(consoleMode ? 'analytics: console (development, no token)' : reason ? `analytics: off (${reason})` : 'analytics: on');

  const turnOff = (why: OffReason) => {
    if (reason) return;
    reason = why;
    counts.dropped += queue.length;
    queue = [];
    if (provider) {
      try {
        provider.stop();
      } catch {
        /* provider errors never reach the game */
      }
    }
    provider = null;
    say(`analytics: off (${why})`);
  };

  const hand = (q: Queued) => {
    if (!provider) return;
    try {
      provider.capture(q.name, q.props, q.at);
      counts.handed += 1;
    } catch {
      counts.dropped += 1;
    }
  };

  const enqueue = (q: Queued) => {
    if (queue.length >= QUEUE_LIMIT) {
      const i = queue.findIndex((e) => !PROTECTED.has(e.name));
      if (i >= 0) {
        queue.splice(i, 1);
        counts.dropped += 1;
      } else if (!PROTECTED.has(q.name)) {
        counts.dropped += 1;
        return;
      }
    }
    queue.push(q);
    counts.queued += 1;
  };

  return {
    testMode,
    start() {
      if (started || reason || consoleMode) return;
      started = true;
      let ready = false;
      env.setTimer(() => {
        if (!ready) turnOff('provider not ready after 10 s');
      }, READY_TIMEOUT_MS);
      env
        .loadProvider(superProps)
        .then((p) => {
          ready = true;
          if (reason) {
            try {
              p.stop();
            } catch {
              /* ignore */
            }
            return;
          }
          provider = p;
          const pending = queue;
          queue = [];
          for (const q of pending) hand(q);
        })
        .catch(() => {
          ready = true;
          turnOff('provider chunk import failed');
        });
    },
    track(name, props) {
      const at = env.now();
      if (testMode) {
        const shown = sanitizeProps({ ...superProps, ...props, $current_url: env.href });
        shown.$current_url = sanitizeUrl(env.href);
        payloads.push({ name, props: shown });
        if (payloads.length > 100) payloads.shift();
      }
      if (consoleMode) {
        say(`analytics(console): ${name} ${JSON.stringify(props)}`);
        return;
      }
      if (reason) return;
      // Recheck the flag before each capture (ENG38).
      if (testFlagOn(env.storage, at.getTime())) {
        turnOff('test flag');
        return;
      }
      const q = { name, props, at };
      if (provider) hand(q);
      else enqueue(q);
    },
    testFlagChanged() {
      if (testFlagOn(env.storage, Date.now())) turnOff('test flag');
    },
    inspect() {
      return {
        status: consoleMode ? 'console' : reason ? 'off' : 'on',
        reason,
        counts: { ...counts },
        payloads: [...payloads],
      };
    },
  };
}
