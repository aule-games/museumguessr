// Per-tab session facts (E5, PH3, ENG28, ENG38). A session is one browser
// tab's lifetime (sessionStorage). The channel is read once per session from
// the landing URL; `test` and `dev` are removed from the address bar so a
// copied link cannot silently exclude other people, and so are a challenge
// link's parameters once read.

import { channelFrom, revalidateSrc, type Src } from '../analytics/channels.ts';
import { KEYS } from '../state/schema.ts';
import type { KV } from '../storage/guarded.ts';

export interface TabSession {
  /** Channel of this tab session (from utm_source on the first load). */
  src: Src;
  /** First load in this tab session. */
  landing: boolean;
  testParam: string | null;
  devParam: string | null;
}

export function readSession(url: URL, session: KV): TabSession {
  const testParam = url.searchParams.get('test');
  const devParam = url.searchParams.get('dev');
  const stored = session.get(KEYS.session);
  let src: Src;
  let landing: boolean;
  if (stored) {
    src = revalidateSrc(stored);
    landing = false;
  } else {
    src = channelFrom(url.searchParams.get('utm_source'));
    session.set(KEYS.session, src);
    landing = true;
  }
  return { src, landing, testParam, devParam };
}

/** Parameters the page removes from the address bar after reading them: test flags, the development clock switch and fixtures, and challenge links (V1-16). */
const CLEANED = ['test', 'dev', 'clock', 'fixture', 'd', 's', 'n', 'h', 'r'];

/** URL without `test`, `dev` and the challenge parameters, for history.replaceState. Other parameters stay. */
export function cleanedUrl(url: URL): string | null {
  if (!CLEANED.some((p) => url.searchParams.has(p))) return null;
  const next = new URL(url.href);
  for (const p of CLEANED) next.searchParams.delete(p);
  return `${next.pathname}${next.search}${next.hash}`;
}
