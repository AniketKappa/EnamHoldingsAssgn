// LOCAL PREVIEW ONLY. Starts an in-memory Postgres (PGlite) on 127.0.0.1:5433 and
// fills it with the synthetic test fixtures run through the real pipeline (with
// model stand-ins), so the UI can be reviewed without network access.
// Never point this at a deployed database: the people and orders are invented.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = Number(process.env.PREVIEW_PORT ?? 5433);

async function main() {
  const pg = await PGlite.create();
  const server = new PGLiteSocketServer({ db: pg, port: PORT, host: "127.0.0.1" });
  await server.start();
  process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${PORT}/postgres`;
  process.env.DB_POOL_MAX = "1";
  const { db, closeDb } = await import("../../src/lib/db");
  const sql = db();
  await sql.unsafe(readFileSync("db/schema.sql", "utf8"));
  const { setMockLlm } = await import("../../src/lib/llm/router");
  const { mockLlm } = await import("../../tests/helpers/mockLlm");
  setMockLlm(mockLlm);
  const { seedDemo } = await import("../../src/lib/pipeline/seed");
  await seedDemo();
  await sql`update companies set mcap_cr = 522321, revenue_cr = 285874, sector = 'Capital goods, EPC' where symbol = 'LT'`;

  const { makePdf, servePdfs } = await import("../../tests/helpers/pdf");
  const fx = await import("../../tests/helpers/fixtures");
  const srv = await servePdfs({
    "lt_results.pdf": await makePdf(fx.LT_RESULTS_PAGES), "lt_cfo.pdf": await makePdf(fx.CFO_PAGES),
    "lt_order.pdf": await makePdf(fx.ORDER_PAGES), "lt_rating.pdf": await makePdf(fx.RATING_PAGES),
    "hdfc_md.pdf": await makePdf(["SYNTHETIC TEST FILING\nThe Board has appointed Ms. Anita Rao as Managing Director & CEO with effect from October 27, 2026.\nBrief profile: Ms. Anita Rao has over 30 years of experience in banking."]),
  });
  const { normalizeBseRow } = await import("../../src/lib/sources/bse");
  const { upsertFilings } = await import("../../src/lib/pipeline/ingest");
  const now = Date.now();
  const ago = (h: number) => new Date(now - h * 3_600_000);
  const LT = { code: "500510", company: "LARSEN & TOUBRO LTD." };
  const rows = [
    fx.bseRow({ ...LT, id: "r1", subject: "Outcome of Board Meeting - Financial Results for the quarter ended September 30, 2026", subcat: "Outcome of Board Meeting", at: ago(20), pdf: "lt_results.pdf" }),
    fx.bseRow({ ...LT, id: "r2", subject: "Newspaper Publication of financial results", subcat: "Newspaper Publication", at: ago(6) }),
    fx.bseRow({ ...LT, id: "r3", subject: "Investor Presentation", subcat: "Investor Presentation", at: ago(19) }),
    fx.bseRow({ ...LT, id: "p1", subject: "Appointment of Chief Financial Officer (synthetic test filing)", subcat: "Change in Management", at: ago(5), pdf: "lt_cfo.pdf" }),
    fx.bseRow({ ...LT, id: "o1", subject: "Bagging/Receiving of orders/contracts", subcat: "Award of Order / Receipt of Order", headline: "Order win for the power transmission business", at: ago(4), pdf: "lt_order.pdf" }),
    fx.bseRow({ ...LT, id: "c1", subject: "Credit Rating", subcat: "Credit Rating", at: ago(30), pdf: "lt_rating.pdf" }),
    fx.bseRow({ ...LT, id: "t1", subject: "Closure of Trading Window", subcat: "Trading Window", at: ago(26) }),
    fx.bseRow({ ...LT, id: "u1", subject: "General Updates", subcat: "Others", headline: "Update on a project", at: ago(2) }),
    fx.bseRow({ code: "500180", company: "HDFC BANK LTD.", id: "h1", subject: "Change in Management - Appointment of Managing Director & CEO", subcat: "Change in Management", at: ago(10), pdf: "hdfc_md.pdf" }),
    fx.bseRow({ code: "532500", company: "MARUTI SUZUKI INDIA LTD.", id: "m1", subject: "Intimation of Board Meeting to consider financial results", subcat: "Board Meeting", at: ago(15) }),
    fx.bseRow({ code: "532500", company: "MARUTI SUZUKI INDIA LTD.", id: "m2", subject: "Compliances-Certificate under Reg. 74 (5) of SEBI (DP) Regulations, 2018", subcat: "Certificate under Reg. 74 (5)", at: ago(12) }),
    fx.bseRow({ code: "532667", company: "SUZLON ENERGY LTD.", id: "s1", subject: "Analysts/Institutional Investor Meet/Con. Call Updates", subcat: "Analyst / Investor Meet", at: ago(8) }),
    fx.bseRow({ code: "500820", company: "ASIAN PAINTS LTD.", id: "ap1", subject: "Announcement under Regulation 30 (LODR)-Dividend Updates", subcat: "Dividend", headline: "Interim dividend of Rs 4.50 per share; record date 7 November 2026", at: ago(9) }),
  ];
  const sym: Record<string, string> = { "500510": "LT", "500180": "HDFCBANK", "532500": "MARUTI", "532667": "SUZLON", "500820": "ASIANPAINT" };
  await upsertFilings(rows.map((r) => {
    const n = normalizeBseRow(r, sym[String(r.SCRIP_CD)]);
    if (r.ATTACHMENTNAME) n.pdf_url = `${srv.base}/${r.ATTACHMENTNAME}`;
    return n;
  }));
  const { processPipeline } = await import("../../src/lib/tasks");
  console.log("pipeline", JSON.stringify(await processPipeline(Date.now() + 240_000)));

  // Synthetic prices: a random walk per holding, with an unexplained move for SUZLON.
  const holdings = (await sql`select symbol from holdings where user_id = 'demo'`).map((r) => String(r.symbol));
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const s of holdings) {
    let close = 500 + rnd() * 3000;
    const vals: { symbol: string; d: string; close: number; volume: number }[] = [];
    for (let i = 170; i >= 0; i--) {
      const d = new Date(now - i * 86_400_000);
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      const last = i === 0 || (i === 1 && new Date(now).getUTCDay() === 0);
      const shock = last && s === "SUZLON" ? -0.064 : last && s === "LT" ? 0.037 : (rnd() - 0.5) * 0.03;
      close *= 1 + shock;
      vals.push({ symbol: s, d: d.toISOString().slice(0, 10), close: Math.round(close * 100) / 100, volume: Math.round((last && s === "SUZLON" ? 3.1 : 0.7 + rnd() * 0.6) * 1_000_000) });
    }
    await sql`insert into prices ${sql(vals, "symbol", "d", "close", "volume")} on conflict do nothing`;
    await sql`update companies set last_close = ${vals[vals.length - 1].close}, last_close_d = ${vals[vals.length - 1].d}, backfilled_at = now() where symbol = ${s}`;
  }
  const { computeAllSignals, explainSignals } = await import("../../src/lib/pipeline/market");
  await computeAllSignals(holdings);
  await explainSignals();
  const { evaluateAlerts } = await import("../../src/lib/pipeline/alerts");
  console.log("alerts", JSON.stringify(await evaluateAlerts()));
  await sql`insert into upcoming_results (symbol, meeting_date) values ('BHARTIARTL', current_date + 7), ('DIXON', current_date + 1), ('RELIANCE', current_date + 1) on conflict do nothing`;
  await sql`insert into task_runs (task, finished_at, ok) values ('poll', now(), true), ('prices', now() - interval '3 hours', true)`;

  // A dossier for LT from screener's real tables and the synthetic transcripts.
  const html = readFileSync("tests/fixtures/screener_LT_consolidated.html", "utf8");
  const { sha1 } = await import("../../src/lib/text");
  const url = "https://www.screener.in/company/LT/consolidated/";
  await sql`insert into http_cache (url_hash, url, status, body) values (${sha1(url)}, ${url}, 200, ${html}) on conflict do nothing`;
  const { parseScreenerHtml } = await import("../../src/lib/sources/screener");
  const { pickDocuments } = await import("../../src/lib/research/docs");
  const { storeDocument } = await import("../../src/lib/pipeline/filings");
  for (const d of pickDocuments(parseScreenerHtml(html, "LT", url))) {
    const label = d.label.match(/\(([^)]+)\)/)?.[1] ?? "";
    const pages = d.doc_type === "annual_report" ? fx.ANNUAL_REPORT_PAGES : fx.TRANSCRIPTS[label];
    if (pages) await storeDocument({ symbol: "LT", docType: d.doc_type, url: d.url, pages, periodLabel: d.period_label, periodEnd: d.period_end });
  }
  const { createResearchJob, runResearchJob } = await import("../../src/lib/research/job");
  const id = await createResearchJob("LT", "demo");
  for (let i = 0; i < 4; i++) if (await runResearchJob(id, Date.now() + 120_000)) break;
  console.log("dossier", JSON.stringify((await sql`select status, error from jobs where id = ${id}`)[0]));
  await closeDb();
  console.log(`Preview database ready on 127.0.0.1:${PORT} (synthetic data). Ctrl-C to stop.`);
  void srv;
}

main().catch((e) => { console.error(e); process.exit(1); });
