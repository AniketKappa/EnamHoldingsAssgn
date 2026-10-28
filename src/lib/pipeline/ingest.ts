// Pull filings for every held symbol from BSE and upsert them. Idempotent:
// rows are keyed by BSE's NEWSID, so re-running only inserts what's new.
import { db } from "../db";
import { fetchAnnouncements, normalizeBseRow, type NormalizedFiling } from "../sources/bse";
import { addDays } from "../time";

export async function heldSymbols(): Promise<{ symbol: string; bse_code: string | null }[]> {
  const rows = await db()`
    select distinct c.symbol, c.bse_code from companies c
    join holdings h on h.symbol = c.symbol
    order by c.symbol`;
  return rows.map((r) => ({ symbol: String(r.symbol), bse_code: r.bse_code ? String(r.bse_code) : null }));
}

export async function upsertFilings(rows: NormalizedFiling[]): Promise<number> {
  if (!rows.length) return 0;
  const sql = db();
  const values = rows
    .filter((r) => !Number.isNaN(r.filed_at.getTime()) && r.subject)
    .map((r) => ({
      id: r.id, source: r.source, symbol: r.symbol, subject: r.subject.slice(0, 1000), headline: r.headline?.slice(0, 2000) ?? null,
      exchange_category: r.exchange_category, exchange_subcategory: r.exchange_subcategory, filed_at: r.filed_at,
      pdf_url: r.pdf_url, pdf_bytes: r.pdf_bytes, raw: sql.json(r.raw as never),
    }));
  let inserted = 0;
  for (let i = 0; i < values.length; i += 100) {
    const res = await sql`
      insert into announcements ${sql(values.slice(i, i + 100), "id", "source", "symbol", "subject", "headline",
        "exchange_category", "exchange_subcategory", "filed_at", "pdf_url", "pdf_bytes", "raw")}
      on conflict (id) do nothing returning id`;
    inserted += res.length;
  }
  return inserted;
}

export async function ingestSymbol(symbol: string, bseCode: string, days: number): Promise<number> {
  const to = new Date();
  const from = addDays(to, -days);
  const rows = await fetchAnnouncements(bseCode, from, to);
  return upsertFilings(rows.map((r) => normalizeBseRow(r, symbol)));
}

export async function ingestAll(days = 2, deadline = Date.now() + 120_000): Promise<{ symbols: number; inserted: number; errors: string[] }> {
  const syms = await heldSymbols();
  let inserted = 0;
  const errors: string[] = [];
  for (const s of syms) {
    if (Date.now() > deadline) break;
    if (!s.bse_code) continue;
    try {
      inserted += await ingestSymbol(s.symbol, s.bse_code, days);
    } catch (e) {
      errors.push(`${s.symbol}: ${(e as Error).message}`);
    }
  }
  return { symbols: syms.length, inserted, errors };
}
