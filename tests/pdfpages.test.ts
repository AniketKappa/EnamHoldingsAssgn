import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findResultsPages, ocrDigits, basisOf } from "@/lib/sources/pdf";

// Text layers of two real Q2 FY27 results filings (BSE, October 2026): Info Edge's
// is a poor OCR of a scanned statement; HDFC Bank's reads letter O for zero.
const real = JSON.parse(readFileSync(join(__dirname, "fixtures", "scanned-pages.json"), "utf8")) as Record<string, { page: number; text: string }[]>;
const pagesOf = (k: string) => real[k].map((p) => p.text);
const pageNo = (k: string, idx: number[]) => idx.map((i) => real[k][i].page);

describe("finding the statement page in real filings", () => {
  it("picks HDFC Bank's consolidated statement despite O-for-0 OCR", () => {
    const pick = findResultsPages(pagesOf("HDFCBANK_results"))!;
    expect(pick.confident).toBe(true);
    expect(pick.basis).toBe("consolidated");
    expect(pageNo("HDFCBANK_results", pick.pages)).toEqual([9]);
  });

  it("sends both garbled Info Edge statements, never the press release", () => {
    const pick = findResultsPages(pagesOf("NAUKRI_results"))!;
    expect(pick.confident).toBe(false);
    expect(pageNo("NAUKRI_results", pick.pages)).toEqual([4, 14]);
    expect(pick.basis).toBe("consolidated");
  });

  it("reads OCR'd digits and basis words", () => {
    expect(ocrDigits("3o.O6.2O26 and 9O575.33")).toBe("30.06.2026 and 90575.33");
    expect(basisOf("STAlEMENT or cor~SOUOATEO Ul4AUOITEO FlNANCI A.L RESULTS").consolidated).toBe(true);
    expect(basisOf("STATEMENT OF STANDALONE UNAUOITED FI NANCIAL RESULTS").standalone).toBe(true);
  });
});
