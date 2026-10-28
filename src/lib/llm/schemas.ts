// Output schemas for every model task (spec Appendix A). Objects have named
// fields only, because Gemini's structured output rejects free-form objects.
import { z } from "zod";
import { CATEGORIES } from "../pipeline/rules";

const n = () => z.number().nullable();
const s = () => z.string().nullable();

export const ClassifyBatch = z.object({
  items: z.array(z.object({
    id: z.string(),
    category: z.enum(CATEGORIES),
    subtype: s(),
    confidence: z.number().min(0).max(1),
  })),
});

export const OneLinerBatch = z.object({
  items: z.array(z.object({
    id: z.string(),
    one_liner: z.string().max(160),
    amount_cr: n(),
    amount_quote: s(),
    direction: z.enum(["up", "down", "same"]).nullable(),
    failed_vote: z.boolean().nullable(),
  })),
});

export const ResultLines = z.object({
  period_end: z.string().describe("YYYY-MM-DD"),
  revenue_from_operations: n(),
  other_income: n(),
  total_income: n(),
  finance_costs: n(),
  depreciation_amortisation: n(),
  total_expenses: n(),
  profit_before_exceptional_and_tax: n(),
  exceptional_items: n(),
  share_of_associates_jv: n(),
  profit_before_tax: z.number(),
  tax_expense: n(),
  profit_after_tax_total: z.number(),
  profit_after_tax_owners: n(),
  interest_earned: n(),
  interest_expended: n(),
  operating_expenses: n(),
  provisions: n(),
  gross_npa_pct: n(),
});
export type ResultLinesT = z.infer<typeof ResultLines>;

export const ResultsExtract = z.object({
  basis: z.enum(["consolidated", "standalone"]),
  unit: z.enum(["lakh", "crore", "million", "thousand", "rupees"]),
  current: ResultLines,
  previous_quarter: ResultLines,
  year_ago_quarter: ResultLines,
  note: z.string().max(240).nullable(),
});
export type ResultsExtractT = z.infer<typeof ResultsExtract>;

export const PeopleExtract = z.object({
  changes: z.array(z.object({
    person_name: z.string(),
    designation: z.string(),
    role_class: z.enum(["top", "kmp", "independent", "auditor", "other"]),
    change_type: z.enum(["appointment", "resignation", "retirement", "cessation", "redesignation", "reappointment"]),
    effective_date: s().describe("YYYY-MM-DD if stated"),
    reason: s(),
    brief_profile: z.string().max(700).nullable(),
    relationships: s(),
    resignation_letter_attached: z.boolean().nullable(),
    quote: z.string(),
    page: z.number().int(),
  })),
});
export type PeopleExtractT = z.infer<typeof PeopleExtract>;

export const PersonBackground = z.object({
  headline: z.string().max(140).nullable(),
  previous_roles: z.array(z.object({
    organisation: z.string(),
    title: z.string(),
    start_year: z.number().int().nullable(),
    end_year: z.number().int().nullable(),
    source_url: z.string(),
  })),
  education: z.array(z.string()),
  years_experience: z.number().int().nullable(),
  linkedin_url: s(),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});
export type PersonBackgroundT = z.infer<typeof PersonBackground>;

export const METRIC_KEYS = [
  "revenue_growth", "revenue", "ebitda_margin", "ebit_margin", "ebitda", "pat_growth", "pat", "capex",
  "net_debt", "order_inflow", "order_inflow_growth", "order_book", "volume_growth", "aum_growth", "credit_cost", "nim", "gnpa",
  "capacity", "store_count",
] as const;

export const TranscriptExtract = z.object({
  call_period: z.string().describe("e.g. Q1 FY27"),
  call_date: s(),
  guidance: z.array(z.object({
    metric: z.string().describe(`one of ${METRIC_KEYS.join(", ")} or other:<short label>`),
    label_raw: z.string(),
    target_low: n(),
    target_high: n(),
    unit: z.enum(["pct", "cr", "bps", "count", "x", "other"]),
    basis: z.enum(["reported", "constant_currency", "organic", "ex_one_offs", "unspecified"]),
    horizon: z.string().describe("FY27, Q3 FY27, H2 FY27, FY28 or medium_term"),
    direction: z.enum(["range", "at_least", "at_most", "point", "qualitative"]),
    speaker: s(),
    quote: z.string().max(400),
    page: z.number().int(),
  })),
  reported_kpis: z.array(z.object({
    metric: z.string().describe("same keys as guidance"),
    value: z.number(),
    unit: z.enum(["pct", "cr", "bps", "count", "x", "other"]),
    basis: z.enum(["reported", "constant_currency", "organic", "ex_one_offs", "unspecified"]),
    period: z.string().describe("FY26, Q2 FY27 or H1 FY27"),
    quote: z.string().max(400),
    page: z.number().int(),
  })),
  narrative_claims: z.array(z.object({
    claim: z.string().max(200),
    horizon: s(),
    quote: z.string().max(400),
    page: z.number().int(),
  })),
  analyst_concerns: z.array(z.object({
    topic: z.string().max(80),
    summary: z.string().max(200),
    page: z.number().int(),
  })),
});
export type TranscriptExtractT = z.infer<typeof TranscriptExtract>;

export const AnnualReportExtract = z.object({
  fiscal_year: z.string(),
  business_description: z.string().max(400),
  segments: z.array(z.object({
    name: z.string(), revenue_cr: n(), share_pct: n(), page: z.number().int(),
  })),
  top_risks: z.array(z.string()),
  contingent_liabilities_cr: n(),
  related_party_highlights: z.array(z.string()),
  auditor_opinion: z.enum(["unmodified", "qualified", "adverse", "disclaimer", "unknown"]),
  key_audit_matters: z.array(z.string()),
  citations: z.array(z.object({ field: z.string(), page: z.number().int(), quote: z.string() })),
});
export type AnnualReportExtractT = z.infer<typeof AnnualReportExtract>;

export const LedgerJudge = z.object({
  items: z.array(z.object({
    claim_id: z.number().int(),
    verdict: z.enum(["agree", "diverge", "too_early"]),
    evidence: z.string().max(280),
    cites: z.array(z.string()),
  })),
});
export type LedgerJudgeT = z.infer<typeof LedgerJudge>;

const Bullet = z.object({ text: z.string().max(260), cites: z.array(z.string()).min(1) });

export const Synthesis = z.object({
  what_matters_now: z.array(Bullet).min(2).max(3),
  bull: z.array(Bullet).min(2).max(3),
  bear: z.array(Bullet).min(2).max(3),
  seed_questions: z.array(z.string().max(140)).min(2).max(3),
});
export type SynthesisT = z.infer<typeof Synthesis>;

export const Answer = z.object({
  answer: z.string().max(1200),
  cites: z.array(z.string()),
  found: z.boolean(),
});

export const ParsedRules = z.object({
  rules: z.array(z.object({
    kind: z.enum(["category", "price_move", "volume_spike", "sigma_move"]),
    symbol: s(),
    categories: z.array(z.enum(CATEGORIES)).nullable(),
    subtypes: z.array(z.string()).nullable(),
    pct: n(),
    multiple: n(),
    z: n(),
    label: z.string(),
  })),
  unparsed: s(),
});

export const BriefScript = z.object({ script: z.string().max(1400) });

/** zod -> JSON Schema in the subset Gemini accepts. */
export function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const o = { ...(node as Record<string, unknown>) };
    delete o.$schema;
    if (Array.isArray(o.type)) {
      const types = o.type as string[];
      delete o.type;
      const rest = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v)]));
      const nonNull = types.filter((t) => t !== "null");
      const variants: Record<string, unknown>[] = nonNull.map((t) => ({ ...rest, type: t }));
      if (types.includes("null")) variants.push({ type: "null" });
      return variants.length === 1 ? variants[0] : { anyOf: variants };
    }
    for (const [k, v] of Object.entries(o)) o[k] = walk(v);
    return o;
  };
  return walk(raw) as Record<string, unknown>;
}
