-- Errors by build: client_error events in the last 7 days per build id and
-- error name. A new build id at the top right after a deploy means "revert".
SELECT
  properties.build_id AS build,
  properties.name AS error,
  count() AS events,
  count(DISTINCT distinct_id) AS visitors,
  min(timestamp) AS first_seen,
  max(timestamp) AS last_seen
FROM events
WHERE event = 'client_error'
  AND properties.project_id = 'museumguessr'
  AND timestamp >= now() - INTERVAL 7 DAY
GROUP BY build, error
ORDER BY events DESC
