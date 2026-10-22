// Overlays (DS13, DS29, ENG17). Each open overlay pushes one history entry,
// so Back closes it; game steps push none. Close buttons call history.back();
// popstate closes overlays idempotently. Native <dialog> traps focus and
// closes on Escape; focus returns to the opener. Anything that runs after a
// close (another dialog, a new game) waits for that popstate: back() is
// asynchronous, and a pushState before it lands would be undone by it.
// At time-up every overlay closes through its history entry and queued
// continuations are cancelled (D2, ENG7); dialog headers repeat the clock.

import { t } from '../copy.ts';
import { clockMirror } from './clock.ts';
import { h } from './dom.ts';

interface Open {
  id: string;
  close: () => void;
  /** history.back() was requested for it and has not landed yet. */
  closing: boolean;
}

const stack: Open[] = [];
let counter = 0;
/** Bumped by closeAllOverlays: continuations queued before it never run. */
let generation = 0;
let waiters: (() => void)[] = [];

function settle() {
  if (stack.length) return;
  const done = waiters;
  waiters = [];
  for (const w of done) w();
}

export function initOverlayHistory() {
  if (history.state && typeof history.state === 'object' && 'overlay' in history.state) {
    history.replaceState(null, '');
  }
  window.addEventListener('popstate', () => {
    const current = (history.state as { overlay?: string } | null)?.overlay;
    while (stack.length && stack[stack.length - 1]?.id !== current) stack.pop()?.close();
    settle();
  });
}

/** Register an overlay that manages its own DOM (the lightbox). Returns a function to request closing. */
export function pushOverlay(close: () => void): () => void {
  const id = `o${++counter}`;
  const entry: Open = { id, close, closing: false };
  stack.push(entry);
  history.pushState({ overlay: id }, '');
  return () => {
    if (stack.includes(entry) && !entry.closing) {
      entry.closing = true;
      history.back();
    }
  };
}

export function isOpen(): boolean {
  return stack.length > 0;
}

/** The current continuation generation; a continuation queued under an older one is stale. */
export function overlayGeneration(): number {
  return generation;
}

/**
 * Close every open overlay through its own history pop, so no stale entry
 * stays behind, and cancel every continuation queued by closeDialog (D2,
 * ENG7). Resolves once the overlays are closed (or after `fallbackMs`, when
 * a history event never arrives).
 */
export function closeAllOverlays(fallbackMs = 1000): Promise<void> {
  generation += 1;
  if (!stack.length) return Promise.resolve();
  const open = stack.filter((o) => !o.closing);
  for (const o of open) o.closing = true;
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
    if (open.length) history.go(-open.length);
    setTimeout(() => {
      if (!waiters.includes(resolve)) return;
      while (stack.length) stack.pop()?.close();
      settle();
    }, fallbackMs);
  });
}

type ManagedDialog = HTMLDialogElement & { requestClose2?: () => void; afterClose?: () => void; afterCloseGen?: number };

export function openDialog(title: string, body: Node[], opener?: HTMLElement | null, extraClass = ''): HTMLDialogElement {
  const heading = h('h2', { class: 'dialog__title', id: `dlg-${counter + 1}` }, title);
  const closeBtn = h('button', { type: 'button', class: 'dialog__close', 'aria-label': t('overlay.close') }, '×');
  const dialog = h(
    'dialog',
    { class: `dialog ${extraClass}`.trim(), 'aria-labelledby': heading.id },
    // time keeps running while a dialog is open, so its header shows the clock (R2)
    h('div', { class: 'dialog__head' }, heading, clockMirror(), closeBtn),
    h('div', { class: 'dialog__body' }, ...body),
  );
  document.body.append(dialog);
  const managed = dialog as ManagedDialog;
  const requestClose = pushOverlay(() => {
    dialog.close();
    dialog.remove();
    opener?.focus({ preventScroll: true });
    const next = managed.afterClose;
    const gen = managed.afterCloseGen;
    managed.afterClose = undefined;
    // a continuation queued before a forced close (time-up) is cancelled (ENG7)
    if (next && gen === generation) setTimeout(() => {
      if (gen === generation) next();
    }, 0);
  });
  closeBtn.addEventListener('click', requestClose);
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    requestClose();
  });
  managed.requestClose2 = requestClose;
  dialog.showModal();
  return dialog;
}

/** Close a dialog; `then` runs once the close has landed in history, unless time ran out first. */
export function closeDialog(dialog: HTMLDialogElement, then?: () => void) {
  const managed = dialog as ManagedDialog;
  if (!dialog.isConnected) {
    if (then) {
      const gen = generation;
      setTimeout(() => {
        if (gen === generation) then();
      }, 0);
    }
    return;
  }
  if (then) {
    managed.afterClose = then;
    managed.afterCloseGen = generation;
  }
  managed.requestClose2?.();
}
