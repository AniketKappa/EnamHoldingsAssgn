import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyLetter, subjectLine, bodyLead } from "@/lib/pipeline/classify";
import { classifyText } from "@/lib/pipeline/rules";

// Ten real "Disclosure under Regulation 30" letters (BSE, Sep-Oct 2026) whose
// subject and headline say nothing; the rules alone sent all of them to a model.
const letters = JSON.parse(readFileSync(join(__dirname, "fixtures", "letters.json"), "utf8")) as
  { file: string; subcategory: string | null; headline: string; expected: string; text: string }[];

describe("reading the letter behind a generic disclosure", () => {
  for (const l of letters) {
    it(`${l.file}: ${l.expected}`, () => {
      expect(classifyText(l.subcategory, l.headline, l.headline).category).toBe("needs_llm");
      const hit = classifyLetter(l.subcategory, l.text);
      expect(hit && `${hit.category}/${hit.subtype}`).toBe(l.expected);
    });
  }

  it("ignores the 'not debarred by any order passed by SEBI' declaration", () => {
    const l = letters.find((x) => x.file === "HDFCBANK_37fec54b")!;
    expect(bodyLead(l.text, subjectLine(l.text))).not.toMatch(/debarred/);
  });

  it("never reads the signature block ('Company Secretary & Compliance Officer')", () => {
    const l = letters.find((x) => x.file === "BHARTIARTL_af92a854")!;
    expect(bodyLead(l.text, subjectLine(l.text))).not.toMatch(/company secretary/i);
  });

  it("stops a subject line at the body", () => {
    const s = subjectLine("Sub: L&T Wins Orders (Major*) for Dhaka Metro We enclose herewith a copy of Press Release. Thanking you, Yours faithfully");
    expect(s?.line).toBe("L&T Wins Orders (Major*) for Dhaka Metro");
  });
});
