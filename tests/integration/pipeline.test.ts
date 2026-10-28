// End to end on a real Postgres (PGlite): ingest -> classify -> group ->
// extract -> score -> signals -> alerts, with real PDFs served from localhost
// and a deterministic stand-in for the models.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDb, stopDb } from "../helpers/pg";
import { makePdf, servePdfs } from "../helpers/pdf";
import { bseRow, LT_RESULTS_PAGES, CFO_PAGES, ORDER_PAGES, RATING_PAGES } from "../helpers/fixtures";
import { mockLlm } from "../helpers/mockLlm";

let close: () => Promise<void>;
const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3_600_000);

beforeAll(async () => {
  await startDb();
  const { setMockLlm } = await import("@/lib/llm/router");
  setMockLlm(mockLlm);
  const srv = await servePdfs({
    "lt_results.pdf": await makePdf(LT_RESULTS_PAGES),
    "lt_cfo.pdf": await makePdf(CFO_PAGES),
    "lt_order.pdf": await makePdf(ORDER_PAGES),
    "lt_rating.pdf": await makePdf(RATING_PAGES),
    "lt_reg30.pdf": await makePdf(["SYNTHETIC TEST FILING\nTo, BSE Limited\nDear Sir/Madam,\nSub: Disclosure under Regulation 30 of the SEBI (LODR) Regulations, 2015 - Acquisition of 100% equity stake in Example Grid Private Limited\nThis is to inform you that the Company has completed the acquisition for a consideration of Rs. 120 crore."]),
    "hdfc_md.pdf": await makePdf(["SYNTHETIC TEST FILING\nThe Board has appointed Ms. Anita Rao as Managing Director & CEO with effect from October 27, 2026.\nBrief profile: Ms. Anita Rao has over 30 years of experience in banking."]),
  });
  close = srv.close;
  const { seedDemo } = await import("@/lib/pipeline/seed");
  await seedDemo();
  const { db } = await import("@/lib/db");
  await db()`update companies set mcap_cr = 522321, revenue_cr = 285874 where symbol = 'LT'`;

  const { normalizeBseRow } = await import("@/lib/sources/bse");
  const { upsertFilings } = await import("@/lib/pipeline/ingest");
  const LT = { code: "500510", company: "LARSEN & TOUBRO LTD." };
  const rows = [
    bseRow({ ...LT, id: "r1", subject: "Outcome of Board Meeting - Financial Results for the quarter ended September 30, 2026", subcat: "Outcome of Board Meeting", at: hoursAgo(20), pdf: "lt_results.pdf" }),
    bseRow({ ...LT, id: "r2", subject: "Newspaper Publication of financial results", subcat: "Newspaper Publication", at: hoursAgo(6) }),
    bseRow({ ...LT, id: "r4", subject: "Board Meeting Outcome for Outcome Of Board Meeting Of Larsen & Toubro Limited", subcat: "Outcome of Board Meeting", at: hoursAgo(20.2) }),
    bseRow({ ...LT, id: "g1", subject: "Disclosure Under Regulation 30 Of SEBI (Listing Obligations And Disclosure Requirements) Regulations, 2015", subcat: "General", at: hoursAgo(8), pdf: "lt_reg30.pdf" }),
    bseRow({ ...LT, id: "r3", subject: "Investor Presentation", subcat: "Investor Presentation", at: hoursAgo(19) }),
    bseRow({ ...LT, id: "p1", subject: "Appointment of Chief Financial Officer (synthetic test filing)", subcat: "Change in Management", at: hoursAgo(5), pdf: "lt_cfo.pdf" }),
    bseRow({ ...LT, id: "o1", subject: "Bagging/Receiving of orders/contracts", subcat: "Award of Order / Receipt of Order", headline: "Order win for the power transmission business", at: hoursAgo(4), pdf: "lt_order.pdf" }),
    bseRow({ ...LT, id: "c1", subject: "Credit Rating", subcat: "Credit Rating", at: hoursAgo(30), pdf: "lt_rating.pdf" }),
    bseRow({ ...LT, id: "t1", subject: "Closure of Trading Window", subcat: "Trading Window", at: hoursAgo(26) }),
    bseRow({ ...LT, id: "a1", subject: "Analysts/Institutional Investor Meet/Con. Call Updates", subcat: "Analyst / Investor Meet", at: hoursAgo(3) }),
    bseRow({ ...LT, id: "u1", subject: "General Updates", subcat: "Others", headline: "Update on a project", at: hoursAgo(2) }),
    bseRow({ code: "500180", company: "HDFC BANK LTD.", id: "h1", subject: "Change in Management - Appointment of Managing Director & CEO", subcat: "Change in Management", at: hoursAgo(10), pdf: "hdfc_md.pdf" }),
  ];
  const normalized = rows.map((r) => {
    const n = normalizeBseRow(r, r.SCRIP_CD === 500180 ? "HDFCBANK" : "LT");
    if (r.ATTACHMENTNAME) n.pdf_url = `${srv.base}/${r.ATTACHMENTNAME}`;
    return n;
  });
  await upsertFilings(normalized);
}, 60_000);

afterAll(async () => {
  await close?.();
  await stopDb();
});

describe("push pipeline", () => {
  it("classifies by rules first, then the model, and is idempotent", async () => {
    const { classifyNew } = await import("@/lib/pipeline/classify");
    const r = await classifyNew();
    expect(r.rule).toBe(9);
    expect(r.context).toBe(1); // the bare board outcome on the results day
    expect(r.pdf).toBe(1);     // the generic Reg 30 disclosure, read from its "Sub:" line
    expect(r.llm).toBe(1);
    expect((await classifyNew()).rule).toBe(0);
    const { db } = await import("@/lib/db");
    const rows = await db()`select id, category, subtype from announcements order by id`;
    const byId = Object.fromEntries(rows.map((x) => [String(x.id), `${x.category}/${x.subtype}`]));
    expect(byId["BSE:r1"]).toBe("results/financial_results");
    expect(byId["BSE:r2"]).toBe("results/results_admin");
    expect(byId["BSE:p1"]).toBe("management_change/pending_people");
    expect(byId["BSE:o1"]).toBe("press_release/order_win");
    expect(byId["BSE:t1"]).toBe("unclassified/compliance");
    expect(byId["BSE:u1"]).toBe("press_release/general");
    expect(byId["BSE:r4"]).toBe("results/financial_results");
    expect(byId["BSE:g1"]).toBe("M&A/acquisition");
  });

  it("groups a results day into one event", async () => {
    const { groupNew } = await import("@/lib/pipeline/events");
    expect(await groupNew()).toBe(12);
    const { db } = await import("@/lib/db");
    const ev = await db()`select * from events where event_key = 'LT:results:2026-09-30'`;
    expect(ev).toHaveLength(1);
    expect(ev[0].filings).toBe(5); // two outcomes, newspaper ad, presentation, call notice
    expect(ev[0].primary_id).toBe("BSE:r1");
    const n = await db()`select count(*)::int as n from events`;
    expect(n[0].n).toBe(8);
  });

  it("extracts the results card, the person cards and one-liners", async () => {
    const { extractPending } = await import("@/lib/pipeline/extract");
    const out = await extractPending(Date.now() + 60_000);
    expect(out.results).toBe(1);
    expect(out.people).toBe(2);
    expect(out.one_liners).toBeGreaterThanOrEqual(2);
    const { db } = await import("@/lib/db");
    const [r] = await db()`select title, detail, base_score, reasons from events where event_key = 'LT:results:2026-09-30'`;
    const res = (r.detail as { results: { checks_ok: boolean; metrics: { revenue: { value: number; yoy_pct: number }; pat: { value: number } }; source_pages: number[] } }).results;
    expect(res.checks_ok).toBe(true);
    expect(res.metrics.revenue.value).toBe(78750.12);
    expect(res.metrics.revenue.yoy_pct).toBe(15.8);
    expect(res.metrics.pat.value).toBe(5202);
    expect(res.source_pages).toEqual([3]);
    expect(String(r.title)).toContain("Q2 FY27");
    expect(r.base_score).toBe(90);

    const [p] = await db()`select title, subtype, detail, base_score, reasons from events where event_key = 'LT:BSE:p1'`;
    expect(p.subtype).toBe("top");
    expect(String(p.title)).toBe("Rajesh Kumar appointed CFO");
    const person = (p.detail as { people: { background: { headline: string; sources: unknown[] } }[] }).people[0];
    expect(person.background.headline).toContain("Example Engineering");
    expect(person.background.sources).toHaveLength(1);
    expect(p.reasons).toContain("New CFO");

    const [o] = await db()`select title, detail, reasons, base_score from events where event_key = 'LT:BSE:o1'`;
    expect((o.detail as { amount_cr: number }).amount_cr).toBe(2500);
    expect((o.reasons as string[]).some((x) => x.includes("% of revenue"))).toBe(true);
    expect(o.base_score).toBe(50);

    // A ₹120 crore stake for a ₹5 lakh crore company is routine, and says why.
    const [g] = await db()`select base_score, reasons from events where event_key = 'LT:BSE:g1'`;
    expect(g.reasons).toContain("₹120 cr = <0.1% of mcap");
    expect(g.base_score).toBe(35);
  });

  it("computes signals and links the move to the filing that explains it", async () => {
    const { db } = await import("@/lib/db");
    const sql = db();
    // 70 quiet sessions, then a +6% day on 3x volume today.
    const days: string[] = [];
    for (let i = 100; days.length < 71; i--) {
      const d = new Date(now - i * 86_400_000);
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      days.push(d.toISOString().slice(0, 10));
    }
    days[days.length - 1] = new Date(now + 330 * 60_000).toISOString().slice(0, 10);
    let close = 3600;
    for (let i = 0; i < days.length; i++) {
      const last = i === days.length - 1;
      close = last ? close * 1.06 : close * (1 + (i % 2 ? 0.004 : -0.003));
      await sql`insert into prices (symbol, d, close, volume) values ('LT', ${days[i]}, ${close}, ${last ? 3_000_000 : 1_000_000}) on conflict do nothing`;
    }
    const { computeAllSignals, explainSignals } = await import("@/lib/pipeline/market");
    expect(await computeAllSignals(["LT"])).toBe(5);
    await explainSignals();
    const [s] = await sql`select * from price_signals where symbol = 'LT' order by d desc limit 1`;
    expect(Number(s.vol_ratio)).toBeCloseTo(3, 1);
    expect(Number(s.ret_pct)).toBeCloseTo(6, 1);
    expect(s.explained_by).not.toBeNull();
  });

  it("raises alerts from the demo user's default rules, once", async () => {
    const { evaluateAlerts } = await import("@/lib/pipeline/alerts");
    const first = await evaluateAlerts();
    expect(first.events).toBeGreaterThanOrEqual(3); // results, CFO, HDFC Bank MD & CEO
    expect(first.signals).toBe(1);
    const again = await evaluateAlerts();
    expect(again).toEqual({ events: 0, signals: 0 });
    const { db } = await import("@/lib/db");
    const sig = await db()`select title, body from alerts where kind = 'signal'`;
    expect(String(sig[0].body)).toMatch(/^Explained by:/);
  });

  it("gives a new visitor their own copy of the demo portfolio and rules", async () => {
    const { ensureUser } = await import("@/lib/pipeline/alerts");
    expect(await ensureUser("visitor-1")).toBe(true);
    expect(await ensureUser("visitor-1")).toBe(false);
    const { db } = await import("@/lib/db");
    const [h] = await db()`select count(*)::int as n from holdings where user_id = 'visitor-1'`;
    const [r] = await db()`select count(*)::int as n from alert_rules where user_id = 'visitor-1'`;
    expect(h.n).toBe(18);
    expect(r.n).toBe(8);
  });
});
