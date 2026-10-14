// Overlays (DS13, DS29, ENG17). Each open overlay pushes one history entry,
// so Back closes it; game steps push none. Close buttons call history.back();
// popstate closes overlays idempotently. Native <dialog> traps focus and
// closes on Escape; focus returns to the opener. Anything that runs after a
// close (another dialog, a new game) waits for that popstate: back() is
// asynchronous, and a pushState before it lands would be undone by it.

import { t } from '../copy.ts';
import { h } from './dom.ts';

interface Open {
  id: string;
  close: () => void;
}

const stack: Open[] = [];
let counter = 0;

export function initOverlayHistory() {
  if (history.state && typeof history.state === 'object' && 'overlay' in history.state) {
    history.replaceState(null, '');
  }
  window.addEventListener('popstate', () => {
    const current = (history.state as { overlay?: string } | null)?.overlay;
    while (stack.length && stack[stack.length - 1]?.id !== current) stack.pop()?.close();
  });
}

/** Register an overlay that manages its own DOM (the lightbox). Returns a function to request closing. */
export function pushOverlay(close: () => void): () => void {
  const id = `o${++counter}`;
  stack.push({ id, close });
  history.pushState({ overlay: id }, '');
  return () => {
    if (stack.some((o) => o.id === id)) history.back();
  };
}

export function isOpen(): boolean {
  return stack.length > 0;
}

type ManagedDialog = HTMLDialogElement & { requestClose2?: () => void; afterClose?: () => void };

export function openDialog(title: string, body: Node[], opener?: HTMLElement | null, extraClass = ''): HTMLDialogElement {
  const heading = h('h2', { class: 'dialog__title', id: `dlg-${counter + 1}` }, title);
  const closeBtn = h('button', { type: 'button', class: 'dialog__close', 'aria-label': t('overlay.close') }, '×');
  const dialog = h(
    'dialog',
    { class: `dialog ${extraClass}`.trim(), 'aria-labelledby': heading.id },
    h('div', { class: 'dialog__head' }, heading, closeBtn),
    h('div', { class: 'dialog__body' }, ...body),
  );
  document.body.append(dialog);
  const managed = dialog as ManagedDialog;
  const requestClose = pushOverlay(() => {
    dialog.close();
    dialog.remove();
    opener?.focus({ preventScroll: true });
    const next = managed.afterClose;
    managed.afterClose = undefined;
    if (next) setTimeout(next, 0);
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

/** Close a dialog; `then` runs once the close has landed in history. */
export function closeDialog(dialog: HTMLDialogElement, then?: () => void) {
  const managed = dialog as ManagedDialog;
  if (!dialog.isConnected) {
    if (then) setTimeout(then, 0);
    return;
  }
  if (then) managed.afterClose = then;
  managed.requestClose2?.();
}
