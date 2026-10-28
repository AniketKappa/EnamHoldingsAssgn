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

// Real BSE subcategory | subject | headline triples from October 2026 that the
// first rule set got wrong (captured by the fixtures workflow).
const REAL: [string, string | null, string][] = [
  ["unclassified", "compliance", "Closure of Trading Window | Closure of Trading Window | Closure of Trading Window with effect from 1st October, 2026 until 48 hours after the declaration of financial results"],
  ["results", "results_notice", "Analyst / Investor Meet | Announcement under Regulation 30 (LODR)-Analyst / Investor Meet - Intimation | The meeting of the Board of Directors of the Company is scheduled on October 30, 2026, inter alia, to consider the financial results"],
  ["results", "results_notice", "Board Meeting | Board Meeting Intimation for Considering The Unaudited Financial Results For The Quarter And Half Year Ended 3 | Larsen & Toubro Ltdhas informed BSE that the meeting of the Board of Directors of the Company is scheduled on 27/10/2026"],
  ["unclassified", "board_notice", "Board Meeting Rescheduled | Update on board meeting | The Board Meeting to be held on 27/10/2026 has been revised to 07/11/2026"],
  ["M&A", "listing", "General | Initial Public Offer Of Jio Platforms Limited - Update | Initial Public Offer of Jio Platforms Limited - Update"],
  ["unclassified", "compliance", "General | Announcement Under Regulation 30 Of SEBI LODR- ESG Rating By Crisil ESG Ratings & Analytics Ltd | ESG Rating by Crisil ESG Ratings & Analytics Ltd."],
  ["M&A", "restructuring_update", "General | Receipt Of Certified True Copy Of The Order Of The Hon'Ble National Company Law Tribunal, Mumbai Bench | Receipt of certified true copy of the Order of Hon'ble National Company Law Tribunal in the matter of the Scheme of Amalgamation"],
  ["M&A", "restructuring_update", "Scheme of Arrangement | Announcement under Regulation 30 (LODR)-Scheme of Arrangement | Pronouncement of Order by the Hon'ble NCLT approving and sanctioning the Scheme of Amalgamation amongst Tata Steel Limited and its subsidiaries"],
  ["press_release", "business_update", "Press Release / Media Release | Announcement under Regulation 30 (LODR)-Press Release / Media Release | Press Release titled 'Tata Steel: 2QFY2027 Production and Delivery Volumes (Provisional)'"],
  ["management_change", "pending_people", "Press Release / Media Release | Announcement under Regulation 30 (LODR)-Press Release / Media Release | Intimation for transition of Mr. Hitesh Oberoi from MD & CEO (KMP) to Additional Director"],
  ["unclassified", "esop", "General | Grant Of Restricted Stock Units | Grant of RSUs to eligible employees under the Employee Stock Option Plan"],
  ["unclassified", "compliance", "General | Reminder Letter For Transfer Of Equity Shares To The Investor Education And Protection Fund ('IEPF') | Reminder letter for transfer of equity shares to IEPF"],
  ["unclassified", "compliance", "Half Yearly Report (SEBI Circular No. CIR/IMD/DF-1/67/2017) | Compliances-Half Yearly Report | Disclosure pursuant to Paragraph 9.1(a) of the Chapter VIII of SEBI Master Circular"],
  ["dividend", "dividend", "Record Date | Corporate Action - Record Date | Record Date for Interim Dividend for FY 2026-27 is 12th November, 2026"],
  ["earnings_call", "recording", "Analyst / Investor Meet | Announcement under Regulation 30 (LODR)-Analyst / Investor Meet - Outcome | Audio Video recording of the Earnings Conference Call held on 28th October, 2026"],
  ["results", "financial_results", "Financial Results | Results- Quarterly- September 30, 2026 | The Board of Directors of the Company at their meeting held today have approved the unaudited results"],
  ["insider_trading", "pit_violation", "General | Disclosure Of Violation Under SEBI (PIT) Regulations, 2015 | Disclosure of violation under SEBI (PIT) Regulations"],
  ["needs_llm", null, "General | Disclosure Under Regulation 30 Of SEBI (Listing Obligations And Disclosure Requirements), Regulations, 2015 | Disclosure under Regulation 30 of SEBI (Listing Obligations and Disclosure Requirements), Regulations, 2015"],
  ["M&A", "subsidiary", "Acquisition | Announcement under Regulation 30 (LODR)-Acquisition | KPIT Technologies Limited has informed the Exchange that the Board of Directors of the Company approved the proposal to incorporate a wholly owned subsidiary in Vietnam ."],
  ["M&A", "subsidiary", "Scheme of Arrangement | Announcement under Regulation 30 (LODR)-Scheme of Arrangement | KPIT Technologies Limited has informed the Exchange that the Board of Directors of the Company approved the Strike-off of Somit Solutions Limited, wholly owned step-down subsidiary of the Company."],
  ["M&A", "group_restructuring", "Scheme of Arrangement | Announcement under Regulation 30 (LODR)-Scheme of Arrangement | Board approves scheme of amalgamation of its wholly owned subsidiary with the Company"],
  ["M&A", "restructuring", "Scheme of Arrangement | Announcement under Regulation 30 (LODR)-Scheme of Arrangement | Board approves the composite scheme of arrangement for demerger of the consumer business"],
  ["unclassified", "board_notice", "Record Date | Record Date For Payment Of Interim Dividend, If Any | This is to inform you that the meeting of Board of Directors of the Company will be held on Thursday, 29th October 2026, inter alia, to consider declaration of interim dividend, if any"],
  ["unclassified", "correction", "General | Corrigendum to the outcome of board meeting | Corrigendum to the outcome of board meeting dated October 7, 2026"],
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

  for (const [cat, sub, text] of REAL) {
    it(`real filing: ${cat}/${sub ?? "*"} <- ${text.split(" | ")[2]?.slice(0, 50)}`, () => {
      const [subcat, subject, headline] = text.split(" | ");
      const r = classifyText(subcat, subject, headline ?? null);
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
