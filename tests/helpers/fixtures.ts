// Synthetic filings and documents for integration tests. Numbers mirror
// L&T's Q2 FY27 consolidated results (screener, 28 Oct 2026); people and
// orders are invented for tests only and never reach a deployed database.
import type { BseAnnouncementRow } from "@/lib/sources/bse";

/** "2026-10-27T15:47:12.33" style IST wall-clock string for an instant. */
export function istNaive(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 22);
}

export function bseRow(p: { id: string; code: string; company: string; subject: string; subcat: string; headline?: string; at: Date; pdf?: string; category?: string }): BseAnnouncementRow {
  return {
    NEWSID: p.id, SCRIP_CD: Number(p.code), NEWSSUB: `${p.company} - ${p.code} - ${p.subject}`, HEADLINE: p.headline ?? "",
    CATEGORYNAME: p.category ?? null, SUBCATNAME: p.subcat, NEWS_DT: istNaive(p.at), DT_TM: istNaive(p.at), DissemDT: istNaive(p.at),
    ATTACHMENTNAME: p.pdf ?? null, Fld_Attachsize: p.pdf ? 200_000 + [...p.pdf].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 100_000, 7) : null, SLONGNAME: p.company, CRITICALNEWS: 0,
  };
}

export const LT_RESULTS_PAGES = [
  `LARSEN & TOUBRO LIMITED\nOctober 27, 2026\nTo the Stock Exchanges\nSub: Outcome of the Board Meeting held on October 27, 2026\nThe Board approved the unaudited financial results for the quarter ended September 30, 2026.`,
  `Independent Auditor's Limited Review Report\nWe have reviewed the accompanying statement of unaudited standalone financial results.`,
  [
    "STATEMENT OF UNAUDITED CONSOLIDATED FINANCIAL RESULTS FOR THE QUARTER ENDED SEPTEMBER 30, 2026",
    "Rs crore   Quarter ended   30.09.2026   30.06.2026   30.09.2025",
    "1 Revenue from operations   78,750.12   67,942.30   67,984.45",
    "2 Other income   2,306.00   2,377.00   1,384.00",
    "3 Total income   81,056.12   70,319.30   69,368.45",
    "Finance costs   2,442.00   2,571.00   2,470.00",
    "Depreciation and amortisation   1,037.00   1,032.00   1,092.00",
    "4 Total expenses   73,415.12   63,396.30   63,032.45",
    "5 Profit before exceptional items and tax   7,641.00   6,923.00   6,336.00",
    "6 Profit before tax   7,641.00   6,923.00   6,336.00",
    "7 Tax expense   1,692.00   1,935.00   1,658.00",
    "8 Profit for the period   5,949.00   4,988.00   4,678.00",
    "Attributable to owners of the Company   5,202.00   4,300.00   3,929.00",
    "Earnings per share (Rs)   37.81   29.97   28.54",
  ].join("\n"),
];

export const CFO_PAGES = [
  `SYNTHETIC TEST FILING\nSub: Appointment of Chief Financial Officer under Regulation 30 of SEBI LODR\nThe Board has appointed Mr. Rajesh Kumar as Chief Financial Officer and Key Managerial Personnel with effect from November 1, 2026.`,
  `Annexure A\nReason for change: Appointment\nDate of appointment: November 1, 2026\nBrief profile: Mr. Rajesh Kumar is a chartered accountant with 24 years of experience in finance. He was previously Chief Financial Officer of Example Engineering Limited.\nDisclosure of relationships between directors: Not related to any director.`,
];

export const ORDER_PAGES = [
  `SYNTHETIC TEST FILING\nPress release\nThe Power Transmission business has won an order valued at Rs 2,500 crore to build a 765 kV substation network.`,
];

export const RATING_PAGES = [
  `Credit rating\nCRISIL Ratings has reaffirmed the rating of CRISIL AAA/Stable on the long-term bank facilities of the Company.`,
];

/** Five calls of L&T-like guidance, matched to screener's real FY25/FY26 figures in the fixture. */
export const TRANSCRIPTS: Record<string, string[]> = {
  "Jul 2026": [
    "SYNTHETIC TEST TRANSCRIPT. Q1 FY27 Earnings Conference Call, July 28, 2026",
    "Management: For FY27, we are guiding for revenue growth of 15% and order inflow growth of 10%. We expect core margins of around 8.3% for FY27.",
    "Analyst: Can you comment on the Middle East pipeline? Management: The international prospects pipeline remains healthy at Rs 7 lakh crore.",
  ],
  "May 2026": [
    "SYNTHETIC TEST TRANSCRIPT. Q4 FY26 Earnings Conference Call, May 12, 2026",
    "Management: For FY27 we expect revenue growth of 12% to 14%. For FY26 our revenue grew by 11.8%.",
    "Demand from the domestic private sector is recovering, and we see margins improving from here.",
  ],
  "Jan 2026": [
    "SYNTHETIC TEST TRANSCRIPT. Q3 FY26 Earnings Conference Call, January 28, 2026",
    "Management: We are confident of revenue growth of 15% for FY26 and EBITDA margin of 13% for the full year.",
  ],
  "Oct 2025": [
    "SYNTHETIC TEST TRANSCRIPT. Q2 FY26 Earnings Conference Call, October 28, 2025",
    "Management: We maintain revenue growth of 15% for FY26.",
  ],
  "Jul 2025": [
    "SYNTHETIC TEST TRANSCRIPT. Q1 FY26 Earnings Conference Call, July 29, 2025",
    "Management: For FY26 we guide to revenue growth of 15%.",
  ],
};

export const ANNUAL_REPORT_PAGES: string[] = [
  "SYNTHETIC TEST ANNUAL REPORT 2025-26",
  ...Array.from({ length: 8 }, (_, i) => `Corporate overview page ${i + 2}. `.repeat(30)),
  `Management Discussion and Analysis. Business overview. Segment information: Infrastructure Projects revenue Rs 1,40,000 crore, 49% of revenue; Energy Projects Rs 40,000 crore, 14%; Hi-Tech Manufacturing Rs 20,000 crore, 7%. ${"Segment performance commentary. ".repeat(20)}`,
  `Risk management. Key risks and concerns: execution delays in large projects; commodity price volatility; geopolitical risk in the Middle East. ${"Risk discussion. ".repeat(25)}`,
  `Notes to consolidated financial statements. Contingent liabilities not provided for: Rs 9,500 crore, mainly disputed tax demands. ${"Note detail. ".repeat(30)}`,
  `Independent Auditor's Report on the consolidated financial statements. Opinion: In our opinion the statements give a true and fair view. Key audit matters: revenue recognition on long-term contracts. ${"Audit detail. ".repeat(25)}`,
];
