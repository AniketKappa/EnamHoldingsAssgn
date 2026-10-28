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

const MONTH_RE = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const DATE_PATTERNS: { re: RegExp; iso: (m: RegExpExecArray) => string | null }[] = [
  // 28/10/2026, 28-10-2026, 28.10.2026
  { re: /\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/g, iso: (m) => ymd(m[3], m[2], m[1]) },
  // October 27, 2026 / Oct 27 2026
  { re: new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(20\\d{2})\\b`, "gi"), iso: (m) => ymd(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]) },
  // 28th October, 2026 / 12 October 2026
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE},?\\s*(20\\d{2})\\b`, "gi"), iso: (m) => ymd(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]) },
];

function ymd(y: string, m: string | undefined, d: string): string | null {
  if (!m) return null;
  const mm = Number(m), dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Every calendar date written in a filing's text, in the order they appear. */
export function datesIn(text: string): string[] {
  const found: { at: number; iso: string }[] = [];
  for (const p of DATE_PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text))) {
      const iso = p.iso(m);
      if (iso && !found.some((f) => f.at === m!.index)) found.push({ at: m.index, iso });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.iso);
}

/** The board meeting a notice is about, and the old date when it was moved. */
export function noticeDates(text: string): { date: string | null; replaces: string | null } {
  const moved = text.match(/(revised|rescheduled|postponed|preponed|changed)\s+(to|for)\b/i);
  if (moved && moved.index !== undefined) {
    const before = datesIn(text.slice(0, moved.index));
    const after = datesIn(text.slice(moved.index));
    return { date: after[0] ?? null, replaces: before[0] ?? null };
  }
  const at = text.search(/scheduled|to be held|will be held|held on|meeting on|on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
  const dates = datesIn(at >= 0 ? text.slice(at) : text);
  return { date: dates[0] ?? null, replaces: null };
}

/** Results meetings announced in board notices also go into the calendar. */
export async function noteMeetings(notices: { symbol: string; text: string; results: boolean }[]): Promise<number> {
  const sql = db();
  let n = 0;
  for (const nt of notices) {
    const { date, replaces } = noticeDates(nt.text);
    if (replaces) {
      const moved = await sql`delete from upcoming_results where symbol = ${nt.symbol} and meeting_date = ${replaces} returning symbol`;
      if (!moved.length && !nt.results) continue; // a non-results meeting moved
    } else if (!nt.results) continue;
    if (!date) continue;
    await sql`insert into upcoming_results (symbol, meeting_date) values (${nt.symbol}, ${date})
      on conflict (symbol, meeting_date) do update set fetched_at = now()`;
    n++;
  }
  return n;
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
