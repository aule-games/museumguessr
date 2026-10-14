// Screen-space map geometry only: no answer, snapping or scoring rules.
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function overlaps(a: Box, b: Box, gap = 0): boolean {
  return a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
}

/** World views show only the highest-ranked cities; screen collisions thin them further. */
export function fallbackRank(zoom: number): number {
  return Math.max(0, Math.floor((zoom - 1) * 1.5));
}

/** Reserve whole pin/label boxes, the attribution rail and the visible controls. */
export function revealPadding(
  view: { w: number; h: number },
  pin: { height: number; labelWidth: number; labelHeight: number; gap: number; labelGap: number },
  controls: Box | null,
  attribution: Box | null,
): { top: number; bottom: number; left: number; right: number } {
  const side = pin.labelWidth / 2 + pin.gap;
  let top = pin.height + pin.gap;
  let bottomRail = attribution ? view.h - attribution.top : 0;
  let rightRail = 0;
  if (controls) {
    if (controls.top >= view.h / 2) bottomRail = Math.max(bottomRail, view.h - controls.top);
    else rightRail = view.w - controls.left;
  }
  let bottom = pin.labelHeight + pin.labelGap + pin.gap + bottomRail;
  let left = side;
  let right = side + rightRail;
  // A detached or exceptionally small host must still leave a positive fit area.
  const vertical = Math.min(1, Math.max(0, view.h * 0.9) / (top + bottom));
  const horizontal = Math.min(1, Math.max(0, view.w * 0.9) / (left + right));
  top *= vertical;
  bottom *= vertical;
  left *= horizontal;
  right *= horizontal;
  return { top, bottom, left, right };
}
