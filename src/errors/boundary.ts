// Errors (E8, ENG11, DX13, DX31). Game-code boundaries (dispatch, render,
// async loaders) show the error screen; global handlers send telemetry only,
// keep errors from our own bundle (never the PostHog chunk) and drop noise.

import { KEYS } from '../state/schema.ts';
import type { KV } from '../storage/guarded.ts';

export const MAX_ERRORS_PER_SESSION = 3;

export interface ErrorReport {
  name: string;
  message: string;
  frame: string;
}

/** First 80 characters with URLs and query strings removed. */
export function stripMessage(message: string): string {
  return message
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/\?\S*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** Top stack frame as `chunk:line:col` (file name only, no URL). */
export function topFrame(stack: string | undefined): string {
  if (!stack) return '';
  for (const line of stack.split('\n')) {
    const m = line.match(/([^/\s()@]+\.(?:m?js|ts)):(\d+):(\d+)/);
    if (m) return `${m[1]}:${m[2]}:${m[3]}`;
  }
  return '';
}

export function toReport(err: unknown): ErrorReport {
  if (err instanceof Error) {
    return { name: err.name || 'Error', message: stripMessage(err.message), frame: topFrame(err.stack) };
  }
  return { name: 'NonError', message: stripMessage(String(err)), frame: '' };
}

const NOISE = [/^Script error\.?$/i, /ResizeObserver loop/i];

/** Should a global error event become telemetry? Only from our bundle, never the PostHog chunk. */
export function isOurs(filename: string | undefined, message: string, bundlePrefix: string): boolean {
  if (NOISE.some((re) => re.test(message))) return false;
  if (!filename || !filename.startsWith(bundlePrefix)) return false;
  const file = filename.slice(bundlePrefix.length);
  return !file.startsWith('posthog-');
}

/** Session-wide cap on client_error events. */
export function takeErrorBudget(session: KV): boolean {
  const n = Number(session.get('museumguessr:v1:errors') ?? '0');
  if (n >= MAX_ERRORS_PER_SESSION) return false;
  session.set('museumguessr:v1:errors', String(n + 1));
  return true;
}

/** Boot-failure counter (ENG11): a saved game that crashes twice on resume is discarded. */
export function bootStarting(session: KV): number {
  const n = Number(session.get(KEYS.bootFailures) ?? '0') + 1;
  session.set(KEYS.bootFailures, String(n));
  return n;
}

export function bootSucceeded(session: KV): void {
  session.remove(KEYS.bootFailures);
}
