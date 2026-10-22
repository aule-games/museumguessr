// The exact zone settings docs/ops.md "Hosting and limits" lists (ENG13,
// ENG15, ENG16, W2; V12-24, V12-25, V12-26). cf:bootstrap creates them when
// the token allows, otherwise prints DASHBOARD; a docs test keeps the
// runbook table and these values equal.

import { LIMITS } from '../../src/api/limits.ts';

export const WWW_HOST = 'www.museumguessr.com';

export const WWW_RECORD = { type: 'AAAA', name: WWW_HOST, content: '100::', proxied: true, ttl: 1 };

export const REDIRECT_RULE = {
  description: 'museumguessr: www to the apex',
  expression: `(http.host eq "${WWW_HOST}")`,
  action: 'redirect',
  action_parameters: { from_value: { status_code: 301, target_url: { expression: 'concat("https://museumguessr.com", http.request.uri.path)' }, preserve_query_string: true } },
  enabled: true,
};

export const RATE_RULE = {
  description: 'museumguessr: API burst limit',
  expression: '(starts_with(http.request.uri.path, "/api/"))',
  action: 'block',
  ratelimit: { characteristics: ['ip.src', 'cf.colo.id'], period: LIMITS.waf.periodSeconds, requests_per_period: LIMITS.waf.requests, mitigation_timeout: LIMITS.waf.mitigationSeconds },
  enabled: true,
};

export const SCANNER_RULE = {
  description: 'museumguessr: scanner paths',
  expression: '(ends_with(http.request.uri.path, ".php") or starts_with(http.request.uri.path, "/wp-") or starts_with(http.request.uri.path, "/.env") or starts_with(http.request.uri.path, "/.git"))',
  action: 'block',
  enabled: true,
};

export const HSTS = { enabled: true, max_age: 31536000, include_subdomains: false, preload: false, nosniff: false };

/** The dashboard values to set by hand when the token may not (the runbook's table). */
export const DASHBOARD = {
  'www DNS': 'Proxied AAAA record named www with placeholder target 100::',
  'Redirect rule': 'hostname equals www.museumguessr.com; dynamic target concat("https://museumguessr.com", http.request.uri.path); 301; preserve query string',
  'API WAF rate rule': `starts_with(http.request.uri.path, "/api/"); per IP; ${LIMITS.waf.requests} requests; ${LIMITS.waf.periodSeconds}-second period; Block; ${LIMITS.waf.mitigationSeconds}-second mitigation timeout`,
  'Scanner WAF custom rule': 'ends_with(http.request.uri.path, ".php") or starts_with(http.request.uri.path, "/wp-") or starts_with(http.request.uri.path, "/.env") or starts_with(http.request.uri.path, "/.git"); Block',
  Transport: 'Always Use HTTPS enabled; HSTS max-age=31536000, no preload',
};
