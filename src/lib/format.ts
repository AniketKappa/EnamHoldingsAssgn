// Number formatting for Indian investors: lakh/crore digit grouping,
// rupee crore units, explicit signs on changes.

const inrFmt = (digits: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function inr(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return inrFmt(digits).format(n);
}

/** ₹ crore with sensible precision: 78,750 cr; 412.6 cr; 8.4 cr. */
export function crore(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `₹${inr(n, digits)} cr`;
}

/** Market cap: ₹5.2 lakh cr above 1 lakh crore, else ₹48,210 cr. */
export function mcap(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(n >= 1_000_000 ? 1 : 2)} lakh cr`;
  return crore(n);
}

export function pct(n: number | null | undefined, digits = 1, signed = true): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const s = n.toFixed(digits);
  if (!signed) return `${s}%`;
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}%`;
}

export function bps(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const r = Math.round(n);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)} bps`;
}

export function multiple(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return `${n.toFixed(digits)}×`;
}

export function price(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return `₹${inr(n, n >= 1000 ? 0 : 2)}`;
}

const istTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
});
const istDay = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "numeric", month: "short",
});
const istWeekdayFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short",
});

export function timeIst(d: Date | string): string {
  return istTime.format(new Date(d));
}

export function dayIst(d: Date | string): string {
  return istDay.format(new Date(d));
}

export function weekdayIst(d: Date | string): string {
  return istWeekdayFmt.format(new Date(d));
}

/** "15:47" today, "Yesterday 15:47", "27 Oct" otherwise. */
export function whenIst(d: Date | string, now = new Date()): string {
  const t = new Date(d);
  const key = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(x);
  const today = key(now);
  const yest = key(new Date(now.getTime() - 86_400_000));
  const k = key(t);
  if (k === today) return timeIst(t);
  if (k === yest) return `Yesterday ${timeIst(t)}`;
  return dayIst(t);
}
