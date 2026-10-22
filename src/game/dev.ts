// Development-only switches (M4). `?clock=off` plays untimed rounds while
// working on the game locally. Every production build compiles it out: the
// branch below is dead code there, so the string "mg-dev-clock-off" never
// reaches dist/ (the build check and a browser test assert its absence).

export function devClockOff(params: URLSearchParams): boolean {
  if (!import.meta.env.DEV) return false;
  const off = params.get('clock') === 'off';
  if (off) console.info('mg-dev-clock-off: rounds are untimed');
  return off;
}
