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
  amountChecked?: boolean;     // the filing was read and no amount was found
}

export interface Scored { base: number; reasons: string[] }

// Where the size of the money decides materiality (a ₹50 crore startup stake is
// not news for a ₹1 lakh crore company; the same deal is for a ₹2,000 crore one).
const SIZED = new Set(["M&A", "fund_raise", "capex", "press_release", "litigation", "insider_trading"]);
const SIZE_UNSTATED = new Set(["acquisition", "divestment", "jv", "order_win"]);

/** Points for an amount as a share of market value (or of revenue for orders). */
export function sizePoints(pct: number, kind: "mcap" | "revenue"): number {
  if (kind === "revenue") return pct >= 10 ? 25 : pct >= 5 ? 15 : pct >= 2 ? 5 : pct >= 0.5 ? 0 : -20;
  return pct >= 10 ? 15 : pct >= 5 ? 5 : pct >= 2 ? 0 : pct >= 0.5 ? -15 : -45;
}

const SUBTYPE_LABEL: Record<string, string> = {
  order_win: "Order win", clarification: "Clarification", downgrade: "Rating downgrade", upgrade: "Rating upgrade",
  outlook_change: "Outlook change", reaffirm: "Rating reaffirmed", pledge_create: "New pledge", pledge_release: "Pledge released",
  promoter_buy: "Promoter buy", promoter_sell: "Promoter sale", buyback: "Buyback", equity_raise: "Equity raise",
  debt_raise: "Debt raise", insolvency: "Insolvency", regulatory_action: "Regulatory action", acquisition: "Acquisition",
  restructuring: "Merger or demerger", divestment: "Stake sale", jv: "Joint venture", special_dividend: "Special dividend",
  guidance_change: "Guidance change", auditor_exit: "Auditor exit", commissioning: "Commissioning", listing: "Listing",
  restructuring_update: "Scheme update", business_update: "Business update", pit_violation: "Insider-rule breach",
  group_restructuring: "Group restructuring", subsidiary: "Subsidiary", correction: "Correction",
};

function fmtCr(n: number) { return `₹${Math.round(n).toLocaleString("en-IN")} cr`; }
function pctText(p: number) { return p >= 10 ? p.toFixed(0) : p >= 0.1 ? p.toFixed(1) : "<0.1"; }

export function scoreEvent(i: ScoreInput): Scored {
  let base = baseScore(i.category, i.subtype);
  const reasons: string[] = [i.roleLabel || (i.subtype && SUBTYPE_LABEL[i.subtype]) || CATEGORY_LABEL[i.category] || i.category];
  if (i.redFlags?.length) {
    base += 15;
    for (const f of i.redFlags) if (!reasons.includes(f)) reasons.push(f);
  }
  // Only where money is the story: a rating on ₹5,685 cr of bank lines is not a ₹5,685 cr event.
  if (i.amountCr && i.amountCr > 0 && (SIZED.has(i.category) || i.subtype === "order_win")) {
    if (i.subtype === "order_win") {
      // Orders are sized against what the company sells in a year, never its market value.
      if (i.revenueCr && i.revenueCr > 0) {
        const ofRev = (i.amountCr / i.revenueCr) * 100;
        base += sizePoints(ofRev, "revenue");
        reasons.push(`${fmtCr(i.amountCr)} = ${pctText(ofRev)}% of revenue`);
      } else reasons.push(fmtCr(i.amountCr));
    } else if (i.mcapCr && i.mcapCr > 0) {
      const ofMcap = (i.amountCr / i.mcapCr) * 100;
      base += sizePoints(ofMcap, "mcap");
      reasons.push(`${fmtCr(i.amountCr)} = ${pctText(ofMcap)}% of mcap`);
    } else {
      reasons.push(fmtCr(i.amountCr));
    }
  } else if (i.amountChecked && i.subtype && SIZE_UNSTATED.has(i.subtype)) {
    base -= 10;
    reasons.push("Size not stated");
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
