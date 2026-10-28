// A deterministic stand-in for every model task, so integration tests run the
// real pipeline without network or keys. Answers mirror the test fixtures.
import type { LlmRequest } from "@/lib/llm/router";

const ids = (prompt: string) => [...prompt.matchAll(/<f id="([^"]+)">/g)].map((m) => m[1]);

const line = (period_end: string, v: Partial<Record<string, number | null>>) => ({
  period_end, revenue_from_operations: null, other_income: null, total_income: null, finance_costs: null,
  depreciation_amortisation: null, total_expenses: null, profit_before_exceptional_and_tax: null, exceptional_items: null,
  share_of_associates_jv: null, profit_before_tax: 0, tax_expense: null, profit_after_tax_total: 0, profit_after_tax_owners: null,
  interest_earned: null, interest_expended: null, operating_expenses: null, provisions: null, gross_npa_pct: null, ...v,
});

export const calls: string[] = [];

export function mockLlm(req: LlmRequest<unknown>): unknown {
  calls.push(String(req.task));
  const p = req.prompt;
  switch (req.task) {
    case "classify_batch":
      return { items: ids(p).map((id) => ({ id, category: "press_release", subtype: "general", confidence: 0.6 })) };
    case "results_extract":
      return {
        basis: "consolidated", unit: "crore", note: null,
        current: line("2026-09-30", { revenue_from_operations: 78750.12, other_income: 2306, total_income: 81056.12, finance_costs: 2442, depreciation_amortisation: 1037, total_expenses: 73415.12, profit_before_exceptional_and_tax: 7641, exceptional_items: 0, profit_before_tax: 7641, tax_expense: 1692, profit_after_tax_total: 5949, profit_after_tax_owners: 5202 }),
        previous_quarter: line("2026-06-30", { revenue_from_operations: 67942.3, other_income: 2377, total_income: 70319.3, finance_costs: 2571, depreciation_amortisation: 1032, total_expenses: 63396.3, profit_before_exceptional_and_tax: 6923, exceptional_items: 0, profit_before_tax: 6923, tax_expense: 1935, profit_after_tax_total: 4988, profit_after_tax_owners: 4300 }),
        year_ago_quarter: line("2025-09-30", { revenue_from_operations: 67984.45, other_income: 1384, total_income: 69368.45, finance_costs: 2470, depreciation_amortisation: 1092, total_expenses: 63032.45, profit_before_exceptional_and_tax: 6336, exceptional_items: 0, profit_before_tax: 6336, tax_expense: 1658, profit_after_tax_total: 4678, profit_after_tax_owners: 3929 }),
      };
    case "people_extract":
      if (/Managing Director/i.test(p)) {
        return { changes: [{ person_name: "Anita Rao", designation: "Managing Director & CEO", role_class: "top", change_type: "appointment", effective_date: "2026-10-27", reason: "Appointment for a term of three years", brief_profile: "Ms. Anita Rao has over 30 years of experience in banking.", relationships: "None", resignation_letter_attached: null, quote: "appointed Ms. Anita Rao as Managing Director & CEO", page: 1 }] };
      }
      return { changes: [{ person_name: "Rajesh Kumar", designation: "Chief Financial Officer", role_class: "top", change_type: "appointment", effective_date: "2026-11-01", reason: "Appointment", brief_profile: "Mr. Rajesh Kumar is a chartered accountant with 24 years of experience in finance.", relationships: "Not related to any director.", resignation_letter_attached: null, quote: "The Board has appointed Mr. Rajesh Kumar as Chief Financial Officer", page: 1 }] };
    case "person_background":
      return { __result: { data: "notes", text: "notes", sources: [{ title: "example.com", url: "https://example.com/people/profile" }], supports: [{ text: "Previously Chief Financial Officer of Example Engineering Limited from 2018 to 2026.", sources: [0] }] } };
    case "person_structure":
      return { headline: "Joins from Example Engineering, where he was CFO", previous_roles: [{ organisation: "Example Engineering Limited", title: "Chief Financial Officer", start_year: 2018, end_year: 2026, source_url: "https://example.com/people/profile" }], education: ["Chartered Accountant"], years_experience: 24, linkedin_url: null, sources: [{ title: "example.com", url: "https://example.com/people/profile" }] };
    case "one_liners_batch":
      return {
        items: ids(p).map((id) => {
          const chunk = p.slice(p.indexOf(`<f id="${id}">`)).split("</f>")[0];
          if (/order valued at/i.test(chunk)) return { id, one_liner: "Order for a 765 kV substation network, ₹2,500 cr", amount_cr: 2500, amount_quote: "Rs 2,500 crore", direction: null, failed_vote: null };
          if (/consideration of Rs\. 120 crore/i.test(chunk)) return { id, one_liner: "Bought 100% of Example Grid for ₹120 cr", amount_cr: 120, amount_quote: "Rs. 120 crore", direction: null, failed_vote: null };
          if (/reaffirmed/i.test(chunk)) return { id, one_liner: "CRISIL reaffirmed AAA/Stable on long-term bank facilities", amount_cr: null, amount_quote: null, direction: "same", failed_vote: null };
          return { id, one_liner: "Routine update", amount_cr: null, amount_quote: null, direction: null, failed_vote: null };
        }),
      };
    case "transcript_extract": {
      const g = (metric: string, lo: number | null, hi: number | null, horizon: string, quote: string, direction = "point", unit = "pct") =>
        ({ metric, label_raw: quote.slice(0, 40), target_low: lo, target_high: hi, unit, basis: "unspecified", horizon, direction, speaker: "Management", quote, page: 2 });
      if (/Q1 FY27 Earnings/.test(p)) return { call_period: "Q1 FY27", call_date: "2026-07-28", guidance: [g("revenue_growth", 15, 15, "FY27", "For FY27, we are guiding for revenue growth of 15%"), g("order_inflow_growth", 10, 10, "FY27", "order inflow growth of 10%")], reported_kpis: [], narrative_claims: [], analyst_concerns: [{ topic: "Middle East pipeline", summary: "Analysts asked about the international pipeline.", page: 3 }] };
      if (/Q4 FY26 Earnings/.test(p)) return { call_period: "Q4 FY26", call_date: "2026-05-12", guidance: [g("revenue_growth", 12, 14, "FY27", "For FY27 we expect revenue growth of 12% to 14%", "range")], reported_kpis: [{ metric: "revenue_growth", value: 11.8, unit: "pct", basis: "reported", period: "FY26", quote: "For FY26 our revenue grew by 11.8%", page: 2 }], narrative_claims: [{ claim: "Domestic private demand is recovering and margins will improve", horizon: null, quote: "Demand from the domestic private sector is recovering, and we see margins improving from here", page: 3 }], analyst_concerns: [] };
      if (/Q3 FY26 Earnings/.test(p)) return { call_period: "Q3 FY26", call_date: "2026-01-28", guidance: [g("revenue_growth", 15, 15, "FY26", "We are confident of revenue growth of 15% for FY26"), g("ebitda_margin", 13, 13, "FY26", "EBITDA margin of 13% for the full year")], reported_kpis: [], narrative_claims: [], analyst_concerns: [] };
      if (/Q2 FY26 Earnings/.test(p)) return { call_period: "Q2 FY26", call_date: "2025-10-28", guidance: [g("revenue_growth", 15, 15, "FY26", "We maintain revenue growth of 15% for FY26")], reported_kpis: [], narrative_claims: [], analyst_concerns: [] };
      return { call_period: "Q1 FY26", call_date: "2025-07-29", guidance: [g("revenue_growth", 15, 15, "FY26", "For FY26 we guide to revenue growth of 15%")], reported_kpis: [], narrative_claims: [], analyst_concerns: [] };
    }
    case "ar_extract":
      return {
        fiscal_year: "FY26", business_description: "An engineering and construction group with infrastructure, energy and manufacturing businesses.",
        segments: [{ name: "Infrastructure Projects", revenue_cr: 140000, share_pct: 49, page: 10 }, { name: "Energy Projects", revenue_cr: 40000, share_pct: 14, page: 10 }],
        top_risks: ["Execution delays in large projects", "Commodity price volatility", "Geopolitical risk in the Middle East"],
        contingent_liabilities_cr: 9500, related_party_highlights: [], auditor_opinion: "unmodified", key_audit_matters: ["Revenue recognition on long-term contracts"],
        citations: [{ field: "segments", page: 10, quote: "Infrastructure Projects revenue Rs 1,40,000 crore" }, { field: "contingent liabilities", page: 12, quote: "Contingent liabilities not provided for: Rs 9,500 crore" }, { field: "auditor opinion", page: 13, quote: "Key audit matters: revenue recognition on long-term contracts" }],
      };
    case "ledger_judge":
      return { items: [{ claim_id: 1, verdict: "diverge", evidence: "EBITDA margin was 11.2% in Q2 FY27, down 133 bps YoY", cites: ["fact:q_opm", "fact:q_opm_yoy_bps"] }] };
    case "synthesize":
      return {
        what_matters_now: [
          { text: "Revenue grew 15.8% YoY to ₹78,750 cr in Q2 FY27 while EBITDA margin fell to 11.2%.", cites: ["fact:q_revenue", "fact:q_revenue_yoy", "fact:q_opm"] },
          { text: "Management promised 15% growth in FY26; revenue grew 11.8%.", cites: ["fact:fy_revenue_growth"] },
          { text: "Revenue will double by FY28.", cites: ["fact:nope"] },
        ],
        bull: [{ text: "Five-year revenue CAGR is 13.3%, with ROCE at 15%.", cites: ["fact:revenue_cagr_5y", "fact:roce"] }, { text: "Net profit grew 27.2% YoY to ₹5,949 cr.", cites: ["fact:q_pat"] }],
        bear: [{ text: "EBITDA margin fell 133 bps YoY.", cites: ["fact:q_opm_yoy_bps"] }, { text: "Borrowings rose to ₹1,40,300 cr.", cites: ["fact:borrowings"] }],
        seed_questions: ["What did management guide for FY27 margins?", "Why did EBITDA margin fall 133 bps YoY?"],
      };
    case "ask":
      return { answer: "Management guided revenue growth of 15% for FY27.", cites: [p.match(/<excerpt id="([^"]+)"/)?.[1] ?? "fact:q_revenue"], found: true };
    case "parse_rule":
      return { rules: [], unparsed: p };
    default:
      return {};
  }
}
