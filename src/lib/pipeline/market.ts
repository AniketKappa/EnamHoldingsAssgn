// End-of-day prices, signals and "explained by" (spec 5.6). Prices come from
// Yahoo (.NS) with BSE's 12-month series as the fallback.
import YahooFinance from "yahoo-finance2";
import { db } from "../db";
import { fetchDaily } from "../sources/prices";
import { computeSignals, signalHits, DEFAULT_THRESHOLDS, type DayBar } from "./signals";
import { istAt } from "../time";
import { pct, multiple } from "../format";

export async function ingestPrices(symbols: { symbol: string; bse_code: string | null }[], days = 10, deadline = Date.now() + 120_000) {
  const sql = db();
  let bars = 0;
  const errors: string[] = [];
  for (const s of symbols) {
    if (Date.now() > deadline) break;
    try {
      const rows = await fetchDaily(s.symbol, s.bse_code, days);
      if (!rows.length) continue;
      const values = rows.map((b) => ({ symbol: s.symbol, d: b.d, open: b.open, high: b.high, low: b.low, close: b.close, adj_close: b.adj_close, volume: Math.round(b.volume), source: b.source }));
      for (let i = 0; i < values.length; i += 300) {
        await sql`insert into prices ${sql(values.slice(i, i + 300), "symbol", "d", "open", "high", "low", "close", "adj_close", "volume", "source")}
          on conflict (symbol, d) do update set open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close,
          adj_close = excluded.adj_close, volume = excluded.volume, source = excluded.source`;
      }
      const last = rows[rows.length - 1];
      await sql`update companies set last_close = ${last.close}, last_close_d = ${last.d} where symbol = ${s.symbol}`;
      bars += rows.length;
    } catch (e) {
      errors.push(`${s.symbol}: ${(e as Error).message}`);
    }
  }
  return { bars, errors };
}

let yf: InstanceType<typeof YahooFinance> | null = null;

/** Market cap in ₹ crore from Yahoo's quote, for size chips. */
export async function refreshMcap(symbols: string[]) {
  if (!symbols.length) return 0;
  yf ??= new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const sql = db();
  let n = 0;
  for (let i = 0; i < symbols.length; i += 20) {
    const chunk = symbols.slice(i, i + 20);
    try {
      const quotes = await yf.quote(chunk.map((s) => `${s}.NS`));
      for (const q of Array.isArray(quotes) ? quotes : [quotes]) {
        const sym = String(q.symbol ?? "").replace(/\.NS$/, "");
        if (q.marketCap && sym) {
          await sql`update companies set mcap_cr = ${Math.round(q.marketCap / 1e7)} where symbol = ${sym}`;
          n++;
        }
      }
    } catch { /* keep the previous value */ }
  }
  return n;
}

/** Recompute the last few sessions' signals for each symbol from stored prices. */
export async function computeAllSignals(symbols: string[], lastN = 5) {
  const sql = db();
  let n = 0;
  for (const symbol of symbols) {
    const rows = await sql`select d, close, volume from prices where symbol = ${symbol} order by d desc limit 100`;
    const bars: DayBar[] = rows.map((r) => ({ d: toIso(r.d), close: Number(r.close), volume: Number(r.volume ?? 0) })).reverse();
    if (bars.length < 21) continue;
    const sigs = computeSignals(bars, lastN);
    for (const s of sigs) {
      await sql`insert into price_signals (symbol, d, close, ret_pct, vol_ratio, ret_z) values (${symbol}, ${s.d}, ${s.close}, ${s.ret_pct}, ${s.vol_ratio}, ${s.ret_z})
        on conflict (symbol, d) do update set close = excluded.close, ret_pct = excluded.ret_pct, vol_ratio = excluded.vol_ratio, ret_z = excluded.ret_z`;
      n++;
    }
  }
  return n;
}

function toIso(d: unknown): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/**
 * For each unusual session, look for that stock's material events filed between the previous
 * session's close (15:30 IST) and this close. The best one "explains" the move and earns the
 * event a market-confirmation bonus (+10).
 */
export async function explainSignals(days = 7) {
  const sql = db();
  const sigs = await sql`select s.symbol, s.d, s.ret_pct, s.vol_ratio, s.ret_z,
      (select max(p.d) from prices p where p.symbol = s.symbol and p.d < s.d) as prev_d
    from price_signals s where s.d > current_date - ${days}::int`;
  let explained = 0;
  for (const s of sigs) {
    const hits = signalHits({ d: toIso(s.d), close: 0, ret_pct: num(s.ret_pct), vol_ratio: num(s.vol_ratio), ret_z: num(s.ret_z) }, DEFAULT_THRESHOLDS);
    if (!hits.price && !hits.volume && !hits.sigma) continue;
    if (!s.prev_d) continue;
    const from = istAt(toIso(s.prev_d), 15, 30);
    const to = istAt(toIso(s.d), 15, 30);
    const ev = await sql`select event_key from events where symbol = ${String(s.symbol)}
      and first_filed_at > ${from} and first_filed_at <= ${to} and base_score >= 40
      order by base_score desc, first_filed_at desc limit 1`;
    const key = ev.length ? String(ev[0].event_key) : null;
    await sql`update price_signals set explained_by = ${key} where symbol = ${String(s.symbol)} and d = ${toIso(s.d)}`;
    if (key) {
      // An alert raised before the filing was grouped learns its explanation now.
      await sql`update alerts a set body = 'Explained by: ' || e.title || ', filed ' || to_char(e.first_filed_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI')
        from events e where e.event_key = ${key} and a.kind = 'signal' and a.ref_id = ${`${String(s.symbol)}:${toIso(s.d)}`}
          and a.body = 'No filing explains this move.'`;
      const chip = hits.price || hits.sigma ? `Price ${pct(num(s.ret_pct))}` : `Volume ${multiple(num(s.vol_ratio))}`;
      await sql`update events set market_bonus = 10,
        reasons = case when reasons @> ${sql.json([chip])} then reasons else reasons || ${sql.json([chip])} end,
        updated_at = now() where event_key = ${key}`;
      explained++;
    }
  }
  return explained;
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}
