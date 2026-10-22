// Cloudflare API helpers for setup:check, cf:bootstrap and live:check
// (H5, N6; V12-21, V12-22). The token comes from the environment at the
// moment of the call and goes only into the request header. Zone calls
// refuse every zone other than museumguessr.com.

import { refuse, ZONE } from './ops.mjs';

export const API = 'https://api.cloudflare.com/client/v4';

/** An API client; fetchImpl is injected so tests run against recorded responses. */
export function cloudflare({ env, fetchImpl = fetch }) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  async function call(method, path, body) {
    if (!token) refuse({ kind: 'environment', what: 'CLOUDFLARE_API_TOKEN is not set', why: 'account and zone calls need the API token from your secure environment', fix: 'export CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in this shell, then rerun', anchor: 'preflight-and-credentials' });
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, ok: res.ok && json?.success !== false, json, result: json?.result };
  }
  let zoneId = null;
  /** The museumguessr.com zone id; any other name is refused before a request is made. */
  async function zone(name = ZONE) {
    if (name !== ZONE) refuse({ kind: 'scope', what: `zone ${name} is not museumguessr.com`, why: 'these scripts may only read or change the game zone', fix: `use ${ZONE}`, anchor: 'preflight-and-credentials' });
    if (zoneId) return zoneId;
    const r = await call('GET', `/zones?name=${ZONE}`);
    const z = r.result?.find?.((x) => x.name === ZONE);
    if (!r.ok || !z) refuse({ kind: 'remote', what: `zone ${ZONE} not found (HTTP ${r.status})`, why: 'the token cannot read the game zone, or the zone is not in this account', fix: 'give the token Zone Read on museumguessr.com, then run npm run setup:check -- --deploy', anchor: 'preflight-and-credentials' });
    zoneId = z.id;
    return zoneId;
  }
  return {
    account,
    call,
    zone,
    /** A call under /zones/<id>: only ever the game zone. */
    async zoneCall(method, path, body) {
      return call(method, `/zones/${await zone()}${path}`, body);
    },
    async accountCall(method, path, body) {
      if (!account) refuse({ kind: 'environment', what: 'CLOUDFLARE_ACCOUNT_ID is not set', why: 'account calls (Workers, D1, Turnstile) need the account id', fix: 'export CLOUDFLARE_ACCOUNT_ID in this shell, then rerun', anchor: 'preflight-and-credentials' });
      return call(method, `/accounts/${account}${path}`, body);
    },
  };
}
