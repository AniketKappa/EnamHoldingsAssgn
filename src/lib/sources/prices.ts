// End-of-day prices. Primary: Yahoo Finance (NSE tickers end in .NS).
// Fallback: BSE's 12-month price/volume series.
import YahooFinance from "yahoo-finance2";
import { fetchPriceVolume12M } from "./bse";

export interface Bar {
  d: string; // YYYY-MM-DD (exchange date)
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  adj_close: number | null;
  volume: number;
  source: "yahoo" | "bse";
}

let yf: InstanceType<typeof YahooFinance> | null = null;
function client() {
  if (!yf) yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  return yf;
}

/** Yahoo marks Indian bars at 09:15 IST (03:45 UTC); take the IST calendar date. */
function istDay(date: Date): string {
  return new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export async function fetchYahooDaily(symbol: string, days = 400): Promise<Bar[]> {
  const period1 = new Date(Date.now() - days * 86_400_000);
  const res = await client().chart(`${symbol}.NS`, { period1, interval: "1d" });
  const bars: Bar[] = [];
  for (const q of res.quotes ?? []) {
    if (q.close === null || q.close === undefined || q.volume === null || q.volume === undefined) continue;
    bars.push({
      d: istDay(new Date(q.date)),
      open: q.open ?? null,
      high: q.high ?? null,
      low: q.low ?? null,
      close: q.close,
      adj_close: (q.adjclose as number | null | undefined) ?? null,
      volume: q.volume,
      source: "yahoo",
    });
  }
  return dedupeByDay(bars);
}

export async function fetchDaily(symbol: string, bseCode: string | null, days = 400): Promise<Bar[]> {
  try {
    const bars = await fetchYahooDaily(symbol, days);
    if (bars.length >= 5) return bars;
  } catch (e) {
    if (!bseCode) throw e;
  }
  if (!bseCode) return [];
  const rows = await fetchPriceVolume12M(bseCode);
  return dedupeByDay(rows.map((r) => ({
    d: r.d, open: null, high: null, low: null, close: r.close, adj_close: null, volume: r.volume, source: "bse" as const,
  })));
}

function dedupeByDay(bars: Bar[]): Bar[] {
  const m = new Map<string, Bar>();
  for (const b of bars) m.set(b.d, b);
  return [...m.values()].sort((a, b) => a.d.localeCompare(b.d));
}
