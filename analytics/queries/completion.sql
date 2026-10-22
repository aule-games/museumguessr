-- Completion measures (R7, E11, V12-76), kept as three separate numbers per
-- channel over non-smoke visitor-days with a page view:
--   reveal reach: a round-3 reveal visibly opened (timed out or not);
--   answered completion: three revealed rounds with at least one placed or
--     confirmed answer (photo skips and wholly timed-out rounds do not count);
--   time-out share: revealed, non-skipped rounds with a timed-out question.
-- round_completed is sent only when a reveal visibly opens, so an expiry in a
-- hidden tab that nobody saw converts nothing. Photo skips are reported apart.
-- Replace __START__ with the launch time (UTC, 'YYYY-MM-DD HH:MM:SS').
WITH
  visits AS (
    SELECT
      distinct_id,
      toDate(timestamp) AS day,
      argMin(properties.src, timestamp) AS src
    FROM events
    WHERE event = '$pageview'
      AND properties.project_id = 'museumguessr'
      AND properties.src != 'smoke'
      AND timestamp >= toDateTime('__START__')
    GROUP BY distinct_id, day
  ),
  reveals AS (
    SELECT
      distinct_id,
      toDate(timestamp) AS day,
      countIf(toInt(properties.round) = 3) AS round_3_reveals,
      countIf(toString(properties.skipped) = 'false' AND toInt(properties.timed_out) < 3) AS answered_rounds,
      countIf(toString(properties.skipped) = 'false') AS revealed_rounds,
      countIf(toString(properties.skipped) = 'false' AND toInt(properties.timed_out) > 0) AS timed_out_rounds,
      countIf(toString(properties.skipped) = 'true') AS photo_skips
    FROM events
    WHERE event = 'round_completed'
      AND properties.project_id = 'museumguessr'
      AND properties.src != 'smoke'
      AND timestamp >= toDateTime('__START__')
    GROUP BY distinct_id, day
  )
SELECT
  v.src AS src,
  count() AS visitor_days,
  countIf(r.round_3_reveals > 0) AS reveal_reach,
  countIf(r.answered_rounds >= 3) AS answered_completion,
  sum(r.timed_out_rounds) AS timed_out_rounds,
  sum(r.revealed_rounds) AS revealed_rounds,
  round(100 * timed_out_rounds / revealed_rounds, 1) AS timeout_share_percent,
  sum(r.photo_skips) AS photo_skips
FROM visits AS v
LEFT JOIN reveals AS r ON v.distinct_id = r.distinct_id AND v.day = r.day
GROUP BY src
ORDER BY visitor_days DESC
