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

// Scanned filings carry an OCR text layer full of confusions ("cor~SOUOATEO",
// "Prom before exceptional", "30/ 06/2026"), so basis words and line items are
// matched loosely and the page's structure counts as much as its words.
const CONSOL = /consolidated|c[o0][nr~]{1,2}\W{0,2}s[o0][l1iu|]{1,2}[o0i1l|]{0,2}[dao0]{0,2}at[e3][dDo0]/i;
const STANDALONE = /standalone|st\W?[a.j]{0,3}n?d\W?a?l[o0]n[ec]/i;

export function basisOf(text: string): { consolidated: boolean; standalone: boolean } {
  return { consolidated: CONSOL.test(text), standalone: STANDALONE.test(text) };
}

/** "3O.O6.2O26" and "9O575.33": letter O read where a digit was printed. */
export function ocrDigits(t: string): string {
  let prev = "";
  for (let i = 0; i < 6 && prev !== t; i++) {
    prev = t;
    t = t.replace(/(\d[.,]?)[oO]|[oO]([.,]?\d)/g, (m, a?: string, b?: string) => (a !== undefined ? `${a}0` : `0${b}`));
  }
  return t;
}

/** Structure of a results statement that survives bad OCR: period-end dates, line items, columns of figures. */
export function statementShape(text: string): number {
  const t = ocrDigits(text.toLowerCase());
  const dates = new Set<string>();
  for (const m of t.matchAll(/\b(30|31)\s*[/.-]\s*(0?3|0?6|0?9|12)\s*[/.-]\s*(20\d{2})\b/g)) dates.add(`${m[1]}${Number(m[2])}${m[3]}`);
  for (const m of t.matchAll(/\b(march|june|september|december)\s*(30|31)(st|th)?,?\s*(20\d{2})\b|\b(30|31)(st|th)?\s*(march|june|september|december),?\s*(20\d{2})\b/g)) dates.add(m[0].replace(/\W/g, ""));
  let s = Math.min(dates.size, 4) * 1.5;
  const items = [/inc[o0c]me/, /e[xk]\W?p[e3]n/, /pr[o0]f[i1l]t|\bprom\b|pr[o0]fll/, /\btax\b/, /per\s*share|\beps\b/, /part[i1l]cul/, /exc[e3]pt[i1l][o0]nal/, /empl[o0]y/, /depr[e3]c|am[o0]rt/, /unaud[i1l]t|\baudited/];
  for (const re of items) if (re.test(t)) s += 1;
  const figures = (t.match(/\d[\d,]*\.\d{1,2}\b/g) ?? []).length;
  s += figures >= 80 ? 3 : figures >= 40 ? 2 : figures >= 20 ? 1 : 0;
  if (/independent auditor|review report|chartered\s*accountants|to the board of directors of/.test(t)) s -= 4;
  if (/cash\s*flow|assets\s*(and|&)\s*l[i1l]ab|balance\s*sheet|non-?\s*current\s*assets/.test(t)) s -= 3;
  if (/segment|seament|seqment/.test(t)) s -= 2;
  if (/reported its|press release|media release|safe harbou?r|earnings presentation|billings|\byoy\b/.test(t)) s -= 4;
  return s;
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
  const b = basisOf(text);
  if (want === "consolidated") {
    if (b.consolidated) s += 2;
    if (b.standalone && !b.consolidated) s -= 2;
  } else {
    if (b.standalone) s += 2;
    if (b.consolidated && !b.standalone) s -= 2;
  }
  if (/independent auditor|limited review report|review report/.test(t)) s -= 2;
  if (t.includes("segment")) s -= 1;
  // Lender format
  if (t.includes("interest earned") && t.includes("profit")) s += 3;
  return s;
}

/** `confident` is false when the text layer is too garbled to be sure; then `pages` holds a few candidates. */
export interface PagePick { pages: number[]; basis: "consolidated" | "standalone"; score: number; confident: boolean }

export function findResultsPages(pages: string[]): PagePick | null {
  const pick = (want: "consolidated" | "standalone"): PagePick | null => {
    let best = -1;
    let bestScore = -99;
    pages.forEach((p, i) => {
      if (want === "consolidated" && !basisOf(p).consolidated) return;
      const sc = scoreResultsPage(p, want) + Math.max(0, statementShape(p));
      if (sc > bestScore) { bestScore = sc; best = i; }
    });
    if (best < 0 || scoreResultsPage(pages[best], want) < 8) return null;
    const picked = [best];
    // Statements often run onto a second page (tax, PAT, EPS).
    const next = pages[best + 1]?.toLowerCase() ?? "";
    if (next && (/earnings per share|profit for the period|net profit/.test(next)) && !/independent auditor/.test(next)) {
      picked.push(best + 1);
    }
    return { pages: picked, basis: want, score: bestScore, confident: true };
  };
  const clean = pick("consolidated") ?? pick("standalone");
  if (clean) return clean;

  // Garbled text: rank by shape, send the model the best few pages and let it say which one it read.
  const ranked = pages.map((p, i) => ({ i, shape: statementShape(p), b: basisOf(p) }))
    .filter((x) => x.shape >= 8)
    .sort((a, b) => b.shape - a.shape || Number(b.b.consolidated) - Number(a.b.consolidated));
  if (!ranked.length) return null;
  const top = ranked.slice(0, 4).filter((x) => x.shape >= ranked[0].shape - 4);
  const consolidated = top.some((x) => x.b.consolidated);
  return { pages: top.map((x) => x.i).sort((a, b) => a - b), basis: consolidated ? "consolidated" : "standalone", score: ranked[0].shape, confident: false };
}
