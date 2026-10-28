import { describe, expect, it } from "vitest";
import { computeMetrics, ebitda, runChecks, toLines } from "@/lib/pipeline/results";
import type { ResultLinesT } from "@/lib/llm/schemas";

// L&T Q2 FY27 consolidated, reconstructed from screener's table (Rs crore).
const base = (p: Partial<ResultLinesT>): ResultLinesT => ({
  period_end: "2026-09-30", revenue_from_operations: null, other_income: null, total_income: null,
  finance_costs: null, depreciation_amortisation: null, total_expenses: null,
  profit_before_exceptional_and_tax: null, exceptional_items: null, share_of_associates_jv: null,
  profit_before_tax: 0, tax_expense: null, profit_after_tax_total: 0, profit_after_tax_owners: null,
  interest_earned: null, interest_expended: null, operating_expenses: null, provisions: null, gross_npa_pct: null,
  ...p,
});

const cur = base({ period_end: "2026-09-30", revenue_from_operations: 78750, other_income: 2306, total_income: 81056,
  finance_costs: 2442, depreciation_amortisation: 1037, total_expenses: 73415, profit_before_exceptional_and_tax: 7641,
  exceptional_items: 0, profit_before_tax: 7641, tax_expense: 1692, profit_after_tax_total: 5949, profit_after_tax_owners: 5202 });
const prev = base({ period_end: "2026-06-30", revenue_from_operations: 67942, other_income: 2377, total_income: 70319,
  finance_costs: 2571, depreciation_amortisation: 1032, total_expenses: 63396, profit_before_exceptional_and_tax: 6923,
  exceptional_items: 0, profit_before_tax: 6923, tax_expense: 1935, profit_after_tax_total: 4988, profit_after_tax_owners: 4300 });
const yoy = base({ period_end: "2025-09-30", revenue_from_operations: 67984, other_income: 1384, total_income: 69368,
  finance_costs: 2470, depreciation_amortisation: 1092, total_expenses: 63032, profit_before_exceptional_and_tax: 6336,
  exceptional_items: 0, profit_before_tax: 6336, tax_expense: 1658, profit_after_tax_total: 4678, profit_after_tax_owners: 3929 });

describe("results maths", () => {
  const c = toLines(cur, "crore"), p = toLines(prev, "crore"), y = toLines(yoy, "crore");

  it("computes EBITDA excluding other income", () => {
    expect(ebitda(c)).toBe(8814);
    expect(ebitda(y)).toBe(8514); // screener rounds to 8,513
  });

  it("matches the worked example in the spec", () => {
    const m = computeMetrics(c, p, y, "corporate");
    expect(m.quarter).toBe("Q2 FY27");
    expect(m.revenue.qoq_pct).toBe(15.9);
    expect(m.revenue.yoy_pct).toBe(15.8);
    expect(m.ebitda.yoy_pct).toBe(3.5);
    expect(m.ebitda_margin.value).toBe(11.2);
    expect(m.ebitda_margin.qoq_bps).toBe(-80);
    expect(m.ebitda_margin.yoy_bps).toBe(-133);
    expect(m.pbt.yoy_pct).toBe(20.6);
    expect(m.pat.value).toBe(5202); // owners' share is the headline
  });

  it("passes every check on consistent lines", () => {
    const checks = runChecks(c, p, y, { expectedPeriodEnd: "2026-09-30", prevRevenueHint: 67942, template: "corporate" });
    expect(checks.filter((x) => !x.ok)).toEqual([]);
  });

  it("catches a lakh/crore unit slip", () => {
    const wrong = toLines(cur, "lakh"); // model said lakh but numbers are crore
    const checks = runChecks(wrong, toLines(prev, "lakh"), toLines(yoy, "lakh"), { prevRevenueHint: 67942, template: "corporate" });
    expect(checks.find((x) => x.name === "units")?.ok).toBe(false);
  });

  it("catches a wrong period column", () => {
    const checks = runChecks(c, p, y, { expectedPeriodEnd: "2026-06-30", template: "corporate" });
    expect(checks.find((x) => x.name === "periods")?.ok).toBe(false);
  });

  it("catches a PBT that does not add up", () => {
    const bad = toLines({ ...cur, profit_before_exceptional_and_tax: 9641 }, "crore");
    const checks = runChecks(bad, p, y, { template: "corporate" });
    expect(checks.find((x) => x.name === "pbt_identity")?.ok).toBe(false);
  });

  it("converts lakh to crore", () => {
    const l = toLines(base({ revenue_from_operations: 12826000, profit_before_tax: 1159700, profit_after_tax_total: 872100 }), "lakh");
    expect(l.revenue).toBe(128260);
    expect(l.pat_total).toBe(8721);
  });

  it("does not report a % change from loss to profit", () => {
    const a = toLines(base({ period_end: "2026-09-30", profit_before_tax: 50, profit_after_tax_total: 40 }), "crore");
    const b = toLines(base({ period_end: "2025-09-30", profit_before_tax: -20, profit_after_tax_total: -25 }), "crore");
    const m = computeMetrics(a, b, b, "corporate");
    expect(m.pat.yoy_pct).toBeNull();
  });
});
