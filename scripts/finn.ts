// FINN command line: the same pipeline the web app's clock runs, for CI,
// setup and debugging. Usage: npx tsx scripts/finn.ts <command> [args]
import { readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { db, closeDb, hasDb } from "../src/lib/db";
import { env } from "../src/lib/env";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";
const flag = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const minutes = Number(flag("minutes", "8"));
const deadline = Date.now() + minutes * 60_000;

function summary(md: string) {
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  // Annotations are readable through the REST API, so a remote operator can see results without log access.
  if (process.env.GITHUB_ACTIONS) {
    const esc = md.slice(0, 3800).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
    console.log(`::notice title=finn ${cmd}::${esc}`);
  }
}

async function probe() {
  const { getJson, getText, getBuffer, CHROME_UA } = await import("../src/lib/sources/http");
  const { BSE_HEADERS } = await import("../src/lib/sources/bse");
  const { yyyymmdd, addDays } = await import("../src/lib/time");
  const to = new Date(), from = addDays(to, -7);
  const checks: [string, () => Promise<string>][] = [
    ["BSE announcements (LT, 7 days)", async () => {
      const q = new URLSearchParams({ pageno: "1", strCat: "-1", subcategory: "-1", strPrevDate: yyyymmdd(from), strToDate: yyyymmdd(to), strSearch: "P", strScrip: "500510", strType: "C" });
      const j = await getJson<{ Table?: unknown[] }>(`https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?${q}`, { headers: BSE_HEADERS, retries: 0 });
      return `${j.Table?.length ?? 0} rows`;
    }],
    ["BSE result calendar (LT)", async () => `${JSON.stringify(await getJson(`https://api.bseindia.com/BseIndiaAPI/api/Corpforthresults/w?scripcode=500510`, { headers: BSE_HEADERS, retries: 0 })).length} bytes`],
    ["BSE PDF (L&T FY26 annual report)", async () => {
      const b = await getBuffer("https://www.bseindia.com/xml-data/corpfiling/AttachHis/825f9859-e7f2-4e90-8583-01a38850f795.pdf", { headers: { ...BSE_HEADERS, Accept: "application/pdf,*/*" }, retries: 0, timeoutMs: 60_000 });
      return `${(b.byteLength / 1e6).toFixed(1)} MB, starts ${String.fromCharCode(...b.slice(0, 4))}`;
    }],
    ["Screener (LT consolidated)", async () => `${(await getText("https://www.screener.in/company/LT/consolidated/", { headers: { Accept: "text/html" }, retries: 0 })).length} chars`],
    ["Screener search API", async () => `${JSON.stringify(await getJson("https://www.screener.in/api/company/search/?q=infosys", { retries: 0 })).slice(0, 80)}`],
    ["Yahoo chart (LT.NS)", async () => {
      const YahooFinance = (await import("yahoo-finance2")).default;
      const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
      const r = await yf.chart("LT.NS", { period1: addDays(to, -30), interval: "1d" });
      return `${r.quotes.length} bars, last close ${r.quotes.at(-1)?.close}`;
    }],
    ["NSE equity list", async () => `${(await getText("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv", { headers: { "User-Agent": CHROME_UA }, retries: 0 })).split("\n").length} lines`],
    ["Gemini models", async () => {
      if (!env.geminiKey()) return "no GEMINI_API_KEY";
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: env.geminiKey() });
      const names: string[] = [];
      for await (const m of await ai.models.list()) names.push(String(m.name).replace("models/", ""));
      const wanted = [...new Set([...env.models.t1(), ...env.models.t2(), ...env.models.t3(), ...env.models.grounded()])];
      // Listed is not the same as usable (retired models still list): ask each for one word.
      const out: string[] = [];
      for (const w of wanted) {
        if (!names.includes(w)) { out.push(`${w}:MISSING`); continue; }
        try {
          const r = await ai.models.generateContent({ model: w, contents: "Reply with the single word OK." });
          out.push(`${w}:${/ok/i.test(r.text ?? "") ? "ok" : "odd reply"}`);
        } catch (e) {
          const m = String((e as Error).message);
          out.push(`${w}:${/\b404\b|no longer available/.test(m) ? "RETIRED" : /\b429\b/.test(m) ? "QUOTA" : "FAIL"}`);
        }
      }
      return out.join(" ");
    }],
    ["Gemini search grounding", async () => {
      if (!env.geminiKey()) return "no GEMINI_API_KEY";
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: env.geminiKey() });
      const out: string[] = [];
      for (const w of env.models.grounded()) {
        try {
          const r = await ai.models.generateContent({ model: w, contents: "Who is the chief executive of Infosys? One line.", config: { tools: [{ googleSearch: {} }] } });
          const chunks = r.candidates?.[0]?.groundingMetadata?.groundingChunks?.length ?? 0;
          out.push(`${w}:ok (${chunks} sources)`);
        } catch (e) {
          out.push(`${w}:${String((e as Error).message).replace(/\s+/g, " ").slice(0, 260)}`);
        }
      }
      return out.join(" || ");
    }],
  ];
  const rows: string[] = ["| Source | Result | ms |", "| --- | --- | --- |"];
  for (const [name, fn] of checks) {
    const t0 = Date.now();
    let res: string;
    try { res = `ok: ${await fn()}`; } catch (e) { res = `FAIL: ${String((e as Error).message).slice(0, 140)}`; }
    rows.push(`| ${name} | ${res.replace(/\|/g, "/")} | ${Date.now() - t0} |`);
  }
  summary(`### FINN source probe (${new Date().toISOString()})\n\n${rows.join("\n")}\n`);
}

/** Real-world fixtures for offline tests: 30 days of BSE filings, screener pages, a few results PDFs. */
async function fixtures(dir: string) {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { fetchAnnouncements } = await import("../src/lib/sources/bse");
  const { classifyText } = await import("../src/lib/pipeline/rules");
  const { downloadPdf } = await import("../src/lib/pipeline/filings");
  const { getText } = await import("../src/lib/sources/http");
  const { cleanSubject } = await import("../src/lib/sources/bse");
  const p = JSON.parse(readFileSync(join(process.cwd(), "data", "portfolio.json"), "utf8")) as { holdings: { symbol: string; bse_code: string }[]; research_picks: { symbol: string; bse_code: string }[] };
  mkdirSync(`${dir}/bse`, { recursive: true }); mkdirSync(`${dir}/screener`, { recursive: true }); mkdirSync(`${dir}/pdf/other`, { recursive: true });
  const index: Record<string, unknown>[] = [];
  let otherPdfs = 0;
  const to = new Date(), from = new Date(Date.now() - 30 * 86_400_000);
  const lines: string[] = [];
  let pdfs = 0;
  for (const h of p.holdings) {
    try {
      const rows = await fetchAnnouncements(h.bse_code, from, to);
      writeFileSync(`${dir}/bse/${h.symbol}.json`, JSON.stringify(rows, null, 1));
      lines.push(`${h.symbol}: ${rows.length} filings`);
      const results = rows.filter((r) => classifyText(r.SUBCATNAME ?? null, cleanSubject(r.NEWSSUB ?? ""), r.HEADLINE ?? null).subtype === "financial_results" && r.ATTACHMENTNAME)
        .sort((a, b) => Number(b.Fld_Attachsize ?? 0) - Number(a.Fld_Attachsize ?? 0));
      if (results[0] && pdfs < 8 && Number(results[0].Fld_Attachsize ?? 0) < 12_000_000) {
        const buf = await downloadPdf(`https://www.bseindia.com/xml-data/corpfiling/AttachLive/${results[0].ATTACHMENTNAME}`);
        writeFileSync(`${dir}/pdf/${h.symbol}_results.pdf`, buf);
        pdfs++;
      }
      // Disclosure PDFs the rules cannot place, and the kinds the extractors read, for offline tests.
      const want: Record<string, number> = { needs_llm: 3, management_change: 2, "M&A": 2, press_release: 1, credit_rating: 1, fund_raise: 1 };
      for (const r of rows) {
        if (otherPdfs >= 45 || !r.ATTACHMENTNAME || Number(r.Fld_Attachsize ?? 0) > 5_000_000) continue;
        const c = classifyText(r.SUBCATNAME ?? null, cleanSubject(r.NEWSSUB ?? ""), r.HEADLINE ?? null);
        if (!want[c.category]) continue;
        want[c.category]--;
        try {
          const buf = await downloadPdf(`https://www.bseindia.com/xml-data/corpfiling/AttachLive/${r.ATTACHMENTNAME}`);
          const name = `${h.symbol}_${String(r.NEWSID).slice(0, 8)}.pdf`;
          writeFileSync(`${dir}/pdf/other/${name}`, buf);
          index.push({ file: name, symbol: h.symbol, category: c.category, subtype: c.subtype, subcategory: r.SUBCATNAME, subject: cleanSubject(r.NEWSSUB ?? ""), headline: r.HEADLINE });
          otherPdfs++;
        } catch (e) { lines.push(`${h.symbol} pdf ${r.ATTACHMENTNAME}: FAIL ${(e as Error).message.slice(0, 80)}`); }
      }
    } catch (e) { lines.push(`${h.symbol}: FAIL ${(e as Error).message.slice(0, 100)}`); }
  }
  writeFileSync(`${dir}/pdf/other/index.json`, JSON.stringify(index, null, 1));
  for (const s of [...new Set([...p.holdings, ...p.research_picks].map((x) => x.symbol))]) {
    for (const basis of ["consolidated", "standalone"]) {
      try {
        const url = basis === "consolidated" ? `https://www.screener.in/company/${s}/consolidated/` : `https://www.screener.in/company/${s}/`;
        writeFileSync(`${dir}/screener/${s}_${basis}.html`, await getText(url, { headers: { Accept: "text/html" } }));
      } catch (e) { lines.push(`screener ${s} ${basis}: FAIL ${(e as Error).message.slice(0, 80)}`); }
    }
  }
  summary(`Fixtures: ${pdfs} results PDFs, ${otherPdfs} other filing PDFs\n${lines.join("\n")}`);
}

async function main() {
  if (cmd === "fixtures") return fixtures(flag("dir", "fixtures") ?? "fixtures");
  if (cmd === "help") {
    console.log("Commands: probe, migrate, seed, symbols, backfill, ingest, process, prices, verify, calendar, alerts, research <SYMBOL>, prebuild, tick, taxonomy, eval, status, fixtures");
    return;
  }
  if (cmd === "probe") return probe();
  if (!hasDb()) throw new Error("DATABASE_URL is not set");
  const dbUrl = env.databaseUrl();
  if (/@db\.[a-z0-9]+\.supabase\.co(:5432)?\//.test(dbUrl)) {
    summary("DATABASE_URL is Supabase's direct connection, which is IPv6 only and unreachable from GitHub runners. In Supabase, open Connect and copy the Transaction pooler URI (port 6543) instead.");
  }
  const sql = db();
  switch (cmd) {
    case "migrate": {
      const ddl = readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8");
      await sql.unsafe(ddl);
      summary("Schema applied.");
      break;
    }
    case "seed": {
      const { seedDemo } = await import("../src/lib/pipeline/seed");
      summary(`Seeded: ${JSON.stringify(await seedDemo())}`);
      break;
    }
    case "symbols": {
      const { buildSymbolMaster } = await import("../src/lib/pipeline/symbols");
      summary(`Symbol master: ${JSON.stringify(await buildSymbolMaster())}`);
      break;
    }
    case "backfill": {
      // Filings (30 days), prices (400 days) and financials for every held symbol.
      const days = Number(flag("days", "30"));
      const { heldSymbols, ingestSymbol } = await import("../src/lib/pipeline/ingest");
      const { ingestPrices, computeAllSignals, refreshMcap, explainSignals } = await import("../src/lib/pipeline/market");
      const { screenerFor, storeScreener } = await import("../src/lib/pipeline/financials");
      const syms = await heldSymbols();
      const out: string[] = [];
      for (const s of syms) {
        let filings = 0, fin = "ok";
        try { if (s.bse_code) filings = await ingestSymbol(s.symbol, s.bse_code, days); } catch (e) { out.push(`${s.symbol} filings FAIL ${(e as Error).message}`); }
        try { await storeScreener(await screenerFor(s.symbol, 12)); } catch (e) { fin = `FAIL ${(e as Error).message.slice(0, 60)}`; }
        out.push(`${s.symbol}: ${filings} filings, financials ${fin}`);
        await sql`update companies set backfilled_at = now() where symbol = ${s.symbol}`;
      }
      const p = await ingestPrices(syms, 400, deadline);
      await refreshMcap(syms.map((s) => s.symbol));
      await computeAllSignals(syms.map((s) => s.symbol), 30);
      await explainSignals(30);
      summary(`Backfill:\n${out.map((l) => `- ${l}`).join("\n")}\n- prices: ${p.bars} bars${p.errors.length ? `, errors: ${p.errors.join("; ")}` : ""}`);
      break;
    }
    case "ingest": {
      const { ingestAll } = await import("../src/lib/pipeline/ingest");
      summary(`Ingest: ${JSON.stringify(await ingestAll(Number(flag("days", "2")), deadline))}`);
      break;
    }
    case "process": {
      const { processPipeline } = await import("../src/lib/tasks");
      summary(`Process: ${JSON.stringify(await processPipeline(deadline))}`);
      break;
    }
    case "prices": {
      const { heldSymbols } = await import("../src/lib/pipeline/ingest");
      const { ingestPrices, computeAllSignals, explainSignals, refreshMcap } = await import("../src/lib/pipeline/market");
      const syms = await heldSymbols();
      const p = await ingestPrices(syms, Number(flag("days", "10")), deadline);
      await refreshMcap(syms.map((s) => s.symbol));
      const n = await computeAllSignals(syms.map((s) => s.symbol), 10);
      const e = await explainSignals(10);
      summary(`Prices: ${p.bars} bars, ${n} signals, ${e} explained${p.errors.length ? `; errors ${p.errors.join("; ")}` : ""}`);
      break;
    }
    case "verify": {
      const { verifyResults } = await import("../src/lib/pipeline/verify");
      summary(`Verified ${await verifyResults(deadline)} results cards`);
      break;
    }
    case "calendar": {
      const { heldSymbols } = await import("../src/lib/pipeline/ingest");
      const { refreshCalendar } = await import("../src/lib/pipeline/calendar");
      summary(`Calendar: ${await refreshCalendar(await heldSymbols(), deadline)} dates`);
      break;
    }
    case "alerts": {
      const { evaluateAlerts } = await import("../src/lib/pipeline/alerts");
      const { pushPendingAlerts } = await import("../src/lib/pipeline/push");
      summary(`Alerts: ${JSON.stringify(await evaluateAlerts())}, pushed ${await pushPendingAlerts()}`);
      break;
    }
    case "research": {
      const symbol = (args[1] ?? "").toUpperCase();
      if (!symbol) throw new Error("Usage: research SYMBOL");
      const { createResearchJob, runResearchJob } = await import("../src/lib/research/job");
      const id = await createResearchJob(symbol, null);
      let finished = false;
      while (!finished && Date.now() < deadline) {
        finished = await runResearchJob(id, Math.min(deadline, Date.now() + 280_000));
        if (!finished) await new Promise((r) => setTimeout(r, 1000));
      }
      const [j] = await sql`select status, step, error, log, result->>'version' as version from jobs where id = ${id}`;
      summary(`Research ${symbol}: ${j.status}${j.error ? ` (${j.error})` : ""}, version ${j.version ?? "-"}\n${(j.log as { text: string }[]).map((l) => `- ${l.text}`).join("\n")}`);
      break;
    }
    case "prebuild": {
      const { queuePrebuilds, drainJobs } = await import("../src/lib/tasks");
      const q = await queuePrebuilds(Number(flag("max", "3")));
      summary(`Prebuild queued ${q.queued}; ${JSON.stringify(await drainJobs(deadline))}`);
      break;
    }
    case "tick": {
      const { runTick } = await import("../src/lib/tasks");
      const force = flag("force")?.split(",") as never;
      summary(`Tick: ${JSON.stringify(await runTick({ deadlineMs: deadline, force }))}`);
      break;
    }
    case "taxonomy": {
      const { classificationSources } = await import("../src/lib/pipeline/evaluate");
      const src = await classificationSources();
      const cats = await sql`select category, count(*)::int as n from announcements group by 1 order by 2 desc`;
      const unmatched = await sql`select subject, exchange_subcategory, classified_by, category from announcements
        where classified_by in ('llm', 'default') order by filed_at desc limit 40`;
      const total = Object.values(src).reduce((a, b) => a + b, 0);
      const noModel = (src.rules ?? 0) + (src.context ?? 0) + (src.letter ?? 0);
      summary(`Taxonomy: ${noModel}/${total} placed without a model (${total ? Math.round((noModel / total) * 1000) / 10 : 0}%): ${JSON.stringify(src)}\n\n${cats.map((c) => `- ${c.category}: ${c.n}`).join("\n")}\n\nLeft to the model or the default:\n${unmatched.map((u) => `- [${u.classified_by} -> ${u.category}] ${u.exchange_subcategory ?? ""} | ${u.subject}`).join("\n")}`);
      break;
    }
    case "eval": {
      const { evalResults, classificationSources } = await import("../src/lib/pipeline/evaluate");
      const r = await evalResults(deadline);
      const src = await classificationSources();
      const checks = await sql`select count(*)::int as n, count(*) filter (where not exists (select 1 from jsonb_array_elements(checks) c where (c->>'ok')::boolean = false))::int as all_ok
        from results_extracts`;
      const calls = await sql`select count(*)::int as calls, count(*) filter (where cache_hit)::int as hits, coalesce(sum(tokens_in), 0)::bigint as tin,
        coalesce(sum(tokens_out), 0)::bigint as tout, coalesce(sum(cost_usd_est), 0)::float as usd from llm_calls`;
      summary([
        `Results vs screener: ${r.within}/${r.compared} numbers within 0.5% (${r.rate ?? "-"}%) across ${r.filings} filings`,
        `All checks passed: ${checks[0].all_ok}/${checks[0].n} results cards`,
        `Classification sources: ${JSON.stringify(src)}`,
        `Model calls: ${calls[0].calls} (${calls[0].hits} cache hits), tokens in ${calls[0].tin}, out ${calls[0].tout}, paid-rate estimate $${Number(calls[0].usd).toFixed(2)}`,
        r.misses.length ? `\nMisses:\n${r.misses.map((m) => `- ${m}`).join("\n")}` : "",
        r.skipped.length ? `\nSkipped:\n${r.skipped.map((m) => `- ${m}`).join("\n")}` : "",
      ].join("\n"));
      break;
    }
    case "reclassify": {
      // Filings that fell back to the default (no model answer) get a second pass: their
      // single-filing events (and the alerts about them) go, and the filings return to 'new'.
      const which = flag("by", "default") ?? "default";
      const rows = await sql`select id from announcements where classified_by = ${which}`;
      const ids = rows.map((r) => String(r.id));
      let events = 0;
      if (ids.length) {
        const gone = await sql`delete from events where primary_id in ${sql(ids)} and filings <= 1 returning event_key`;
        events = gone.length;
        if (gone.length) await sql`delete from alerts where kind = 'event' and ref_id in ${sql(gone.map((g) => String(g.event_key)))}`;
        await sql`update announcements set status = 'new', category = null, subtype = null, classified_by = null, also = '[]'::jsonb,
          event_key = null, is_primary = true, one_liner = null, amount_cr = null where id in ${sql(ids)}`;
      }
      summary(`Reclassify (${which}): ${ids.length} filings back to new, ${events} events removed`);
      break;
    }
    case "diag": {
      // Read-only diagnostics for a remote operator: where filings were classified, model errors, failed stages.
      const by = await sql`select coalesce(classified_by, 'none') as by, count(*)::int as n from announcements group by 1 order by 2 desc`;
      const calls = await sql`select task, model, ok, count(*)::int as n, max(created_at) as last, max(left(error, 140)) filter (where not ok) as error
        from llm_calls group by task, model, ok order by task, model, ok`;
      const runs = await sql`select task, ok, started_at, left(detail::text, 220) as detail from task_runs order by started_at desc limit 25`;
      const evs = await sql`select category, status, count(*)::int as n from events group by 1, 2 order by 1, 2`;
      const failed = await sql`select event_key, attempts, left(error, 160) as error from events where status = 'failed' or (status = 'pending' and attempts > 0) order by updated_at desc limit 20`;
      const jobs = await sql`select kind, status, symbol, step, left(error, 140) as error, created_at from jobs order by created_at desc limit 10`;
      summary([
        `Classified by: ${by.map((r) => `${r.by} ${r.n}`).join(", ")}`,
        `\nModel calls:\n${calls.map((c) => `- ${c.task} ${c.model} ${c.ok ? "ok" : "FAIL"} x${c.n}${c.error ? `: ${c.error}` : ""}`).join("\n")}`,
        `\nEvents: ${evs.map((e) => `${e.category}/${e.status} ${e.n}`).join(", ")}`,
        `\nFailed or retried extractions:\n${failed.map((f) => `- ${f.event_key} x${f.attempts}: ${f.error ?? ""}`).join("\n")}`,
        `\nRecent task runs:\n${runs.map((r) => `- ${new Date(r.started_at as string).toISOString().slice(5, 16)} ${r.task} ${r.ok ? "ok" : "FAIL"} ${r.detail ?? ""}`).join("\n")}`,
        `\nJobs:\n${jobs.map((j) => `- ${j.kind} ${j.symbol} ${j.status} at ${j.step}${j.error ? `: ${j.error}` : ""}`).join("\n")}`,
      ].join("\n"));
      break;
    }
    case "status": {
      const t = await sql`select task, max(started_at) filter (where ok) as last_ok, count(*) filter (where not ok and started_at > now() - interval '1 day')::int as failures
        from task_runs group by task order by task`;
      const c = await sql`select (select count(*) from announcements)::int as filings, (select count(*) from events)::int as events,
        (select count(*) from events where status = 'pending')::int as pending, (select count(*) from dossiers)::int as dossiers,
        (select count(*) from prices)::int as prices, (select count(*) from llm_calls)::int as llm_calls`;
      summary(`Status: ${JSON.stringify(c[0])}\n\n${t.map((r) => `- ${r.task}: last ok ${r.last_ok ? new Date(r.last_ok as string).toISOString() : "never"}, failures today ${r.failures}`).join("\n")}`);
      break;
    }
    default:
      throw new Error(`Unknown command ${cmd}`);
  }
}

main()
  .then(() => closeDb())
  .catch(async (e) => {
    console.error(e);
    await closeDb();
    process.exit(1);
  });
