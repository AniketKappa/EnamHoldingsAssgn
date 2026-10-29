// Replay captured real filings (the `fixtures` branch) through classification
// and grouping on an in-memory Postgres, with no network and no model, and
// print what the Brief would rank. Usage:
//   git worktree add /tmp/fx fixtures   (or clone the branch)
//   npx tsx scripts/dev/replay.ts /tmp/fx
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const dir = process.argv[2];
if (!dir || !existsSync(join(dir, "bse"))) {
  console.error("Usage: npx tsx scripts/dev/replay.ts <fixtures dir with bse/, screener/, pdf/other/>");
  process.exit(1);
}

async function main() {
  const pg = await PGlite.create();
  const port = 5600 + Math.floor(Math.random() * 300);
  const server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1" });
  await server.start();
  process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${port}/postgres`;
  process.env.DB_POOL_MAX = "1";
  delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY; delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const { db, closeDb } = await import("../../src/lib/db");
  const sql = db();
  await sql.unsafe(readFileSync("db/schema.sql", "utf8"));
  const { seedDemo } = await import("../../src/lib/pipeline/seed");
  await seedDemo();

  // Market value and revenue from the captured screener pages, so deals are sized.
  const { parseScreenerHtml } = await import("../../src/lib/sources/screener");
  const { storeScreener } = await import("../../src/lib/pipeline/financials");
  for (const f of readdirSync(join(dir, "screener")).filter((x) => x.endsWith("_consolidated.html"))) {
    const symbol = f.replace("_consolidated.html", "");
    const [c] = await sql`select 1 from companies where symbol = ${symbol}`;
    if (!c) continue;
    try { await storeScreener(parseScreenerHtml(readFileSync(join(dir, "screener", f), "utf8"), symbol, f)); } catch { /* skip */ }
  }

  // Serve the captured disclosure PDFs locally in place of BSE.
  const other = join(dir, "pdf", "other");
  const local = new Map<string, string>();
  if (existsSync(other)) for (const f of readdirSync(other).filter((x) => x.endsWith(".pdf"))) local.set(f.split("_")[1].replace(".pdf", ""), f);
  const http = createServer((req, res) => {
    const f = decodeURIComponent((req.url ?? "/").slice(1));
    if (!local.has(f.split("_")[1]?.replace(".pdf", "") ?? "") && !existsSync(join(other, f))) { res.statusCode = 404; res.end(); return; }
    res.setHeader("content-type", "application/pdf");
    res.end(readFileSync(join(other, f)));
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;

  const { normalizeBseRow } = await import("../../src/lib/sources/bse");
  const { upsertFilings } = await import("../../src/lib/pipeline/ingest");
  let n = 0;
  for (const f of readdirSync(join(dir, "bse"))) {
    const symbol = f.replace(".json", "");
    const rows = JSON.parse(readFileSync(join(dir, "bse", f), "utf8"));
    const norm = rows.map((r: Parameters<typeof normalizeBseRow>[0]) => {
      const x = normalizeBseRow(r, symbol);
      const hit = local.get(String(r.NEWSID).slice(0, 8));
      x.pdf_url = hit ? `${base}/${hit}` : null; // BSE is not reachable offline
      return x;
    });
    n += await upsertFilings(norm);
  }

  const { classifyNew } = await import("../../src/lib/pipeline/classify");
  const { groupNew, rescoreEvent } = await import("../../src/lib/pipeline/events");
  const c = await classifyNew(5000, Date.now() + 120_000);
  const g = await groupNew(5000);
  for (const e of await sql`select event_key from events`) await rescoreEvent(String(e.event_key));
  const { tierOf } = await import("../../src/lib/pipeline/score");

  const events = await sql`select e.symbol, e.category, e.subtype, e.title, e.base_score, e.filings, e.reasons from events e order by e.base_score desc, e.first_filed_at desc`;
  const tiers: Record<string, number> = { top: 0, worth: 0, routine: 0, hidden: 0 };
  for (const e of events) tiers[tierOf(Number(e.base_score))]++;
  console.log(`filings ${n} -> events ${events.length} | classified ${JSON.stringify(c)} | grouped ${g}`);
  console.log(`tiers ${JSON.stringify(tiers)}\n`);
  for (const e of events) {
    const t = tierOf(Number(e.base_score));
    if (t === "hidden") continue;
    console.log(`${String(e.base_score).padStart(3)} ${t.padEnd(7)} ${String(e.symbol).padEnd(11)} ${`${e.category}/${e.subtype}`.padEnd(34)} x${e.filings} ${String(e.title).slice(0, 90)}  [${(e.reasons as string[]).join("; ")}]`);
  }
  const byClass = await sql`select classified_by, count(*)::int as n from announcements group by 1 order by 2 desc`;
  console.log(`\nclassified by: ${byClass.map((r) => `${r.classified_by} ${r.n}`).join(", ")}`);
  http.close();
  await closeDb();
  await server.stop();
  await pg.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
