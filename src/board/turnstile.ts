// Turnstile for board entry (G1, ENG14; V12-115). The script loads only when
// a submission needs a token, never with the page. The widget renders into a
// zero-height slot and stays invisible unless Turnstile needs the player:
// then the card says "Tap to finish adding" and the slot opens in place. A
// script that has not started within ten seconds counts as "Verification
// couldn't load"; every attempt asks for a fresh token. The CSP allows the
// Turnstile host only when the board UI is built in (src/security/headers.ts).

import type { Verifier } from './session.ts';

export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
export const TURNSTILE_SCRIPT = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;
/** The action siteverify checks (docs/api.md). */
export const TURNSTILE_ACTION = 'board_submit';
export const LOAD_TIMEOUT_MS = 10_000;

interface RenderOptions {
  sitekey: string;
  action: string;
  appearance: 'interaction-only';
  execution: 'execute';
  'refresh-expired': 'manual';
  'response-field': false;
  callback(token: string): void;
  'error-callback'(): void;
  'expired-callback'(): void;
  'timeout-callback'(): void;
  'before-interactive-callback'(): void;
  'after-interactive-callback'(): void;
}

export interface TurnstileApi {
  render(el: HTMLElement, opts: RenderOptions): string | undefined;
  execute(id: string): void;
  reset(id: string): void;
  remove(id: string): void;
}

type Win = Window & { turnstile?: TurnstileApi };

let loading: Promise<TurnstileApi> | null = null;

/** Load the script once (a failed load can be tried again); resolves when `window.turnstile` exists. */
export function loadTurnstile(win: Win = window, timeoutMs = LOAD_TIMEOUT_MS): Promise<TurnstileApi> {
  if (win.turnstile) return Promise.resolve(win.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const doc = win.document;
    let script = doc.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT}"]`);
    if (!script) {
      script = doc.createElement('script');
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      doc.head.append(script);
    }
    const started = Date.now();
    const poll = () => {
      if (win.turnstile) return resolve(win.turnstile);
      if (Date.now() - started >= timeoutMs) return reject(new Error('turnstile did not load'));
      win.setTimeout(poll, 100);
    };
    script.addEventListener('error', () => reject(new Error('turnstile did not load')));
    poll();
  }).catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}

/**
 * A verifier for one slot. The widget renders on first use and is reset for
 * every later token, so each attempt is verified afresh (ENG14).
 */
export function turnstileVerifier(slot: HTMLElement, sitekey: string, win: Win = window): Verifier {
  let id: string | null = null;
  let pending: { resolve(t: string): void; reject(e: Error): void; interactive(open: boolean): void } | null = null;
  const fail = () => {
    pending?.interactive(false);
    pending?.reject(new Error('turnstile failed'));
    pending = null;
  };
  return {
    async token(on) {
      const ts = await loadTurnstile(win);
      return new Promise<string>((resolve, reject) => {
        pending?.reject(new Error('superseded'));
        pending = { resolve, reject, interactive: on.interactive };
        if (id === null) {
          id =
            ts.render(slot, {
              sitekey,
              action: TURNSTILE_ACTION,
              appearance: 'interaction-only',
              execution: 'execute',
              'refresh-expired': 'manual',
              'response-field': false,
              callback: (token) => {
                pending?.interactive(false);
                pending?.resolve(token);
                pending = null;
              },
              'error-callback': fail,
              'expired-callback': () => {},
              'timeout-callback': fail,
              'before-interactive-callback': () => pending?.interactive(true),
              'after-interactive-callback': () => pending?.interactive(false),
            }) ?? null;
          if (id === null) return fail();
        } else {
          ts.reset(id);
        }
        ts.execute(id);
      });
    },
  };
}

/** A hidden slot for background retries; such a verifier gives up when the widget needs the player. */
export function backgroundVerifier(sitekey: string, win: Win = window): Verifier {
  let inner: Verifier | null = null;
  return {
    token(on) {
      if (!inner) {
        const slot = win.document.createElement('div');
        slot.className = 'board__slot board__slot--hidden';
        slot.setAttribute('aria-hidden', 'true');
        win.document.body.append(slot);
        inner = turnstileVerifier(slot, sitekey, win);
      }
      const v = inner;
      return new Promise<string>((resolve, reject) => {
        v
          .token({
            interactive: (open) => {
              on.interactive(open);
              if (open) reject(new Error('needs the player'));
            },
          })
          .then(resolve, reject);
      });
    },
  };
}
