-- Return play (V1-28): game starts by how many objects the device had seen
-- before (seen_before). A device's first game starts at '0'; a fourth or
-- later game starts at '30+'. fourth_game_rate approximates the share of new
-- devices that come back for a fourth game; it overcounts slightly, because
-- a device that plays five games sends two '30+' starts. docs/analytics.md
-- "Return play" gives the threshold for content batch B.
-- Replace __START__ with the launch time (UTC, 'YYYY-MM-DD HH:MM:SS').
SELECT
  countIf(properties.seen_before = '0') AS first_games,
  countIf(properties.seen_before = '10-19') AS second_games,
  countIf(properties.seen_before = '20-29') AS third_games,
  countIf(properties.seen_before = '30+') AS fourth_or_later,
  round(100 * fourth_or_later / greatest(first_games, 1), 1) AS fourth_game_rate
FROM events
WHERE event = 'game_start'
  AND properties.project_id = 'museumguessr'
  AND properties.deck_kind = 'random'
  AND properties.src != 'smoke'
  AND timestamp >= toDateTime('__START__')
