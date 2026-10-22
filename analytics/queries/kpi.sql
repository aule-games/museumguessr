-- KPI by channel: visitor-days with a page view, and how many of them reached a
-- third answered round (round_completed with answered_count = 3) after that
-- page view on the same day. Smoke traffic is excluded from both sides.
-- From v1.2 round_completed is sent when a reveal visibly opens, timed out or
-- not; answered_count counts rounds with at least one answer, so photo skips and
-- wholly timed-out rounds never convert. completion.sql adds reveal reach and the
-- time-out share beside it (R7).
-- This is the SQL cross-check of the funnel insight in ../kpi-funnel.json; the
-- funnel's 1-day conversion window can differ from "same day" near midnight.
-- Replace __START__ with the launch time (UTC, 'YYYY-MM-DD HH:MM:SS').
WITH
  visits AS (
    SELECT
      distinct_id,
      toDate(timestamp) AS day,
      argMin(properties.src, timestamp) AS src,
      min(timestamp) AS first_view
    FROM events
    WHERE event = '$pageview'
      AND properties.project_id = 'museumguessr'
      AND properties.src != 'smoke'
      AND timestamp >= toDateTime('__START__')
    GROUP BY distinct_id, day
  ),
  third AS (
    SELECT distinct_id, toDate(timestamp) AS day, min(timestamp) AS reached_at
    FROM events
    WHERE event = 'round_completed'
      AND properties.project_id = 'museumguessr'
      AND toInt(properties.answered_count) = 3
      AND properties.src != 'smoke'
      AND timestamp >= toDateTime('__START__')
    GROUP BY distinct_id, day
  )
SELECT
  v.src AS src,
  count() AS visitor_days,
  countIf(t.reached_at >= v.first_view) AS reached_round_3,
  round(100 * reached_round_3 / visitor_days, 1) AS kpi_percent
FROM visits AS v
LEFT JOIN third AS t ON v.distinct_id = t.distinct_id AND v.day = t.day
GROUP BY src
ORDER BY visitor_days DESC
