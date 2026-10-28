import type { NextRequest } from "next/server";
import { handle, json, fail } from "@/lib/api/http";
import { currentUser } from "@/lib/api/user";
import { listHoldings } from "@/lib/api/reads";
import { db } from "@/lib/db";
import { resolveCompany, JobError } from "@/lib/research/job";

export async function GET() {
  return handle(async () => json({ holdings: await listHoldings(await currentUser()) }));
}

/** Add a stock. One FINN hasn't seen gets a backfill job: 30 days of filings, a year of prices. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json().catch(() => ({}))) as { symbol?: string; weight_pct?: number };
    if (!b.symbol) return fail(400, "Send a symbol.");
    const userId = await currentUser();
    const sql = db();
    const [{ n }] = await sql`select count(*)::int as n from holdings where user_id = ${userId}`;
    if (Number(n) >= 30) return fail(400, "FINN's prototype follows up to 30 holdings.");
    let c;
    try { c = await resolveCompany(b.symbol); } catch (e) { return fail(404, e instanceof JobError ? e.message : "Couldn't find that symbol."); }
    const w = typeof b.weight_pct === "number" && b.weight_pct >= 0 && b.weight_pct <= 100 ? b.weight_pct : null;
    await sql`insert into holdings (user_id, symbol, weight_pct) values (${userId}, ${c.symbol}, ${w}) on conflict (user_id, symbol) do nothing`;
    const [co] = await sql`select backfilled_at from companies where symbol = ${c.symbol}`;
    let job: string | null = null;
    if (!co?.backfilled_at) {
      const open = await sql`select id from jobs where kind = 'backfill' and symbol = ${c.symbol} and status in ('queued', 'running')`;
      job = open.length ? String(open[0].id) : String((await sql`insert into jobs (kind, symbol, user_id, step) values ('backfill', ${c.symbol}, ${userId}, 'Fetching 30 days of filings') returning id`)[0].id);
    }
    return json({ symbol: c.symbol, name: c.name, job_id: job });
  });
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const s = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
    await db()`delete from holdings where user_id = ${await currentUser()} and symbol = ${s}`;
    return json({ ok: true });
  });
}
