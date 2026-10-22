# Board API

v1.2 target specification; implementation progress is recorded in
[requirements.json](requirements.json), not implied by this reference. [V12-04]
The DOM-free types and constants in `src/api/contract.ts` are shared by page and
Worker. There is no cross-origin API. Validation uses plain guards or generated
standalone validators, never runtime evaluation. [V12-03] [V12-05] [V12-129]

## Endpoints

All paths are same-origin. Bearer means a 128-bit random base64url device key.
Reject missing or malformed credentials as `invalid`. Successful GET and DELETE
responses use 200; a new score uses 201, an idempotent retry 200. An ordinary
client in off/dark mode sees `{ "disabled": true }` on the board GET.

<!-- endpoint-table -->
| Method | Path | Auth | Request | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/board` | none | BoardReadOptions | PublicBoard \| DarkBoard \| DisabledBoard | invalid, unavailable, server |
| GET | `/api/v1/board` | bearer | BoardReadOptions | DeviceBoard \| DarkDeviceBoard \| DisabledBoard | invalid, rate_limited, unavailable, server |
| POST | `/api/v1/scores` | bearer | ScoreRequest | ScoreResponse | invalid, too_large, replay, duplicate, turnstile_failed, rate_limited, update_page, try_later, board_disabled, not_best, removed, week_closed, unavailable, server |
| GET | `/api/v1/scores/<row_id>` | bearer | SmokeReadOptions | ReceiptResponse | invalid, duplicate, not_found, rate_limited, unavailable, server |
| DELETE | `/api/v1/scores/<row_id>` | bearer | none | DeleteResponse | invalid, duplicate, not_found, rate_limited, unavailable, server |
| GET | `/api/v1/health` | none | none | HealthResponse | unavailable, server |
<!-- /endpoint-table -->

GET with a bearer returns the public projection plus that device's part: its
name, this week's best with its standing, and at most one best per retained week
(eight weeks), newest first; without it, only the public projection (except the
dark test context below). There is no history paging: the eight-week purge
bounds the list. Per-game receipts stay in the Worker's receipts table and on
the device; receipt GET identifies the weekly row and returns the current game
id to its owner, so an older local game can show that it was replaced. Keep the
complete personal read, including standing, within one hundred scanned rows.
Hidden or removed
rows return `not_found` on receipt GET; an already-known POST can still return
its own removed receipt. Another owner gets `duplicate`, never receipt data.
Deletion remains available when ranking is off. [V12-95] [V12-96] [V12-97]

## Score payload and hashing

Exactly ten distinct item ids, ten positive integer answer revisions and ten
entries in each answer, skipped and timeout array are required. The payload
field order below is the canonical JSON serialization order before SHA-256.
Nested answers and timeout flags use made, when, kept order; coordinates use
lat then lng. Finite coordinates are bounded to latitude -90..90 and longitude
-180..180. Unknown fields are refused rather than included in a hash. [V12-06]

<!-- payload-fields -->
- `game_id`
- `deck_kind`
- `fresh`
- `deck_hash`
- `answers_revs`
- `scoring_version`
- `item_ids`
- `answers`
- `skipped`
- `timed_out`
- `board_week`
- `client_version`
- `test_assisted`
<!-- /payload-fields -->

The verification token is the additional `turnstile_token` request field and is
excluded from hashing. The bearer key is not in JSON. Names, client totals,
seconds, deadlines and completion timestamps are not payload fields.
`finished_at` is local bookkeeping, not a claim the server verifies. `fresh`
is descriptive only, not a ranking condition. An all-seen challenge is encoded
as replay for ranking; this and test assistance are client-declared. [V12-80]

`answers` holds nullable made/kept points and a nullable year. `timed_out` holds
three booleans per round. A true timeout requires a null answer and scores zero;
photo skips are separate, also zero, and do not become timeouts. Non-skipped,
non-timeout questions require answers. The canonical early-year value is -4001;
the shared normalizer maps input at/below -4000 to it before serialization.
For younger objects the scorer measures it from -4000. No year zero is valid.
[V12-68] [V12-69] [V12-89]

`game_id` is random 128-bit base64url. `board_week` is a server-issued ISO week
such as `2026-W43`, or null if no week was obtained. ISO week validity is checked
at runtime, including year boundaries. The TypeScript template is not a
validator. `client_version` is the contract version, initially 1. [V12-108]

## POST order

The request-IP binding runs after bounded input validation and before the
known-game lookup. It counts retries; the per-key submission binding does not.
Mode and force-off checks run before cache or ranking access. [V12-83] [V12-84]

1. Read at most 4096 streamed bytes and validate schema, credential and version
   shape. Enforce thirty requests per minute per IPv4 or IPv6 /64.
2. For an existing game id, require the same owner and canonical hash. Return
   its own receipt, including replaced/removed status, without verification or
   a submission-limit charge. Otherwise return `duplicate`.
3. Refuse a tombstoned device-week as `removed`.
4. Check eligibility, contract/scoring compatibility, server week and answer
   revisions. A lower revision or retired id requires `update_page`; a higher
   revision or unknown id means `try_later`. Accept the current contract; a
   previous contract is accepted only with an explicit adapter and matching
   scoring version. No previous version exists at contract version 1.
5. Rescore with shared scoring and bundled answer keys. Keep retired keys for
   fourteen days for compatibility diagnostics, not new ranked submissions.
6. If the score cannot improve the weekly best, return `not_best` with `best`.
7. Check three submissions per key per minute and five new device-week rows per
   IP per minute, then siteverify. Check success, expected hostname and action
   `board_submit`, passing remoteip. Each verification retry needs a fresh token.
8. In one transactional `env.DB.batch`, insert or improve only when total is
   greater and no tombstone exists. Receipt changes are conditioned on the
   winning game id. A zero-row race returns `removed` or the fresh `not_best`.

Nothing writes D1 before step 7 has passed. Replacement keeps row id and hidden
status, resets sequence and creation time, updates the old receipt, and relies
on SQLite triggers for bucket counts. Concurrent improvements, removal and
duplicate retries are integration-tested in both orders. [V12-85] [V12-86]
[V12-87] [V12-88] [V12-90] [V12-91] [V12-92] [V12-93] [V12-94] [V12-137]

## Errors

Every error envelope is `{ reason, retryable, retry_after?, request_id?, best? }`.
The table is exhaustive for the contract. The page branches on reason, not
status. `retry_after` is seconds and required on binding rate limits; a WAF
response is normalized client-side to `edge_limited`. [V12-111]

<!-- error-table -->
| Reason | Status | Retryable | Copy key | Analytics reason |
| --- | --- | --- | --- | --- |
| invalid | 400 | false | board.invalid | invalid |
| too_large | 413 | false | board.invalid | too_large |
| replay | 422 | false | board.notRankedReplay | replay |
| duplicate | 409 | false | board.duplicate | duplicate |
| turnstile_failed | 403 | true | board.verificationFailed | turnstile_failed |
| rate_limited | 429 | true | board.pending | rate_limited |
| update_page | 409 | false | board.updatePage | update_page |
| try_later | 503 | true | board.pending | try_later |
| board_disabled | 503 | true | board.unavailable | board_disabled |
| server | 500 | true | board.unavailable | server |
| not_best | 409 | false | board.notBest | not_best |
| removed | 410 | false | board.removed | removed |
| week_closed | 409 | false | board.lastWeek | week_closed |
| edge_limited | 429 | true | board.pending | edge_limited |
| unavailable | 503 | true | board.unavailable | unavailable |
| not_found | 404 | false | board.hidden | not_found |
<!-- /error-table -->

Non-JSON 429 uses Retry-After or bounded backoff. Cloudflare 1027 body markers
identify quota unavailability; other non-JSON failures also become unavailable.
Five automatic retries is the limit; pending data remains and explicit Retry
is offered. An error trace logs exactly request_id, route, error_name, with no
body, IP or key. Worker invocation logging stays disabled in configuration
(`observability.enabled = false`); a configuration test guards it. Redacted
console error tracing is not permission to enable invocation logs. [V12-112]
[V12-114]

## Weeks, ranks and storage

One shared UTC Monday-start `weekId()` helper governs week calculations.
The server returns week and resets_at. A new submission for another week, or
with null board_week, returns `week_closed`: an offline completion is never
silently assigned to the new week. Known retries retain their original week.
When round ten opens, the page sends one nonblocking anonymous GET /board to
obtain week context (deduplicate any in-flight request). It is skipped when the
board UI is off or the device's "Add my games to the board" switch is off, needs
no device key or Turnstile and never delays play.
The page stores finished_at at the round-ten reveal with the last successfully
obtained server week; no client-clock week inference is allowed. A response
arriving after completion cannot rewrite a null or old frozen week. The end
screen's bearer GET refreshes standing only, not completion ownership. A stale
week may be refused safely; it is never reassigned. Tests cover the first online
game, no response before completion, offline reconnect and Sunday/Monday rollover.
This single pre-completion fetch resolves a source-plan gap (a device's first
online game would otherwise always carry a null week); the end screen keeps its
two-call budget, so a game costs at most three API calls. [V12-79] [V12-108] [V12-139]

The best table has UNIQUE(week, player_hash) and index
(week, hidden, total DESC, seq). Equal totals share rank; earlier submission
orders tied rows. Public row ids are random. A separate receipts table keeps
every game outcome for eight weeks. Tombstones prevent current-week recreation;
Remove all creates a current-week tombstone only. [V12-82] [V12-95] [V12-98]

Never persist raw answer pins, IP addresses or user agents. Rescoring is in
memory; retain points, item ids and canonical hashes rather than raw guesses.
DELETE clears the stored name and answer/points detail, retaining only the
minimal owner/game hashes, deletion time and receipt metadata necessary to
prevent resurrection and identify the removed result. Removed responses must
not re-emit cleared detail. Retention ends at the eight-week purge. [V12-97]
[V12-135]

Only public top-fifty JSON enters caches.default, keyed by week and mode, with
TTL min(60 seconds, time to Monday reset). Check mode first. The materialized
projection and counter update in the write batch; cache misses read one or two
rows and can refresh stale data only within that week/mode boundary. Personal
responses always send `Cache-Control: private, no-store`. Normal end-screen
traffic is one bearer GET and one POST, apart from retries. [V12-99] [V12-100]
[V12-139]

Delete, hide and unhide invalidate the affected week's public cache as well as
updating its materialized projection: the Worker deletes the cache entry in the
location that handled the request, and other locations may serve the old
projection until its TTL ends (at most 60 seconds). A warm-cache test checks
that the handling location stops serving a removed or hidden row at once.
[V12-97] [V12-99] [V12-100]
[Cloudflare Cache API scope](https://developers.cloudflare.com/workers/reference/how-the-cache-works/)

POST computes exact rank once and stores receipt_rank. Current GET standing is
bounded to at most 100 scanned rows: exact when bounded, otherwise a top-half
percentile or distance to the top fifty, never a fabricated exact rank. Buckets
are 500 points below 25000, 100 from 25000 through 28000, and 25 above 28000;
TypeScript and SQL share a tested boundary convention for all 30001 totals.
Hidden rows never enter buckets. Weekly purge runs in chunks away from reset,
skipping old-week per-row bucket upkeep. [V12-101] [V12-102] [V12-107]

The read budget includes the receipt page and owner summaries, not only the
standing query. If exact rank cannot fit the remaining budget, use the allowed
approximate standing. Pagination belongs to deliberate history recovery and
does not add background end-screen requests. [V12-95] [V12-101] [V12-139]

## Board modes and security boundary

BOARD_MODE lives in D1 settings, cached in-isolate for at most thirty seconds.
Missing settings mean off; D1 errors mean unavailable. BOARD_FORCE_OFF is a
separate secret and wins even when D1 cannot be read. Releases never reset
either setting. Dark mode writes only smoke_scores with its own unique key;
public ranks, buckets and bests never include those records. Enabling public
mode requires contentApproved and purges current-week smoke rows. [V12-103]
[V12-104] [V12-105] [V12-106]

For dark-mode GET requests only, the client-declared header
`X-MuseumGuessr-Test: 1` selects smoke context. An anonymous board read returns
DarkBoard (server week and reset time, no public list); a bearer board read
returns DarkDeviceBoard (the same context plus only that owner's smoke best
and bounded receipts). The smoke receipt GET uses the same header. Smoke
standing, receipt_rank and final_rank are null, count is zero and cutoff_total
is null. All smoke responses are private, no-store, including anonymous week
context. In off mode the header cannot enable anything; in on mode it cannot
bypass test-assisted rejection or select public-ranked test data. It is not an
authentication mechanism. Ordinary dark reads remain disabled. [V12-105]

Time and test mode are client-declared and are not a security boundary.
Blocking map readiness can give unlimited time. Answer keys ship to the browser
and edited challenge decks may rank. This is a board for fun, not verified
competition. All server text is rendered as text nodes. Credentials go only to
this origin, are never in URLs and never enter analytics. [V12-124] [V12-135]

## Local examples

These examples target the step-3 local dark Worker, not production. The fixed
key below is a public test fixture, never a real player's credential. The
fixture command supplies a canonical score request with the local test token;
GET examples need no Turnstile token. Production rejects dummy credentials.

```sh
curl -sS http://127.0.0.1:8787/api/v1/health
curl -sS http://127.0.0.1:8787/api/v1/board
curl -sS http://127.0.0.1:8787/api/v1/board \
  -H 'X-MuseumGuessr-Test: 1'
curl -sS http://127.0.0.1:8787/api/v1/board \
  -H 'Authorization: Bearer AAAAAAAAAAAAAAAAAAAAAA' \
  -H 'X-MuseumGuessr-Test: 1'
# With a fixture exported by the local test harness:
curl -sS http://127.0.0.1:8787/api/v1/scores \
  -H 'Authorization: Bearer AAAAAAAAAAAAAAAAAAAAAA' \
  -H 'Content-Type: application/json' --data-binary @score-fixture.json
```

The local harness must refresh board_week from its Worker before exporting
score-fixture.json. It sets test_assisted=true and uses the dummy Turnstile
site/secret pair. No real account is needed for the local loop. [V12-126]
[V12-127] [V12-128]
