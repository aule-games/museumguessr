-- Per-object difficulty (V1-28): answered rounds and mean points per item_id,
-- first encounters only (a player who has met the object before knows the
-- answers), skipped rounds and smoke visits left out. docs/content.md
-- "Difficulty" turns the means into proposals on the next contact sheet.
-- Replace __START__ with the launch time (UTC, 'YYYY-MM-DD HH:MM:SS').
SELECT
  properties.item_id AS item_id,
  count() AS rounds,
  round(avg(toFloat(properties.points))) AS mean_points,
  round(avg(toFloat(properties.made_points))) AS mean_made,
  round(avg(toFloat(properties.when_points))) AS mean_when,
  round(avg(toFloat(properties.kept_points))) AS mean_kept
FROM events
WHERE event = 'round_completed'
  AND properties.project_id = 'museumguessr'
  AND toString(properties.skipped) = 'false'
  AND toString(properties.first_seen) = 'true'
  AND properties.src != 'smoke'
  AND timestamp >= toDateTime('__START__')
GROUP BY item_id
ORDER BY mean_points ASC
