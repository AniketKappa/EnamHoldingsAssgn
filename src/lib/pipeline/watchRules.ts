// Plain-English watch rules. A deterministic parser handles the common shapes
// ("DIXON moves 5%", "volume 3x", "any promoter pledge"); the cheap model only
// sees what the parser could not map. Either way the user confirms chips.
import { llm, llmConfigured } from "../llm/router";
import { ParsedRules } from "../llm/schemas";
import { CATEGORIES } from "./rules";
import type { RuleParams } from "./alerts";

export interface RuleDraft { kind: "category" | "price_move" | "volume_spike" | "sigma_move"; symbol: string | null; params: RuleParams; label: string }

const CATEGORY_WORDS: { re: RegExp; categories: string[]; subtypes?: string[]; label: string }[] = [
  { re: /\bpledg/i, categories: ["pledging"], subtypes: ["pledge_create"], label: "promoter pledges shares" },
  { re: /\bresults?\b|earnings/i, categories: ["results"], subtypes: ["financial_results"], label: "results are filed" },
  { re: /\b(ceo|cfo|md|managing director|chair(man|person)?|management change|resign|exit|appoint)/i, categories: ["management_change"], subtypes: ["top", "auditor_exit"], label: "top management changes" },
  { re: /\bauditor/i, categories: ["management_change"], subtypes: ["auditor_exit"], label: "the auditor resigns" },
  { re: /\b(acqui|merger|demerger|takeover|stake sale|m&a)/i, categories: ["M&A"], label: "a deal is announced" },
  { re: /\b(qip|rights issue|preferential|fund ?rais|dilut|buy ?back)/i, categories: ["fund_raise"], label: "a fund raise or buyback is announced" },
  { re: /\bdowngrad/i, categories: ["credit_rating"], subtypes: ["downgrade"], label: "a rating is downgraded" },
  { re: /\brating/i, categories: ["credit_rating"], subtypes: ["downgrade", "upgrade", "outlook_change"], label: "a rating changes" },
  { re: /\b(promoter (buy|sell|sale|purchase)|insider)/i, categories: ["insider_trading"], subtypes: ["promoter_buy", "promoter_sell"], label: "promoters buy or sell" },
  { re: /\b(order win|orders?\b|contract)/i, categories: ["press_release"], subtypes: ["order_win"], label: "an order win is announced" },
  { re: /\b(dividend)/i, categories: ["dividend"], label: "a dividend is declared" },
  { re: /\b(capex|capacity|new plant)/i, categories: ["capex"], label: "new capex is announced" },
  { re: /\b(litigation|penalty|sebi order|lawsuit|insolvency)/i, categories: ["litigation"], label: "a legal or regulatory action is disclosed" },
];

/** Deterministic parse. Returns drafts plus whatever text was not understood. */
export function parseRuleText(text: string, holdings: string[]): { rules: RuleDraft[]; unparsed: string | null } {
  const t = text.trim();
  const upper = t.toUpperCase();
  const symbol = holdings.find((s) => new RegExp(`\\b${s.replace(/[&]/g, "\\&")}\\b`).test(upper)) ?? null;
  const who = symbol ?? "Any holding";
  const rules: RuleDraft[] = [];
  const pct = t.match(/(\d+(?:\.\d+)?)\s?%/);
  if (pct && /mov|fall|drop|rise|jump|gain|los|swing|change|up|down|price/i.test(t)) {
    const v = Number(pct[1]);
    rules.push({ kind: "price_move", symbol, params: { pct: v }, label: `${who} moves ${v}% in a day` });
  }
  const mult = t.match(/(\d+(?:\.\d+)?)\s?(x|×|times)\b/i);
  if (mult && /volume|traded|turnover/i.test(t)) {
    const v = Number(mult[1]);
    rules.push({ kind: "volume_spike", symbol, params: { multiple: v }, label: `${who}: volume at ${v}× its 20-day average` });
  } else if (/volume|traded/i.test(t) && !mult) {
    rules.push({ kind: "volume_spike", symbol, params: { multiple: 2 }, label: `${who}: volume at 2× its 20-day average` });
  }
  const sig = t.match(/(\d+(?:\.\d+)?)\s?(σ|sigma|standard deviation)/i);
  if (sig || /unusual|abnormal/i.test(t)) {
    const z = sig ? Number(sig[1]) : 2.5;
    rules.push({ kind: "sigma_move", symbol, params: { z }, label: `${who} makes an unusual move (${z}σ)` });
  }
  const seen = new Set<string>();
  for (const c of CATEGORY_WORDS) {
    if (!c.re.test(t)) continue;
    const key = c.categories.join(",") + (c.subtypes ?? []).join(",");
    if (seen.has(key)) continue;
    // "rating" is covered by "downgrade" when both match.
    if (c.categories[0] === "credit_rating" && rules.some((r) => r.params.categories?.includes("credit_rating"))) continue;
    if (c.categories[0] === "management_change" && rules.some((r) => r.params.categories?.includes("management_change"))) continue;
    seen.add(key);
    rules.push({ kind: "category", symbol, params: { categories: c.categories, subtypes: c.subtypes ?? null }, label: `${symbol ?? "Any holding"}: ${c.label}`.replace("Any holding: ", "Any holding: ") });
  }
  return { rules, unparsed: rules.length ? null : t };
}

export async function parseRules(text: string, holdings: string[]): Promise<{ rules: RuleDraft[]; unparsed: string | null; via: "rules" | "model" }> {
  const first = parseRuleText(text, holdings);
  if (first.rules.length || !llmConfigured()) return { ...first, via: "rules" };
  const prompt = `Turn the investor's request into alert rules. Kinds: category (categories and subtypes from: ${CATEGORIES.join(", ")}),
price_move (pct), volume_spike (multiple of the 20-day average), sigma_move (z).
Symbols must come from these holdings: ${holdings.join(", ")}. With no symbol named, use null (all holdings).
Write a short plain-English label in sentence case. Put anything you cannot map into unparsed.
Request: ${text}`;
  try {
    const out = await llm({ task: "parse_rule", prompt, schema: ParsedRules, ref: "rules" });
    const rules: RuleDraft[] = out.data.rules
      .filter((r) => !r.symbol || holdings.includes(r.symbol.toUpperCase()))
      .map((r) => ({
        kind: r.kind, symbol: r.symbol ? r.symbol.toUpperCase() : null, label: r.label,
        params: r.kind === "category" ? { categories: r.categories ?? [], subtypes: r.subtypes ?? null }
          : r.kind === "price_move" ? { pct: r.pct ?? 4 } : r.kind === "volume_spike" ? { multiple: r.multiple ?? 2 } : { z: r.z ?? 2.5 },
      }));
    return { rules, unparsed: out.data.unparsed, via: "model" };
  } catch {
    return { ...first, via: "rules" };
  }
}
