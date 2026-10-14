-- Identity-free KPI cross-check per channel: third answered rounds divided by
-- first page loads in a tab session. It needs no visitor id, so it survives a
-- phone changing IP mid-game (which splits one player into two cookieless
-- visitors). The decision report flags a gap of more than 5 points between
-- this rate and the funnel's conversion.
-- Replace __START__ with the launch time (UTC, 'YYYY-MM-DD HH:MM:SS').
SELECT
  properties.src AS src,
  countIf(event = '$pageview' AND properties.landing = true) AS landing_pageviews,
  countIf(event = 'round_completed' AND toInt(properties.answered_count) = 3) AS third_answered_rounds,
  round(100 * third_answered_rounds / landing_pageviews, 1) AS rate_percent
FROM events
WHERE properties.project_id = 'museumguessr'
  AND properties.src != 'smoke'
  AND event IN ('$pageview', 'round_completed')
  AND timestamp >= toDateTime('__START__')
GROUP BY src
ORDER BY landing_pageviews DESC
