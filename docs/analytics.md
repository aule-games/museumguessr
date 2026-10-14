# Analytics

What the game measures, how, and what the numbers cannot tell you. The daily
routine and the incident steps are in [ops.md](ops.md).

## Why there is analytics at all

v0 is a test of one question: do people who open the game play at least three
rounds? Everything sent serves that question or tells us the game broke.
Nothing identifies a person: no cookies, no local storage for analytics, no
sign-up, no session recording, no autocapture.

## Configuration

| Setting | Where | Value |
| --- | --- | --- |
| Provider | `src/analytics/posthog.ts` | PostHog Cloud EU (`https://eu.i.posthog.com`), `cookieless_mode: 'always'`, `person_profiles: 'never'`, memory persistence, no autocapture, no session recording |
| Project | PostHog | project id `304461`, shared with other side projects |
| Tag on every event | `src/analytics/core.ts` | `project_id = 'museumguessr'` and `build_id` (the short commit SHA) |
| `VITE_POSTHOG_PROJECT_TOKEN` | CI repository variable | the public project token (`phc_…`); a build stops if it is anything else. Empty means analytics off |
| `VITE_ANALYTICS_HOSTS` | CI repository variable | comma-separated hostnames where analytics may run; default `mert-aktas.github.io` |

Because the project is shared, **every query and insight filters
`project_id = 'museumguessr'`**, except the event-cap check, which must count
the whole project. A unit test enforces this for the queries in
[`analytics/queries/`](../analytics/queries).

## When nothing is sent

Analytics stays off, and the console says why (`analytics: off (<reason>)`):

| Reason | When |
| --- | --- |
| `test flag` | the browser opened the site with `?test=1` (remembered until `?test=0`) |
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

Sent events and their properties (also listed on the in-game About & privacy
screen, from the same source in `src/analytics/events.ts`):

| Event | Properties | Fires | Once per |
| --- | --- | --- | --- |
| `$pageview` | `src`, `landing` (first load in this tab session), `resumed` (a saved game was restored) | each page load, after the first screen renders | every load counts |
| `game_start` | `src` | a new game starts (Start, New game, Replay) | game |
| `round_started` | `src`, `round` (1-10) | a round is shown the first time | game and round |
| `step_completed` | `src`, `round`, `step` (`kept`, `made`, `when`) | an answer is confirmed | game, round and step |
| `round_completed` | `src`, `round`, `skipped`, `answered_count` (answered rounds so far), `points` (0-3000) | the reveal is shown, or a round is skipped after its photo failed | game and round |
| `game_completed` | `src`, `total` (0-30000), `answered_count` | the end screen opens after round 10 | game |
| `client_error` | `name`, `message` (first 80 characters, URLs removed), `frame` (chunk:line:col) | an uncaught error in game code, or the map cannot run | at most 3 per tab session |
| `feedback` | `src`, `q` (`difficulty`, `most_fun`), `a` | the optional difficulty row (after round 3) or the "most fun" row (end) | game and question |
| `result_copied` | `src`, `total`, `method` (`clipboard`, `manual`) | the player copies the result | every copy |

**`src`** is the channel. Posted links carry `?utm_source=<channel>`; the game
keeps it only if it is an approved channel (`src/analytics/channels.ts`:
`webgames`, `geoguessr`, `reply`, `share`, `smoke`, `hn`, `museum`,
`arthistory`, `glam`, `discord`, `city-<name>`, `oa-<name>`), records `none`
when there is no tag and `other` for anything else, and keeps the value for
the whole game. The share text links back with `utm_source=share`.

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

**Of the daily visitors who open the game, the share who complete three
answered rounds.**

- **Insight:** a PostHog funnel in project 304461, defined in
  [`analytics/kpi-funnel.json`](../analytics/kpi-funnel.json).
  Step 1: `$pageview`. Step 2: `round_completed` with `answered_count = 3`
  (three rounds answered, so a round skipped after an image failure never
  converts). Both steps filter `project_id = museumguessr` and exclude
  `src = smoke`. Ordered, 1-day conversion window, broken down by `src`
  (attributed to the first step).
- **Date range:** from the launch, the time of the first public post. Smoke
  and pre-launch traffic never count.
- **Unit: visitor-days.** In cookieless mode PostHog's visitor id is a hash of
  the project, a salt that changes daily, the IP address, the user agent and
  the hostname. So a person who comes back on another day counts again; a game
  that crosses the daily salt change loses its conversion; and two people
  behind one IP with the same browser build can merge into one visitor.
- **Decision rule:** the founder's minimum is 100 visitor-days before reading
  the KPI; below that the result is "inconclusive". The KPI is read per `src`.
- **Cross-check:** [`crosscheck.sql`](../analytics/queries/crosscheck.sql)
  divides third answered rounds by first page loads per tab session, per
  `src`, without any visitor id. A gap of more than 5 points from the funnel
  is flagged in the decision report (usually a phone changing IP mid-game,
  which splits one player into two visitors).

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
- **The shared origin:** other sites served from the same Pages domain can read
  this game's local storage. It holds only the saved game, no secrets.
- **Hosting budget:** a full game downloads about 4 MB; GitHub Pages' 100 GB
  monthly soft limit is about 25,000 full games.

## Event budget

PostHog's free plan allows 1,000,000 events a month across the whole project
(all side projects). About 50 events per full game is about 20,000 full games a
month. Events above the cap are dropped, not billed. During the decision window
the daily check runs [`cap.sql`](../analytics/queries/cap.sql); above 60% of the
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

How to run them: [ops.md](ops.md#running-a-query).
