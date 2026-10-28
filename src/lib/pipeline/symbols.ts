// Symbol master: every active NSE equity with its BSE code, joined on ISIN.
// NSE's EQUITY_L.csv gives symbol, name and ISIN; BSE's scrip list gives the
// BSE code, industry and market cap. Built by the setup workflow, refreshed weekly.
import { db } from "../db";
import { getJson, getText } from "../sources/http";
import { BSE_HEADERS } from "../sources/bse";

export interface SymbolRow { symbol: string; name: string; isin: string | null; bse_code: string | null; industry: string | null; mcap_cr: number | null }

export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === "," && !q) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    out.push(cells.map((c) => c.trim()));
  }
  return out;
}

export function parseNseEquityList(csv: string): { symbol: string; name: string; isin: string; series: string }[] {
  const rows = parseCsv(csv);
  const head = rows[0].map((h) => h.toUpperCase());
  const iSym = head.indexOf("SYMBOL"), iName = head.indexOf("NAME OF COMPANY"), iIsin = head.indexOf("ISIN NUMBER"), iSeries = head.indexOf("SERIES");
  return rows.slice(1).map((r) => ({ symbol: r[iSym], name: r[iName], isin: r[iIsin], series: r[iSeries] }))
    .filter((r) => r.symbol && r.isin && ["EQ", "BE", "BZ", "SM", "ST"].includes(r.series));
}

const FIN = /\bbank|non banking|nbfc|housing finance|finance|financial institution|insurance/i;

export function titleCase(name: string): string {
  return name.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Ltd|Limited)\.?$/i, "").replace(/\s+/g, " ").trim()
    .replace(/\bOf\b/g, "of").replace(/\bAnd\b/g, "and").replace(/\(India\)/i, "(India)");
}

export async function buildSymbolMaster(): Promise<{ nse: number; bse: number; joined: number }> {
  const csv = await getText("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv", {
    headers: { Accept: "text/csv,*/*", Referer: "https://www.nseindia.com/" }, timeoutMs: 30_000,
  }).catch(() => getText("https://archives.nseindia.com/content/equities/EQUITY_L.csv", { headers: { Accept: "text/csv,*/*" }, timeoutMs: 30_000 }));
  const nse = parseNseEquityList(csv);
  type BseRow = { SCRIP_CD: string; scrip_id: string; ISIN_NUMBER: string; INDUSTRY: string; Mktcap: string; Scrip_Name: string };
  let bse: BseRow[] = [];
  try {
    bse = await getJson<BseRow[]>(
      "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?scripcode=&Group=&industry=&segment=Equity&status=Active",
      { headers: BSE_HEADERS, timeoutMs: 60_000 },
    );
  } catch { /* NSE list alone still lets research resolve symbols */ }
  const byIsin = new Map(bse.map((b) => [b.ISIN_NUMBER, b]));
  const rows: SymbolRow[] = nse.map((n) => {
    const b = byIsin.get(n.isin);
    const mcap = b?.Mktcap ? Number(String(b.Mktcap).replace(/,/g, "")) : null;
    return {
      symbol: n.symbol, name: titleCase(n.name), isin: n.isin, bse_code: b ? String(b.SCRIP_CD) : null,
      industry: b?.INDUSTRY || null, mcap_cr: mcap !== null && Number.isFinite(mcap) ? mcap : null,
    };
  });
  const sql = db();
  // bse_code is unique; drop duplicates defensively.
  const seenBse = new Set<string>();
  for (const r of rows) {
    if (r.bse_code && seenBse.has(r.bse_code)) r.bse_code = null;
    if (r.bse_code) seenBse.add(r.bse_code);
  }
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400).map((r) => ({ ...r, is_financial: !!(r.industry && FIN.test(r.industry)) }));
    await sql`insert into companies ${sql(chunk, "symbol", "name", "isin", "bse_code", "industry", "mcap_cr", "is_financial")}
      on conflict (symbol) do update set isin = excluded.isin,
        bse_code = coalesce(companies.bse_code, excluded.bse_code),
        industry = coalesce(excluded.industry, companies.industry),
        mcap_cr = coalesce(excluded.mcap_cr, companies.mcap_cr),
        is_financial = companies.is_financial or excluded.is_financial`;
  }
  return { nse: nse.length, bse: bse.length, joined: rows.filter((r) => r.bse_code).length };
}

/** Autocomplete over the master: exact symbol first, then prefix, then name words. */
export async function searchSymbols(q: string, limit = 8): Promise<{ symbol: string; name: string; mcap_cr: number | null }[]> {
  const t = q.trim().toUpperCase();
  if (!t) return [];
  const rows = await db()`select symbol, name, mcap_cr from companies
    where symbol = ${t} or symbol like ${t + "%"} or upper(name) like ${"%" + t + "%"}
    order by (symbol = ${t}) desc, (symbol like ${t + "%"}) desc, mcap_cr desc nulls last
    limit ${limit}`;
  return rows.map((r) => ({ symbol: String(r.symbol), name: String(r.name), mcap_cr: r.mcap_cr === null ? null : Number(r.mcap_cr) }));
}
