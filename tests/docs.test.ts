import { describe, expect, it } from "vitest";
import { pickDocuments } from "@/lib/research/docs";
import type { ScreenerCompany } from "@/lib/sources/screener";

const call = (label: string, date: string, transcript: string | null) => ({ label, date, transcript, ppt: null, rec: null });

describe("choosing the calls to read", () => {
  it("keeps one call per quarter: the earliest, and BSE's copy over a company site's", () => {
    const sc = {
      symbol: "X", name: "X Ltd", basis: "consolidated", bseCode: null, url: "", top: {}, tables: {},
      annualReports: [{ year: 2026, url: "https://www.bseindia.com/ar.pdf" }],
      concalls: [
        call("Oct 2026", "2026-10-01", "https://www.bseindia.com/q2fy27.pdf"),
        call("Jul 2026", "2026-07-01", "https://www.bseindia.com/q1fy27.pdf"),
        call("Apr 2026", "2026-04-01", "https://www.bseindia.com/q4fy26.pdf"),
        call("Feb 2026", "2026-02-01", "https://www.bseindia.com/investor-day.pdf"), // same quarter, later
        call("Jan 2026", "2026-01-01", "https://ir.example.com/q3fy26.pdf"),
        call("Jan 2026", "2026-01-01", "https://www.bseindia.com/q3fy26.pdf"),        // same call on BSE
        call("Oct 2025", "2025-10-01", "https://www.bseindia.com/q2fy26.pdf"),
        call("Jul 2025", "2025-07-01", "https://www.bseindia.com/q1fy26.pdf"),
      ],
    } as unknown as ScreenerCompany;
    const docs = pickDocuments(sc);
    expect(docs.filter((d) => d.doc_type === "transcript").map((d) => d.period_label)).toEqual(["Q2 FY27", "Q1 FY27", "Q4 FY26", "Q3 FY26", "Q2 FY26"]);
    expect(docs.find((d) => d.period_label === "Q3 FY26")?.url).toBe("https://www.bseindia.com/q3fy26.pdf");
    expect(docs.at(-1)?.doc_type).toBe("annual_report");
  });
});
