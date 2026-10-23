-- Four-week board review (G5, E9, R7; V12-133): per ISO week (UTC, Monday
-- start), board views per finished game next to first shares per finished
-- game, full-game completion and challenge completion, each with its
-- denominator in its own column. Reported only; there is no target (G5).
-- A finished game is a round-ten reveal (game_completed). board_viewed counts
-- deliberate opens, so a player who opens the board twice counts twice: read
-- the ratio beside raw volume. Challenge completion leaves out a device's own
-- deck (replies) and invalid links. Automatic board entries (board_submitted)
-- are operations, not engagement, and are not counted here. The newest week
-- is immature until it ends.
-- Replace __START__ with the launch time (UTC, 'YYYY-MM-DD HH:MM:SS').
SELECT
  week,
  games_started,
  games_finished,
  round(100 * games_finished / nullIf(games_started, 0), 1) AS full_game_completion_percent,
  board_views,
  round(board_views / nullIf(games_finished, 0), 3) AS board_views_per_finished_game,
  first_shares,
  round(first_shares / nullIf(games_finished, 0), 3) AS first_shares_per_finished_game,
  challenge_opens,
  challenges_completed,
  round(100 * challenges_completed / nullIf(challenge_opens, 0), 1) AS challenge_completion_percent
FROM (
  SELECT
    toStartOfWeek(timestamp, 1) AS week,
    countIf(event = 'game_start') AS games_started,
    countIf(event = 'game_completed') AS games_finished,
    countIf(event = 'board_viewed') AS board_views,
    countIf(event = 'result_shared' AND toString(properties.first_in_game) = 'true') AS first_shares,
    countIf(event = 'challenge_opened' AND toString(properties.valid) = 'true' AND toString(properties.own_deck) = 'false') AS challenge_opens,
    countIf(event = 'challenge_completed') AS challenges_completed
  FROM events
  WHERE event IN ('game_start', 'game_completed', 'board_viewed', 'result_shared', 'challenge_opened', 'challenge_completed')
    AND properties.project_id = 'museumguessr'
    AND properties.src != 'smoke'
    AND timestamp >= toDateTime('__START__')
  GROUP BY week
)
ORDER BY week
