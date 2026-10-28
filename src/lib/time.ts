// IST helpers and Indian fiscal labels. All stored timestamps are UTC
// (timestamptz); everything shown to people is IST.

const IST_OFFSET_MIN = 330; // UTC+05:30

/** Parse a naive exchange timestamp ("2026-10-27T15:47:12.33") as IST. */
export function parseIstNaive(s: string): Date {
  const clean = s.trim().replace(" ", "T");
  const m = clean.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?/);
  if (!m) return new Date(NaN);
  const [, y, mo, d, h = "0", mi = "0", sec = "0", frac = "0"] = m;
  const ms = Math.round(Number(`0.${frac}`) * 1000);
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec, ms) - IST_OFFSET_MIN * 60_000;
  return new Date(utc);
}

/** Parse NSE style "27-Oct-2026 15:47:12" as IST. */
export function parseNseDate(s: string): Date {
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return new Date(NaN);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mo = months.indexOf(m[2].toLowerCase());
  const utc = Date.UTC(+m[3], mo, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) - IST_OFFSET_MIN * 60_000;
  return new Date(utc);
}

/** Shift a UTC instant into a Date whose UTC fields read as IST wall-clock. */
function istShift(d: Date): Date {
  return new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
}

/** YYYY-MM-DD of the instant in IST. */
export function istDate(d: Date = new Date()): string {
  return istShift(d).toISOString().slice(0, 10);
}

/** Minutes since IST midnight. */
export function istMinutes(d: Date = new Date()): number {
  const s = istShift(d);
  return s.getUTCHours() * 60 + s.getUTCMinutes();
}

/** 0 = Sunday ... 6 = Saturday, in IST. */
export function istWeekday(d: Date = new Date()): number {
  return istShift(d).getUTCDay();
}

export function isWeekdayIst(d: Date = new Date()): boolean {
  const w = istWeekday(d);
  return w >= 1 && w <= 5;
}

/** IST wall-clock time today (or on a given IST date) as a UTC instant. */
export function istAt(dateIst: string, hh: number, mm = 0): Date {
  const [y, mo, d] = dateIst.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, hh, mm) - IST_OFFSET_MIN * 60_000);
}

export function yyyymmdd(d: Date): string {
  return istDate(d).replace(/-/g, "");
}

/** Latest quarter end (30 Jun, 30 Sep, 31 Dec, 31 Mar) on or before the date (IST). */
export function quarterEndOnOrBefore(d: Date): string {
  const [y, m, day] = istDate(d).split("-").map(Number);
  const ends: [number, number, number][] = [
    [y, 12, 31], [y, 9, 30], [y, 6, 30], [y, 3, 31],
    [y - 1, 12, 31],
  ];
  for (const [ey, em, ed] of ends) {
    if (ey < y || em < m || (em === m && ed <= day)) {
      return `${ey}-${String(em).padStart(2, "0")}-${String(ed).padStart(2, "0")}`;
    }
  }
  return `${y - 1}-12-31`;
}

/** "2026-09-30" -> "Q2 FY27". FY = year + 1 when the quarter ends in April or later. */
export function fiscalQuarterLabel(periodEnd: string): string {
  const [y, m] = periodEnd.split("-").map(Number);
  const fy = m >= 4 ? y + 1 : y;
  const q = m === 6 ? 1 : m === 9 ? 2 : m === 12 ? 3 : m === 3 ? 4 : Math.ceil((((m - 4 + 12) % 12) + 1) / 3);
  return `Q${q} FY${String(fy % 100).padStart(2, "0")}`;
}

/** "2026-03-31" -> "FY26". */
export function fiscalYearLabel(yearEnd: string): string {
  const [y, m] = yearEnd.split("-").map(Number);
  const fy = m >= 4 ? y + 1 : y;
  return `FY${String(fy % 100).padStart(2, "0")}`;
}

/** Last day of the month for screener headers like "Sep 2026". */
export function monthLabelToDate(label: string): string | null {
  const m = label.trim().match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (!m) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mi = months.indexOf(m[1].toLowerCase());
  if (mi < 0) return null;
  const y = +m[2];
  const last = new Date(Date.UTC(y, mi + 1, 0)).getUTCDate();
  return `${y}-${String(mi + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

export function hoursAgo(d: Date, now = new Date()): number {
  return (now.getTime() - d.getTime()) / 3_600_000;
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}
