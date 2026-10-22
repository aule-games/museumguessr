// The round clock's disclosure (D1, M4): the start and challenge lines, How
// to play and the welcome tour say how long each object has, filled from the
// timer constants.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPY, t } from '../../src/copy';
import { TIMER } from '../../src/game/timer-config';

afterEach(() => {
  vi.doUnmock('../../src/game/timer-config.ts');
  vi.resetModules();
});

describe('the timer disclosure', () => {
  it('start and challenge lines say 60 seconds per object, filled from the timer constants [V12-61]', () => {
    expect(TIMER).toEqual({ roundSeconds: 60, firstRoundSeconds: 60, warnSeconds: 10 });
    const disclosure = t('timer.disclosure', { seconds: TIMER.roundSeconds });
    expect(disclosure).toBe('60 seconds per object');
    expect(t('start.meta', { total: 75 })).toBe('Ten objects from a collection of 75, a new set every game · 60 seconds per object · about 10 min · real, credited museum photos');
    expect(t('challenge.meta', { name: 'Ali' })).toBe('The same 10 objects Ali played · 60 seconds per object · about 10 min');
    expect(t('challenge.metaFriend')).toBe('The same 10 objects your friend played · 60 seconds per object · about 10 min');
  });

  it('How to play and the welcome tour explain the clock and the placed-answer rule; help also says time keeps running in help and the photo viewer [V12-61]', () => {
    const help = t('timer.help', { seconds: 60, warning: 10 });
    expect(help).toBe("You have 60 seconds for each object's three questions. A thin line shows the time running down, the seconds show for the last 10, and answers you have placed count when time runs out.");
    expect(COPY['how.body']).toContain(help);
    expect(COPY['how.body'].endsWith(`${help} ${COPY['timer.overlayHelp']}`)).toBe(true);
    expect(COPY['timer.overlayHelp']).toBe('Time keeps running while help or the photo viewer is open.');
    expect(COPY['tour.welcome.body']).toContain(help);
    expect(COPY['tour.welcome.body']).toMatch(/Here is a quick tour\.$/);
    // The expectation of about ten minutes stays.
    expect(COPY['start.meta']).toContain('about 10 min');
  });

  it('every disclosure follows the timer constants when they change [V12-61] [V12-72]', async () => {
    vi.resetModules();
    vi.doMock('../../src/game/timer-config.ts', () => ({ TIMER: { roundSeconds: 45, firstRoundSeconds: null, warnSeconds: 5 } }));
    const copy = await import('../../src/copy');
    const link = await import('../../src/challenge/link');
    expect(copy.t('start.meta', { total: 75 })).toContain('· 45 seconds per object ·');
    expect(copy.t('challenge.meta', { name: 'Ali' })).toContain('· 45 seconds per object ·');
    expect(copy.COPY['how.body']).toContain("You have 45 seconds for each object's three questions.");
    expect(copy.COPY['how.body']).toContain('the seconds show for the last 5,');
    expect(copy.COPY['tour.welcome.body']).toContain('You have 45 seconds');
    expect(link.RULES_VERSION).toBe('3.45.u.5');
  });
});
