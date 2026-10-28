// Extraction passes over primary documents (spec 6.3): one mid-tier call per
// transcript and one over targeted annual-report pages. Every fact carries a
// quote and a page; code drops facts whose quote is not on that page.
import { db } from "../db";
import { llm, EXTRACTION_SYSTEM } from "../llm/router";
import { TranscriptExtract, AnnualReportExtract, METRIC_KEYS, type TranscriptExtractT, type AnnualReportExtractT } from "../llm/schemas";
import { markPages, quoteOnPage } from "../text";
import { annualReportPages } from "./docs";

const TRANSCRIPT_PROMPT = (company: string, period: string) => `This is the transcript (or investor presentation) of ${company}'s earnings call for ${period}.
1. guidance: every forward-looking target stated by management: growth, margins, capex, debt, order inflow, volumes, capacity or stores, credit cost, NIM, AUM.
   Directional statements count, with direction = qualitative. Use a metric key from: ${METRIC_KEYS.join(", ")}; else "other:<short label>".
   Growth rates use the _growth keys with unit pct; margins use unit pct; amounts use unit cr (convert lakh / 100, million / 10, billion x 100).
   Record the basis exactly as stated (constant currency, organic, excluding one-offs) or "unspecified". Record the horizon as FY27, Q3 FY27, H2 FY27 or medium_term.
   Analysts' questions are never guidance; only management's answers and remarks are.
2. reported_kpis: numbers management states as actual results for a past period, with the same metric keys, units and basis rules.
3. narrative_claims: at most 8 qualitative claims about demand, pricing, competition, margins or execution.
4. analyst_concerns: at most 6 topics analysts pressed on.
Quotes are verbatim, at most 30 words, with the page number from the [p.N] markers.`;

const AR_PROMPT = (company: string, fy: string) => `These are selected pages of ${company}'s annual report for ${fy}.
Fill the schema: a two-sentence description of the business; segments with revenue (Rs crore) and share where a segment table exists;
the top 5 risks management names; total contingent liabilities in Rs crore (consolidated if both are shown); notable related-party transactions;
the auditor's opinion type on the consolidated statements and the key audit matters.
Add a citation (field, page, short verbatim quote) for every item. Use only these pages.`;

function pageOk(quote: string, page: number, pages: string[]): boolean {
  if (!quote) return false;
  return quoteOnPage(quote, pages[page - 1] ?? "") || quoteOnPage(quote, pages[page - 2] ?? "") || quoteOnPage(quote, pages[page] ?? "");
}

export interface TranscriptResult { data: TranscriptExtractT; dropped: number; model: string }

export async function extractTranscript(docId: number, pages: string[], company: string, period: string): Promise<TranscriptResult> {
  const cached = await db()`select data, model from doc_extracts where document_id = ${docId} and kind = 'transcript'`;
  if (cached.length) return { data: cached[0].data as TranscriptExtractT, dropped: 0, model: String(cached[0].model) };
  const body = markPages(pages, { maxChars: 160_000 });
  const out = await llm({
    task: "transcript_extract", system: EXTRACTION_SYSTEM, prompt: `${TRANSCRIPT_PROMPT(company, period)}\n\n${body}`,
    schema: TranscriptExtract, ref: `doc:${docId}`,
  });
  const d = out.data;
  const before = d.guidance.length + d.reported_kpis.length + d.narrative_claims.length;
  const clean: TranscriptExtractT = {
    ...d,
    guidance: d.guidance.filter((g) => pageOk(g.quote, g.page, pages)),
    reported_kpis: d.reported_kpis.filter((k) => pageOk(k.quote, k.page, pages)),
    narrative_claims: d.narrative_claims.filter((c) => pageOk(c.quote, c.page, pages)),
    analyst_concerns: d.analyst_concerns.filter((a) => a.page >= 1 && a.page <= pages.length),
  };
  const dropped = before - (clean.guidance.length + clean.reported_kpis.length + clean.narrative_claims.length);
  await db()`insert into doc_extracts (document_id, kind, data, model) values (${docId}, 'transcript', ${db().json({ ...clean, dropped } as never)}, ${out.model})
    on conflict (document_id) do update set data = excluded.data, model = excluded.model, created_at = now()`;
  await db()`update documents set status = 'extracted' where id = ${docId}`;
  return { data: clean, dropped, model: out.model };
}

export interface ArResult { data: AnnualReportExtractT; pagesRead: number[]; model: string }

export async function extractAnnualReport(docId: number, pages: string[], company: string, fy: string): Promise<ArResult> {
  const cached = await db()`select data, model from doc_extracts where document_id = ${docId} and kind = 'annual_report'`;
  if (cached.length) {
    const d = cached[0].data as AnnualReportExtractT & { pages_read?: number[] };
    return { data: d, pagesRead: d.pages_read ?? [], model: String(cached[0].model) };
  }
  const pick = annualReportPages(pages, 40);
  const body = markPages(pages, { only: pick.pages, maxChars: 150_000 });
  const out = await llm({
    task: "ar_extract", system: EXTRACTION_SYSTEM, prompt: `${AR_PROMPT(company, fy)}\n\n${body}`,
    schema: AnnualReportExtract, ref: `doc:${docId}`,
  });
  const d = out.data;
  const clean: AnnualReportExtractT = {
    ...d,
    segments: d.segments.filter((s) => s.page >= 1 && s.page <= pages.length),
    citations: d.citations.filter((c) => pageOk(c.quote, c.page, pages)),
  };
  const pagesRead = pick.pages.map((i) => i + 1);
  await db()`insert into doc_extracts (document_id, kind, data, model) values (${docId}, 'annual_report', ${db().json({ ...clean, pages_read: pagesRead } as never)}, ${out.model})
    on conflict (document_id) do update set data = excluded.data, model = excluded.model, created_at = now()`;
  await db()`update documents set status = 'extracted' where id = ${docId}`;
  return { data: clean, pagesRead, model: out.model };
}
