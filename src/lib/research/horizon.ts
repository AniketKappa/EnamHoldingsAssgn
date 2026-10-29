// Turning management's time words ("FY27", "Q3 FY27", "H2 FY27", "next two
// years") into periods code can evaluate against the financial tables.

export interface Horizon {
  kind: "fy" | "quarter" | "half" | "multi" | "unknown";
  label: string;          // canonical: "FY27", "Q3 FY27", "H2 FY27", or the raw text
  fy?: number;            // 2027 for FY27
  q?: 1 | 2 | 3 | 4;
  h?: 1 | 2;
}

function fyNum(s: string): number | null {
  // "27" -> 2027, "2027" -> 2027, "2026-27" -> 2027, "26-27" -> 2027
  const range = s.match(/^(\d{2,4})\s*[-–/]\s*(\d{2,4})$/);
  if (range) {
    const b = range[2];
    return b.length === 2 ? 2000 + Number(b) : Number(b);
  }
  if (/^\d{2}$/.test(s)) return 2000 + Number(s);
  if (/^\d{4}$/.test(s)) return Number(s);
  return null;
}

export function parseHorizon(raw: string | null | undefined): Horizon {
  const text = (raw ?? "").trim();
  const t = text.toUpperCase().replace(/\s+/g, " ").replace(/[’‘]/g, "'");
  if (!t) return { kind: "unknown", label: "" };
  if (/MEDIUM|LONG|NEXT \d|COMING YEARS|\d\s*-\s*\d\s*YEARS|YEARS?\b/.test(t) && !/FY/.test(t)) return { kind: "multi", label: text };
  if (/^THROUGH\b|^TILL\b|^UNTIL\b/.test(t)) return { kind: "multi", label: text };
  let m = t.match(/\bQ\s?([1-4])\s?(?:OF\s)?FY\s?'?(\d{2,4}(?:\s*[-–/]\s*\d{2,4})?)/);
  if (m) {
    const fy = fyNum(m[2].replace(/\s/g, ""));
    if (fy) return { kind: "quarter", label: `Q${m[1]} FY${String(fy % 100).padStart(2, "0")}`, fy, q: Number(m[1]) as 1 | 2 | 3 | 4 };
  }
  m = t.match(/\b(?:H\s?([12])|([12])\s?H)\s?FY\s?'?(\d{2,4}(?:\s*[-–/]\s*\d{2,4})?)/);
  if (m) {
    const fy = fyNum(m[3].replace(/\s/g, ""));
    const h = Number(m[1] ?? m[2]) as 1 | 2;
    if (fy) return { kind: "half", label: `H${h} FY${String(fy % 100).padStart(2, "0")}`, fy, h };
  }
  m = t.match(/\bFY\s?'?(\d{2,4}(?:\s*[-–/]\s*\d{2,4})?)/);
  if (m) {
    const fy = fyNum(m[1].replace(/\s/g, ""));
    if (fy) {
      // "FY27-FY29" style spans are multi-year targets.
      if (/FY\s?\d{2,4}\s*[-–/]\s*FY/.test(t)) return { kind: "multi", label: text };
      return { kind: "fy", label: `FY${String(fy % 100).padStart(2, "0")}`, fy };
    }
  }
  return { kind: "unknown", label: text };
}

/** Quarter labels a horizon covers, oldest first: FY27 -> Q1..Q4 FY27; H2 FY27 -> Q3, Q4. */
export function quartersOf(h: Horizon): string[] {
  const yy = h.fy ? String(h.fy % 100).padStart(2, "0") : "";
  if (h.kind === "quarter") return [h.label];
  if (h.kind === "half") return h.h === 1 ? [`Q1 FY${yy}`, `Q2 FY${yy}`] : [`Q3 FY${yy}`, `Q4 FY${yy}`];
  if (h.kind === "fy") return [1, 2, 3, 4].map((q) => `Q${q} FY${yy}`);
  return [];
}

/** The same quarters one year earlier. */
export function yearEarlier(quarter: string): string {
  const m = quarter.match(/^Q([1-4]) FY(\d{2})$/);
  if (!m) return quarter;
  return `Q${m[1]} FY${String((Number(m[2]) + 99) % 100).padStart(2, "0")}`;
}

/** Normalise a period string from a transcript ("FY 2026", "Q2FY27", "H1 FY27") to a canonical label. */
export function normalizePeriod(p: string | null | undefined): string {
  return parseHorizon(p).label || (p ?? "").trim();
}
