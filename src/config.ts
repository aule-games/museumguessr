// Build-time configuration (DX12, DX30). BASE_URL comes from Vite's `base`.

export const BASE_URL: string = import.meta.env.BASE_URL;
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
export const MAPLIBRE_URL = `${BASE_URL}maplibre/${typeof __MAPLIBRE_VERSION__ === 'string' ? __MAPLIBRE_VERSION__ : 'dev'}/`;

export const POSTHOG_TOKEN: string = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN ?? '';

/** Hosts where analytics may run; the custom-domain move is a configuration change (DX12). */
export const ANALYTICS_HOSTS: readonly string[] = (import.meta.env.VITE_ANALYTICS_HOSTS ?? 'mert-aktas.github.io')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

/** Canonical public URL used by share text and meta tags. */
export const SITE_URL = 'https://mert-aktas.github.io/museumguessr/';
