import { describe, expect, it } from "vitest";
import { addStandaloneNpa, type ScreenerCompany } from "@/lib/sources/screener";
import { computeFacts } from "@/lib/research/facts";

// HDFC Bank's screener pages, Sep 2026 (₹ crore): the consolidated quarterly
// table leaves NPA ratios blank; the standalone table has them.
const periods = ["Sep 2025", "Dec 2025", "Mar 2026", "Jun 2026", "Sep 2026"].map((label, i) => ({ label, date: ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"][i] }));
const r = (key: string, values: (number | null)[], unit = "cr") => ({ label: key, key, values, unit });
const company = (basis: "consolidated" | "standalone", rows: ReturnType<typeof r>[]): ScreenerCompany => ({
  symbol: "HDFCBANK", name: "HDFC Bank Ltd", basis, bseCode: "500180", url: `x/${basis}`,
  top: { market_cap_cr: 1057574, roe_pct: 13.6 }, annualReports: [], concalls: [],
  tables: {
    quarters: { periods, rows },
    balance_sheet: { periods: [{ label: "Sep 2026", date: "2026-09-30" }], rows: [r("equity_capital", [1530]), r("reserves", [601939]), r("deposits", [3324146]), r("borrowings", [594144])] },
  },
});

describe("lender facts", () => {
  const cons = company("consolidated", [
    r("revenue", [86994, 87067, 87182, 90575, 95132]), r("interest", [46741, 45821, 45220, 47626, 50667]),
    r("financing_profit", [-4908, -12899, -2066, -15342, -5565]), r("pat", [20364, 20691, 21074, 20383, 21537]),
    r("gross_npa_pct", [null, null, null, null, null], "pct"), r("net_npa_pct", [null, null, null, null, null], "pct"),
  ]);
  const stand = company("standalone", [r("gross_npa_pct", [1.24, 1.24, 1.15, 1.17, 1.11], "pct"), r("net_npa_pct", [0.42, 0.42, 0.38, 0.41, 0.37], "pct")]);
  addStandaloneNpa(cons, stand);
  const f = computeFacts(cons);

  it("takes bad-loan ratios from the bank-level table and says so", () => {
    expect(f.facts.q_gnpa.value).toBe(1.11);
    expect(f.facts.q_gnpa.source).toMatch(/^Screener standalone/);
    expect(f.facts.q_gnpa_yoy_bps.value).toBe(-13);
    expect(f.facts.q_nnpa.value).toBe(0.37);
  });

  it("reports net interest income, not EBITDA margin, and no cash conversion or debt to equity", () => {
    expect(f.lender).toBe(true);
    expect(f.facts.q_nii.value).toBe(44465);
    expect(f.facts.q_opm).toBeUndefined();
    expect(f.facts.cfo_pat_5y).toBeUndefined();
    expect(f.facts.de_ratio).toBeUndefined();
    expect(f.facts.deposits.value).toBe(3324146);
  });
});
