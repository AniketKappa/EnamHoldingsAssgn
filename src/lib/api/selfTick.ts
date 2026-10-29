// A second clock. GitHub's scheduler is best effort (on a new repository it can skip
// hours), so when the pipeline has been quiet for 15 minutes the next visit runs a
// tick in the background, after its response is sent. One kick per 5 minutes across
// all visitors; the tick's own lease stops overlaps with the scheduled run.
import { after } from "next/server";
import { db, kvGet } from "../db";

const STALE_MS = 15 * 60_000;

function enabled(): boolean {
  const v = process.env.AUTO_TICK;
  if (v === "off") return false;
  return v === "on" || !!process.env.VERCEL;
}

export async function tickIfStale(): Promise<boolean> {
  if (!enabled()) return false;
  try {
    const last = await kvGet<{ at: string }>("last_tick");
    if (last && Date.now() - Date.parse(last.at) < STALE_MS) return false;
    const sql = db();
    const won = await sql`insert into kv (key, value, updated_at) values ('tick_kick', ${sql.json({ at: new Date().toISOString() })}, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
      where kv.updated_at < now() - interval '5 minutes' returning key`;
    if (!won.length) return false;
    // Loaded only when needed, so a page's cold start does not pay for the pipeline's modules.
    after(async () => {
      try { await (await import("../tasks")).runTick({ deadlineMs: Date.now() + 240_000 }); } catch { /* next visit retries */ }
    });
    return true;
  } catch {
    return false;
  }
}
