// URL and campaign sanitiser (PH2, ENG39). Runs on every event before it is
// sent: URL-valued properties keep only utm_* and ref query parameters, and
// click ids that posthog-js derives from the URL are dropped.

const KEEP_PARAM = /^(utm_[a-z_]+|ref)$/;

/** Click and campaign ids other than utm_* (posthog-js CAMPAIGN_PARAMS and friends). */
const CLICK_IDS = new Set([
  'gclid',
  'gad_source',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'twclid',
  'li_fat_id',
  'igshid',
  'ttclid',
  'rdt_cid',
  'epik',
  'qclid',
  'sccid',
  'irclid',
  '_kx',
  'mc_cid',
  'mc_eid',
  'yclid',
  '_openstat',
]);

const UTM_VALUE = /^[A-Za-z0-9._-]{1,64}$/;

export function sanitizeUtmValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return UTM_VALUE.test(value) ? value : 'other';
}

/** Keep only utm_* (validated) and ref parameters; drop the fragment. */
export function sanitizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.split(/[?#]/)[0] ?? '';
  }
  const kept = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (!KEEP_PARAM.test(k)) continue;
    kept.append(k, k.startsWith('utm_') ? String(sanitizeUtmValue(v)) : v.slice(0, 64));
  }
  const qs = kept.toString();
  return `${url.origin}${url.pathname}${qs ? `?${qs}` : ''}`;
}

const looksLikeUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v);

function baseKey(key: string): string {
  return key.replace(/^\$initial_/, '').replace(/^\$/, '');
}

/** Sanitise one property bag in place-free fashion; walks nested $set / $set_once (ENG39). */
export function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    const base = baseKey(key);
    if (CLICK_IDS.has(base)) continue;
    if ((key === '$set' || key === '$set_once') && value && typeof value === 'object') {
      out[key] = sanitizeProps(value as Record<string, unknown>);
      continue;
    }
    if (base.startsWith('utm_')) {
      out[key] = sanitizeUtmValue(value);
      continue;
    }
    out[key] = looksLikeUrl(value) ? sanitizeUrl(value) : value;
  }
  return out;
}

export interface CaptureLike {
  event: string;
  properties?: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
  [k: string]: unknown;
}

/** posthog-js `before_send` hook. */
export function beforeSend<T extends CaptureLike | null>(event: T): T {
  if (!event) return event;
  const next: CaptureLike = { ...event };
  if (event.properties) next.properties = sanitizeProps(event.properties);
  if (event.$set) next.$set = sanitizeProps(event.$set);
  if (event.$set_once) next.$set_once = sanitizeProps(event.$set_once);
  return next as T;
}
