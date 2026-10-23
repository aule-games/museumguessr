// Security headers from one source (W1, V12-13, V12-170). vite.config.ts
// writes the meta CSP into every built page and the assets `_headers` file
// from these values; the Worker sets the same headers on every response it
// makes (API answers and the asset 404 it passes through). Plain data only:
// the page build, the Worker and the Node scripts all import this file.

const DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://tiles.openfreemap.org https://eu.i.posthog.com",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
] as const;

/**
 * Turnstile's origin (V12-115, V12-125): a page built with the board UI loads
 * its script and frame from here, so only that build's policy names it.
 */
export const TURNSTILE_HOST = 'https://challenges.cloudflare.com';

/** The directives of a build: Turnstile's script and frame sources only with the board UI. */
export function directivesFor(board: boolean): string[] {
  if (!board) return [...DIRECTIVES];
  const out: string[] = DIRECTIVES.map((d) => (d === "script-src 'self'" ? `script-src 'self' ${TURNSTILE_HOST}` : d));
  out.splice(out.indexOf("worker-src 'self'") + 1, 0, `frame-src ${TURNSTILE_HOST}`);
  return out;
}

/** Header-only directive: browsers ignore frame-ancestors in a meta CSP. */
export const HEADER_ONLY_DIRECTIVE = "frame-ancestors 'none'";

/** The CSP as the page's meta tag carries it. */
export const META_CSP: string = DIRECTIVES.join('; ');

/** The CSP as an HTTP header: the meta policy plus frame-ancestors. */
export const HEADER_CSP: string = [...DIRECTIVES, HEADER_ONLY_DIRECTIVE].join('; ');

/** Every response (assets, API, Worker-served 404) carries these. HSTS is set at the zone (docs/ops.md). */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': HEADER_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
};

/** Content-hashed build output never changes, so it may be cached for a year. */
export const IMMUTABLE_PATHS = ['/assets/*', '/maplibre/*'] as const;
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

/** The meta CSP of a build with or without the board UI. */
export const metaCspFor = (board: boolean): string => directivesFor(board).join('; ');

/** The security headers of a build with or without the board UI; without it they are SECURITY_HEADERS. */
export function securityHeadersFor(board: boolean): Readonly<Record<string, string>> {
  return { ...SECURITY_HEADERS, 'Content-Security-Policy': [...directivesFor(board), HEADER_ONLY_DIRECTIVE].join('; ') };
}

/** The assets `_headers` file (Workers static assets format). */
export function headersFile(board = false): string {
  const lines = ['/*', ...Object.entries(securityHeadersFor(board)).map(([k, v]) => `  ${k}: ${v}`)];
  for (const path of IMMUTABLE_PATHS) lines.push(path, `  Cache-Control: ${IMMUTABLE_CACHE}`);
  return `${lines.join('\n')}\n`;
}

/** Parse a `_headers` file into path rules (used by the build check and the live check). */
export function parseHeadersFile(text: string): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>();
  let current: Record<string, string> | null = null;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = {};
      rules.set(raw.trim(), current);
      continue;
    }
    const at = raw.indexOf(':');
    if (current && at > 0) current[raw.slice(0, at).trim()] = raw.slice(at + 1).trim();
  }
  return rules;
}

/** Directive list of a policy, normalised for comparison. */
export function cspDirectives(policy: string): string[] {
  return policy.split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

/**
 * Differences between a header CSP and a meta CSP, apart from the
 * header-only frame-ancestors directive (which the header must carry).
 * An empty list means the two policies agree.
 */
export function cspMismatch(header: string, meta: string): string[] {
  const h = cspDirectives(header);
  const m = cspDirectives(meta);
  const problems: string[] = [];
  if (!h.includes(HEADER_ONLY_DIRECTIVE)) problems.push(`header CSP lacks ${HEADER_ONLY_DIRECTIVE}`);
  if (m.some((d) => d.startsWith('frame-ancestors'))) problems.push('meta CSP carries frame-ancestors, which browsers ignore there');
  const hRest = h.filter((d) => d !== HEADER_ONLY_DIRECTIVE);
  for (const d of hRest) if (!m.includes(d)) problems.push(`only the header has: ${d}`);
  for (const d of m) if (!hRest.includes(d)) problems.push(`only the meta tag has: ${d}`);
  return problems;
}
