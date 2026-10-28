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
      const wanted = [...env.models.t1(), ...env.models.t2(), ...env.models.t3(), ...env.models.grounded()];
      return wanted.map((w) => `${w}:${names.includes(w) ? "ok" : "MISSING"}`).join(" ");
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
    console.log("Commands: probe, doctor, migrate, seed, symbols, backfill, ingest, process, prices, verify, calendar, alerts, research <SYMBOL>, tick, taxonomy, status");
    return;
  }
  if (cmd === "probe") return probe();
  if (!hasDb()) throw new Error("DATABASE_URL is not set");
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
      const rows = await sql`select classified_by like 'rule:%' as by_rule, count(*)::int as n from announcements group by 1`;
      const cats = await sql`select category, count(*)::int as n from announcements group by 1 order by 2 desc`;
      const unmatched = await sql`select subject, exchange_subcategory from announcements where classified_by <> 'rule' and classified_by not like 'rule:%' limit 40`;
      const total = rows.reduce((s, r) => s + Number(r.n), 0);
      const rule = rows.find((r) => r.by_rule)?.n ?? 0;
      summary(`Taxonomy: ${rule}/${total} by rules (${total ? Math.round((Number(rule) / total) * 100) : 0}%)\n\n${cats.map((c) => `- ${c.category}: ${c.n}`).join("\n")}\n\nNot matched by rules:\n${unmatched.map((u) => `- ${u.exchange_subcategory ?? ""} | ${u.subject}`).join("\n")}`);
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
