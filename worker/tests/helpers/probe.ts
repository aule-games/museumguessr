// Wraps any D1 binding (node:sqlite or Miniflare) to record every statement
// the Worker runs, count writes and rows, inject D1 failures, and hold a
// request just before its write batch so tests can order concurrent
// requests exactly.
import type { D1Database, D1Meta, D1PreparedStatement, D1Result } from '../../src/platform';

export interface Executed {
  sql: string;
  write: boolean;
  meta: D1Meta | null;
  batch: boolean;
}

const isWrite = (sql: string) => !/^\s*(SELECT|WITH)\b/i.test(sql);

export function probe(db: D1Database) {
  const log: Executed[] = [];
  let failing: ((sql: string) => boolean) | null = null;
  const gates: { reached: () => void; release: Promise<void> }[] = [];

  const check = (sql: string) => {
    if (failing?.(sql)) throw new Error('D1_ERROR: injected failure (exceeded the daily limit)');
  };
  const record = (sql: string, meta: D1Meta | null, batch = false) => log.push({ sql, write: isWrite(sql), meta, batch });

  type Wrapped = D1PreparedStatement & { inner: D1PreparedStatement; sql: string };
  const wrap = (inner: D1PreparedStatement, sql: string): Wrapped => ({
    inner,
    sql,
    bind: (...v: unknown[]) => wrap(inner.bind(...v), sql),
    first: async <T>() => {
      check(sql);
      const r = await inner.all<T>();
      record(sql, r.meta);
      return (r.results[0] as T | undefined) ?? null;
    },
    all: async <T>() => {
      check(sql);
      const r = await inner.all<T>();
      record(sql, r.meta);
      return r;
    },
    run: async <T>() => {
      check(sql);
      const r = await inner.run<T>();
      record(sql, r.meta);
      return r;
    },
  });

  const wrapped: D1Database = {
    prepare: (sql: string) => wrap(db.prepare(sql), sql),
    async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const gate = gates.shift();
      if (gate) {
        gate.reached();
        await gate.release;
      }
      for (const s of statements) check((s as Wrapped).sql);
      const out = await db.batch<T>(statements.map((s) => (s as Wrapped).inner));
      statements.forEach((s, i) => record((s as Wrapped).sql, out[i]!.meta, true));
      return out;
    },
  };

  return {
    db: wrapped,
    log,
    reset: () => void log.splice(0),
    /** Statements that can write (INSERT, UPDATE, DELETE), executed so far. */
    writes: () => log.filter((e) => e.write).length,
    rowsRead: () => log.reduce((s, e) => s + (e.meta?.rows_read ?? 0), 0),
    rowsWritten: () => log.reduce((s, e) => s + (e.meta?.rows_written ?? 0), 0),
    /** Every statement whose SQL matches fails like a D1 outage until cleared with null. */
    failWhen: (test: ((sql: string) => boolean) | null) => {
      failing = test;
    },
    /** The next batch waits: `reached` resolves when it is about to run, `release()` lets it go. */
    holdNextBatch() {
      let release!: () => void;
      let reached!: () => void;
      const at = new Promise<void>((r) => (reached = r));
      gates.push({ reached, release: new Promise<void>((r) => (release = r)) });
      return { reached: at, release };
    },
  };
}

export type Probe = ReturnType<typeof probe>;
