import { describe, expect, it, vi } from 'vitest';
import { CHANNELS, channelFrom, revalidateSrc } from '../../src/analytics/channels';
import { createAnalytics, QUEUE_LIMIT, type AnalyticsEnv, type Provider } from '../../src/analytics/core';
import { CATALOGUE, EVENTS } from '../../src/analytics/events';
import { beforeSend, sanitizeUrl } from '../../src/analytics/sanitize';
import { guarded } from '../../src/storage/guarded';
import { KEYS } from '../../src/state/schema';

function memoryStore(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

function fakeProvider() {
  const calls: { name: string; props: Record<string, unknown>; at: Date }[] = [];
  const provider: Provider & { stopped: boolean } = {
    stopped: false,
    capture: (name, props, at) => void calls.push({ name, props, at }),
    stop() {
      this.stopped = true;
    },
  };
  return { provider, calls };
}

function env(over: Partial<AnalyticsEnv> = {}): AnalyticsEnv & { lines: string[]; timers: (() => void)[] } {
  const lines: string[] = [];
  const timers: (() => void)[] = [];
  const { provider } = fakeProvider();
  return {
    token: 'phc_test',
    hosts: ['mert-aktas.github.io'],
    buildId: 'abc1234',
    dev: false,
    hostname: 'mert-aktas.github.io',
    href: 'https://mert-aktas.github.io/museumguessr/?utm_source=webgames&test=1&x=y',
    testParam: null,
    webdriver: false,
    storage: guarded(memoryStore),
    log: (l) => void lines.push(l),
    loadProvider: async () => provider,
    now: () => new Date(1000),
    setTimer: (fn) => void timers.push(fn),
    lines,
    timers,
    ...over,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('[DX3] [ENG13] off-reasons, one console line each', () => {
  it.each([
    [{ testParam: '1' }, 'analytics: off (test flag)'],
    [{ webdriver: true }, 'analytics: off (webdriver)'],
    [{ token: '' }, 'analytics: off (no token)'],
    [{ token: 'phx_secret' }, 'analytics: off (invalid token)'],
    [{ hostname: 'example.com' }, 'analytics: off (host not allowed)'],
    [{}, 'analytics: on'],
    [{ token: '', dev: true }, 'analytics: console (development, no token)'],
  ] as [Partial<AnalyticsEnv>, string][])('%o → %s', (over, line) => {
    const e = env(over);
    createAnalytics(e);
    expect(e.lines).toEqual([line]);
  });

  it('?test=1 persists the flag and ?test=0 clears it', () => {
    const storage = guarded(memoryStore);
    createAnalytics(env({ storage, testParam: '1' }));
    expect(storage.get(KEYS.test)).toBe('1');
    expect(createAnalytics(env({ storage })).testMode).toBe(true);
    createAnalytics(env({ storage, testParam: '0' }));
    expect(storage.get(KEYS.test)).toBeNull();
  });

  it('never loads the provider in test mode', async () => {
    const load = vi.fn();
    const a = createAnalytics(env({ testParam: '1', loadProvider: load }));
    a.start();
    a.track(EVENTS.gameStart, { src: 'none' });
    await flush();
    expect(load).not.toHaveBeenCalled();
  });
});

describe('[ENG29] pre-load queue', () => {
  it('flushes queued events with their original timestamps', async () => {
    const { provider, calls } = fakeProvider();
    let t = 0;
    const a = createAnalytics(env({ loadProvider: async () => provider, now: () => new Date(++t) }));
    a.track(EVENTS.pageview, { src: 'none', landing: true, resumed: false });
    a.track(EVENTS.gameStart, { src: 'none' });
    a.start();
    await flush();
    expect(calls.map((c) => [c.name, c.at.getTime()])).toEqual([
      [EVENTS.pageview, 1],
      [EVENTS.gameStart, 2],
    ]);
  });

  it('never drops $pageview or round_completed when full', async () => {
    const { provider, calls } = fakeProvider();
    const a = createAnalytics(env({ loadProvider: async () => provider }));
    a.track(EVENTS.pageview, {});
    for (let i = 0; i < QUEUE_LIMIT + 50; i++) a.track(EVENTS.stepCompleted, { i });
    a.track(EVENTS.roundCompleted, { round: 3 });
    a.start();
    await flush();
    expect(calls.length).toBeLessThanOrEqual(QUEUE_LIMIT + 1);
    expect(calls.filter((c) => c.name === EVENTS.pageview)).toHaveLength(1);
    expect(calls.filter((c) => c.name === EVENTS.roundCompleted)).toHaveLength(1);
    expect(a.inspect().counts.dropped).toBeGreaterThan(0);
  });

  it('discards the queue when the chunk import fails, and the game keeps going', async () => {
    const e = env({ loadProvider: () => Promise.reject(new Error('blocked')) });
    const a = createAnalytics(e);
    a.track(EVENTS.roundCompleted, { round: 3 });
    a.start();
    await flush();
    expect(e.lines.at(-1)).toBe('analytics: off (provider chunk import failed)');
    expect(() => a.track(EVENTS.gameCompleted, {})).not.toThrow();
  });

  it('gives up after 10 s when the provider never initialises', async () => {
    const e = env({ loadProvider: () => new Promise(() => {}) });
    const a = createAnalytics(e);
    a.start();
    e.timers.forEach((fn) => fn());
    expect(e.lines.at(-1)).toBe('analytics: off (provider not ready after 10 s)');
    expect(a.inspect().status).toBe('off');
  });

  it('a throwing provider never reaches the game', async () => {
    const provider: Provider = {
      capture: () => {
        throw new Error('provider bug');
      },
      stop: () => {},
    };
    const a = createAnalytics(env({ loadProvider: async () => provider }));
    a.start();
    await flush();
    expect(() => a.track(EVENTS.gameStart, {})).not.toThrow();
  });
});

describe('[ENG38] test flag set in another tab', () => {
  it('stops capture and discards the queue', async () => {
    const { provider, calls } = fakeProvider();
    const storage = guarded(memoryStore);
    const a = createAnalytics(env({ storage, loadProvider: async () => provider }));
    a.start();
    await flush();
    storage.set(KEYS.test, '1');
    a.testFlagChanged();
    a.track(EVENTS.gameStart, {});
    expect(calls).toHaveLength(0);
    expect(provider.stopped).toBe(true);
  });
});

describe('[DX29] test-mode inspector', () => {
  it('lists sanitised payloads while sending nothing', () => {
    const a = createAnalytics(env({ testParam: '1' }));
    a.track(EVENTS.gameStart, { src: 'webgames' });
    const { payloads, status } = a.inspect();
    expect(status).toBe('off');
    expect(payloads[0]?.props).toMatchObject({
      project_id: 'museumguessr',
      src: 'webgames',
      $current_url: 'https://mert-aktas.github.io/museumguessr/?utm_source=webgames',
    });
  });
});

describe('[PH2] URL sanitiser', () => {
  it('keeps only utm_* and ref', () => {
    expect(sanitizeUrl('https://x.io/museumguessr/?utm_source=webgames&test=1&x=y#frag')).toBe(
      'https://x.io/museumguessr/?utm_source=webgames',
    );
    expect(sanitizeUrl('https://x.io/?ref=abc&dev=round')).toBe('https://x.io/?ref=abc');
  });
  it('sanitises URL properties on $pageview and game events', () => {
    for (const event of [EVENTS.pageview, EVENTS.roundCompleted]) {
      const out = beforeSend({
        event,
        properties: { $current_url: 'https://x.io/?utm_source=webgames&test=1&x=y', round: 3 },
      });
      expect(out.properties).toEqual({ $current_url: 'https://x.io/?utm_source=webgames', round: 3 });
    }
  });
  it('drops click ids, including nested $set_once (ENG39)', () => {
    const out = beforeSend({
      event: '$pageview',
      properties: { fbclid: 'x', gclid: 'y', $initial_gclid: 'z', utm_source: 'webgames' },
      $set_once: { $initial_fbclid: 'q', $initial_referrer: 'https://r.io/p?secret=1' },
    });
    expect(out.properties).toEqual({ utm_source: 'webgames' });
    expect(out.$set_once).toEqual({ $initial_referrer: 'https://r.io/p' });
  });
  it('caps utm values to 64 safe characters', () => {
    expect(beforeSend({ event: 'e', properties: { utm_source: 'a'.repeat(65) } }).properties?.utm_source).toBe('other');
    expect(beforeSend({ event: 'e', properties: { utm_source: '<b>' } }).properties?.utm_source).toBe('other');
  });
});

describe('[PH3] [V12] channels', () => {
  it.each(CHANNELS.map((c) => [c]))('%s is approved', (c) => expect(channelFrom(c)).toBe(c));
  it('accepts the city- and oa- patterns', () => {
    expect(channelFrom('city-berlin')).toBe('city-berlin');
    expect(channelFrom('city-new-york')).toBe('city-new-york');
    expect(channelFrom('oa-met')).toBe('oa-met');
  });
  it('maps absent to none and anything else to other', () => {
    expect(channelFrom(null)).toBe('none');
    expect(channelFrom('')).toBe('none');
    expect(channelFrom('Webgames')).toBe('other');
    expect(channelFrom('<script>')).toBe('other');
    expect(channelFrom('city-')).toBe('other');
    expect(channelFrom('x'.repeat(40))).toBe('other');
    expect(revalidateSrc('none')).toBe('none');
    expect(revalidateSrc(42)).toBe('other');
  });
});

describe('[DX11] event catalogue', () => {
  it('lists every event exactly once', () => {
    expect(CATALOGUE.map((e) => e.name).sort()).toEqual(Object.values(EVENTS).sort());
  });
});

describe('[ENG31] guarded storage', () => {
  it.each(['getItem', 'setItem', 'removeItem'] as const)('falls back to memory when %s throws', (method) => {
    const store = memoryStore();
    store[method] = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    const kv = guarded(() => store);
    expect(() => {
      kv.set('a', '1');
      kv.get('a');
      kv.remove('a');
      kv.set('b', '2');
    }).not.toThrow();
    expect(kv.persistent).toBe(false);
    expect(kv.get('b')).toBe('2');
  });
  it('survives a store that cannot even be opened', () => {
    const kv = guarded(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    kv.set('a', '1');
    expect(kv.get('a')).toBe('1');
    expect(kv.persistent).toBe(false);
  });
});
