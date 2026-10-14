// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { API_HOST, CONFIG } from '../../src/analytics/posthog';

describe('[PH1] [ENG39] pinned PostHog init options', () => {
  it('pins every capture-related option', () => {
    expect(API_HOST).toBe('https://eu.i.posthog.com');
    const { before_send, ...rest } = CONFIG;
    expect(typeof before_send).toBe('function');
    expect(rest).toMatchInlineSnapshot(`
      {
        "advanced_disable_feature_flags": true,
        "advanced_disable_feature_flags_on_first_load": true,
        "advanced_disable_flags": true,
        "api_host": "https://eu.i.posthog.com",
        "autocapture": false,
        "capture_dead_clicks": false,
        "capture_exceptions": false,
        "capture_heatmaps": false,
        "capture_pageleave": false,
        "capture_pageview": false,
        "capture_performance": false,
        "cookieless_mode": "always",
        "custom_campaign_params": [],
        "disable_conversations": true,
        "disable_external_dependency_loading": true,
        "disable_persistence": true,
        "disable_product_tours": true,
        "disable_scroll_properties": true,
        "disable_session_recording": true,
        "disable_surveys": true,
        "disable_surveys_automatic_display": true,
        "disable_web_experiments": true,
        "enable_heatmaps": false,
        "mask_personal_data_properties": true,
        "persistence": "memory",
        "person_profiles": "never",
        "rageclick": false,
        "save_campaign_params": false,
        "save_referrer": true,
        "ui_host": null,
      }
    `);
  });
});
