-- Timer evidence (E10, R7, V12-76): per round, the median and 90th-percentile
-- time the answer controls were usable (active_ms, from the clock itself, never
-- the gap between event timestamps; read rounds 1-3), the readiness delay, and
-- the time-out share among revealed rounds that were not photo skips. Round 1's
-- share is its own row. These numbers inform the founder's decision; no timer
-- change follows from them automatically.
-- Replace __START__ with the launch time (UTC, 'YYYY-MM-DD HH:MM:SS').
SELECT
  toInt(properties.round) AS round,
  count() AS revealed_rounds,
  round(quantile(0.5)(toFloat(properties.active_ms))) AS active_ms_p50,
  round(quantile(0.9)(toFloat(properties.active_ms))) AS active_ms_p90,
  round(quantile(0.5)(toFloat(properties.ready_ms))) AS ready_ms_p50,
  countIf(toInt(properties.timed_out) > 0) AS timed_out_rounds,
  round(100 * timed_out_rounds / revealed_rounds, 1) AS timeout_share_percent,
  round(avg(toFloat(properties.seconds_left)), 1) AS mean_seconds_left
FROM events
WHERE event = 'round_completed'
  AND properties.project_id = 'museumguessr'
  AND toString(properties.skipped) = 'false'
  AND properties.src != 'smoke'
  AND timestamp >= toDateTime('__START__')
GROUP BY round
ORDER BY round
