// Code's checks on what the extraction model read from earnings calls, on real quotes from
// L&T, Infosys, Bajaj Finance, Eternal and Polycab calls (FY26-FY27). The model in production
// copied the prompt's "FY27" into FY26 promises, left "Rs 1,356 billion" as 1,356 crore and
// filed working capital under net debt; these are the cases that broke the ledger.
import { describe, expect, it } from "vitest";
import {
  callRef, periodMentions, resolveHorizon, resolveKpiPeriod, fixMetric, fixAmounts, grounded, analystVoice,
  isSequential, scopeOf, normalizeGuidance, normalizeKpis,
} from "@/lib/research/normalize";
import { buildLedger, type GuidanceIn, type KpiIn } from "@/lib/research/ledger";
import type { FactsBundle } from "@/lib/research/facts";

const call = (p: string) => callRef(p);
const h = (quote: string, said: string, model = "FY27", label = "", before = "") => resolveHorizon({ quote, label_raw: label, horizon: model }, call(said), before)?.horizon ?? null;

describe("the call a statement was made on", () => {
  it("knows the year in progress: after a Q4 call it is the next fiscal year", () => {
    expect(call("Q2 FY26")).toEqual({ fy: 2026, q: 2, inProgress: 2026 });
    expect(call("Q4 FY26")).toEqual({ fy: 2026, q: 4, inProgress: 2027 });
    expect(callRef("", "2026-01-28")).toMatchObject({ fy: 2026, q: 3 });
    expect(callRef("", "2026-05-05")).toMatchObject({ fy: 2026, q: 4, inProgress: 2027 });
  });
});

describe("periods named in a quote", () => {
  it("reads the ways Indian managements write a year", () => {
    const labels = (t: string) => periodMentions(t).map((m) => m.p);
    expect(labels("the 10% order inflow guidance for FY '26")).toEqual([{ kind: "fy", fy: 2026 }]);
    expect(labels("guidance for March ‘26 remains at 12%")).toEqual([{ kind: "fy", fy: 2026 }]);
    expect(labels("for the financial year 2027 is 1.5% to 3.5%")).toEqual([{ kind: "fy", fy: 2027 }]);
    expect(labels("for financial year '27 is 20% to 22%")).toEqual([{ kind: "fy", fy: 2027 }]);
    expect(labels("in Q3 FY '26 of Rs 1,356 billion")).toEqual([{ kind: "quarter", fy: 2026, q: 3 }]);
    expect(labels("as of December '25")).toEqual([{ kind: "quarter", fy: 2026, q: 3 }]);
    expect(labels("H2 FY27 execution")).toEqual([{ kind: "half", fy: 2027, h: 2 }]);
    expect(labels("for 2025-26")).toEqual([{ kind: "fy", fy: 2026 }]);
    expect(periodMentions("15% CAGR over FY26-FY28")[0].span).toEqual({ kind: "fy", fy: 2028 });
  });
});

describe("the period a promise is for", () => {
  it("takes 'full year' from the call, not the model's copied example", () => {
    expect(h("Accordingly, we maintain our full year revenue growth guidance at 15%.", "Q2 FY26")).toBe("FY26");
    expect(h("The new revenue growth guidance for this financial year is 3% to 3.5% growth in constant currency.", "Q3 FY26")).toBe("FY26");
    expect(h("Based on our Q2 performance and revised outlook for rest of the year, our revenue growth guidance is 1% to 2% YoY.", "Q2 FY27")).toBe("FY27");
  });
  it("prefers a year the quote names", () => {
    expect(h("We expect our group order inflows and group revenues to grow at 10% and 15% respectively for FY26.", "Q1 FY26")).toBe("FY26");
    expect(h("we expect to close the year with a revised target of around 10%.", "Q3 FY26", "FY27", "Net Working Capital to Revenue of 12% by March '26")).toBe("FY26");
    expect(h("On this reclassified basis, the FY26 margins for Projects, Products and Manufacturing was 7.8%, and we expect the same to be stable as well in FY27 as well.", "Q4 FY26")).toBe("FY27");
    expect(h("in line with our Project Spring trajectory of achieving 8% to 10% EBITDA margins by financial year 2030.", "Q4 FY26", "medium_term")).toBe("FY30");
  });
  it("reads 'next year' after a Q4 call as the year just begun", () => {
    expect(h("you're guiding for 145 to 160 bps next year, full year.", "Q4 FY26")).toBe("FY27");
    expect(h("we expect margins to improve further next year.", "Q2 FY26")).toBe("FY27");
  });
  it("reads a bare month as the next one", () => {
    expect(h("On store addition, we're on track on our guidance for March of 3,000 stores.", "Q4 FY26", "medium_term")).toBe("FY27");
  });
  it("marks spans and multi-year targets", () => {
    expect(h("in-line with our Project Spring guidance of investing ₹ 12 billion to ₹ 16 billion annually through FY30.", "Q3 FY26", "medium_term")).toBe("Through FY30");
    expect(h("over the next five years, we are targeting order inflow growth at a CAGR return of 10% to 12%", "Q4 FY26", "medium_term")).toBe("Medium term");
  });
  it("carries a heading on the page to the lines under it", () => {
    const before = "Before we conclude, let me cover the guidance on the various parameters for FY '26: On order inflows - Our nine months order inflow has seen a strong growth of 30% Y-on-Y based on a strong capex momentum.";
    expect(h("we remain confident on order inflows.", "Q3 FY26", "FY27", "", before)).toBe("FY26");
  });
  it("defaults to the year in progress, and drops periods already reported", () => {
    expect(h("And we now think the growth will be in the region of 22-23%", "Q2 FY26")).toBe("FY26");
    expect(h("we delivered margins of 21%", "Q1 FY27", "FY26")).toBeNull();
  });
});

describe("the period a reported number is for", () => {
  const k = (quote: string, said: string, period = "Q2 FY27") => resolveKpiPeriod({ quote, period }, call(said));
  it("never after the call's own quarter", () => {
    expect(k("Our revenues for the quarter grew 2.2% sequentially and 2.9% year-on-year in constant currency terms.", "Q2 FY26")).toBe("Q2 FY26");
  });
  it("skips the comparison base", () => {
    expect(k("Order inflows in Q4 FY26 stood at Rs 898 billion, broadly in line with Q4 FY25 levels", "Q4 FY26")).toBe("Q4 FY26");
    expect(k("loan loss to average AUF came in at 2.05% compared to 2.02% in Q1 from a sequential standpoint.", "Q2 FY26", "Q1 FY26")).toBe("Q2 FY26");
  });
  it("reads full-year and year-end numbers in a Q4 call", () => {
    expect(k("We had growth of 3.1% for the full year in constant currency terms.", "Q4 FY26", "FY26")).toBe("FY26");
    expect(k("As of March 2026, the Net Working Capital to Revenue ratio improved sharply to 4.1%", "Q4 FY26", "FY26")).toBe("FY26");
  });
  it("tells sequential growth from year-on-year", () => {
    const q = "Our revenues for the quarter grew 2.2% sequentially and 2.9% year-on-year in constant currency terms.";
    expect(isSequential(2.2, q)).toBe(true);
    expect(isSequential(2.9, q)).toBe(false);
  });
});

describe("metric keys", () => {
  it("files working capital, ROA and opex ratios under their own names", () => {
    expect(fixMetric("net_debt", "guidance for working capital for FY '26 remains unchanged at around 12% by March 2026", "On Working Capital, our guidance for working capital for FY '26 remains unchanged at around 12% by March 2026.", false)).toBe("working_capital");
    expect(fixMetric("other:<working capital to sales>", "working capital guidance of around 10%", "we are maintaining our FY '27 working capital guidance of around 10%", false)).toBe("working_capital");
    expect(fixMetric("ebitda_margin", "ROA came in as of fourth quarter at 4.6%. We continue to guide for 4.4% to 4.6%", "ROA came in as of fourth quarter at 4.6%. We continue to guide for 4.4% to 4.6%.", true)).toBe("other:roa");
    expect(fixMetric("ebitda_margin", "deliver a 25 to 40 basis point improvement in FY27 on opex-to-NTI", "We remain pretty comfortable place to deliver a 25 to 40 basis point improvement in FY27 on opex-to-NTI.", true)).toBe("other:opex_to_nti");
  });
  it("reads the model's own label first when one quote lists several targets", () => {
    const q = "over the next five years, we are targeting order inflow growth at a CAGR return of 10% to 12%, revenue growth of 12% to 15%, and a Return on Equity in the range of 16% to 17%.";
    expect(fixMetric("revenue_growth", "revenue growth of 12% to 15%", q, false)).toBe("revenue_growth");
    expect(fixMetric("order_inflow_growth", "order inflow growth at a CAGR return of 10% to 12%", q, false)).toBe("order_inflow_growth");
  });
  it("does not keep a key the words do not support", () => {
    expect(fixMetric("net_debt", "losses to come down sequentially", "we now expect the losses to come down sequentially from here towards breakeven in the next four to six quarters.", false)).toBe("other:losses");
    expect(fixMetric("store_count", "cross 120 million franchise in the current year", "We are well on course to cross 120 million franchise in the current year.", true)).toBe("customer_franchise");
    expect(fixMetric("revenue_growth", "top line growth or AUM growth will gravitate between 22% and 23%", "the top line growth or AUM growth will gravitate between 22% and 23%", true)).toBe("aum_growth");
  });
});

describe("amounts", () => {
  it("converts billion, trillion, million and lakh to crore from the quote", () => {
    expect(fixAmounts(1356, null, "cr", "We witnessed our highest ever quarterly order inflows in Q3 FY '26 of Rs 1,356 billion", "order_inflow").low).toBe(135_600);
    expect(fixAmounts(7.4, null, "cr", "our order book stands at Rs 7.40 trillion as of March 2026", "order_book").low).toBe(740_000);
    expect(fixAmounts(7967, null, "cr", "Profit After Tax of INR 7,967 million", "pat").low).toBe(796.7);
    expect(fixAmounts(9, null, "cr", "We are at INR 9 lakh today.", "other:nov").low).toBe(0.09);
    expect(fixAmounts(60, 80, "cr", "planned capex program of INR 60 billion to INR 80 billion over the next 5 years", "capex")).toMatchObject({ low: 6000, high: 8000, unit: "cr" });
  });
  it("leaves numbers the model already converted", () => {
    expect(fixAmounts(1200, 1600, "cr", "Project Spring guidance of investing ₹ 12 billion - ₹ 16 billion annually", "capex")).toMatchObject({ low: 1200, high: 1600 });
  });
  it("keeps dollar amounts out of rupee comparisons", () => {
    expect(fixAmounts(1, 1, "other", "overall EBITDA guidance or indication of $1 billion by FY29.", "ebitda")).toEqual({ low: 1, high: 1, unit: "other", text: "$1 billion" });
  });
  it("counts customers and loans in units, not rupees", () => {
    expect(fixAmounts(60, 62, "count", "We are well on track to deliver between 60 million to 62 million new loans in FY27.", "other:new_loans")).toMatchObject({ low: 60e6, high: 62e6 });
    expect(fixAmounts(15, 17, "other", "adding 15 - 17 million new customers in FY27.", "customer_additions")).toMatchObject({ low: 15e6, high: 17e6, unit: "count" });
  });
  it("drops a target whose number is not in the quote", () => {
    expect(grounded(60, 70, "we expect the absolute losses to sort of remain range bound around the current levels.", "absolute losses to sort of remain range bound")).toBe(false);
    expect(grounded(1.45, 1.6, "you're guiding for 145 to 160 bps next year, full year.", "145 to 160")).toBe(true);
  });
});

describe("whose promise it is, and for which part of the company", () => {
  it("drops analysts restating guidance", () => {
    expect(analystVoice("you have mentioned that you plan to operate around 2,100 stores by the December quarter")).toBe(true);
    expect(analystVoice("You've maintained your $3 billion NOV guidance for going-out in FY30")).toBe(true);
    expect(analystVoice("AUM, as you can see, grew by 26.5% to INR 5,84,624 crores")).toBe(false);
  });
  it("takes the subject from the lines leading into a quote", () => {
    const lead = "Accordingly, we maintain our full year revenue growth guidance at 15%. Coming to the EBITDA margin for the P&M business. As you may have seen, the EBITDA margin for the P&M business has improved by 10 basis points in H1 FY '26. ";
    expect(scopeOf("With the execution momentum expected to pick up in H2, we are reasonably confident to achieve our full year EBITDA margin target of 8.5%.", "full year EBITDA margin target of 8.5%", lead, "ebitda_margin"))
      .toEqual({ scope: "segment", label: "Projects and Manufacturing portfolio" });
    // A new subject ("On Working Capital, ...") does not inherit the margin paragraph's.
    expect(scopeOf("On Working Capital, our guidance for working capital for FY '26 remains unchanged at around 12% by March 2026.", "", lead, "working_capital")).toEqual({ scope: "company" });
    expect(scopeOf("Accordingly, we maintain our full year revenue growth guidance at 15%.", "", "On Revenue, the group revenue grew by 13% in H1 FY '26, in line with our expectations.", "revenue_growth")).toEqual({ scope: "company" });
  });
  it("names 'this business' from the paragraph", () => {
    const lead = "EBIT margins for the Wires & Cables business stood at 13.3%. Sequential margin improvement was driven by a favourable business mix and continued focus on operational excellence. ";
    expect(scopeOf("Consistent with our Project Spring roadmap, we continue to maintain our medium- to long-term margin guidance of 11% to 13% for this business.", "margin guidance of 11% to 13%", lead, "ebit_margin"))
      .toEqual({ scope: "segment", label: "wires and cables business" });
  });
  it("does not read a vertical's mention as the subject of a company-wide target", () => {
    const lead = "Our revenue growth guidance for the financial year 2027 is 1.5% to 3.5% growth year-on-year in constant currency terms. We expect acceleration of growth in Financial Services and in Energy, Utility, Resources and Services vertical. ";
    expect(scopeOf("Our operating margin guidance for financial year '27 is 20% to 22%.", "", lead, "ebit_margin")).toEqual({ scope: "company" });
  });
});

// ---------- The ledger on normalized input ----------

const g = (id: number, said_period: string, said_on: string, metric: string, lo: number | null, hi: number | null, quote: string, over: Partial<GuidanceIn> = {}): GuidanceIn => ({
  id, doc_id: id, said_period, said_on, metric, label_raw: quote.slice(0, 60), target_low: lo, target_high: hi, unit: "pct", basis: "unspecified",
  horizon: "FY27", direction: lo !== null && hi !== null && lo !== hi ? "range" : "point", speaker: null, quote, page: 1, ...over,
});
const facts: FactsBundle = { facts: {}, annual: {}, quarterly: {}, basis: "consolidated", lender: false, flags: [], latestQuarter: null } as unknown as FactsBundle;

describe("the ledger after code's checks", () => {
  it("resolves FY26 working capital against the year-end figure, lower being better", () => {
    const raw = [
      g(1, "Q1 FY26", "2025-07-29", "net_debt", 12, 12, "Our Net Working Capital-to-Revenue guidance for March ‘26 remains at 12%."),
      g(2, "Q2 FY26", "2025-10-29", "net_debt", 12, 12, "On Working Capital, our guidance for working capital for FY '26 remains unchanged at around 12% by March 2026."),
      g(3, "Q3 FY26", "2026-01-28", "net_debt", 10, 10, "we expect to close the year with a revised target of around 10%.", { label_raw: "Net Working Capital to Revenue of 12% by March '26" }),
    ];
    const kpis: KpiIn[] = [{ doc_id: 4, said_on: "2026-05-05", metric: "other:nwc_to_revenue", value: 4.1, unit: "pct", basis: "unspecified", period: "FY26", quote: "As of March 2026, the Net Working Capital to Revenue ratio improved sharply to 4.1%", page: 6 }];
    const ng = normalizeGuidance(raw, { lender: false });
    const nk = normalizeKpis(kpis, { lender: false, periods: new Map([[4, "Q4 FY26"]]) });
    const { items } = buildLedger(ng, nk, facts);
    expect(items.map((x) => [x.said_period, x.metric, x.horizon_label, x.status])).toEqual([
      ["Q3 FY26", "working_capital", "FY26", "delivered"],
      ["Q2 FY26", "working_capital", "FY26", "revised"],   // 12% (said twice) became 10%: shown once
    ]);
    expect(items[0].actual?.value).toBe(4.1);
    expect(items[1].revised_to).toMatchObject({ low: 10, said_period: "Q3 FY26" });
  });

  it("chains revisions call to call", () => {
    const raw = [
      g(1, "Q4 FY26", "2026-04-16", "revenue_growth", 1.5, 3.5, "Our revenue growth guidance for the financial year 2027 is 1.5% to 3.5% growth year-on-year in constant currency terms.", { basis: "constant_currency" }),
      g(2, "Q1 FY27", "2026-07-17", "revenue_growth", 1.5, 3, "we are changing our revenue growth guidance to 1.5% to 3% Y-on-Y growth in constant currency terms.", { basis: "constant_currency" }),
      g(3, "Q2 FY27", "2026-10-16", "revenue_growth", 1, 2, "our revenue growth guidance is 1% to 2% YoY.in constant currency terms.", { basis: "constant_currency" }),
    ];
    const { items } = buildLedger(normalizeGuidance(raw, { lender: false }), [], facts);
    expect(items.map((x) => [x.said_period, x.status, x.revised_to?.said_period ?? null])).toEqual([
      ["Q2 FY27", "pending", null], ["Q1 FY27", "revised", "Q2 FY27"], ["Q4 FY26", "revised", "Q1 FY27"],
    ]);
  });

  it("checks a segment's margin against what management reports for it, never the company's", () => {
    const raw = [g(1, "Q1 FY27", "2026-07-25", "ebitda_margin", 7.8, 7.8, "we continue to target the margin of around 7.8% for FY '27 with respect to the PPM portfolio.")];
    const { items } = buildLedger(normalizeGuidance(raw, { lender: false }), [], facts);
    expect(items[0].scope).toEqual({ scope: "segment", label: "Projects, Products and Manufacturing portfolio" });
    expect(items[0].status).toBe("pending");
    expect(items[0].note).toMatch(/checked against what management reports/);
  });

  it("drops analysts' restatements and unsupported numbers", () => {
    const raw = [
      g(1, "Q2 FY26", "2025-10-20", "store_count", 3000, 3000, "you have mentioned that you plan to operate around 2,100 stores by the December quarter and 3,000 by March 2027.", { unit: "count" }),
      g(2, "Q2 FY26", "2025-10-20", "net_debt", 60, 70, "we expect the absolute losses to sort of remain range bound around the current levels.", { unit: "cr", horizon: "medium_term" }),
    ];
    const ng = normalizeGuidance(raw, { lender: false });
    expect(ng).toHaveLength(1);
    expect(ng[0]).toMatchObject({ metric: "other:losses", direction: "qualitative", target_low: null });
  });

  it("keeps two figures from one call as two targets, not a revision (group and a subsidiary)", () => {
    const raw = [
      g(1, "Q4 FY26", "2026-05-05", "revenue_growth", 12, 15, "revenue growth of 12% to 15%", { horizon: "medium_term", label_raw: "revenue CAGR" }),
      g(1, "Q4 FY26", "2026-05-05", "revenue_growth", 13, 15, "The Lakshya L31 targets 13% to 15% revenue CAGR growth for over five years", { id: 2, horizon: "medium_term", label_raw: "LTTS revenue CAGR" }),
    ];
    const { items } = buildLedger(normalizeGuidance(raw, { lender: false }), [], facts);
    expect(items.map((x) => x.status)).toEqual(["pending", "pending"]);
  });

  it("reads a lender's unqualified growth guidance as AUM growth, and basis-point improvements in bps", () => {
    const raw = [
      g(1, "Q2 FY27", "2026-10-20", "revenue_growth", 26, 27, "I would say probably between 26%, 27% growth we should deliver now on a full year basis.", { label_raw: "full year growth" }),
      g(2, "Q2 FY27", "2026-10-20", "ebitda_margin", 0.25, 0.4, "We remain pretty comfortable place to deliver a 25 to 40 basis point improvement in FY27 on opex-to-NTI.", { label_raw: "opex-to-NTI improvement" }),
    ];
    const ng = normalizeGuidance(raw, { lender: true });
    expect(ng.map((x) => [x.metric, x.unit, x.target_low, x.target_high])).toEqual([["aum_growth", "pct", 26, 27], ["other:opex_to_nti", "bps", 25, 40]]);
  });
});
