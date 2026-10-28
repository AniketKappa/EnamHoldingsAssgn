import postgres from "postgres";
import { env, IS_SERVERLESS } from "./env";

// One client per process. On Vercel, connections go through Supabase's
// transaction pooler, so prepared statements must be off.
export type Sql = postgres.Sql<Record<string, unknown>>;

declare global {
  // eslint-disable-next-line no-var
  var __finnSql: Sql | undefined;
}

export function db(): Sql {
  if (globalThis.__finnSql) return globalThis.__finnSql;
  const url = env.databaseUrl();
  if (!url) throw new Error("DATABASE_URL is not set");
  const local = /localhost|127\.0\.0\.1/.test(url);
  const client = postgres(url, {
    prepare: false,
    max: Number(process.env.DB_POOL_MAX ?? (IS_SERVERLESS ? 3 : 6)),
    idle_timeout: 20,
    connect_timeout: 20,
    ssl: local ? false : "require",
    onnotice: () => {},
  });
  globalThis.__finnSql = client;
  return client;
}

export async function closeDb() {
  if (globalThis.__finnSql) {
    await globalThis.__finnSql.end({ timeout: 5 });
    globalThis.__finnSql = undefined;
  }
}

export function hasDb(): boolean {
  return !!env.databaseUrl();
}

/** Small key-value helpers for operational state (e.g. NSE disabled until). */
export async function kvGet<T>(key: string): Promise<T | null> {
  const rows = await db()`select value from kv where key = ${key}`;
  return rows.length ? (rows[0].value as T) : null;
}

export async function kvSet(key: string, value: unknown) {
  await db()`insert into kv (key, value, updated_at) values (${key}, ${db().json(value as never)}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}
