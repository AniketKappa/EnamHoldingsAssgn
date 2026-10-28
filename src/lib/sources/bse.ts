// BSE India JSON API (same endpoints and headers as the maintained `bse`
// Python package, v3.3.4). BSE is FINN's primary source for filings.
import { getJson, getText } from "./http";
import { parseIstNaive, yyyymmdd } from "../time";

const API = "https://api.bseindia.com/BseIndiaAPI/api";

export const BSE_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  Origin: "https://www.bseindia.com",
  Referer: "https://www.bseindia.com/",
  "Sec-Fetch-Site": "same-site",
};

export interface BseAnnouncementRow {
  NEWSID: string;
  SCRIP_CD: number | string;
  NEWSSUB: string;
  HEADLINE?: string | null;
  CATEGORYNAME?: string | null;
  SUBCATNAME?: string | null;
  NEWS_DT?: string | null;
  DT_TM?: string | null;
  DissemDT?: string | null;
  ATTACHMENTNAME?: string | null;
  Fld_Attachsize?: number | null;
  SLONGNAME?: string | null;
  CRITICALNEWS?: number | null;
  [k: string]: unknown;
}

export interface NormalizedFiling {
  id: string;
  source: "BSE" | "NSE";
  symbol: string;
  subject: string;
  headline: string | null;
  exchange_category: string | null;
  exchange_subcategory: string | null;
  filed_at: Date;
  pdf_url: string | null;
  pdf_bytes: number | null;
  raw: Record<string, unknown>;
}

export function attachmentUrl(name: string, historical = false): string {
  return `https://www.bseindia.com/xml-data/corpfiling/${historical ? "AttachHis" : "AttachLive"}/${name}`;
}

export function attachmentViewUrl(name: string): string {
  return `https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=${name}`;
}

/** "LARSEN & TOUBRO LTD. - 500510 - Outcome of Board Meeting" -> "Outcome of Board Meeting". */
export function cleanSubject(newssub: string): string {
  const parts = newssub.split(" - ");
  if (parts.length >= 3 && /^\d{5,6}$/.test(parts[1].trim())) return parts.slice(2).join(" - ").trim();
  return newssub.trim();
}

export function normalizeBseRow(row: BseAnnouncementRow, symbol: string): NormalizedFiling {
  const when = row.NEWS_DT || row.DissemDT || row.DT_TM || "";
  const att = row.ATTACHMENTNAME ? String(row.ATTACHMENTNAME).trim() : "";
  return {
    id: `BSE:${row.NEWSID}`,
    source: "BSE",
    symbol,
    subject: cleanSubject(row.NEWSSUB ?? ""),
    headline: row.HEADLINE ? String(row.HEADLINE).trim() : null,
    exchange_category: row.CATEGORYNAME ?? null,
    exchange_subcategory: row.SUBCATNAME ?? null,
    filed_at: parseIstNaive(String(when)),
    pdf_url: att ? attachmentUrl(att) : null,
    pdf_bytes: row.Fld_Attachsize ? Number(row.Fld_Attachsize) : null,
    raw: row as Record<string, unknown>,
  };
}

export async function fetchAnnouncementsPage(params: {
  scripCode?: string; from: Date; to: Date; page?: number;
}): Promise<{ rows: BseAnnouncementRow[]; total: number }> {
  const q = new URLSearchParams({
    pageno: String(params.page ?? 1),
    strCat: "-1",
    subcategory: "-1",
    strPrevDate: yyyymmdd(params.from),
    strToDate: yyyymmdd(params.to),
    strSearch: "P",
    strScrip: params.scripCode ?? "",
    strType: "C",
  });
  const data = await getJson<{ Table?: BseAnnouncementRow[]; Table1?: { ROWCNT: number }[] }>(
    `${API}/AnnSubCategoryGetData/w?${q}`,
    { headers: BSE_HEADERS },
  );
  return { rows: data.Table ?? [], total: data.Table1?.[0]?.ROWCNT ?? 0 };
}

/** All announcements for one scrip in a date range (pages of 50). */
export async function fetchAnnouncements(scripCode: string, from: Date, to: Date): Promise<BseAnnouncementRow[]> {
  const out: BseAnnouncementRow[] = [];
  for (let page = 1; page <= 20; page++) {
    const { rows, total } = await fetchAnnouncementsPage({ scripCode, from, to, page });
    out.push(...rows);
    if (!rows.length || out.length >= total) break;
  }
  return out;
}

export interface BseCalendarRow { scrip_Code: string; short_name: string; Long_Name: string; meeting_date: string }

/** Forthcoming result dates for a scrip ("05 Nov 2026"). */
export async function fetchResultCalendar(scripCode: string): Promise<BseCalendarRow[]> {
  const rows = await getJson<BseCalendarRow[] | { Table?: BseCalendarRow[] }>(
    `${API}/Corpforthresults/w?scripcode=${encodeURIComponent(scripCode)}`,
    { headers: BSE_HEADERS },
  );
  return Array.isArray(rows) ? rows : rows.Table ?? [];
}

export interface ResultsSnapshot {
  unit: string;
  periods: string[];
  rows: { title: string; values: (number | null)[] }[];
}

/** BSE's own 3-period results summary (Revenue, Net Profit, OPM%) in crore: used to verify. */
export async function fetchResultsSnapshot(scripCode: string): Promise<ResultsSnapshot | null> {
  let res = await getJson<unknown>(`${API}/TabResults_PAR/w?scripcode=${scripCode}&tabtype=RESULTS`, {
    headers: BSE_HEADERS,
  });
  if (typeof res === "string") res = JSON.parse(res);
  const r = res as Record<string, unknown>;
  const periods = [r.col2, r.col3, r.col4].filter(Boolean).map(String);
  const list = (r.resultinCr as { title: string; v1?: string; v2?: string; v3?: string }[]) ?? [];
  if (!list.length) return null;
  const num = (s?: string) => {
    if (s === undefined || s === null || s === "" || s === "--") return null;
    const n = Number(String(s).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  return {
    unit: String(r.col1 ?? "").replace(/[()]/g, "").trim(),
    periods,
    rows: list.map((x) => ({ title: x.title, values: [num(x.v1), num(x.v2), num(x.v3)] })),
  };
}

/** 12 months of daily price and volume from BSE (fallback when Yahoo fails). */
export async function fetchPriceVolume12M(scripCode: string): Promise<{ d: string; close: number; volume: number }[]> {
  let res = await getJson<unknown>(
    `${API}/StockReachGraph/w?scripcode=${scripCode}&flag=12M&fromdate=&todate=&seriesid=`,
    { headers: BSE_HEADERS },
  );
  if (typeof res === "string") res = JSON.parse(res);
  const r = res as Record<string, unknown>;
  let data = r.Data as unknown;
  if (typeof data === "string") data = JSON.parse(data);
  if (!Array.isArray(data)) return [];
  return (data as Record<string, string>[]).map((row) => ({
    d: parseIstNaive(String(row.dttm ?? "")).toISOString().slice(0, 10),
    close: Number(row.vale1),
    volume: Number(row.vole),
  })).filter((x) => Number.isFinite(x.close));
}

/** Resolve a symbol to a BSE scrip code using BSE's search endpoint. */
export async function lookupScripCode(symbol: string): Promise<string | null> {
  const html = await getText(`${API}/PeerSmartSearch/w?Type=SS&text=${encodeURIComponent(symbol)}`, {
    headers: BSE_HEADERS,
  });
  const clean = html.replace(/&nbsp;/g, " ");
  const re = new RegExp(`<\\w+>${symbol.replace(/[&]/g, "&amp;")}<\\/\\w+>\\s+\\w+\\s+(\\d{6})`, "i");
  const m = clean.match(re);
  return m ? m[1] : null;
}
