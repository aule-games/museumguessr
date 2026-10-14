-- Cap check: month-to-date events across the WHOLE PostHog project, which all
-- side projects share. The free plan drops events above 1,000,000 a month.
-- This is the only query without a project_id filter, on purpose.
-- Above 60% of the cap, the founder decides: a billing limit, an upgrade, or
-- dropping step_completed.
SELECT
  count() AS events_month_to_date,
  round(100 * events_month_to_date / 1000000, 1) AS percent_of_cap,
  countIf(properties.project_id = 'museumguessr') AS museumguessr_events
FROM events
WHERE timestamp >= toStartOfMonth(now())
