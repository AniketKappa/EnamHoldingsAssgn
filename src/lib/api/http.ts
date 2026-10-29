// Small helpers shared by route handlers.
import { connection } from "next/server";
import { hasDb } from "../db";

export function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init.headers ?? {}) } });
}

export function fail(status: number, message: string) {
  return json({ error: message }, { status });
}

/** Every handler starts here: mark the request dynamic and check the database is configured. */
export async function ready(): Promise<Response | null> {
  await connection();
  if (!hasDb()) return fail(503, "FINN's database isn't configured on this deployment yet.");
  return null;
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  const notReady = await ready();
  if (notReady) return notReady;
  try {
    return await fn();
  } catch (e) {
    // 42P01 undefined_table: the database exists but the first setup run has not created the schema yet.
    if ((e as { code?: string })?.code === "42P01") return fail(503, "FINN is being set up. The first data load takes about 15 minutes; this page fills in by itself.");
    console.error(e);
    return fail(500, `Something broke on FINN's side: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
  }
}

/** Per-user hourly limit backed by the jobs/qa tables, to protect free model quotas. */
export function windowStart(minutes = 60) {
  return new Date(Date.now() - minutes * 60_000);
}
