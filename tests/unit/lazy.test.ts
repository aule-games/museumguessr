import { describe, expect, it } from 'vitest';
import { lazy, takeHandledFailure, withModule } from '../../src/ui/lazy';

describe('[V1-02] screens that load on demand', () => {
  it('a lazy screen loads its chunk once and then opens at once, without waiting [V1-02]', async () => {
    let loads = 0;
    const chunk = lazy(async () => {
      loads += 1;
      return { name: 'end' };
    });
    expect(chunk.module).toBeNull();
    const [a, b] = await Promise.all([chunk.load(), chunk.load()]);
    expect(a).toEqual({ name: 'end' });
    expect(b).toBe(a);
    expect(loads).toBe(1);
    const seen: string[] = [];
    withModule(chunk, (m) => seen.push(m.name));
    // already loaded: runs before this line returns
    expect(seen).toEqual(['end']);
  });

  it('a chunk that cannot load gives null, so the game goes on, and is tried again next time [V1-02]', async () => {
    let fail = true;
    const chunk = lazy(async () => {
      if (fail) throw new TypeError('Failed to fetch dynamically imported module');
      return { ok: true };
    });
    const failed: string[] = [];
    withModule(chunk, () => failed.push('opened'), () => failed.push('failed'));
    await chunk.load();
    await Promise.resolve();
    expect(failed).toEqual(['failed']);
    expect(chunk.module).toBeNull();
    fail = false;
    expect(await chunk.load()).toEqual({ ok: true });
  });

  it('a failure the reload-once handler swallowed is left to the screen that asked for it, once [V1-02]', async () => {
    // after main.ts's handler prevents the error, the build's import helper resolves undefined
    const chunk = lazy(async () => undefined as unknown as { ok: true });
    expect(takeHandledFailure()).toBe(false);
    expect(await chunk.load()).toBeNull();
    expect(takeHandledFailure()).toBe(true);
    expect(takeHandledFailure()).toBe(false);
  });
});
