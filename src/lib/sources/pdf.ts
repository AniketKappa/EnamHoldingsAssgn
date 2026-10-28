// PDF utilities: per-page text (for search, page targeting and citations) and
// page subsetting (so a model reads 1-2 pages, not a 40-page filing).
import { PDFDocument } from "pdf-lib";

export async function pdfPages(buf: Uint8Array, maxPages = 600): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const total = Math.min(pdf.numPages, maxPages);
  if (total === pdf.numPages) {
    const { text } = await extractText(pdf, { mergePages: false });
    return (text as string[]).map(cleanPage);
  }
  const pages: string[] = [];
  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(cleanPage(content.items.map((it) => ("str" in it ? it.str : "")).join(" ")));
  }
  return pages;
}

function cleanPage(s: string): string {
  return s.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Copy the given 0-based pages into a new small PDF. */
export async function subsetPdf(buf: Uint8Array, pageIdx: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const valid = pageIdx.filter((i) => i >= 0 && i < src.getPageCount());
  const copied = await out.copyPages(src, valid);
  copied.forEach((p) => out.addPage(p));
  return out.save();
}

export function isPdf(buf: Uint8Array): boolean {
  return buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

/**
 * Score pages for the quarterly P&L statement. Indian results filings bundle a
 * cover letter, auditor's review report, standalone and consolidated statements,
 * segment data and notes; the model only needs the statement page.
 */
export function scoreResultsPage(text: string, want: "consolidated" | "standalone"): number {
  const t = text.toLowerCase();
  let s = 0;
  if (t.includes("revenue from operations")) s += 3;
  if (t.includes("profit before tax")) s += 3;
  if (/quarter ended|three months ended|quarter ending/.test(t)) s += 2;
  if (t.includes("total income")) s += 1;
  if (t.includes("finance cost")) s += 1;
  if (t.includes("total expenses")) s += 1;
  if (want === "consolidated") {
    if (t.includes("consolidated")) s += 2;
    if (t.includes("standalone") && !t.includes("consolidated")) s -= 2;
  } else {
    if (t.includes("standalone")) s += 2;
    if (t.includes("consolidated") && !t.includes("standalone")) s -= 2;
  }
  if (/independent auditor|limited review report|review report/.test(t)) s -= 2;
  if (t.includes("segment")) s -= 1;
  // Lender format
  if (t.includes("interest earned") && t.includes("profit")) s += 3;
  return s;
}

export interface PagePick { pages: number[]; basis: "consolidated" | "standalone"; score: number }

export function findResultsPages(pages: string[]): PagePick | null {
  const pick = (want: "consolidated" | "standalone"): PagePick | null => {
    let best = -1;
    let bestScore = -99;
    pages.forEach((p, i) => {
      if (want === "consolidated" && !p.toLowerCase().includes("consolidated")) return;
      const sc = scoreResultsPage(p, want);
      if (sc > bestScore) { bestScore = sc; best = i; }
    });
    if (best < 0 || bestScore < 6) return null;
    const picked = [best];
    // Statements often run onto a second page (tax, PAT, EPS).
    const next = pages[best + 1]?.toLowerCase() ?? "";
    if (next && (/earnings per share|profit for the period|net profit/.test(next)) && !/independent auditor/.test(next)) {
      picked.push(best + 1);
    }
    return { pages: picked, basis: want, score: bestScore };
  };
  return pick("consolidated") ?? pick("standalone");
}
