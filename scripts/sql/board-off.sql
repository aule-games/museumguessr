-- npm run board:off: the board switch (ENG3). A fixed statement; nothing is interpolated.
INSERT INTO settings (id, board_mode, updated_at) VALUES (1, 'off', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (id) DO UPDATE SET board_mode = excluded.board_mode, updated_at = excluded.updated_at;
