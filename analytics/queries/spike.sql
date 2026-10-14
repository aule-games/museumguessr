-- Spike check (no server-side bot detection in cookieless mode): per hour and
-- channel, daily visitors who loaded the page but never started a game.
-- A sudden hour with many page views and almost no game starts is the signal.
SELECT
  hour,
  src,
  count() AS visitor_days,
  countIf(starts = 0) AS no_game_start,
  round(100 * no_game_start / visitor_days, 1) AS no_start_percent
FROM (
  SELECT
    distinct_id,
    toDate(timestamp) AS day,
    argMin(properties.src, timestamp) AS src,
    toStartOfHour(min(timestamp)) AS hour,
    countIf(event = 'game_start') AS starts
  FROM events
  WHERE properties.project_id = 'museumguessr'
    AND event IN ('$pageview', 'game_start')
    AND timestamp >= now() - INTERVAL 2 DAY
  GROUP BY distinct_id, day
)
GROUP BY hour, src
ORDER BY hour DESC, visitor_days DESC
