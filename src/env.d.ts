/// <reference types="vite/client" />

declare const __BUILD_ID__: string;
declare const __MAPLIBRE_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_POSTHOG_PROJECT_TOKEN?: string;
  readonly VITE_ANALYTICS_HOSTS?: string;
  readonly VITE_SITE_URL?: string;
}

declare module 'posthog-js/dist/module.slim.no-external.js' {
  import posthog from 'posthog-js';
  export default posthog;
}

/** The answer fields of the live pool, built from data/items.json (scripts/lib/items-core.mjs). */
declare module 'virtual:museumguessr/items-core' {
  import type { CoreItem } from './content/items.ts';
  const core: readonly CoreItem[];
  export default core;
}
