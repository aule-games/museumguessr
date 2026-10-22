-- Week-2 return (ENG6, V12-132): week_active is sent once per device and ISO
-- week (UTC, Monday start) from a marker kept on the device, with
-- active_last_week = true when that device also completed a game the week
-- before. Return for week W = W+1 events with active_last_week true / W events.
-- Daily cookieless ids are never joined across weeks. The newest week is
-- immature until it ends; clearing site data and blocked analytics lower it.
-- Replace __START__ with the launch time (UTC, 'YYYY-MM-DD HH:MM:SS').
SELECT
  week,
  active_devices,
  returned_from_last_week,
  round(100 * returned_from_last_week / lagInFrame(active_devices) OVER (ORDER BY week ROWS BETWEEN 1 PRECEDING AND CURRENT ROW), 1) AS week2_return_percent
FROM (
  SELECT
    toString(properties.week) AS week,
    count() AS active_devices,
    countIf(toString(properties.active_last_week) = 'true') AS returned_from_last_week
  FROM events
  WHERE event = 'week_active'
    AND properties.project_id = 'museumguessr'
    AND properties.src != 'smoke'
    AND timestamp >= toDateTime('__START__')
  GROUP BY week
)
ORDER BY week
