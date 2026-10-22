# Analytics

v1.2 target specification; see [requirements.json](requirements.json) for implemented
gates. Instrumentation lands with steps 1–3; the existing catalogue and query files
are migrated with those steps, not claimed complete by this document. [V12-04]

What the game measures, how, and what the numbers cannot tell you. The daily
routine and the incident steps are in [ops.md](ops.md).

## Why there is analytics at all

v0 is a test of one question: do people who open the game play at least three
rounds? Everything sent serves that question or tells us the game broke.
No sign-up, cookies, session recording or autocapture. A device-local last-active
ISO-week marker supports the return measure below; it is the only new analytics
storage. A per-game random reference is not reused across games. These are
approximate device measures, not a claim of irreversible anonymity. [V12-132]

## Configuration

| Setting | Where | Value |
| --- | --- | --- |
| Provider | `src/analytics/posthog.ts` | PostHog Cloud EU (`https://eu.i.posthog.com`), `cookieless_mode: 'always'`, `person_profiles: 'never'`, memory persistence, no autocapture, no session recording |
| Project | PostHog | project id `304461`, shared with other side projects |
| Tag on every event | `src/analytics/core.ts` | `project_id = 'museumguessr'` and `build_id` (the short commit SHA) |
| `VITE_POSTHOG_PROJECT_TOKEN` | Tracked public build profile (step 1) | the public project token (`phc_…`); a build stops if it is anything else. Empty means analytics off |
| `VITE_ANALYTICS_HOSTS` | Tracked public build profile (step 1) | comma-separated allowed hostnames; deploy uses museumguessr.com |

Because the project is shared, **every query and insight filters
`project_id = 'museumguessr'`**, except the event-cap check, which must count
the whole project. A unit test enforces this for the queries in
[`analytics/queries/`](../analytics/queries).

## When nothing is sent

Analytics stays off, and the console says why (`analytics: off (<reason>)`):

| Reason | When |
| --- | --- |
| `test flag` | the browser opened the site with `?test=1` (until `?test=0`; from v1.2 also after 24 hours) |
| `webdriver` | the browser is automated (`navigator.webdriver`) |
| `no token` / `invalid token` | the build has no project token, or not a `phc_` one |
| `host not allowed` | the page is not on a host in `VITE_ANALYTICS_HOSTS` |
| `provider chunk import failed` | the PostHog script could not be loaded (blocked or offline) |
| `provider not ready after 10 s` | posthog-js did not start within 10 s; queued events are dropped |

In development without a token, events print to the console instead.

The PostHog script loads only after the first screen has painted. Until then,
events wait in a queue of up to 100 (a full game sends about 56). The queue
never drops `$pageview` or `round_completed`, keeps each event's time, and is
discarded if the provider is not ready after 10 s. Open `?test=1` and tap the
test badge to see the events that would have been sent and the queue counts.

## Events

Event contract (the runtime catalogue and About text are updated with the owning
implementation step; newly specified events do not fire in the step-0 build):

| Event | Properties | Fires | Once per |
| --- | --- | --- | --- |
| `$pageview` | `src`, `landing` (first load in this tab session), `resumed` (a saved game was restored) | each page load, after the first screen renders | every load counts |
| `game_start` | `game_ref`, `country_cap_missed` (step 2), `src`, `deck_kind` (`random`, `challenge`, `replay`), `game_in_tab` (`1`, `2`, `3+`), `seen_before` (`0`, `1-9`, `10-19`, `20-29`, `30+`: a rough count of objects this device had seen) | a new game starts (Start, Play another 10, a challenge, Replay) | game |
| `round_started` | `game_ref`, `src`, `round` (1-10), `item_id` | a round is shown the first time | game and round |
| `step_completed` | `src`, `round`, `step` (`made`, `when`, `kept`), `item_id` | an answer is confirmed (a changed answer after Back is not sent again) | game, round and step |
| `step_back` | `src`, `round`, `from` (the step left: `when`, `kept`) | the player taps Back to change an earlier answer | every Back |
| `round_completed` | `game_ref`, `active_ms`, `ready_ms` (step 1), `timed_out` (0–3), `seconds_left` (step 2), `src`, `round`, `item_id`, `skipped`, `answered_count` (answered rounds so far), `points` (0-3000), `made_points`, `when_points`, `kept_points` (0-1000 each), `first_seen` (the device had not seen the object before this game) | the reveal visibly opens through the deduplicated reveal_shown action; photo-failure skips remain separately flagged | game and round |
| `game_completed` | `game_ref`, `src`, `total` (0-30000), `answered_count` | the round-ten reveal first opens; returning to the end screen never repeats it | game |
| `client_error` | `name`, `message` (first 80 characters, URLs removed), `frame` (chunk:line:col) | an uncaught error in game code, or the map cannot run | at most 3 per tab session |
| `feedback` | `src`, `q` (`difficulty`, `most_fun`), `a` | the optional difficulty row (after round 3) or the "most fun" row (end) | game and question |
| `result_shared` | `src`, `total`, `method` (`native` for the phone's share sheet, `whatsapp`, `x`, `copy`, `manual`), `kind` (`challenge`, `reply`), `first_in_game` | a share sheet completes, a share button opens its target or the link is copied (a cancelled sheet or a closed chooser sends nothing) | every share (`first_in_game` marks the first) |
| `challenge_opened` | `src`, `valid` (10 known objects), `has_score`, `own_deck` (the deck this device just finished) | a challenge link's screen first renders | challenge link and tab session |
| `challenge_completed` | `game_ref`, `src`, `beat` (`true`, `false`, or `null` without a comparable score) | a challenge game ends | game |
| `tour_ended` | `src`, `outcome` (`done`, `skipped`), `step` (last step shown, 1-7), `replay` (opened from the menu) | the game tour closes | every close |
| `week_active` | `week`, `active_last_week`, `src` | a game first completes this ISO week (its round-10 reveal opens; sent from step 2) | device and week |

Step-3 additions:

| Event | Properties | Fires | Once per |
| --- | --- | --- | --- |
| `board_submitted` | `game_ref`, `reason`, `auto: true`, `src` | an automatic submission obtains a terminal or pending outcome | deduplicated outcome per game; retries must not inflate acceptance |
| `board_viewed` | `src` | a deliberate See the board open | open |

The board reason vocabulary comes from the API error table plus success outcomes
added/replaced; edge_limited and unavailable are explicit outcomes. No raw device
key, generated name, public row id, IP or bearer fingerprint enters analytics.
[V12-134] [V12-135]

**`src`** is the channel. Posted links carry `?utm_source=<channel>`; the game
keeps it only if it is an approved channel (`src/analytics/channels.ts`:
`webgames`, `geoguessr`, `reply`, `share`, `smoke`, `hn`, `museum`,
`arthistory`, `glam`, `discord`, `city-<name>`, `oa-<name>`), records `none`
when there is no tag and `other` for anything else, and keeps the value for
the whole game. Shared challenge links carry `utm_source=share`, `utm_medium`
(`native`, `whatsapp`, `x`, `copy`) and `utm_campaign` (`challenge`, or `reply`
for a score sent back).

**URLs** in event properties keep only the `utm_*` and `ref` query parameters; click ids
(`gclid`, `fbclid` and others) and fragments are removed before sending.

**Added by posthog-js** to every event (recorded from a real request):
`$browser`, `$browser_version`, `$os`, `$os_version`, `$device_type`,
`$screen_width`/`$screen_height`, `$viewport_width`/`$viewport_height`,
`$browser_language`, `$timezone`, `$timezone_offset`, `$raw_user_agent`,
`$referrer` and `$referring_domain`, `$current_url`, `$host`, `$pathname`,
the page `title`, and library bookkeeping (`$lib`, `$lib_version`,
`$insert_id`, `$pageview_id`, `$time`, the cookieless `distinct_id`). None of
them names a person; the README and the in-game privacy screen list them in
plain words.

## The KPI

At least 20% of non-test visitor-days should reach three rounds. Keep three
separate series rather than calling every reveal an answered round. [V12-51]
[V12-76]

| Measure | Numerator | Denominator / interpretation |
| --- | --- | --- |
| Reveal reach | Visitors with a visible round-three reveal | Non-test visitor-days from page views; timeout reveals count, hidden expiry does not |
| Answered-round completion | Visitors with three rounds containing at least one placed/confirmed answer | Same visitor cohort; photo skips and entirely unanswered timeouts do not count |
| Timeout share | Revealed rounds with at least one timed-out question | All revealed non-skipped rounds in the same cohort; also report round one separately |

The historical answered_count=3 funnel remains labelled answered completion; it
is not silently relabelled reveal reach. Add the visible-reveal series alongside
it when migrating kpi.sql and the funnel definition. Photo skips are reported
separately. No event for expiry alone can convert either visible-reveal measure.
Full-game completion is round-ten reveal, not an unopened end screen.

The live insight (since release 1.1) is a PostHog funnel in project 304461,
defined in [`analytics/kpi-funnel.json`](../analytics/kpi-funnel.json). Step 1:
`$pageview`. Step 2: `round_completed` with `answered_count = 3` (three rounds
answered, so a round skipped after an image failure never converts). Both steps
filter `project_id = museumguessr` and exclude `src = smoke`. Ordered, 1-day
conversion window, broken down by `src` (attributed to the first step).

Filter every query to project_id=museumguessr, exclude test and smoke traffic,
and begin the launch series at the first approved public post. Break down by
source and build. Below 100 visitor-days a per-source result is inconclusive;
the 300-visitor KPI review is a decision point, not an automatic timer change.
Review the first three fifty-visitor cohorts with all three measures.

Cookieless ids rotate daily and can merge people on the same network/browser or
split one person across networks/days. The unit is visitor-days, not people.
The identity-free cross-check compares third answered rounds to first tab loads;
flag a gap over five percentage points and inspect cohort/mix before interpreting.

## What the numbers cannot tell you

- **Ad blockers** hide visitors completely, so totals undercount.
- **Visitors who leave before the PostHog script loads**, or whose queued
  `$pageview` is lost, are missing from step 1, which slightly inflates the
  KPI. The net bias of lost events is unknown.
- **No bot detection on the server:** in cookieless mode PostHog runs no
  server-side bot filtering and no GeoIP. Only the client-side user-agent
  blocklist and the `webdriver` check apply; [`spike.sql`](../analytics/queries/spike.sql)
  is the replacement signal. Country breakdowns are unavailable (and not needed).
- **The answers are in the page bundle.** The game is not competitive; nothing
  stops a determined player from reading them.
- **The shared origin (live release 1.1 until step 1 moves the game):** other
  sites served from the same Pages domain can read this game's local storage.
  It holds the saved game and the lists of objects this device has seen; no
  secrets.
- **Origin migration:** site data does not move from the previous origin. The new
  origin stores a device bearer key for board operations; never expose it to
  analytics or unrelated scripts.
- **Hosting budget:** static assets and Worker/D1 quotas are different; consult
  the measured runbook budget, including retries and junk-path invocations.

## Return play and difficulty

`seen_before` and `first_seen` come from the device's seen list, read when the
deck is committed and kept in the saved game, so a reload never changes them.
[`return.sql`](../analytics/queries/return.sql) counts game starts by
`seen_before`: a device's first game starts at `0`, its fourth or later at
`30+`. Content batches F and T are approved independently of a return-rate threshold;
the previous threshold does not gate this release. Share rate per finished game is
`result_shared` with `first_in_game = true` over `game_completed`. In v1.2
`game_completed` moves from the end screen opening to the round-ten reveal, so
note that build when comparing share rates across it.

[`difficulty.sql`](../analytics/queries/difficulty.sql) gives each object's
mean points over first encounters; docs/content.md "Difficulty" turns them
into difficulty proposals.

## Event budget

PostHog's free plan allows 1,000,000 events a month across the whole project
(all side projects). About 50 events per full game is about 20,000 full games a
month. Events above the cap are dropped, not billed. During the decision window
the [daily check](ops.md#daily-kpi-check-decision-window) runs [`cap.sql`](../analytics/queries/cap.sql); above 60% of the
cap the founder chooses between a billing limit, an upgrade, or dropping
`step_completed`.

## Queries

| File | Answers |
| --- | --- |
| [`smoke.sql`](../analytics/queries/smoke.sql) | did the pre-launch smoke visits arrive, as two visitors, with every event? |
| [`kpi.sql`](../analytics/queries/kpi.sql) | the KPI per `src` in SQL (visitor-days), to cross-check the funnel |
| [`crosscheck.sql`](../analytics/queries/crosscheck.sql) | the identity-free rate per `src` |
| [`spike.sql`](../analytics/queries/spike.sql) | hours where page views arrive without game starts |
| [`errors-by-build.sql`](../analytics/queries/errors-by-build.sql) | `client_error` per build id and error name |
| [`cap.sql`](../analytics/queries/cap.sql) | month-to-date events for the whole project vs the cap |
| [`timer.sql`](../analytics/queries/timer.sql) | per round: median and 90th-percentile `active_ms`, readiness delay and the time-out share (round 1 on its own row) |
| [`completion.sql`](../analytics/queries/completion.sql) | per `src`: reveal reach, answered completion and the time-out share, kept apart, with photo skips |
| [`week2.sql`](../analytics/queries/week2.sql) | `week_active` devices per week and the week-2 return |

How to run them: [ops.md](ops.md#running-a-query).


## Timer evidence and board return

Step 1 measures active_ms (controls usable) and ready_ms (round opened until
photo and controls usable), with per-game game_ref on round/game events. Store
elapsed evidence across reloads without counting tours, map failures or own error
screens as usable time. Step 2 adds timeout count and seconds_left. (Built
together in step 2: active_ms is the time the round clock ran, which it does only
while the answer controls are usable, so it survives reloads in the save.) Percentiles
for rounds 1–3 use active_ms, not subtraction of event arrival timestamps.
These timing properties never enter the public score payload. [V12-32] [V12-78]

The weekly marker holds the last ISO UTC Monday-start week with a completed game.
On the first completion in W+1 send week_active with active_last_week true only
if the stored week was W, then update the marker. Emit once per device/week.
Week-2 return is W+1 true events divided by W week_active events, with incomplete
weeks labelled immature. Clearing storage, blocked analytics and client-clock
skew limit the result; never join daily distinct ids across weeks. [V12-132]

| Measure | Definition | Decision use |
| --- | --- | --- |
| Board view rate | Deliberate board opens per finished game; also show games/visits with an open to expose repeats | Four-week review; reported only, no target (G5) |
| Sharing guardrail | First challenge/reply shares per finished game | Report beside board views; no target success while sharing drops unexplained |
| Week-2 return | W+1 week_active true / W week_active | Four-week review; estimated 10% target |
| Full-game completion | Round-ten visible reveals / game starts in matched cohorts | Separate timeout-heavy completion |
| Challenge completion | Completed challenge games / valid recipient challenge opens | Exclude own-deck replies; report unmatched/immature opens |

Checked-in HogQL queries and fixture tests implement these definitions in their
owning steps. Automatic submissions are operational outcomes, not engagement.
Retain game_ref only for within-game aggregation; it must not be a cross-game
identity. The board view and share ratios can exceed one when repeated actions
are counted, so report first-action rates alongside raw volume. [V12-133]

No novice sessions or predetermined fallback are required. The founder reviews
timer evidence and chooses any future change. No score database column or ranking
tie-break stores seconds. About/README disclose the stable generated public name,
score and date, device-only bearer key and local weekly marker. [V12-76]
[V12-135]
