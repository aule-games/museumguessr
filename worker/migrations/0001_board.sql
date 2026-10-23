-- The weekly board (W6, ENG1-ENG4, ENG18, N2; docs/api.md). Migrations are
-- forward-only and additive (docs/ops.md "Deploy and rollback"): later
-- files add tables or nullable/defaulted columns, never drop or rename.
-- Nothing here stores a raw answer pin, an IP address, a user agent or any
-- time spent playing; player_hash is sha256 of the device key.

-- The board switch: one row; a missing row means off (ENG3).
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  board_mode TEXT NOT NULL CHECK (board_mode IN ('off', 'dark', 'on')),
  updated_at TEXT NOT NULL
);

-- One row per week: the visible device count (kept by the triggers), the
-- last tie-order sequence, and the materialized public top 50 (ENG2). A
-- missing row means the week is purged, and the triggers then skip bucket
-- upkeep (N2).
CREATE TABLE board_weeks (
  week TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL DEFAULT 0,
  top_json TEXT NOT NULL DEFAULT '[]',
  cutoff_total INTEGER,
  updated_at TEXT NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

-- One best per device per week (UNIQUE week, player_hash). row_id is the
-- random public id; game_id never leaves the owner's responses (ENG22).
CREATE TABLE scores (
  week TEXT NOT NULL,
  player_hash TEXT NOT NULL,
  row_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  game_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  total INTEGER NOT NULL CHECK (total BETWEEN 0 AND 30000),
  points TEXT NOT NULL,
  item_ids TEXT NOT NULL,
  deck_kind TEXT NOT NULL CHECK (deck_kind IN ('random', 'challenge')),
  fresh INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  seq INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  final_rank INTEGER,
  PRIMARY KEY (week, player_hash)
) WITHOUT ROWID;

-- Ranking order; it also covers the public top-50 rebuild.
CREATE INDEX scores_rank ON scores (week, hidden, total DESC, seq, row_id, name, created_at);

-- Every game's outcome for eight weeks (current, replaced or removed).
CREATE TABLE receipts (
  game_id TEXT PRIMARY KEY,
  player_hash TEXT NOT NULL,
  week TEXT NOT NULL,
  row_id TEXT NOT NULL,
  total INTEGER NOT NULL,
  payload_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('current', 'replaced', 'removed')),
  receipt_rank INTEGER,
  count INTEGER NOT NULL DEFAULT 0,
  replaced INTEGER NOT NULL DEFAULT 0,
  smoke INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX receipts_week ON receipts (week, player_hash, status);

-- A removed device-week cannot be created again that week.
CREATE TABLE tombstones (
  week TEXT NOT NULL,
  player_hash TEXT NOT NULL,
  smoke INTEGER NOT NULL DEFAULT 0,
  row_id TEXT NOT NULL,
  removed_at TEXT NOT NULL,
  PRIMARY KEY (week, player_hash, smoke)
) WITHOUT ROWID;

CREATE INDEX tombstones_row ON tombstones (row_id);

-- Visible scores per bucket (src: worker/src/buckets.ts), kept by triggers.
CREATE TABLE score_buckets (
  week TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (week, bucket)
) WITHOUT ROWID;

-- Dark-mode test submissions (ENG4): their own unique key, no triggers,
-- never in buckets, counts, ranks or the public board.
CREATE TABLE smoke_scores (
  week TEXT NOT NULL,
  player_hash TEXT NOT NULL,
  row_id TEXT NOT NULL UNIQUE,
  game_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  total INTEGER NOT NULL CHECK (total BETWEEN 0 AND 30000),
  points TEXT NOT NULL,
  item_ids TEXT NOT NULL,
  deck_kind TEXT NOT NULL,
  fresh INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (week, player_hash)
) WITHOUT ROWID;

-- Moderation log: public row id, week, action, reason; no personal data.
CREATE TABLE moderation (
  id INTEGER PRIMARY KEY,
  row_id TEXT NOT NULL,
  week TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('hide', 'unhide')),
  reason TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE TRIGGER scores_insert AFTER INSERT ON scores
WHEN NEW.hidden = 0 AND EXISTS (SELECT 1 FROM board_weeks WHERE week = NEW.week)
BEGIN
  INSERT INTO score_buckets (week, bucket, n)
    VALUES (NEW.week, (CASE WHEN NEW.total < 25000 THEN NEW.total / 500 * 500 WHEN NEW.total < 28000 THEN NEW.total / 100 * 100 ELSE NEW.total / 25 * 25 END), 1)
    ON CONFLICT (week, bucket) DO UPDATE SET n = n + 1;
  UPDATE board_weeks SET n = n + 1, seq = max(seq, NEW.seq) WHERE week = NEW.week;
END;

CREATE TRIGGER scores_insert_hidden AFTER INSERT ON scores
WHEN NEW.hidden = 1 AND EXISTS (SELECT 1 FROM board_weeks WHERE week = NEW.week)
BEGIN
  UPDATE board_weeks SET seq = max(seq, NEW.seq) WHERE week = NEW.week;
END;

CREATE TRIGGER scores_update AFTER UPDATE OF total, hidden, seq ON scores
WHEN EXISTS (SELECT 1 FROM board_weeks WHERE week = NEW.week)
BEGIN
  UPDATE score_buckets SET n = n - 1
    WHERE OLD.hidden = 0 AND week = OLD.week AND bucket = (CASE WHEN OLD.total < 25000 THEN OLD.total / 500 * 500 WHEN OLD.total < 28000 THEN OLD.total / 100 * 100 ELSE OLD.total / 25 * 25 END);
  DELETE FROM score_buckets
    WHERE OLD.hidden = 0 AND week = OLD.week AND bucket = (CASE WHEN OLD.total < 25000 THEN OLD.total / 500 * 500 WHEN OLD.total < 28000 THEN OLD.total / 100 * 100 ELSE OLD.total / 25 * 25 END) AND n <= 0;
  INSERT INTO score_buckets (week, bucket, n)
    SELECT NEW.week, (CASE WHEN NEW.total < 25000 THEN NEW.total / 500 * 500 WHEN NEW.total < 28000 THEN NEW.total / 100 * 100 ELSE NEW.total / 25 * 25 END), 1 WHERE NEW.hidden = 0
    ON CONFLICT (week, bucket) DO UPDATE SET n = n + 1;
  UPDATE board_weeks SET n = n + (NEW.hidden = 0) - (OLD.hidden = 0), seq = max(seq, NEW.seq) WHERE week = NEW.week;
END;

CREATE TRIGGER scores_delete AFTER DELETE ON scores
WHEN OLD.hidden = 0 AND EXISTS (SELECT 1 FROM board_weeks WHERE week = OLD.week)
BEGIN
  UPDATE score_buckets SET n = n - 1
    WHERE week = OLD.week AND bucket = (CASE WHEN OLD.total < 25000 THEN OLD.total / 500 * 500 WHEN OLD.total < 28000 THEN OLD.total / 100 * 100 ELSE OLD.total / 25 * 25 END);
  DELETE FROM score_buckets
    WHERE week = OLD.week AND bucket = (CASE WHEN OLD.total < 25000 THEN OLD.total / 500 * 500 WHEN OLD.total < 28000 THEN OLD.total / 100 * 100 ELSE OLD.total / 25 * 25 END) AND n <= 0;
  UPDATE board_weeks SET n = n - 1 WHERE week = OLD.week;
END;
