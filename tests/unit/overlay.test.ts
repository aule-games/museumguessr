// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeAllOverlays, initOverlayHistory, isOpen, pushOverlay } from '../../src/ui/overlay';
import { openMenu } from '../../src/ui/screens/misc';
import type { Item } from '../../src/types/item';

/** A history whose back() lands later, like a busy phone: popstate arrives after other timers. */
function slowHistory(delayMs: number) {
  const entries: unknown[] = [null];
  let index = 0;
  return {
    get state() {
      return entries[index];
    },
    pushState(state: unknown) {
      entries.splice(index + 1);
      entries.push(state);
      index += 1;
    },
    replaceState(state: unknown) {
      entries[index] = state;
    },
    back() {
      this.go(-1);
    },
    go(delta: number) {
      setTimeout(() => {
        const to = Math.max(0, index + delta);
        if (to === index) return;
        index = to;
        window.dispatchEvent(new PopStateEvent('popstate', { state: entries[index] }));
      }, delayMs);
    },
  };
}

const openDialogs = () => [...document.querySelectorAll('dialog')].map((d) => d.querySelector('.dialog__title')?.textContent);
const click = (test: string) => (document.querySelector(`[data-test=${test}]`) as HTMLButtonElement).click();

describe('[DS13] [ENG17] menu → New game with a slow history', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('history', slowHistory(30));
    initOverlayHistory();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('opens the confirmation only after the menu has closed, and Start over runs once', async () => {
    const onNewGame = vi.fn();
    const opener = document.body.appendChild(document.createElement('button'));
    openMenu(opener, { items: [], sample: {} as Item, inGame: true, onNewGame });
    expect(openDialogs()).toEqual(['MuseumGuessr']);

    click('menu-new');
    await vi.advanceTimersByTimeAsync(100);
    expect(openDialogs()).toEqual(['Start over?']);

    click('confirm-new');
    await vi.advanceTimersByTimeAsync(100);
    expect(openDialogs()).toEqual([]);
    expect(onNewGame).toHaveBeenCalledTimes(1);
  });
});

describe('[D2] time-up closes overlays through history', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('history', slowHistory(30));
    initOverlayHistory();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('a forced close at time-up cancels a continuation queued between closeDialog and its popstate, and leaves no overlay entry [V12-49]', async () => {
    const onNewGame = vi.fn();
    const opener = document.body.appendChild(document.createElement('button'));
    openMenu(opener, { items: [], sample: {} as Item, inGame: true, onNewGame });
    click('menu-new'); // queues "Start over?" behind the menu's history pop
    let closed = false;
    void closeAllOverlays().then(() => (closed = true)); // time runs out before the pop lands
    await vi.advanceTimersByTimeAsync(200);
    expect(closed).toBe(true);
    expect(openDialogs()).toEqual([]);
    expect(isOpen()).toBe(false);
    expect(history.state).toBeNull();
  });

  it('closes several open overlays with one history step back each [V12-49]', async () => {
    const closes: string[] = [];
    pushOverlay(() => closes.push('lightbox'));
    pushOverlay(() => closes.push('dialog'));
    const done = closeAllOverlays();
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(closes).toEqual(['dialog', 'lightbox']);
    expect(history.state).toBeNull();
    await expect(closeAllOverlays()).resolves.toBeUndefined();
  });
});
