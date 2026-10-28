// Grounding checks for anything a model writes (spec 6.6): every cited id must
// exist, and every number with a unit must match a fact or a cited page.
import { BANNED_WORDS } from "../llm/router";

export interface NumberToken { value: number; unit: "pct" | "cr" | "bps" | "x" | "rs"; raw: string; tol: number }

const TOKEN = /(₹\s?)?([-−+]?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|[-−+]?\d+(?:\.\d+)?)\s?(lakh crore|lakh cr|crore|cr\b|%|bps|basis points|x\b|×)?/gi;

/** Numbers that carry a unit: ₹, %, cr, bps or ×. Bare numbers (years, counts) are not checked. */
export function unitNumbers(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const rupee = !!m[1];
    const unitRaw = (m[3] ?? "").toLowerCase();
    if (!rupee && !unitRaw) continue;
    const digits = m[2].replace(/[,+]/g, "").replace("−", "-");
    let value = Number(digits);
    if (!Number.isFinite(value)) continue;
    const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
    let tol = 0.5 * 10 ** -decimals;
    let unit: NumberToken["unit"];
    if (unitRaw.startsWith("lakh")) { value *= 100_000; tol *= 100_000; unit = "cr"; }
    else if (unitRaw === "crore" || unitRaw === "cr") unit = "cr";
    else if (unitRaw === "%") unit = "pct";
    else if (unitRaw === "bps" || unitRaw === "basis points") unit = "bps";
    else if (unitRaw === "x" || unitRaw === "×") unit = "x";
    else unit = "rs";
    out.push({ value, unit, raw: m[0].trim(), tol });
  }
  return out;
}

export function matches(token: NumberToken, known: number): boolean {
  const a = Math.abs(token.value), b = Math.abs(known);
  return Math.abs(a - b) <= Math.max(0.01 * Math.max(a, b), token.tol + 1e-9);
}

export interface GroundingContext {
  facts: Record<string, { value: number }>;
  extraNumbers: number[];                       // ledger targets and actuals, extract values
  pageText: (docId: number, page: number) => string | null;
}

export function citeExists(cite: string, ctx: GroundingContext): boolean {
  const f = cite.match(/^fact:(.+)$/);
  if (f) return f[1] in ctx.facts;
  const d = cite.match(/^doc:(\d+):p(\d+)$/);
  if (d) return ctx.pageText(Number(d[1]), Number(d[2])) !== null;
  return false;
}

/** True when every unit-bearing number is a known fact or appears on a cited page. */
export function numbersGrounded(text: string, cites: string[], ctx: GroundingContext): { ok: boolean; bad: string[] } {
  const known = [...Object.values(ctx.facts).map((f) => f.value), ...ctx.extraNumbers];
  const pageNums: number[] = [];
  for (const c of cites) {
    const d = c.match(/^doc:(\d+):p(\d+)$/);
    if (!d) continue;
    const t = ctx.pageText(Number(d[1]), Number(d[2])) ?? "";
    for (const m of t.matchAll(/[-−]?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|[-−]?\d+(?:\.\d+)?/g)) {
      const v = Number(m[0].replace(/,/g, "").replace("−", "-"));
      if (Number.isFinite(v)) pageNums.push(v);
    }
  }
  const bad: string[] = [];
  for (const tok of unitNumbers(text)) {
    if (known.some((k) => matches(tok, k)) || pageNums.some((k) => matches(tok, k))) continue;
    // Percent changes between two known values are allowed (e.g. growth computed from facts).
    bad.push(tok.raw);
  }
  return { ok: bad.length === 0, bad };
}

export function bannedWordsIn(text: string): string[] {
  const t = text.toLowerCase();
  return BANNED_WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(t));
}

export function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "").replace(/\s{2,}/g, " ").trim();
}
