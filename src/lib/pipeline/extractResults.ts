// Results card extraction (spec 5.4): find the P&L page, send only that page
// to a mid-tier model, convert units and run six checks in code.
import type { Part } from "@google/genai";
import { db } from "../db";
import { llm, EXTRACTION_SYSTEM } from "../llm/router";
import { ResultsExtract, type ResultsExtractT } from "../llm/schemas";
import { findResultsPages, subsetPdf } from "../sources/pdf";
import { quarterEndOnOrBefore, fiscalQuarterLabel } from "../time";
import { crore, pct, bps } from "../format";
import { fetchAndStore, downloadPdf } from "./filings";
import {
  toLines, computeMetrics, runChecks, resultsTitle, RESULTS_PROMPT,
  type Check, type Lines, type ResultsMetrics, type Template,
} from "./results";

export interface ResultsDetail {
  quarter: string;
  period_end: string;
  basis: "consolidated" | "standalone";
  template: Template;
  unit: string;
  metrics: ResultsMetrics;
  checks: Check[];
  checks_ok: boolean;
  /** Units or periods failed: numbers are not shown, only the filing. */
  unreliable: boolean;
  source_pages: number[];
  announcement_id: string;
  pdf_url: string | null;
  verified: "match" | "mismatch" | null;
  verified_detail?: unknown;
  note: string | null;
  reasons: string[];
}

async function prevRevenueHint(symbol: string, periodEnd: string): Promise<number | null> {
  const sql = db();
  const prevEnd = previousQuarterEnd(periodEnd);
  const f = await sql`select value from financials where symbol = ${symbol} and statement = 'quarters'
    and line_item = 'revenue' and period_end = ${prevEnd} order by basis = 'consolidated' desc limit 1`;
  if (f.length && f[0].value !== null) return Number(f[0].value);
  const r = await sql`select periods from results_extracts where symbol = ${symbol} and period_end = ${prevEnd} limit 1`;
  if (r.length) {
    const cur = (r[0].periods as { current?: Lines }).current;
    if (cur?.revenue) return cur.revenue;
  }
  return null;
}

export function previousQuarterEnd(periodEnd: string): string {
  const [y, m] = periodEnd.split("-").map(Number);
  if (m === 3) return `${y - 1}-12-31`;
  if (m === 6) return `${y}-03-31`;
  if (m === 9) return `${y}-06-30`;
  return `${y}-09-30`;
}

interface Attempt {
  data: ResultsExtractT;
  model: string;
  lines: { cur: Lines; prev: Lines; yoy: Lines };
  checks: Check[];
  passed: number;
}

function evaluate(data: ResultsExtractT, model: string, expected: string, hint: number | null, template: Template): Attempt {
  const cur = toLines(data.current, data.unit);
  const prev = toLines(data.previous_quarter, data.unit);
  const yoy = toLines(data.year_ago_quarter, data.unit);
  const checks = runChecks(cur, prev, yoy, { expectedPeriodEnd: expected, prevRevenueHint: hint, template });
  return { data, model, lines: { cur, prev, yoy }, checks, passed: checks.filter((c) => c.ok).length };
}

/** Extract one results event. Returns the card detail, or throws on a hard failure. */
export async function extractResultsEvent(eventKey: string): Promise<ResultsDetail> {
  const sql = db();
  const [ev] = await sql`select e.*, c.name, c.is_financial from events e join companies c on c.symbol = e.symbol where e.event_key = ${eventKey}`;
  if (!ev) throw new Error(`No event ${eventKey}`);
  const symbol = String(ev.symbol);
  // Try the results filings of this event, biggest PDF first (the statements are rarely in a 1-page letter).
  const filings = await sql`select id, subject, pdf_url, pdf_bytes, filed_at from announcements
    where event_key = ${eventKey} and category = 'results' and subtype = 'financial_results' and pdf_url is not null
    order by coalesce(pdf_bytes, 0) desc limit 3`;
  if (!filings.length) throw new Error("No results PDF attached");

  let lastErr: unknown = null;
  for (const f of filings) {
    try {
      const filedAt = new Date(f.filed_at as string);
      const expected = quarterEndOnOrBefore(filedAt);
      const doc = await fetchAndStore({
        symbol, docType: "results", url: String(f.pdf_url), periodLabel: fiscalQuarterLabel(expected), periodEnd: expected, maxPages: 80,
      });
      const pick = findResultsPages(doc.pages);
      const textChars = doc.pages.join("").length;
      if (!pick && textChars > 2000) throw new Error("No results statement page in this PDF");
      const pageIdx = pick ? pick.pages : doc.pages.slice(0, 8).map((_, i) => i);
      const buf = doc.buf ?? (await downloadPdf(String(f.pdf_url)));
      const small = await subsetPdf(buf, pageIdx);
      const parts: Part[] = [{ inlineData: { mimeType: "application/pdf", data: Buffer.from(small).toString("base64") } }];
      const lenderHint = !!ev.is_financial || (pick ? /interest earned|interest expended/i.test(doc.pages[pick.pages[0]]) : false);
      const prefer = pick?.basis ?? "consolidated";
      const prompt = RESULTS_PROMPT(String(ev.name), expected, prefer, lenderHint);
      const hint = await prevRevenueHint(symbol, expected);
      const templateOf = (d: ResultsExtractT): Template =>
        lenderHint || (d.current.interest_earned !== null && d.current.revenue_from_operations === null) ? "lender" : "corporate";

      const first = await llm({ task: "results_extract", system: EXTRACTION_SYSTEM, prompt, parts, schema: ResultsExtract, ref: String(f.id) });
      let best = evaluate(first.data, first.model, expected, hint, templateOf(first.data));
      if (best.passed < best.checks.length) {
        const failures = best.checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.detail})`).join("; ");
        try {
          const retry = await llm({
            task: "results_extract", system: EXTRACTION_SYSTEM, parts, schema: ResultsExtract, ref: String(f.id), noCache: true,
            prompt: `${prompt}\nYour previous answer failed these checks: ${failures}. Re-read the page and correct it.`,
          });
          const second = evaluate(retry.data, retry.model, expected, hint, templateOf(retry.data));
          if (second.passed > best.passed) best = second;
        } catch { /* keep the first attempt */ }
      }

      const template = templateOf(best.data);
      const { cur, prev, yoy } = best.lines;
      const metrics = computeMetrics(cur, prev, yoy, template);
      const checksOk = best.checks.every((c) => c.ok);
      const unreliable = best.checks.some((c) => !c.ok && (c.name === "units" || c.name === "periods"));
      const sourcePages = pageIdx.map((i) => i + 1);
      const reasons: string[] = [];
      if (!unreliable) {
        if (metrics.pat.yoy_pct !== null) reasons.push(`PAT ${pct(metrics.pat.yoy_pct, 0)} YoY`);
        if (template === "corporate" && metrics.ebitda_margin.yoy_bps !== null && Math.abs(metrics.ebitda_margin.yoy_bps) >= 50) {
          reasons.push(`Margin ${bps(metrics.ebitda_margin.yoy_bps)} YoY`);
        } else if (metrics.revenue.yoy_pct !== null) {
          reasons.push(`${template === "lender" ? "NII" : "Revenue"} ${pct(metrics.revenue.yoy_pct, 0)} YoY`);
        }
        if (metrics.exceptional && Math.abs(metrics.exceptional) >= 1) reasons.push(`Exceptional ${crore(metrics.exceptional)}`);
      }
      const detail: ResultsDetail = {
        quarter: fiscalQuarterLabel(cur.period_end || expected),
        period_end: cur.period_end || expected,
        basis: best.data.basis,
        template,
        unit: best.data.unit,
        metrics,
        checks: best.checks,
        checks_ok: checksOk,
        unreliable,
        source_pages: sourcePages,
        announcement_id: String(f.id),
        pdf_url: (f.pdf_url as string | null) ?? null,
        verified: null,
        note: best.data.note,
        reasons,
      };

      await sql`
        insert into results_extracts (announcement_id, symbol, period_end, basis, template, unit_in_doc, periods, metrics, checks, source_pages, model)
        values (${String(f.id)}, ${symbol}, ${detail.period_end}, ${detail.basis}, ${template}, ${best.data.unit},
          ${sql.json({ current: cur, prev_q: prev, yoy_q: yoy } as never)}, ${sql.json(metrics as never)}, ${sql.json(best.checks as never)},
          ${sourcePages}, ${best.model})
        on conflict (announcement_id) do update set period_end = excluded.period_end, basis = excluded.basis, template = excluded.template,
          unit_in_doc = excluded.unit_in_doc, periods = excluded.periods, metrics = excluded.metrics, checks = excluded.checks,
          source_pages = excluded.source_pages, model = excluded.model, verified = null, verified_detail = null`;

      const title = unreliable
        ? `${detail.quarter} results filed; numbers need a manual check`
        : resultsTitle(metrics, { crore, pct: (n) => pct(n, 0) });
      await sql`update events set title = ${title}, detail = ${sql.json({ ...((ev.detail as object) ?? {}), results: detail } as never)},
        updated_at = now() where event_key = ${eventKey}`;
      return detail;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
