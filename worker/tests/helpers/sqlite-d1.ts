// A D1 stand-in over node:sqlite for the fast Worker tests (`npm test`): the
// real SQL, triggers and transactions, with D1's prepare/bind/first/all/run
// and transactional batch. It cannot count rows read; the Miniflare suite
// (worker/tests/*.smoke.ts) measures rows_read and rows_written on real D1.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result } from '../../src/platform';

export const MIGRATIONS = join(import.meta.dirname, '../../migrations');

/** The migration files, in order. */
export const migrationSql = (): string[] =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'));

const toValue = (v: unknown): SQLInputValue => {
  if (v === undefined) throw new TypeError('D1_TYPE_ERROR: undefined cannot be bound');
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as SQLInputValue;
};

const isRead = (sql: string) => /^\s*(SELECT|WITH)\b/i.test(sql);

export function sqliteD1(options: { migrate?: boolean } = {}): D1Database & { raw: DatabaseSync; close(): void } {
  const raw = new DatabaseSync(':memory:');
  if (options.migrate !== false) for (const sql of migrationSql()) raw.exec(sql);

  const exec = (sql: string, values: unknown[]): D1Result => {
    const stmt = raw.prepare(sql);
    const params = values.map(toValue);
    if (isRead(sql)) {
      const rows = stmt.all(...params) as Record<string, unknown>[];
      return { results: rows.map((r) => ({ ...r })), success: true, meta: { changes: 0, rows_read: 0, rows_written: 0 } };
    }
    const r = stmt.run(...params);
    return { results: [], success: true, meta: { changes: Number(r.changes), rows_read: 0, rows_written: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };

  const statement = (sql: string, values: unknown[] = []): D1PreparedStatement & { sql: string; values: unknown[] } => ({
    sql,
    values,
    bind: (...v: unknown[]) => statement(sql, v),
    first: async <T>() => (exec(sql, values).results[0] as T | undefined) ?? null,
    all: async <T>() => exec(sql, values) as D1Result<T>,
    run: async <T>() => exec(sql, values) as D1Result<T>,
  });

  return {
    raw,
    close: () => raw.close(),
    prepare: (sql: string) => statement(sql),
    async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      raw.exec('BEGIN');
      try {
        const out = statements.map((s) => {
          const { sql, values } = s as unknown as { sql: string; values: unknown[] };
          return exec(sql, values) as D1Result<T>;
        });
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
