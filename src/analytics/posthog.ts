// The PostHog chunk (PH1, ENG39). Imported dynamically, only after every
// off-reason passed and the first screen painted. Every capture-related
// option is pinned here because the PostHog project is shared and its remote
// settings can change. Vite names this chunk `assets/posthog-[hash].js`.

import type { PostHogConfig } from 'posthog-js';
import posthog from 'posthog-js/dist/module.slim.no-external.js';
import type { Provider } from './core.ts';
import { beforeSend, type CaptureLike } from './sanitize.ts';

export const API_HOST = 'https://eu.i.posthog.com';

export const CONFIG = {
  api_host: API_HOST,
  ui_host: null,
  cookieless_mode: 'always',
  person_profiles: 'never',
  persistence: 'memory',
  disable_persistence: true,
  autocapture: false,
  capture_pageview: false,
  capture_pageleave: false,
  rageclick: false,
  capture_dead_clicks: false,
  capture_heatmaps: false,
  enable_heatmaps: false,
  capture_exceptions: false,
  capture_performance: false,
  disable_session_recording: true,
  disable_surveys: true,
  disable_surveys_automatic_display: true,
  disable_product_tours: true,
  disable_conversations: true,
  disable_web_experiments: true,
  advanced_disable_flags: true,
  advanced_disable_feature_flags: true,
  advanced_disable_feature_flags_on_first_load: true,
  disable_external_dependency_loading: true,
  save_campaign_params: false,
  custom_campaign_params: [],
  save_referrer: true,
  disable_scroll_properties: true,
  mask_personal_data_properties: true,
  before_send: (event) => beforeSend(event as CaptureLike | null) as typeof event,
} satisfies Partial<PostHogConfig>;

export function startPostHog(token: string, superProps: Record<string, unknown>): Provider {
  posthog.init(token, CONFIG);
  posthog.register(superProps);
  return {
    capture(name, props, timestamp) {
      posthog.capture(name, props, { timestamp });
    },
    stop() {
      posthog.opt_out_capturing();
    },
  };
}
