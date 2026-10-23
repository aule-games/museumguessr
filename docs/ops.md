# Operations

v1.2 target runbook; [requirements.json](requirements.json) records what is
implemented. **Commands labelled step 1 or step 3 are unavailable until that
step lands.** No deploy, rollback, DNS change or publication is implied by this
document. Outward actions need explicit approval. [V12-04] [V12-08]

## Hosting and limits

One Worker serves assets and /api/v1 at https://museumguessr.com/ with BASE_PATH=/.
Only /api/* is configured worker-first; unknown non-API requests fall through to
the asset 404 without D1 access. Do not assume junk paths bypass the Worker:
include their invocations in usage checks. Disable workers.dev and preview URLs.
[V12-10] [V12-11] [V12-12]

Use one limits module (`src/api/limits.ts`) for API 4096-byte streamed bodies, top 50, binding windows,
WAF 20/10 seconds, hard-object threshold 2400, city ratio 0.08 and saturation
threshold 29500. The WAF controls bursts, not daily traffic: 20 every 10 seconds
is 172800 per day per IP. Request binding: 30/minute/IP (including retries), new
rows: 5/minute/IP, new submissions: 3/minute/key. IPv6 uses /64. [V12-24]
[V12-84] [V12-91]

| Setting | Exact target |
| --- | --- |
| www DNS | Proxied AAAA record named www with placeholder target 100:: |
| Redirect rule | hostname equals www.museumguessr.com; dynamic target concat("https://museumguessr.com", http.request.uri.path); 301; preserve query string |
| API WAF rate rule | starts_with(http.request.uri.path, "/api/"); per IP; 20 requests; 10-second period; Block; 10-second mitigation timeout |
| Scanner WAF custom rule | ends_with(http.request.uri.path, ".php") or starts_with(http.request.uri.path, "/wp-") or starts_with(http.request.uri.path, "/.env") or starts_with(http.request.uri.path, "/.git"); Block |
| Transport | Always Use HTTPS enabled; HSTS max-age=31536000, no preload |
| Emergency: attack | Security > Settings: "I'm Under Attack" mode on for the zone (every visitor gets a browser check); turn it off after the attack |

Use the zone's DNS Records, Rules > Redirect Rules, Security > WAF rate/custom
rules, and SSL/TLS > Edge Certificates panels. Panel names and permitted rule
options are checked again during setup; if the account cannot express the
approved values, stop rather than enabling a paid tier. [V12-25] [V12-26]

Emergency switches, mildest first: lower the WAF rate threshold; turn the board
off (`npm run board:off`, or the BOARD_FORCE_OFF secret when D1 cannot be read;
step 3); switch on "I'm Under Attack" mode. None of them needs a paid product.
[V12-171]

Every response (assets, API and the Worker-served 404) carries the security
headers from one source: the CSP (header form adds `frame-ancestors 'none'`),
`X-Content-Type-Options: nosniff`, `Referrer-Policy` and `Permissions-Policy`.
The build check fails when the header file and the meta CSP disagree apart from
`frame-ancestors`. [V12-13] [V12-170]

## Commands by build step

| Available from | Command | Purpose |
| --- | --- | --- |
| Existing | npm run verify | Root verification; later steps add Worker, routing and requirement gates |
| 1 | npm run build:deploy | The deploy-profile build CI's verify run and npm run deploy share |
| 1 | npm run setup:check -- --deploy | Runtime, auth, scope, zone, redirect and step-specific prerequisites |
| 1 | npm run cf:bootstrap | Idempotent resource setup; permitted API changes only, otherwise print dashboard values |
| 1 | npm run deploy | Guarded build, artifact checks, optional migration, atomic deployment and live check |
| 1 | npm run rollback -- [version-id] | Previously deployed page/API version; approval required |
| 1 | npm run live:check | SHA, headers, CSP, health, redirects, unblocked 404 and scanner rule |
| 3 | npm run dev:board -- [--reset] | Seeded local dark Worker plus Vite, no real credentials |
| 3 | npm run worker:dev | Local Worker and local migrations |
| 3 | npm run board:off / board:dark / board:on | Write D1 mode; on checks content approval and purges smoke rows |
| 3 | npm run board:list -- [--smoke] | Public/smoke review and saturation count |
| 3 | npm run board:hide -- --week <week> --min-total <n> --since <time> | Validated bulk moderation |
| 3 | npm run board:unhide -- <row-id> | Restore a moderated row and refresh public state |
| 3 | npm run board:purge-smoke | Remove smoke data with count |
| 3 | npm run board:tail | Redacted Worker error stream |
| 3 | npm run names:block -- "<name>" | Versioned pair blocklist; only blocked names change |
| 3 | npm run items:record | Refresh the reviewed answer-revision baseline |

Scripts share one process runner and refusal format: what failed, safe actual
values, why, next command and a runbook anchor, with distinct exit classes.
Validate identifiers and numbers before invoking fixed SQL statement files;
never compose SQL with untrusted arguments. [V12-28] [V12-110]

The runner is `scripts/lib/ops.mjs`. A refusal prints `✖ <what failed>`,
`why:` with the values that matter, `next:` with the command to run and
`docs:` with an anchor in this file. Exit codes by class:

| Exit | Class | Example |
| --- | --- | --- |
| 1 | unexpected error | a bug in the script itself |
| 2 | usage | an unknown argument or a malformed version id |
| 3 | environment | wrong Node major, missing credentials |
| 4 | git | dirty tree, HEAD is not origin/main |
| 5 | ci | the verify check for the SHA is not green |
| 6 | build | npm ci, the profile build or the build id failed |
| 7 | artifact | check-build or the release scan of dist/ failed |
| 8 | approval | --yes (or --force) is needed |
| 9 | remote | a wrangler or Cloudflare API call failed |
| 10 | live | live:check found a difference |
| 11 | scope | a zone other than museumguessr.com |

## Switches

| Switch | Where / who | Default by profile | Effect | Change / test |
| --- | --- | --- | --- | --- |
| VITE_BOARD_UI | Tracked public profile / developer | dev off; board-test on; deploy off through step 2 | Panel, Turnstile CSP and key requirement | Profile commit; invalid-combination build fixtures |
| VITE_BUILD_PURPOSE | Tracked profile / build | dev, board-test or deploy | Test surfaces and artifact identity | Build profile; artifact check |
| BOARD_MODE | One D1 settings row / operator | missing row off; local loop dark | Public ranking off/dark/on | board commands; persists across deploy and rollback |
| BOARD_FORCE_OFF | Worker secret / operator | unset | Force off even if D1 cannot be read | Secret operation; D1-failure test |
| ?test= | Browser / tester | off; explicit flag lasts 24 hours | Analytics suppressed; games retain test provenance | ?test=1 or ?test=0; expiry and provenance tests |
| BASE_PATH | Public profile / developer | / in every profile | Asset routing | Profile commit; URL build test |
| VITE_SITE_URL | Public profile / developer | deploy https://museumguessr.com/ | Canonical and share origin | Profile commit; URL hygiene test |

Public tokens, hosts, site key, base path and purpose come from one committed
profile, `deploy/profile.json`, not shell overrides in deployment. Board off needs no Turnstile key;
board on in deploy refuses dummy site keys. A development untimed override and
end fixture are absent from deployed output. [V12-18] [V12-125] [V12-127]

`scripts/build.mjs` (npm run build:deploy, and build:e2e for verify) is the
only way the deploy profile is built: it reads the profile, refuses any shell
variable that differs from it, removes every CLOUDFLARE_* value and sets the
build id. Vite refuses invalid combinations at build time (board UI on without
a site key, a Turnstile test key in a deploy build, a non-`phc_` analytics
token); each page carries `<meta name="build-purpose">` and check-build fails a
deploy build that ships development fixture code. The tracked profile keeps a
placeholder analytics token until the main session commits the public project
token; `npm run deploy` refuses the placeholder.

## Preflight and credentials

Require Node 24, installed step-dependent Worker dependencies, authenticated gh,
working wrangler identity, the active game zone and the exact required account
and zone permissions. Step 3 also needs the D1 binding and TURNSTILE_SECRET.
Verify the www 301. Missing checks print the corrective command. [V12-21]

Account operations use CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID supplied
through the operator's secure environment. Never put secrets in tracked files,
public profiles, command-line values or GitHub. Requested permissions are Workers
Scripts edit, D1 edit and Turnstile edit on the account; game-zone read and
Workers Routes edit, plus DNS edit, redirect-rule edit, WAF edit and zone-setting
edit only when automating those tasks. Confirm current permission names during
preflight. Limit zone scope to museumguessr.com; reject every other zone.
Build/install/test children receive no CLOUDFLARE_* values. [V12-22] [V12-23]

Bootstrap creates missing resources only. Database ids are public config diffs
to review and commit. Pipe a newly created Turnstile secret to wrangler secret
put via stdin; never print or persist it. If zone permissions are unavailable,
print the table above instead of guessing or changing another zone.

`npm run setup:check -- --deploy` prints one line per check (✓, ✖ with its
fix, ! for an optional permission, - for a step-3 check that is not due):
Node, the pinned wrangler in `worker/` (`npm ci --prefix worker`), gh, the
credentials in the shell, `wrangler whoami`, the zone and its status, the
token's zone scope (museumguessr.com only), Workers Scripts and Workers Routes,
the optional DNS, rules and zone-setting permissions, the www 301 and, once
the config has a D1 binding, D1, Turnstile and TURNSTILE_SECRET.

`npm run cf:bootstrap` reads first and prints what it would create; nothing
changes without `--yes`. It covers the www record, the redirect rule, the API
burst rule, the scanner rule, Always Use HTTPS and HSTS (values in
`scripts/lib/zone-rules.mjs`, equal to the table above). A setting the token
may not manage, or one that already exists with other values, is left alone
and printed as a founder task with its dashboard value. `--board` (step 3)
adds the D1 database and the Turnstile widget and secret.

## Deploy and rollback

The first hosting commit removes manual dispatch and the Pages deploy job;
CI becomes verify-only. Disable PAGES_LIVE before the first push. This variable
change itself requires authorization. Later, unpublish Pages only after the
custom-domain live check and explicit approval. Saves do not cross origins.
[V12-14] [V12-33]

Deploy fetches and requires a clean HEAD equal to origin/main and a green
verify check for that exact SHA. Install locked dependencies with Node 24,
build the deploy profile, check its SHA, move source maps aside, run build
checks and the generated-output release scan before any remote mutation.
Then apply migrations when D1 is bound and deploy page/API together. Record
SHA, migration count and state/scoring/contract versions in the deployment
message, not a tracked log that dirties the tree. Run live:check. [V12-15]
[V12-16] [V12-17] [V12-29]

Rollback lists previous deployments, defaults to the previous one, prints the
URL and needs approval. It is exempt from HEAD matching main but only accepts
previously deployed versions. Crossing state, scoring or contract versions warns
and requires --force; it never silently changes the board mode. [V12-19]
[V12-104] [V12-138]

How to run them (`scripts/deploy.mjs`, `scripts/rollback.mjs`):

1. `npm run deploy` runs every check above and the build, prints the exact
   URL and stops: nothing remote changes. After the founder's yes on
   https://museumguessr.com/, `npm run deploy -- --yes` repeats the checks,
   then migrates (only with a D1 binding), runs one `wrangler deploy` with the
   message `<sha> state:<n> scoring:<n> contract:<n> migrations:<n>` and
   `WORKER_VERSION=<sha>`, prints the board switch before and after, and runs
   live:check. Source maps are kept under `node_modules/.cache/deploy/<sha>/`.
2. `npm run rollback` lists the deployments and names the previous version;
   `npm run rollback -- <version-id> --yes` rolls back (add `--force` when it
   warns about a version change), then runs live:check against that build.

Migrations are forward-only and additive: new columns nullable or defaulted,
no reused column meaning, no dropped/renamed columns. If migration succeeds and
deploy fails, retry the same SHA. If data restoration is necessary, record a D1
Time Travel bookmark and obtain approval before restoring; schema changes are
not undone by Worker rollback. Free Time Travel retains seven days. [V12-20]
[Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

## Live check

`npm run live:check [-- --sha <sha>]` (`scripts/live-check.mjs`; the SHA
defaults to HEAD) checks https://museumguessr.com/ and prints one line per
check: the page's build-id meta equals the SHA; the page sends the
`_headers` values; the header CSP equals the meta CSP plus `frame-ancestors
'none'`; the zone sends `Strict-Transport-Security: max-age=31536000` without
preload; `/api/v1/health` reports this build's scoring version, pool hash,
contract version and SHA (and the board mode); www and http answer 301 to the
https apex keeping path and query; an unblocked unknown path returns the 404
page with status 404 and the security headers; `/wp-login.php` is blocked
with 403 (a warning until the scanner rule exists). With a token that may
read rate-limit rules it compares the API burst rule with
`src/api/limits.ts`. Any failure exits with the live class and names the
rollback. [V12-25] [V12-26] [V12-27]

## Daily KPI check (decision window)

This check runs today for the live release-1.1 game and stays after the move.
Once a day while the KPI is being measured, about 5 minutes:

1. **KPI funnel** (the PostHog insight on the "MuseumGuessr v0" dashboard):
   conversion per `src`. Note the visitor-days per channel; below 100 the KPI
   reads "inconclusive".
2. **Errors by build:** run [`errors-by-build.sql`](../analytics/queries/errors-by-build.sql).
   Normal: zero or a handful of `client_error` spread over old builds. A new
   build id at the top right after a deploy means the runbook below.
3. **Spikes:** run [`spike.sql`](../analytics/queries/spike.sql). An hour with
   many visitor-days and a `no_start_percent` near 100 is bot-like traffic;
   note the hour and `src` so the decision report can exclude it.
4. **Event cap:** run [`cap.sql`](../analytics/queries/cap.sql). Above 60% of
   the month's 1,000,000 events, tell the founder: a billing limit, an upgrade,
   or dropping `step_completed` are the options.

From step 1 the quota checks below join this routine.

## Runbook: errors after a deploy

1. Read errors-by-build and the failing build id; inspect board:tail for the
   request_id, route and error_name only.
2. For a board incident set board:off. If D1 is unavailable, use the independent
   BOARD_FORCE_OFF secret. Keep the game available.
3. With approval, rollback to a known deployed version. Do not change schema
   destructively or enable a paid plan as an incident shortcut.
4. Run live:check and confirm new errors stop; fix forward with the same gates.

| Observed response | Layer | Check |
| --- | --- | --- |
| HTML 429 | Edge WAF | Retry-After, rate-rule match; pending data kept |
| HTML with 1027 marker | Workers quota | Daily usage; board unavailable, game still works |
| JSON unavailable | D1/mode read or infrastructure | D1 limits and force-off; no lost pending submit |
| JSON rate_limited | Worker bindings | IP/key windows; bounded retry |
| JSON server + request_id | Worker exception | Redacted tail record and build id |
| Successful old public list | Public cache | Updated-at, week, mode; use own confirmed receipt |

Five automatic retries maximum; explicit Retry remains. [V12-111] [V12-112]
[V12-114]

Worker invocation logging is disabled (`observability.enabled = false`) and
guarded by a configuration test. board:tail may stream redacted console errors
containing only request_id, route and error_name; it must not enable stored
invocation logs. Do not store request bodies, raw pins, IPs or user agents.
Removal clears stored name and answer/points detail; hide, unhide and removal
also delete that week's public projection cache entry where the request ran;
other locations converge within the 60-second cache lifetime. [V12-97] [V12-99] [V12-112] [V12-135]

## Quota budget and daily check

Workers Free is the accepted operating mode. A quota outage is not permission
to enable Workers Paid or any paid product. The WAF cannot guarantee daily
volume. Use Cloudflare's current free allowances and measure index/trigger costs,
not merely SQL statement counts. [V12-34] [V12-130]

| Path | Measured rows read / request | Measured rows written / request | Illustrative requests/day | Daily reads / writes |
| --- | --- | --- | --- | --- |
| Public cache miss | 1 (the week's projection row), plus the settings row once per 30 s per isolate | 0 | 1440 | 1440 / 0 |
| Bearer board read | 11-19 (bound 100: 8 weekly bests, the current receipt, the projection row, at most 81 bucket rows and a capped scan) | 0 | 10000 | 190000 / 0 |
| Receipt read | 3-17 (same bound) | 0 | included above | — |
| Accepted score | 220-517 (bucket counts above the total plus the rows of its own bucket, for the exact rank; the top-50 rebuild when the total reaches the cutoff) | 7-9 | 2000 | 1034000 / 18000 |
| Non-improving score | 1 (this week's best), plus the known-game and tombstone lookups | 0 | 8000 | 8000 / 0 |
| Removal | 212 (the top-50 rebuild) | 9-10 | rare | — |
| Purge (hourly cron) | up to 500 rows per table per run | about 500 per run (661 on the run that also drops the week's buckets); a 10,000-row week takes 20 runs | 24 runs, most deleting nothing | under 12000 / 12000 while a large week drains |

Measured with `meta.rows_read` and `meta.rows_written` on real local D1
(worker/tests/board-d1.smoke.ts) on 10,000-row weeks with concentrated
(28000-28499) and all-equal (20000) totals; index and trigger writes are
included. These are local measurements, not production capacity: recheck the
D1 dashboard after launch. At 7-9 writes per accepted add, about 11000 adds a
day use the whole free write allowance; the other paths reduce that ceiling.
A week whose totals crowd into one 25-point bucket raises an accepted add's
reads by that bucket's size. D1 Free currently allows 5000000 reads and 100000
writes/day, resetting at UTC midnight.
[Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)

Purge after eight weeks in small repeated batches away from Monday 00:00 UTC;
old-week triggers skip bucket maintenance and old buckets are removed together.
Mode uses a thirty-second cache and missing settings mean off, not on.
[V12-103] [V12-107]

Launch day: inspect invocation counts (including junk paths), D1 usage, WAF
blocks, 5xx and PostHog budget. After each of the first three fifty-visitor
cohorts inspect reveal reach, answered completion and timeout share separately;
no automatic timer change follows. board:list reports top-fifty scores at or
above 29500; more than ten prompts a ranking review, never an inference from
unstored seconds. [V12-136] [V12-167]

## Running a query

Each file in [`analytics/queries/`](../analytics/queries) is HogQL. Files with
`__START__` need a start time first (UTC, `YYYY-MM-DD HH:MM:SS`).

**Through an agent with the PostHog MCP:** paste the file's text into the
`execute-sql` tool for project 304461 (the numeric PostHog project id; it is
not the `project_id = 'museumguessr'` event tag, which the queries filter on).

**From a terminal:** copy [`analytics/env.example`](../analytics/env.example)
to a file outside the repository (for example `~/.config/museumguessr.env`),
put in a personal API key with query read access, then:

```sh
set -a; . ~/.config/museumguessr.env; set +a
q=$(sed 's/__START__/2026-10-20 18:00:00/' analytics/queries/smoke.sql)
jq -n --arg q "$q" '{query: {kind: "HogQLQuery", query: $q}}' |
  curl -sS -X POST "$POSTHOG_API/api/projects/$POSTHOG_PROJECT_ID/query/" \
    -H "Authorization: Bearer $POSTHOG_PERSONAL_API_KEY" \
    -H 'Content-Type: application/json' -d @- |
  jq '{columns, results}'
```

Never commit the key, paste it into an issue, or put it in a build variable:
only the public `phc_` project token goes into the build.


## Smoke test before launch

Use https://museumguessr.com/?utm_source=smoke. Record a UTC start time, play
three rounds on Wi-Fi, then open once on a second network. Query smoke.sql and
check both visits and the expected reveal/answer events. Expect two visitors
(manual row PH7); cookieless identities can collapse, so if they merge into one,
record the observed count and why rather than marking the row passed.
The launch funnel begins at the first approved public post, not the test run.
Before public ranking, run a complete dark-board smoke loop and purge its rows.
[V12-165]

## Keep your own visits out

Open ?test=1 in each browser before testing. The flag expires after 24 hours;
renew it each testing day and after clearing storage. ?test=0 enables ordinary
analytics again but never removes test assistance from an existing game. Never
share test, fixture or clock parameters. [V12-55] [V12-56]

## Moving to another domain

Step 1 moves the game from the GitHub Pages path to https://museumguessr.com/.
Any later move changes the same list, in one commit: [V12-172]

1. The tracked public profile: `BASE_PATH`, `VITE_SITE_URL` (canonical and share
   origin) and the analytics host list (`ANALYTICS_HOSTS`).
2. `index.html`: the canonical link and the `og:url` and `og:image` URLs.
3. The Playwright configuration (base URL and path) and any test that names the
   address.
4. README and docs that name the address, and the release scan's exemptions for
   the public address.
5. The Worker route or custom domain and the www redirect values in the table
   above.

Then check the build at the new base path, deploy (with approval) and run
`live:check`. The founder confirms PostHog's authorised URLs, a shared project
setting. After the deploy open `?test=1` on the new origin in every test
browser: the flag is per origin. Saved games do not move between origins.

## Local board loop

The step-3 dev:board command builds missing assets, applies local migrations,
seeds dark-mode fixtures (including a higher score for not_best), starts the
Worker on 127.0.0.1:8787, waits for health, then starts Vite with /api proxy.
It prints the URL and shuts both processes down on exit. --reset clears local
D1 and requests a browser-key reset. The fixture end-random is test-assisted.
Root install does not install Worker dependencies; Worker scripts and verify
install their exact locked dependencies explicitly when needed. [V12-126]
[V12-127] [V12-129]

```sh
npm ci --prefix worker          # once: the Worker's pinned wrangler
npm run dev:board               # [-- --reset] [--port 8787] [--vite-port 5173]
```

`scripts/dev-board.mjs` keeps its own local database in `.wrangler/board-loop`
and seeds one smoke row of 29,000 this week for the public fixture key
(`AAAAAAAAAAAAAAAAAAAAAA`, docs/api.md "Local examples"). Vite runs the
board-test switches: board UI on, Cloudflare's always-pass Turnstile test key
(the widget loads from Cloudflare, so the loop needs a network) and `/api`
proxied to the Worker. The development and board-test builds have three
fixtures, compiled out of every deploy build (check-build fails one that
still carries them):

| Address | What it does |
| --- | --- |
| `/?fixture=end-random` | sets the fixture key, asks the Worker's dark week context, finishes a test-assisted game with random answers: a smoke submission that meets not_best against the seed |
| `/?fixture=end-best` | the same with exact answers (30,000): a smoke add that beats the seed |
| `/?fixture=reset-board` | forgets this browser's board key, records, switch and standing line |

The timed row "a fresh clone to a local board submit" (target 3 minutes) runs
`git clone`, `npm ci`, `npm ci --prefix worker`, `npm run dev:board` and
opens `/?fixture=end-random` until the card shows the not_best line.

## Board operations

Step 3 commands (`scripts/board.mjs`). Each changes the remote board database
only with the founder's credentials in the shell and `--yes`; with `--local
[--persist-to <dir>]` it acts on the local database that `wrangler dev` uses,
without credentials.

- `npm run board:off`, `board:dark` and `board:on` write the one settings row
  from a fixed statement file in `scripts/sql/`. Workers see the new mode
  within 30 seconds; deploys and rollbacks never change it. `board:on`
  refuses until the content gate passes (contentApproved:
  `data/content-approval.json` records batches F and T promoted, or F
  promoted with the approved F-only fallback), then removes every dark-mode
  test row, receipt and tombstone and prints how many.
- `npm run board:list [-- --smoke] [--week 2026-W43]` prints the mode, the
  device count, the top 50, the hidden rows and the saturation tripwire: how
  many top-50 totals reach 29,500. More than ten prompts a ranking review;
  seconds are never stored, so the review never uses them. `--smoke` lists
  dark-mode test rows.
- `npm run board:hide -- --week <week> --min-total <n> --since <date>
  [--reason <word>]` first prints how many rows it would hide; with `--yes`
  it hides them, logs one moderation row each (row id, week, action, reason
  word and time; no personal data) and rebuilds that week's public top 50 in
  the same statement file. `npm run board:unhide -- <row-id>` restores one
  row. Arguments must match strict patterns (week id, whole number, date,
  12-character row id, lower-case reason word) before they reach a fixed
  template; anything else is refused with exit 2. Cached copies of the public
  board converge within 60 seconds (a Worker DELETE also drops the copy where
  it ran).
- `npm run board:purge-smoke` removes every dark-mode test row and prints the
  count.
- `npm run board:tail` wraps `wrangler tail` and prints only the Worker's own
  error lines: time, request id, route and error name. It never prints a URL,
  header, body, key or IP, and it does not turn on stored invocation logs.
- `npm run worker:dev [-- --port 8787] [--persist-to <dir>] [--mode dark]`
  applies the local migrations, writes the local mode (dark by default) and
  runs `wrangler dev` on 127.0.0.1 with Cloudflare's always-pass Turnstile
  test secret, hostname `example.com` and `TURNSTILE_TEST_KEYS=1`, all local
  only; the deployed Worker refuses test keys.

The hourly cron (`17 * * * *`) purges rows older than the eight retained
weeks, 500 rows per table per run, and skips the two hours on either side of
Monday 00:00 UTC. It also writes the final rank of each closed week's listed
50 once; rows below the top 50 keep no final rank. [V12-103] [V12-106]
[V12-107] [V12-110] [V12-112] [V12-136]

## Board names

Public rows show a generated three-word name ("Quality Material Thing") from
`src/board/names.ts`, seeded by sha256 of the device key, so a device keeps its
name every week and nobody types one. The word lists in
`src/board/name-words.ts` are append-only (over 1,000,000 names, no number
suffix); a unit test checks every word and every adjacent pair against
`data/name-list.json`. To retire a name or a word pair, run
`npm run names:block -- "Amber Heron"` (one to three words in name order): it
appends the sequence to `src/board/name-blocklist.json`, and only names that
contain it derive again with the next salt. Commit the file and deploy; the
page and the Worker share it. Never remove an entry or edit a word list.
[V12-109] [V12-110]

## Release checklist

| Step | Agent evidence | Founder tasks | Gate |
| --- | --- | --- | --- |
| 0 | Final specs, shared contract and requirement ledger | None after writer takeover | Foundation tests |
| 1 local | Hosting/security scripts and verify-only CI; exact artifact tested | None while local | No remote changes |
| 1 release | Preflight, PAGES_LIVE disabled, root URL, redirect/header/health checks | Explicit yes to https://museumguessr.com/ and each push/deploy; zone-only token scope; www record/redirect; WAF rules; HTTPS/HSTS unless permitted automation; shared PostHog authorized URL | No deployment without yes |
| Old hosting retirement | Custom-domain live check passed | Explicit yes before unpublishing GitHub Pages | No old-origin replacement page |
| 2 | Timer/year/rules tests; keyboard timing; active-time evidence | No novice observation requirement | Timed implementation |
| 3 | Local loop, dark live loop, quotas and security tests | Any missing secure credential supplied through a secure form; explicit deployment yes | Ranking stays off/dark |
| 4 | Complete evidence, image audit and full-pool validation | Separate approval of F and T contact sheets, or explicit F-only fallback | contentApproved |
| 5 | Visual review, no blocking findings, every automated row and content gate passed | Yes on exact URL for each deploy; launch timing and posts separately approved | No implied public launch |

Do not mark skipped, failed or manual checks as passed. The requirement ledger
must cover the built steps. A fresh clone to local board submit is timed against
three minutes when step 3 exists. All launch copy uses the actual pool and
current privacy wording. [V12-163] [V12-164] [V12-166] [V12-168]
