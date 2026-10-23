// Score buckets (ENG1, ENG18; V12-102). A week's visible scores are counted
// per bucket by SQLite triggers (worker/migrations/0001_board.sql), so a
// standing needs a few bucket rows instead of a scan of every score. A
// bucket is named by its lowest total: 500 points wide below 25000, 100 wide
// from 25000 up to 28000, 25 wide from 28000 to the maximum 30000. The SQL
// expression below is the same function; a test compares them for every
// total from 0 to 30000.

export const MAX_TOTAL = 30_000;

export function bucketWidth(total: number): number {
  return total < 25_000 ? 500 : total < 28_000 ? 100 : 25;
}

export function bucketOf(total: number): number {
  return total - (total % bucketWidth(total));
}

/** The same function in SQL, for an integer column or parameter expression. */
export function bucketSql(x: string): string {
  return `(CASE WHEN ${x} < 25000 THEN ${x} / 500 * 500 WHEN ${x} < 28000 THEN ${x} / 100 * 100 ELSE ${x} / 25 * 25 END)`;
}

/** The first total above a bucket, in SQL. */
export function bucketEndSql(x: string): string {
  return `(${bucketSql(x)} + CASE WHEN ${x} < 25000 THEN 500 WHEN ${x} < 28000 THEN 100 ELSE 25 END)`;
}

/** Every bucket a total can fall in, lowest first (161 of them). */
export const ALL_BUCKETS: readonly number[] = (() => {
  const out: number[] = [];
  for (let b = 0; b <= MAX_TOTAL; b += bucketWidth(b)) out.push(b);
  return out;
})();
