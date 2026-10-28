// Upcoming results dates per holding from BSE's result calendar.
import { db } from "../db";
import { fetchResultCalendar } from "../sources/bse";

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "05 Nov 2026", "05-Nov-2026", "2026-11-05T00:00:00" -> "2026-11-05". */
export function parseMeetingDate(s: string): string | null {
  const t = s.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = t.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  const dmy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

export async function refreshCalendar(symbols: { symbol: string; bse_code: string | null }[], deadline = Date.now() + 60_000) {
  const sql = db();
  let n = 0;
  for (const s of symbols) {
    if (Date.now() > deadline) break;
    if (!s.bse_code) continue;
    try {
      const rows = await fetchResultCalendar(s.bse_code);
      for (const r of rows) {
        const d = parseMeetingDate(String(r.meeting_date ?? ""));
        if (!d) continue;
        await sql`insert into upcoming_results (symbol, meeting_date) values (${s.symbol}, ${d})
          on conflict (symbol, meeting_date) do update set fetched_at = now()`;
        n++;
      }
    } catch { /* keep yesterday's dates */ }
  }
  await sql`delete from upcoming_results where meeting_date < current_date - 7`;
  return n;
}
