// The clock's entry point. Every tick runs whatever is due (spec 8, schedule)
// under a lease so runs never overlap, inside a deadline so it fits a
// serverless invocation or a CI step. Every task logs to task_runs.
import { db, kvGet } from "./db";
import { istDate, istMinutes, isWeekdayIst, istAt } from "./time";
import { heldSymbols, ingestAll, ingestSymbol } from "./pipeline/ingest";
import { classifyNew } from "./pipeline/classify";
import { groupNew } from "./pipeline/events";
import { extractPending } from "./pipeline/extract";
import { ingestPrices, computeAllSignals, explainSignals, refreshMcap } from "./pipeline/market";
import { evaluateAlerts } from "./pipeline/alerts";
import { pushPendingAlerts, pushDigest } from "./pipeline/push";
import { verifyResults } from "./pipeline/verify";
import { refreshCalendar } from "./pipeline/calendar";
import { buildSymbolMaster } from "./pipeline/symbols";
import { screenerFor, storeScreener } from "./pipeline/financials";
import { runResearchJob, createResearchJob, latestDossier } from "./research/job";
import { lookupScripCode } from "./sources/bse";
import { loadPortfolio } from "./pipeline/seed";

export type TaskName = "poll" | "process" | "prices" | "verify" | "calendar" | "digest" | "jobs" | "symbols" | "prebuild";

interface Schedule { every?: number; at?: [number, number][]; weekdaysOnly?: boolean }
const SCHEDULE: Record<TaskName, Schedule> = {
  poll: { every: 9 },                    // minutes; hourly overnight (see due())
  process: { every: 0 },                 // every tick
  prices: { at: [[16, 15], [19, 0]], weekdaysOnly: true },
  verify: { every: 55 },
  calendar: { at: [[7, 30]] },
  digest: { at: [[8, 30]] },
  jobs: { every: 0 },
  symbols: { every: 7 * 24 * 60 },
  prebuild: { at: [[21, 0]] },
};

async function lastOk(task: TaskName): Promise<Date | null> {
  const rows = await db()`select started_at from task_runs where task = ${task} and ok order by started_at desc limit 1`;
  return rows.length ? new Date(rows[0].started_at as string) : null;
}

export async function due(task: TaskName, now = new Date()): Promise<boolean> {
  const s = SCHEDULE[task];
  const last = await lastOk(task);
  if (s.every !== undefined) {
    let every = s.every;
    if (task === "poll") {
      const m = istMinutes(now);
      every = m >= 7 * 60 ? 9 : 55; // every tick 07:00-24:00 IST, hourly overnight
    }
    return !last || now.getTime() - last.getTime() >= every * 60_000;
  }
  if (s.weekdaysOnly && !isWeekdayIst(now)) return false;
  const today = istDate(now);
  for (const [h, m] of [...(s.at ?? [])].reverse()) {
    const slot = istAt(today, h, m);
    if (now >= slot) return !last || last < slot;
  }
  return false;
}

async function run<T>(task: TaskName, fn: () => Promise<T>): Promise<T | null> {
  const sql = db();
  const [r] = await sql`insert into task_runs (task) values (${task}) returning id`;
  try {
    const out = await fn();
    await sql`update task_runs set finished_at = now(), ok = true, detail = ${sql.json((out ?? {}) as never)} where id = ${r.id}`;
    return out;
  } catch (e) {
    await sql`update task_runs set finished_at = now(), ok = false, detail = ${sql.json({ error: String((e as Error).message ?? e).slice(0, 500) })} where id = ${r.id}`;
    return null;
  }
}

/** A lease row in kv, so two clocks (CI and a manual run) never process at once. */
async function acquire(name: string, seconds: number): Promise<boolean> {
  const sql = db();
  const until = new Date(Date.now() + seconds * 1000).toISOString();
  const rows = await sql`insert into kv (key, value, updated_at) values (${name}, ${sql.json({ until })}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
    where (kv.value->>'until')::timestamptz < now() returning key`;
  return rows.length > 0;
}
async function release(name: string) {
  await db()`update kv set value = jsonb_build_object('until', now()) where key = ${name}`;
}

/** Process stages only: classify, group, extract, score, alert, push. */
export async function processPipeline(deadline: number) {
  const c = await classifyNew(2000, Math.min(deadline - 60_000, Date.now() + 90_000));
  const g = await groupNew();
  // New events can explain moves already seen (e.g. a backfill computed signals first).
  if (g) await explainSignals(10).catch(() => 0);
  const x = await extractPending(deadline - 20_000);
  const a = await evaluateAlerts();
  const p = await pushPendingAlerts().catch(() => 0);
  return { classified: c, grouped: g, extracted: x, alerts: a, pushed: p };
}

export async function runTick(opts: { deadlineMs: number; force?: TaskName[]; skip?: TaskName[] } = { deadlineMs: Date.now() + 240_000 }) {
  const deadline = opts.deadlineMs;
  if (!(await acquire("tick_lease", Math.ceil((deadline - Date.now()) / 1000) + 30))) return { skipped: "another tick is running" };
  const ran: Record<string, unknown> = {};
  const want = async (t: TaskName) => !opts.skip?.includes(t) && (opts.force?.includes(t) || (await due(t)));
  try {
    const syms = await heldSymbols();
    if (await want("symbols")) {
      const [{ n }] = await db()`select count(*)::int as n from companies`;
      if (Number(n) < 500 || opts.force?.includes("symbols")) ran.symbols = await run("symbols", buildSymbolMaster);
      else await run("symbols", async () => ({ skipped: "fresh" }));
    }
    if (await want("poll")) ran.poll = await run("poll", () => ingestAll(2, deadline - 150_000));
    if (await want("prices") && Date.now() < deadline - 90_000) {
      ran.prices = await run("prices", async () => {
        const p = await ingestPrices(syms, 10, deadline - 100_000);
        const m = await refreshMcap(syms.map((s) => s.symbol));
        const s = await computeAllSignals(syms.map((x) => x.symbol));
        const e = await explainSignals();
        return { ...p, mcap: m, signals: s, explained: e };
      });
    }
    if (Date.now() < deadline - 60_000) ran.process = await run("process", () => processPipeline(deadline - 30_000));
    if (await want("calendar") && Date.now() < deadline - 40_000) ran.calendar = await run("calendar", () => refreshCalendar(syms, deadline - 30_000).then((n) => ({ dates: n })));
    if (await want("verify") && Date.now() < deadline - 40_000) ran.verify = await run("verify", () => verifyResults(deadline - 30_000).then((n) => ({ verified: n })));
    if (await want("digest")) ran.digest = await run("digest", () => pushDigest().then((n) => ({ sent: n })));
    if (await want("jobs") && Date.now() < deadline - 45_000) ran.jobs = await run("jobs", () => drainJobs(deadline - 15_000));
    if (await want("prebuild") && Date.now() < deadline - 30_000) ran.prebuild = await run("prebuild", () => queuePrebuilds(1)); // one a night: free model quotas are small
    await db()`insert into kv (key, value, updated_at) values ('last_tick', ${db().json({ at: new Date().toISOString(), ran: Object.keys(ran) })}, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()`;
    return ran;
  } finally {
    await release("tick_lease");
  }
}

/** Queued research and backfill jobs, oldest first, within the deadline. */
export async function drainJobs(deadline: number) {
  const sql = db();
  const jobs = await sql`select id, kind from jobs where status = 'queued' or (status = 'running' and lease_until < now())
    order by created_at limit 5`;
  const out: Record<string, number> = { research: 0, backfill: 0, unfinished: 0 };
  for (const j of jobs) {
    if (Date.now() > deadline - 30_000) break;
    const finished = j.kind === "backfill" ? await runBackfillJob(String(j.id), deadline) : await runResearchJob(String(j.id), deadline);
    if (finished) out[String(j.kind)] = (out[String(j.kind)] ?? 0) + 1; else out.unfinished++;
  }
  return out;
}

/** A stock added to a portfolio: 30 days of filings, a year of prices, its financials. */
export async function runBackfillJob(jobId: string, deadline: number): Promise<boolean> {
  const sql = db();
  const claimed = await sql`update jobs set status = 'running', lease_until = now() + interval '4 minutes', updated_at = now()
    where id = ${jobId} and (status = 'queued' or (status = 'running' and lease_until < now())) returning symbol`;
  if (!claimed.length) return false;
  const symbol = String(claimed[0].symbol);
  try {
    const [c] = await sql`select symbol, bse_code from companies where symbol = ${symbol}`;
    let bse = c?.bse_code ? String(c.bse_code) : null;
    await sql`update jobs set step = 'Reading financials', progress = 10 where id = ${jobId}`;
    try { await storeScreener(await screenerFor(symbol, 12)); } catch { /* financials are optional for the Brief */ }
    if (!bse) {
      const [c2] = await sql`select bse_code from companies where symbol = ${symbol}`;
      bse = c2?.bse_code ? String(c2.bse_code) : await lookupScripCode(symbol).catch(() => null);
      if (bse) await sql`update companies set bse_code = ${bse} where symbol = ${symbol} and bse_code is null`;
    }
    if (!bse) throw new Error("No BSE listing found, so filings can't be fetched");
    await sql`update jobs set step = 'Fetching 30 days of filings', progress = 35 where id = ${jobId}`;
    const n = await ingestSymbol(symbol, bse, 30);
    await sql`update jobs set step = 'Loading a year of prices', progress = 70 where id = ${jobId}`;
    await ingestPrices([{ symbol, bse_code: bse }], 400, deadline);
    await computeAllSignals([symbol]);
    await refreshMcap([symbol]);
    await sql`update companies set backfilled_at = now() where symbol = ${symbol}`;
    await sql`update jobs set status = 'done', step = 'Backfill complete', progress = 100, result = ${sql.json({ filings: n })}, lease_until = null, updated_at = now() where id = ${jobId}`;
    return true;
  } catch (e) {
    await sql`update jobs set status = 'failed', error = ${String((e as Error).message).slice(0, 300)}, lease_until = null, updated_at = now() where id = ${jobId}`;
    return true;
  }
}

/** Keep dossiers warm for the portfolio and the research picks, a few per night. */
export async function queuePrebuilds(max = 3) {
  const p = loadPortfolio();
  const symbols = [...new Set([...p.research_picks.map((x) => x.symbol), ...p.holdings.map((x) => x.symbol)])];
  let queued = 0;
  for (const s of symbols) {
    if (queued >= max) break;
    const d = await latestDossier(s);
    if (d && Date.now() - new Date(d.created_at).getTime() < 7 * 86_400_000) continue;
    await createResearchJob(s, null);
    queued++;
  }
  return { queued };
}

export async function lastTick(): Promise<{ at: string; ran: string[] } | null> {
  return kvGet("last_tick");
}
