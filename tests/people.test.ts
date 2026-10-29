// Person-card rules on real filings from the live run (Info Edge, KPIT, HAL), and
// sizing rules that only apply where money is the story.
import { describe, expect, it } from "vitest";
import { flagsFor, peopleTitle, primaryChange, peopleSubtype } from "@/lib/pipeline/peopleRules";
import { scoreEvent } from "@/lib/pipeline/score";
import type { PeopleExtractT } from "@/lib/llm/schemas";

type Change = PeopleExtractT["changes"][number];
const ch = (o: Partial<Change>): Change => ({
  person_name: "X", designation: "Director", role_class: "other", change_type: "appointment", effective_date: null, reason: null,
  brief_profile: null, relationships: null, resignation_letter_attached: null, quote: "", page: 1, ...o,
} as Change);

describe("planned and unplanned exits", () => {
  const exit = ch({ person_name: "Mr. Hitesh Oberoi", designation: "Managing Director and Chief Executive Officer", role_class: "top", change_type: "resignation",
    reason: "in order to devote more time to his personal interests in education, entrepreneurship, institution building, investing and philanthropy" });
  it("flags a CEO who leaves with no successor named", () => {
    expect(flagsFor(exit, [exit])).toEqual(["Unplanned MD & CEO exit"]);
  });
  it("does not flag a handover: successor named and the CEO stays on the board", () => {
    const stays = ch({ person_name: "Mr. Hitesh Oberoi", designation: "Additional Director (Non-Executive, Non-Independent Director)", role_class: "independent" });
    const successor = ch({ person_name: "Mr. Sanjeev Bikhchandani", designation: "Executive Vice Chairman, Managing Director and Group Chief Executive Officer", role_class: "top", change_type: "redesignation" });
    const all = [exit, stays, successor];
    expect(flagsFor(exit, all)).toEqual([]);
    expect(flagsFor(exit, [exit, successor])).toEqual([]);
    expect(flagsFor(exit, [exit, stays])).toEqual([]);
  });
});

describe("a seat on a subsidiary's board", () => {
  const c = ch({ person_name: "Mr. Anant Talaulicar", designation: "Independent Director, Chairman of the Board", role_class: "independent",
    quote: "Independent Director, Mr. Anant Talaulicar (DIN: 00031051), Chairman of the Board of the Company, has been appointed on the Board of KPIT US, a material unlisted subsidiary of the Company, w.e.f. October 28, 2026 ." });
  it("is not a new chairman", () => {
    expect(peopleTitle(c)).toBe("Mr. Anant Talaulicar joins the board of KPIT US, a subsidiary");
    expect(peopleSubtype(c)).toBe("other");
  });
  it("ranks below a change at the company itself", () => {
    const cfo = ch({ person_name: "Ms. Y", designation: "Chief Financial Officer", role_class: "top" });
    expect(primaryChange([c, cfo])).toBe(cfo);
  });
});

describe("sizing by amount", () => {
  it("ignores the facility amount of a rating action", () => {
    const s = scoreEvent({ category: "credit_rating", subtype: "upgrade", amountCr: 5685, mcapCr: 52000 });
    expect(s.reasons.some((r) => /mcap/.test(r))).toBe(false);
    expect(s.base).toBe(scoreEvent({ category: "credit_rating", subtype: "upgrade" }).base);
  });
  it("still sizes deals against market value", () => {
    const s = scoreEvent({ category: "M&A", subtype: "acquisition", amountCr: 50, mcapCr: 100_000 });
    expect(s.reasons).toContain("₹50 cr = <0.1% of mcap");
  });
});
