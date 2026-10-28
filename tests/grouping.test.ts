import { describe, expect, it } from "vitest";
import { actionKey, groupFilings, type FilingIn } from "@/lib/pipeline/events";
import { datesIn, noticeDates } from "@/lib/pipeline/calendar";
import { subjectLine } from "@/lib/pipeline/classify";
import { scoreEvent, sizePoints, tierOf } from "@/lib/pipeline/score";

const at = (iso: string) => new Date(`${iso}+05:30`);
const f = (p: Partial<FilingIn> & { id: string; filed: string }): FilingIn => ({
  symbol: "NAUKRI", subject: "", headline: null, category: "press_release", subtype: "general", also: [],
  ...p, filed_at: at(p.filed),
});

const TRANSITION = "Intimation for transition of Mr. Hitesh Oberoi from MD & CEO (KMP) to Additional Director (Non-Executive Non-Independent Director- Promoter Category) and appointment";
const REG30 = "Disclosure under Regulation 30 of the Securities and Exchange Board of India (Listing Obligations and Disclosure Requirements) Regulations, 2015";

describe("grouping repeat filings of one action", () => {
  it("merges one management change filed under four subcategories (Info Edge, 28 Oct 2026)", () => {
    const filings = ["13:51", "13:53", "13:57", "13:59"].map((t, i) => f({
      id: `m${i}`, filed: `2026-10-28T${t}:00`, subject: "Announcement under Regulation 30 (LODR)-Change in Management",
      headline: TRANSITION, category: "management_change", subtype: "pending_people",
    }));
    const { events, assignments } = groupFilings(filings, []);
    expect(events.size).toBe(1);
    const [ev] = [...events.values()];
    expect(ev.filings).toBe(4);
    expect(ev.primary_id).toBe("m0");
    expect(assignments.filter((a) => a.is_primary)).toHaveLength(1);
  });

  it("joins a repeat to an event stored by an earlier run", () => {
    const { events, assignments } = groupFilings(
      [f({ id: "m9", filed: "2026-10-28T14:10:00", headline: TRANSITION, category: "management_change", subtype: "pending_people" })],
      [{ event_key: "NAUKRI:m0", symbol: "NAUKRI", first_filed_at: at("2026-10-28T13:51:00"), category: "management_change", subtype: "pending_people", subject: "x", headline: TRANSITION }],
    );
    expect(assignments).toEqual([{ id: "m9", event_key: "NAUKRI:m0", is_primary: false }]);
    expect(events.get("NAUKRI:m0")?.filings).toBe(1);
  });

  it("keeps two different disclosures with the same boilerplate headline apart", () => {
    const { events } = groupFilings([
      f({ id: "d1", filed: "2026-10-23T11:59:00", subject: REG30, headline: REG30, category: "M&A", subtype: "acquisition" }),
      f({ id: "d2", filed: "2026-10-23T15:08:00", subject: REG30, headline: REG30, category: "M&A", subtype: "acquisition" }),
    ], []);
    expect(events.size).toBe(2);
    expect(actionKey(REG30, REG30)).toBeNull();
  });

  it("merges a dividend and its record date (Hindustan Unilever, 28 Oct 2026)", () => {
    const { events } = groupFilings([
      f({ id: "v1", symbol: "HINDUNILVR", filed: "2026-10-28T09:46:27", subject: "Corporate Action-Board approves Dividend", headline: "Board approves Interim Dividend of Rs. 19/- per equity share for FY 2026-27", category: "dividend", subtype: "dividend" }),
      f({ id: "v2", symbol: "HINDUNILVR", filed: "2026-10-28T09:58:56", subject: "Corporate Action - Record Date", headline: "Record Date for Interim Dividend for FY 2026-27 is 12th November, 2026", category: "dividend", subtype: "dividend" }),
    ], []);
    expect(events.size).toBe(1);
    expect([...events.values()][0].filings).toBe(2);
  });

  it("threads two weeks of updates on one IPO into one item (Reliance and Jio Platforms, Oct 2026)", () => {
    const ipo = (id: string, filed: string, headline: string) => f({ id, symbol: "RELIANCE", filed, headline, category: "M&A", subtype: "listing" });
    const { events } = groupFilings([
      ipo("j1", "2026-10-14T18:35:09", "Proposed Initial Public Offer of Jio Platforms Limited - filing of the Red Herring Prospectus"),
      ipo("j2", "2026-10-14T20:12:37", "Proposed Initial Public Offer of Jio Platforms Limited"),
      ipo("j3", "2026-10-24T21:47:58", "JPL has today finalised the Issue Price at Rs. 1,119 per Equity Share"),
      ipo("j4", "2026-10-27T22:11:23", "Trading in equity shares of Jio Platforms Limited (JPL) will commence from October 28, 2026."),
    ], []);
    expect(events.size).toBe(1);
    expect([...events.values()][0].filings).toBe(4);
  });

  it("matches headlines that differ by a word or a cut-off", () => {
    expect(actionKey("x", "Receipt of certified true copy of the Order of Hon'ble National Company Law Tribunal, Mumbai Bench in the matter of the Scheme of Amalgamation of Rujuvalika In"))
      .toBe(actionKey("y", "Receipt of certified true copy of the Order of the Hon'ble National Company Law Tribunal, Mumbai Bench in the matter of the Scheme of Amalgamation of Rujuvalik"));
  });
});

describe("board meeting dates", () => {
  it("reads the dates exchanges and companies write", () => {
    expect(datesIn("scheduled on 28/10/2026 ,inter alia")).toEqual(["2026-10-28"]);
    expect(datesIn("held on 28th October, 2026")).toEqual(["2026-10-28"]);
    expect(datesIn("held today i.e. on Wednesday, October 28, 2026, have")).toEqual(["2026-10-28"]);
    expect(datesIn("held on October 27,2026")).toEqual(["2026-10-27"]);
    expect(datesIn("held on 12 October 2026")).toEqual(["2026-10-12"]);
  });

  it("moves a rescheduled meeting (Tata Steel, 24 Oct 2026)", () => {
    expect(noticeDates("The Board Meeting to be held on 27/10/2026 has been revised to 07/11/2026"))
      .toEqual({ date: "2026-11-07", replaces: "2026-10-27" });
  });
});

describe("cover letter subject line", () => {
  it("finds the Sub: line and stops at the salutation", () => {
    const text = `Date: October 23, 2026\nTo,\nBSE Limited\nScrip Code: 532777\nDear Sir/Madam,\nSub: Disclosure under Regulation 30 of the SEBI (LODR) Regulations, 2015 - Investment in Example Labs Private Limited\nThis is to inform you that the Company has invested Rs. 25 crore.`;
    expect(subjectLine(text)?.line).toBe("Disclosure under Regulation 30 of the SEBI (LODR) Regulations, 2015 - Investment in Example Labs Private Limited");
  });

  it("handles 'Subject -' and a salutation after the subject", () => {
    const text = "Subject - Intimation of acquisition of 100% stake in XYZ Limited Dear Sir, we wish to inform";
    expect(subjectLine(text)?.line).toBe("Intimation of acquisition of 100% stake in XYZ Limited");
  });

  it("returns null when there is no subject line", () => {
    expect(subjectLine("Please find enclosed the copy of the newspaper publication.")).toBeNull();
  });
});

describe("deal size decides materiality", () => {
  it("a startup stake worth 0.05% of market value is routine", () => {
    const s = scoreEvent({ category: "M&A", subtype: "acquisition", amountCr: 50, mcapCr: 100_000 });
    expect(tierOf(s.base)).toBe("routine");
    expect(s.reasons).toContain("₹50 cr = <0.1% of mcap");
  });

  it("an acquisition worth 12% of market value is top", () => {
    const s = scoreEvent({ category: "M&A", subtype: "acquisition", amountCr: 1_200, mcapCr: 10_000 });
    expect(s.base).toBe(95);
    expect(tierOf(s.base)).toBe("top");
  });

  it("orders are sized against revenue, never market value", () => {
    const s = scoreEvent({ category: "press_release", subtype: "order_win", amountCr: 2_000, mcapCr: 500_000, revenueCr: 260_000 });
    expect(s.base).toBe(50);
    expect(s.reasons).toContain("₹2,000 cr = 0.8% of revenue");
    expect(scoreEvent({ category: "press_release", subtype: "order_win", amountCr: 30_000, revenueCr: 260_000 }).base).toBe(75);
  });

  it("an amount never lowers a governance or results event", () => {
    expect(scoreEvent({ category: "management_change", subtype: "top", amountCr: 1, mcapCr: 100_000 }).base).toBe(85);
  });

  it("a deal whose filing states no size loses 10 points", () => {
    const s = scoreEvent({ category: "M&A", subtype: "acquisition", amountChecked: true });
    expect(s.base).toBe(70);
    expect(s.reasons).toContain("Size not stated");
  });

  it("has monotone size points", () => {
    const pts = [0.1, 0.6, 3, 6, 12].map((p) => sizePoints(p, "mcap"));
    expect([...pts].sort((a, b) => a - b)).toEqual(pts);
  });
});
