import { describe, expect, it } from "vitest";
import { classifyText, baseScore } from "@/lib/pipeline/rules";

// [expected category, expected subtype or null (any), subcategory | subject]
const CASES: [string, string | null, string][] = [
  ["results", "financial_results", "Outcome of Board Meeting | Board Meeting Outcome for Outcome Of Board Meeting Of Larsen & Toubro Limited Held On October 27, 2026 | L&T reported Q2 FY27 revenue of Rs 78,750 crore, PAT Rs 5,202 crore"],
  ["results", "financial_results", "Financial Results | Unaudited Financial Results (Standalone & Consolidated) for the quarter ended September 30, 2026"],
  ["management_change", "pending_people", "Change in Management | Appointment of Mr. X as Chief Financial Officer"],
  ["insider_trading", null, "Disclosures under Reg. 29(1) of SEBI (SAST) Regulations, 2011 | Disclosure of acquisition of shares"],
  ["pledging", "pledge_create", "Disclosures under Reg. 31(1) and 31(2) of SEBI (SAST) Regulations, 2011 | Creation of pledge on shares by promoter"],
  ["credit_rating", "reaffirm", "Credit Rating | CRISIL reaffirms ratings on bank facilities"],
  ["investor_meetings", "meeting", "Analyst / Investor Meet - Intimation | Schedule of analyst meet with institutional investors"],
  ["earnings_call", "transcript", "Earnings Call Transcript | Transcript of the earnings call held on October 27, 2026"],
  ["earnings_call", "presentation", "Investor Presentation | Analyst Presentation - Q2 / H1 FY27"],
  ["results", "results_admin", "Newspaper Publication | Intimation to Stock Exchanges regarding publication of Financial Results in Newspapers"],
  ["results", "results_notice", "Board Meeting Intimation | Board Meeting Intimation for considering and approving financial results for the quarter ended Sep 2026"],
  ["unclassified", "esop", "Allotment of Equity Shares | Allotment of equity shares under ESOP scheme"],
  ["fund_raise", "debt_raise", "Raising of Funds | Board approves issue of NCDs on private placement basis"],
  ["M&A", "acquisition", "Acquisition | Acquisition of 26% stake in XYZ Private Limited"],
  ["press_release", "order_win", "Award_of_Order_Receipt_of_Order | L&T wins significant order for metro project"],
  ["press_release", "clarification", "Clarification sought on price movement | Clarification"],
  ["unclassified", "compliance", "Trading Window-XBRL | Closure of trading window"],
  ["postal_ballot", "postal_ballot", "Shareholder Meeting / Postal Ballot-Notice of Postal Ballot | Notice of postal ballot"],
  ["dividend", "dividend", "Corp. Action-Record Date | Record date for interim dividend"],
  ["results", "results_admin", "Integrated Filing (Financial) | Integrated Filing (Financial) for quarter ended September 2026"],
  ["management_change", "pending_people", "Resignation of Independent Director | Resignation of Ms. Y as independent director"],
  ["litigation", "dispute", "Updates | Intimation under Regulation 30 - Litigation update"],
  ["unclassified", "compliance", "Statement of deviation / variation in utilisation of funds raised through QIP"],
  ["unclassified", "compliance", "Shareholding Pattern | Shareholding pattern for the quarter ended Sep 2026"],
  ["management_change", "pending_people", "Change in Directorate | Appointment of Mr. P B Rangarao as Director (Operations)"],
  ["earnings_call", "call_notice", "Analysts/Institutional Investor Meet/Con. Call Updates | Earnings conference call to discuss Q2 FY27 results"],
  ["management_change", "auditor_exit", "Statutory Auditors | Resignation of statutory auditor M/s ABC & Co."],
  ["unclassified", "compliance", "Compliances-Reg. 39 (3) - Details of Loss of Certificate / Duplicate Certificate"],
];

describe("classification rules", () => {
  for (const [cat, sub, text] of CASES) {
    it(`${cat}/${sub ?? "*"} <- ${text.slice(0, 60)}`, () => {
      const [subcat, ...rest] = text.split(" | ");
      const r = classifyText(subcat, rest.join(" | "), null);
      expect(r.category).toBe(cat);
      if (sub) expect(r.subtype).toBe(sub);
    });
  }

  it("keeps extra categories found in a results outcome", () => {
    const r = classifyText("Outcome of Board Meeting", "Financial results for the quarter ended Sep 2026 and issue of NCDs; appointment of Mr. Z as CFO", null);
    expect(r.category).toBe("results");
    expect(r.also).toEqual(expect.arrayContaining(["fund_raise", "management_change"]));
  });

  it("sends an ambiguous board outcome to the model", () => {
    const r = classifyText("Outcome of Board Meeting", "Outcome of the board meeting held today", null);
    expect(r.category).toBe("needs_llm");
  });

  it("does not treat LODR Reg 29 board intimation as insider trading", () => {
    const r = classifyText("Board Meeting Intimation", "Intimation under Regulation 29 of SEBI (LODR) - board meeting to consider financial results", null);
    expect(r.category).toBe("results");
    expect(r.subtype).toBe("results_notice");
  });

  it("has base scores for key subtypes", () => {
    expect(baseScore("results", "financial_results")).toBe(90);
    expect(baseScore("management_change", "auditor_exit")).toBe(95);
    expect(baseScore("credit_rating", "reaffirm")).toBe(15);
    expect(baseScore("unclassified", "compliance")).toBe(5);
  });
});
