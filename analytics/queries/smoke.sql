-- Smoke check: one row per daily visitor id for the smoke visits.
-- Expected: visitor A has pageviews >= 1, game_starts = 1, rounds 1-3 started,
-- 9 steps completed and rounds 1-3 completed; visitor B has pageviews >= 1;
-- A and B are two different visitor ids.
-- Replace __START__ with the recorded smoke start time (UTC, 'YYYY-MM-DD HH:MM:SS').
SELECT
  distinct_id,
  countIf(event = '$pageview') AS pageviews,
  countIf(event = 'game_start') AS game_starts,
  arraySort(groupUniqArrayIf(toInt(properties.round), event = 'round_started')) AS rounds_started,
  countIf(event = 'step_completed') AS steps_completed,
  arraySort(groupUniqArrayIf(toInt(properties.round), event = 'round_completed')) AS rounds_completed,
  min(timestamp) AS first_seen
FROM events
WHERE properties.project_id = 'museumguessr'
  AND properties.src = 'smoke'
  AND timestamp >= toDateTime('__START__')
GROUP BY distinct_id
ORDER BY first_seen
