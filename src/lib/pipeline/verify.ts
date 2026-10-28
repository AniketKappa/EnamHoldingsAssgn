// Cross-check extracted results against exchange data a few hours after filing:
// screener's quarterly row (Sales, Operating Profit, PBT, Net Profit). Within 1%
// (or ₹1 crore, since screener rounds) earns the "Matches exchange data" badge.
import { db } from "../db";
import { screenerFor, storeScreener } from "./financials";
import type { Lines, ResultsMetrics } from "./results";

export interface Comparison { line: string; ours: number | null; theirs: number | null; ok: boolean | null }

export function compareLines(
  ours: { revenue: number | null; ebitda: number | null; pbt: number | null; pat_total: number | null },
  theirs: { revenue: number | null; ebitda: number | null; pbt: number | null; pat: number | null },
  lender: boolean,
): { verdict: "match" | "mismatch" | null; rows: Comparison[] } {
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01 * Math.max(Math.abs(a), Math.abs(b)), 1.01);
  const pairs: [string, number | null, number | null][] = lender
    ? [["PBT", ours.pbt, theirs.pbt], ["PAT", ours.pat_total, theirs.pat]]
    : [["Revenue", ours.revenue, theirs.revenue], ["EBITDA", ours.ebitda, theirs.ebitda], ["PBT", ours.pbt, theirs.pbt], ["PAT", ours.pat_total, theirs.pat]];
  const rows = pairs.map(([line, a, b]) => ({ line, ours: a, theirs: b, ok: a === null || b === null ? null : near(a, b) }));
  const judged = rows.filter((r) => r.ok !== null);
  if (judged.length < 2) return { verdict: null, rows };
  return { verdict: judged.every((r) => r.ok) ? "match" : "mismatch", rows };
}

export async function verifyResults(deadline = Date.now() + 60_000): Promise<number> {
  const sql = db();
  const rows = await sql`
    select r.announcement_id, r.symbol, r.period_end, r.basis, r.template, r.periods, r.metrics, a.event_key, a.filed_at
    from results_extracts r join announcements a on a.id = r.announcement_id
    where r.verified is null and a.filed_at < now() - interval '3 hours' and a.filed_at > now() - interval '10 days'
    order by a.filed_at desc limit 10`;
  let n = 0;
  for (const r of rows) {
    if (Date.now() > deadline) break;
    try {
      const sc = await screenerFor(String(r.symbol), 3);
      await storeScreener(sc);
      if (sc.basis !== r.basis) continue; // compare like with like
      const q = sc.tables.quarters;
      if (!q) continue;
      const periodEnd = new Date(r.period_end as string).toISOString().slice(0, 10);
      const col = q.periods.findIndex((p) => p.date === periodEnd || (p.date && p.date.slice(0, 7) === periodEnd.slice(0, 7)));
      if (col < 0) continue; // screener has not added the quarter yet
      const val = (key: string) => q.rows.find((x) => x.key === key)?.values[col] ?? null;
      const cur = (r.periods as { current: Lines }).current;
      const m = r.metrics as ResultsMetrics;
      const lender = r.template === "lender";
      const cmp = compareLines(
        { revenue: cur.revenue, ebitda: m.ebitda.value, pbt: cur.pbt, pat_total: cur.pat_total },
        { revenue: val("revenue"), ebitda: val("ebitda"), pbt: val("pbt"), pat: val("pat") },
        lender,
      );
      if (!cmp.verdict) continue;
      const detail = { source: "screener", url: sc.url, column: q.periods[col].label, rows: cmp.rows };
      await sql`update results_extracts set verified = ${cmp.verdict}, verified_detail = ${sql.json(detail as never)}
        where announcement_id = ${String(r.announcement_id)}`;
      await sql`update events set detail = jsonb_set(jsonb_set(detail, '{results,verified}', to_jsonb(${cmp.verdict}::text)),
          '{results,verified_detail}', ${sql.json(detail as never)}), updated_at = now()
        where event_key = ${String(r.event_key)} and detail ? 'results'`;
      n++;
    } catch { /* try again next hour */ }
  }
  return n;
}
