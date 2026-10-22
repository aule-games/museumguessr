// Development-only switches (M4). `?clock=off` plays untimed rounds while
// working on the game locally. Every production build compiles it out: the
// branch below is dead code there, so its "__mgDev" marker never reaches dist/
// (the build check's development-code marker and a browser test assert that).

export function devClockOff(params: URLSearchParams): boolean {
  if (!import.meta.env.DEV) return false;
  const off = params.get('clock') === 'off';
  if (off) console.info('__mgDev clock=off: rounds are untimed');
  return off;
}
