// Screener's standardised tables -> the financials table (₹ crore), plus the
// company facts other stages need (market cap, latest full-year revenue).
import { db } from "../db";
import { cachedText } from "../sources/cache";
import { fetchScreener, type ScreenerCompany, type ScreenerTable } from "../sources/screener";
import { monthLabelToDate } from "../time";

export async function screenerFor(symbol: string, ttlHours = 12): Promise<ScreenerCompany> {
  return fetchScreener(symbol, (url) => cachedText(url, {
    ttlHours, headers: { Accept: "text/html,application/xhtml+xml" }, timeoutMs: 25_000,
  }));
}

function rowsFor(symbol: string, basis: string, statement: string, t: ScreenerTable | undefined) {
  if (!t) return [];
  const out: { symbol: string; statement: string; basis: string; period: string; period_end: string | null; line_item: string; value: number | null; unit: string }[] = [];
  for (const r of t.rows) {
    t.periods.forEach((p, i) => {
      out.push({
        symbol, statement, basis, period: p.label, period_end: p.date ?? monthLabelToDate(p.label),
        line_item: r.key, value: r.values[i] ?? null, unit: r.unit,
      });
    });
  }
  return out;
}

/** Store every table row; returns the parsed company for callers that need links. */
export async function storeScreener(sc: ScreenerCompany): Promise<void> {
  const sql = db();
  const all = [
    ...rowsFor(sc.symbol, sc.basis, "quarters", sc.tables.quarters),
    ...rowsFor(sc.symbol, sc.basis, "profit_loss", sc.tables.profit_loss),
    ...rowsFor(sc.symbol, sc.basis, "balance_sheet", sc.tables.balance_sheet),
    ...rowsFor(sc.symbol, sc.basis, "cash_flow", sc.tables.cash_flow),
    ...rowsFor(sc.symbol, sc.basis, "ratios", sc.tables.ratios),
    ...Object.entries(sc.top).map(([k, v]) => ({
      symbol: sc.symbol, statement: "top", basis: sc.basis, period: "now", period_end: null, line_item: k, value: v, unit: k.endsWith("_pct") ? "pct" : k === "market_cap_cr" ? "cr" : "x",
    })),
  ];
  // Dedupe on the primary key (screener repeats a label occasionally).
  const seen = new Map<string, (typeof all)[number]>();
  for (const r of all) seen.set(`${r.statement}|${r.basis}|${r.period}|${r.line_item}`, r);
  const rows = [...seen.values()];
  for (let i = 0; i < rows.length; i += 300) {
    await sql`insert into financials ${sql(rows.slice(i, i + 300), "symbol", "statement", "basis", "period", "period_end", "line_item", "value", "unit")}
      on conflict (symbol, statement, basis, period, line_item) do update set value = excluded.value, period_end = excluded.period_end,
      unit = excluded.unit, fetched_at = now()`;
  }
  const pl = sc.tables.profit_loss;
  let revenue: number | null = null;
  if (pl) {
    const row = pl.rows.find((r) => r.key === "revenue");
    if (row) {
      // Latest dated full-year column (skip TTM).
      for (let i = pl.periods.length - 1; i >= 0; i--) {
        if (/ttm/i.test(pl.periods[i].label)) continue;
        if (row.values[i] !== null) { revenue = row.values[i]; break; }
      }
    }
  }
  const isFinancial = !!sc.tables.balance_sheet?.rows.some((r) => r.key === "deposits")
    || !!sc.tables.quarters?.rows.some((r) => r.key === "financing_profit");
  await sql`update companies set
    mcap_cr = coalesce(${sc.top.market_cap_cr ?? null}, mcap_cr),
    revenue_cr = coalesce(${revenue}, revenue_cr),
    screener_basis = ${sc.basis},
    is_financial = is_financial or ${isFinancial},
    bse_code = coalesce(bse_code, ${sc.bseCode})
    where symbol = ${sc.symbol}`;
}
