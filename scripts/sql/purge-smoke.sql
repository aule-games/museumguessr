-- npm run board:on / board:purge-smoke: remove every dark-mode test row, receipt and
-- tombstone (ENG4). Smoke rows never reach buckets, counts or the public board. A fixed statement.
DELETE FROM smoke_scores;
DELETE FROM receipts WHERE smoke = 1;
DELETE FROM tombstones WHERE smoke = 1;
