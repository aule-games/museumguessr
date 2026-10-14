# Operations

The routine checks and the incident steps for the live game. What the events
and the KPI mean is in [analytics.md](analytics.md).

## Daily check (decision window)

Once a day while the KPI is being measured, about 5 minutes:

1. **KPI funnel** (the PostHog insight "MuseumGuessr v0" dashboard): conversion
   per `src`. Note the visitor-days per channel; below 100 the KPI reads
   "inconclusive".
2. **Errors by build:** run [`errors-by-build.sql`](../analytics/queries/errors-by-build.sql).
   Normal: zero or a handful of `client_error` spread over old builds. A new
   build id at the top right after a deploy means the runbook below.
3. **Spikes:** run [`spike.sql`](../analytics/queries/spike.sql). An hour with
   many visitor-days and a `no_start_percent` near 100 is bot-like traffic;
   note the hour and `src` so the decision report can exclude it.
4. **Event cap:** run [`cap.sql`](../analytics/queries/cap.sql). Above 60% of
   the month's 1,000,000 events, tell the founder: a billing limit, an upgrade,
   or dropping `step_completed` are the options.

## Runbook: errors after a deploy

1. Find the build: `errors-by-build.sql` gives the build id (the short commit
   SHA in `build_id`) and the error name.
2. Roll back: redeploy the last good commit,
   `gh workflow run pages.yml --ref main -f sha=<last-good-sha>` (it verifies,
   builds and deploys exactly that commit), then fix forward on `main`.
3. Confirm: after the deploy, `errors-by-build.sql` shows no new events for the
   bad build, and the page's `<meta name="build-id">` shows the good SHA.

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

Before the first public post, one real visit proves the events and the KPI
insight work end to end:

1. Record the start time (UTC).
2. **Visit A:** in a normal browser on Wi-Fi, without `?test=1`, open
   `https://aule-games.github.io/museumguessr/?utm_source=smoke` and play
   rounds 1-3.
3. **Visit B:** the same browser and device on a different network (a phone
   hotspot), open the same URL once.
4. Run [`smoke.sql`](../analytics/queries/smoke.sql) from the start time.
   Expect two rows (two different visitor ids): A with page views ≥ 1, one
   `game_start`, rounds 1-3 started, 9 steps and rounds 1-3 completed; B with
   page views ≥ 1. One row would mean the cookieless hash collapsed both
   visits.
5. Run a copy of the KPI funnel filtered to `src = smoke` from the start time:
   at least 2 visitors in step 1 and 1 conversion.
6. Only then open `?test=1` in that browser. Record the counts (no ids) in the
   launch note, not in the repository.

## Keep your own visits out

Open the site once with `?test=1` in every browser you use, including in-app
browsers (Reddit, Discord). The flag lives in that browser's local storage, so
re-open `?test=1` weekly (some browsers clear script storage after 7 days
without a visit) and after clearing site data. `?test=0` turns analytics back
on. The test badge shows while the flag is set.

## Moving to another domain

The build reads `BASE_PATH` (default `/museumguessr/`) and the analytics host
list from build variables. When the game moves:

1. Set `BASE_PATH` (for example `/`) and `VITE_ANALYTICS_HOSTS` (the new
   hostname) in the CI variables; update `SITE_URL` in `src/config.ts`, the
   canonical, `og:url` and `og:image` URLs in `index.html`, and the CSP if new
   hosts are involved.
2. Check the build with `BASE_PATH=/ npm run build && npm run preview`.
3. In PostHog, add the new domain to the project's authorised domains if that
   setting is used (shared project: ask the founder first).
4. After the deploy, open `?test=1` on the new origin in every browser (the
   flag is per origin).
5. Note that the old github.io URL redirects to a custom domain once one is
   set, so old links keep working, but their `utm_source` stays as posted.
