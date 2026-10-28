// Which primary documents a dossier reads (spec 6.2): the newest five call
// transcripts (or presentations when transcripts are scarce) and the newest
// annual report, all linked from screener's Documents section.
import type { ScreenerCompany } from "../sources/screener";
import { attachmentUrl } from "../sources/bse";
import { quarterEndOnOrBefore, fiscalQuarterLabel } from "../time";

export interface DocPick {
  doc_type: "transcript" | "presentation" | "annual_report";
  url: string;
  period_label: string;       // "Q1 FY27" for a call in Jul 2026; "FY26" for an annual report
  period_end: string | null;
  said_on: string | null;     // approximate call date (mid-month from screener's label)
  label: string;              // "Jul 2026 call"
}

/** BSE's viewer link (AnnPdfOpen.aspx?Pname=X) -> the direct PDF. */
export function normalizeDocUrl(url: string): string {
  const m = url.match(/AnnPdfOpen\.aspx\?Pname=([^&#]+)/i);
  if (m) return attachmentUrl(decodeURIComponent(m[1]));
  return url.replace(/^http:\/\//, "https://");
}

/** A call in Jul 2026 discusses the quarter ended Jun 2026 (Q1 FY27). */
export function callPeriod(callDate: string): { label: string; end: string } {
  const end = quarterEndOnOrBefore(new Date(`${callDate}T12:00:00+05:30`));
  return { label: fiscalQuarterLabel(end), end };
}

export function pickDocuments(sc: ScreenerCompany, maxTranscripts = 5): DocPick[] {
  const calls = [...sc.concalls].filter((c) => c.date).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const out: DocPick[] = [];
  // One call per quarter. A quarter can list two (the results call and a later investor day,
  // or the same call hosted twice): keep the earliest, and BSE's copy over a company site's.
  const byQuarter = new Map<string, (typeof calls)[number]>();
  for (const c of calls.filter((x) => x.transcript)) {
    const label = callPeriod(c.date!).label;
    const cur = byQuarter.get(label);
    const better = !cur || c.date! < cur.date! || (c.date === cur.date && /bseindia\.com/.test(c.transcript!) && !/bseindia\.com/.test(cur.transcript!));
    if (better) byQuarter.set(label, c);
  }
  const picked = [...byQuarter.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, maxTranscripts);
  for (const c of picked) {
    const p = callPeriod(c.date!);
    out.push({ doc_type: "transcript", url: normalizeDocUrl(c.transcript!), period_label: p.label, period_end: p.end, said_on: c.date, label: `${p.label} call (${c.label})` });
  }
  if (out.length < 3) {
    const have = new Set(out.map((d) => d.period_label));
    for (const c of calls.filter((x) => x.ppt)) {
      if (out.length >= maxTranscripts) break;
      const p = callPeriod(c.date!);
      if (have.has(p.label)) continue;
      out.push({ doc_type: "presentation", url: normalizeDocUrl(c.ppt!), period_label: p.label, period_end: p.end, said_on: c.date, label: `${p.label} presentation (${c.label})` });
      have.add(p.label);
    }
  }
  const ar = [...sc.annualReports].sort((a, b) => b.year - a.year)[0];
  if (ar) {
    out.push({
      doc_type: "annual_report", url: normalizeDocUrl(ar.url), period_label: `FY${String(ar.year % 100).padStart(2, "0")}`,
      period_end: `${ar.year}-03-31`, said_on: null, label: `FY${String(ar.year % 100).padStart(2, "0")} annual report`,
    });
  }
  return out;
}

/** Annual-report pages worth reading, by keyword (spec 6.3), at most `max` in total. */
export const AR_SECTIONS: { name: string; keywords: RegExp; max: number }[] = [
  { name: "business", keywords: /management discussion and analysis|business overview|segment(al)? (information|performance|revenue)|segment reporting/i, max: 10 },
  { name: "risks", keywords: /risk management|risks and concerns|threats|key risks/i, max: 6 },
  { name: "contingent", keywords: /contingent liabilit/i, max: 4 },
  { name: "related_party", keywords: /related part(y|ies) transaction|related party disclosures/i, max: 6 },
  { name: "auditor", keywords: /independent auditor'?s report|key audit matter|qualified opinion|emphasis of matter|basis for (qualified )?opinion/i, max: 8 },
  { name: "ratios", keywords: /key financial ratios|details of significant changes|debtors turnover|interest coverage ratio/i, max: 6 },
];

export function annualReportPages(pages: string[], max = 40): { pages: number[]; bySection: Record<string, number[]> } {
  const chosen = new Set<number>();
  const bySection: Record<string, number[]> = {};
  for (const s of AR_SECTIONS) {
    const hits = pages
      .map((t, i) => ({ i, n: (t.match(new RegExp(s.keywords.source, "gi")) ?? []).length, len: t.length }))
      .filter((x) => x.n > 0 && x.len > 400)
      .sort((a, b) => b.n - a.n || a.i - b.i)
      .slice(0, s.max)
      .map((x) => x.i);
    bySection[s.name] = hits.sort((a, b) => a - b);
    for (const i of hits) { if (chosen.size < max) chosen.add(i); }
  }
  return { pages: [...chosen].sort((a, b) => a - b), bySection };
}
