// Refusals and storage failures (M1; V12-111). A handler throws Refused for
// any contract reason; the router turns it into the error envelope. Every
// D1 failure (an outage, a quota hit, a missing table) becomes StoreError,
// which the router answers as `unavailable` (retryable), so the page keeps
// its pending submission (ENG3, N19).

import type { ApiError, Reason } from '../../src/api/contract.ts';
import type { Ctx, D1Database, D1PreparedStatement } from './platform.ts';

export class Refused extends Error {
  override name = 'Refused';
  constructor(
    readonly reason: Reason,
    readonly extra: Omit<ApiError, 'reason' | 'retryable'> = {},
  ) {
    super(reason);
  }
}

export class StoreError extends Error {
  override name = 'D1Error';
}

const fail = (): never => {
  throw new StoreError('board storage failed');
};

type Wrapped = D1PreparedStatement & { inner: D1PreparedStatement };

function wrap(s: D1PreparedStatement): Wrapped {
  return {
    inner: s,
    bind: (...values: unknown[]) => {
      try {
        return wrap(s.bind(...values));
      } catch {
        return fail();
      }
    },
    first: <T>() => s.first<T>().catch(fail),
    all: <T>() => s.all<T>().catch(fail),
    run: <T>() => s.run<T>().catch(fail),
  };
}

/** The board database with every failure turned into StoreError; a missing binding fails the same way. */
export function store(ctx: Ctx): D1Database {
  const db = ctx.env.DB;
  if (!db) return fail();
  return {
    prepare: (sql: string) => {
      try {
        return wrap(db.prepare(sql));
      } catch {
        return fail();
      }
    },
    batch: <T>(statements: D1PreparedStatement[]) => {
      try {
        return db.batch<T>(statements.map((s) => (s as Partial<Wrapped>).inner ?? s)).catch(fail);
      } catch {
        return fail();
      }
    },
  };
}
