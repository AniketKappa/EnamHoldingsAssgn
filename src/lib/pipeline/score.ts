// Materiality: base score by category/subtype plus explainable modifiers.
// Global parts are stored on the event; per-user parts apply at read time.
import { baseScore, CATEGORY_LABEL } from "./rules";

export interface ScoreInput {
  category: string;
  subtype: string | null;
  amountCr?: number | null;
  mcapCr?: number | null;
  revenueCr?: number | null;   // latest full-year revenue, for order wins
  redFlags?: string[];
  roleLabel?: string | null;   // e.g. "CFO exit"
}

export interface Scored { base: number; reasons: string[] }

const SUBTYPE_LABEL: Record<string, string> = {
  order_win: "Order win", clarification: "Clarification", downgrade: "Rating downgrade", upgrade: "Rating upgrade",
  outlook_change: "Outlook change", reaffirm: "Rating reaffirmed", pledge_create: "New pledge", pledge_release: "Pledge released",
  promoter_buy: "Promoter buy", promoter_sell: "Promoter sale", buyback: "Buyback", equity_raise: "Equity raise",
  debt_raise: "Debt raise", insolvency: "Insolvency", regulatory_action: "Regulatory action", acquisition: "Acquisition",
  restructuring: "Merger or demerger", divestment: "Stake sale", jv: "Joint venture", special_dividend: "Special dividend",
  guidance_change: "Guidance change", auditor_exit: "Auditor exit", commissioning: "Commissioning",
};

function fmtCr(n: number) { return `₹${Math.round(n).toLocaleString("en-IN")} cr`; }

export function scoreEvent(i: ScoreInput): Scored {
  let base = baseScore(i.category, i.subtype);
  const reasons: string[] = [i.roleLabel || (i.subtype && SUBTYPE_LABEL[i.subtype]) || CATEGORY_LABEL[i.category] || i.category];
  if (i.redFlags?.length) {
    base += 15;
    for (const f of i.redFlags) if (!reasons.includes(f)) reasons.push(f);
  }
  if (i.amountCr && i.amountCr > 0) {
    const ofMcap = i.mcapCr && i.mcapCr > 0 ? (i.amountCr / i.mcapCr) * 100 : null;
    if (ofMcap !== null) {
      if (ofMcap >= 10) base += 15;
      else if (ofMcap >= 5) base += 5;
    }
    if (i.subtype === "order_win" && i.revenueCr && i.revenueCr > 0) {
      const ofRev = (i.amountCr / i.revenueCr) * 100;
      reasons.push(`${fmtCr(i.amountCr)} = ${ofRev.toFixed(ofRev >= 10 ? 0 : 1)}% of revenue`);
    } else if (ofMcap !== null && ofMcap >= 0.5) {
      reasons.push(`${fmtCr(i.amountCr)} = ${ofMcap.toFixed(ofMcap >= 10 ? 0 : 1)}% of mcap`);
    } else {
      reasons.push(fmtCr(i.amountCr));
    }
  }
  return { base: clamp(base), reasons: reasons.slice(0, 3) };
}

export function clamp(n: number, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, Math.round(n))); }

export type Tier = "top" | "worth" | "routine" | "hidden";

export function tierOf(score: number): Tier {
  if (score >= 70) return "top";
  if (score >= 40) return "worth";
  if (score >= 15) return "routine";
  return "hidden";
}

/** Market confirmation: the stock moved beyond the thresholds right after the event. */
export function marketBonus(retPct: number | null, volRatio: number | null, pctThreshold = 4, volThreshold = 2): number {
  if (retPct !== null && Math.abs(retPct) >= pctThreshold) return 10;
  if (volRatio !== null && volRatio >= volThreshold) return 10;
  return 0;
}

/** Per-user final score (spec 5.2): base + market + position weight, times feedback. */
export function finalScore(args: {
  base: number; market: number; weightPct?: number | null; feedbackMultiplier?: number;
}): number {
  const pos = args.weightPct ? (args.weightPct >= 10 ? 10 : args.weightPct >= 5 ? 5 : 0) : 0;
  return clamp((args.base + args.market + pos) * (args.feedbackMultiplier ?? 1));
}
