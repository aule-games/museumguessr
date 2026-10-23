// Build-time configuration (DX12, DX30). BASE_URL comes from Vite's `base`.

export const BASE_URL: string = import.meta.env.BASE_URL;
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
export const MAPLIBRE_URL = `${BASE_URL}maplibre/${typeof __MAPLIBRE_VERSION__ === 'string' ? __MAPLIBRE_VERSION__ : 'dev'}/`;

export const POSTHOG_TOKEN: string = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN ?? '';

/** Hosts where analytics may run; the custom-domain move is a configuration change (DX12). */
export const ANALYTICS_HOSTS: readonly string[] = (import.meta.env.VITE_ANALYTICS_HOSTS ?? 'museumguessr.com')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

/**
 * Canonical public URL used by share text and challenge links (V1-16). A
 * build variable, so the custom-domain move is a configuration change; the
 * meta tags in index.html move with it.
 */
export const SITE_URL: string = import.meta.env.VITE_SITE_URL || 'https://museumguessr.com/';

/**
 * The weekly board's page side (W6, V12-125): off removes the end-screen
 * card, the start-screen standing, the menu entry, the disclosure and the
 * Turnstile CSP. A build constant, so the board code is compiled out when off.
 */
export const BOARD_UI: boolean = import.meta.env.VITE_BOARD_UI === 'true';

/** The public Turnstile site key; required by the build when the board UI is on. */
export const TURNSTILE_SITEKEY: string = import.meta.env.VITE_TURNSTILE_SITEKEY ?? '';

/** dev, board-test or deploy (M3): development fixtures exist only outside deploy builds. */
export const BUILD_PURPOSE: string = import.meta.env.VITE_BUILD_PURPOSE ?? 'dev';
