// Ordered classification rules (spec Appendix B). First match wins; later
// matches on a results filing are kept in `also` so their extractors run too.
// Tested on 28 realistic BSE/NSE subjects (tests/rules.test.ts).

export const CATEGORIES = [
  "results", "M&A", "fund_raise", "management_change", "litigation", "insider_trading",
  "earnings_call", "investor_meetings", "credit_rating", "dividend", "bonus_split", "capex",
  "press_release", "postal_ballot", "agm_egm", "pledging", "unclassified",
] as const;
export type Category = (typeof CATEGORIES)[number];

type RuleTarget = Category | `resolve:${string}`;
interface Rule { id: string; re: RegExp; category: RuleTarget; subtype: string | null }

const R = (id: string, pattern: string, category: RuleTarget, subtype: string | null): Rule =>
  ({ id, re: new RegExp(pattern, "i"), category, subtype });

export const RULES: Rule[] = [
  // Paperwork that often mentions "financial results" must be caught first.
  R("R00", String.raw`trading window|closure of trading`, "unclassified", "compliance"),
  R("R00b", String.raw`esg rating|esg overview`, "unclassified", "compliance"),
  R("R01", String.raw`auditor.*(resign|cessation)|resignation of (the )?statutory auditor`, "management_change", "auditor_exit"),
  R("R02", String.raw`(re-?)?appointment of (the )?(statutory|secretarial|internal|cost) auditor`, "unclassified", "auditor_appointment"),
  R("R03", String.raw`statement of deviation|monitoring agency|utili[sz]ation of (issue )?(proceeds|funds)`, "unclassified", "compliance"),
  R("R04", String.raw`insolvency|\bnclt\b|\bcirp\b|\bibc\b`, "resolve:nclt", null),
  R("R05", String.raw`(sebi|\brbi\b|enforcement directorate|\bcbi\b|income tax|\bgst\b|customs|competition commission).*(order|penalty|show cause|search|notice)|action\(s\) (taken|initiated)|orders? passed`, "litigation", "regulatory_action"),
  R("R06", String.raw`litigation|dispute|arbitration|legal proceeding`, "litigation", "dispute"),
  R("R07", String.raw`pledge|encumbrance`, "pledging", "resolve:pledge_direction"),
  R("R08", String.raw`credit rating|rating.*(assign|reaffirm|affirm|upgrad|downgrad|revis|withdraw)|\bcrisil\b|\bicra\b|care ratings|india ratings|acuite`, "credit_rating", "resolve:rating_direction"),
  R("R09a", String.raw`violation.*\bpit\b|\bpit\b.*violation`, "insider_trading", "pit_violation"),
  // SAST disclosures say "acquisition", so insider rules run before M&A. Never
  // match bare "regulation 29" (LODR 29 is a board-meeting intimation) or bare
  // "regulation 31" (LODR 31 is the shareholding pattern).
  R("R09", String.raw`insider trading|\bsast\b|takeover|substantial acquisition|\bpit\b|regulation 7\s?\(2\)|reg\.? ?7\s?\(2\)`, "insider_trading", "resolve:insider"),
  R("R10", String.raw`integrated filing`, "results", "results_admin"),
  R("R11", String.raw`newspaper|advertisement`, "resolve:newspaper", null),
  R("R12", String.raw`transcript`, "earnings_call", "transcript"),
  R("R13", String.raw`(audio|video|recording).*(call|meet)|(call|meet).*(audio|video|recording)|audio recording`, "earnings_call", "recording"),
  R("R14", String.raw`investor presentation|analyst presentation|earnings presentation|investor update`, "earnings_call", "presentation"),
  R("R15", String.raw`(earnings|conference|con\.) ?call|call.*(result|q[1-4])`, "earnings_call", "call_notice"),
  R("R16", String.raw`(prior )?intimation of board meeting|board meeting.*(intimation|to consider)|meeting of the board of directors.*(scheduled|will be held|to consider)|board meeting (to be held|rescheduled)|update on board meeting|board meeting rescheduled`, "resolve:board_notice", null),
  R("R17", String.raw`financial results?|unaudited|audited.*results|results? for the (quarter|period|year)|results- ?quarterly|q[1-4] ?(fy)? ?\d{2,4}.*(revenue|profit|ebitda|\bpat\b)`, "results", "financial_results"),
  R("R18", String.raw`buy ?back`, "fund_raise", "buyback"),
  R("R19", String.raw`\besop\b|\besos\b|\besps\b|\brsu\b|employee stock option|stock options?|grant of options|options to (the )?eligible employees|allotment.*(esop|employee)`, "unclassified", "esop"),
  R("R20", String.raw`qualified institutions? placement|\bqip\b|rights issue|preferential (issue|allotment)|issue of (equity|warrants)`, "fund_raise", "equity_raise"),
  R("R21", String.raw`non-?convertible debenture|\bncds?\b|commercial paper|\bbonds?\b|non-convertible securities`, "fund_raise", "debt_raise"),
  R("R22", String.raw`fund ?rais|raising of funds|issue of securities`, "fund_raise", "fund_raise_other"),
  R("R22b", String.raw`allotment of (equity )?shares|\ballotment\b`, "unclassified", "allotment"),
  R("R23a", String.raw`certified true copy|pronouncement of order|extension of (the )?timeline|revised timeline|timeline (for|of) completion`, "M&A", "restructuring_update"),
  R("R23", String.raw`amalgamation|merger|demerger|scheme of arrangement`, "M&A", "restructuring"),
  R("R23b", String.raw`initial public offer|\bipo\b|listing of (the )?equity shares of|red herring prospectus`, "M&A", "listing"),
  R("R24", String.raw`joint venture|\bjv\b`, "M&A", "jv"),
  R("R25", String.raw`divest|disinvest|stake sale|(sale|disposal) of (stake|shares|investment|equity)|slump sale`, "M&A", "divestment"),
  R("R26", String.raw`incorporation of .*subsidiar|investment in .*subsidiar|wholly owned subsidiary.*(incorporat|set up)`, "M&A", "subsidiary"),
  R("R27", String.raw`acqui(re|sition)`, "M&A", "acquisition"),
  R("R27b", String.raw`letter of comfort|corporate guarantee|giving of guarantee|guarantees? or indemnity|surety`, "unclassified", "guarantee"),
  R("R28", String.raw`change in (director|management|kmp|key managerial|senior management)|changes in senior management|appointment of|resignation of|cessation|retire|superannuat|re-?designat|transition of|managing director|chief executive|\bceo\b|chief financial|\bcfo\b|whole[- ]?time director|company secretary|compliance officer|independent director`, "management_change", "resolve:people"),
  R("R29", String.raw`analyst|institutional investor|investor meet|investor conference|one-on-one|group meeting`, "investor_meetings", "meeting"),
  R("R30", String.raw`special dividend`, "dividend", "special_dividend"),
  R("R31", String.raw`dividend`, "dividend", "dividend"),
  R("R32", String.raw`bonus|sub-?division|stock split|split of`, "bonus_split", "bonus_split"),
  R("R33", String.raw`capital expenditure|\bcapex\b|capacity (addition|expansion)|new (plant|facility)|greenfield|brownfield`, "capex", "capex"),
  R("R34", String.raw`commencement of commercial (production|operations)|commissioning`, "capex", "commissioning"),
  R("R35", String.raw`postal ballot`, "postal_ballot", "postal_ballot"),
  R("R36", String.raw`annual general meeting|\bagm\b|extra-?ordinary general meeting|\begm\b|book closure|e-?voting`, "agm_egm", "agm_egm"),
  R("R37", String.raw`bagging|receiving of (orders|contracts)|award of (order|contract)|receipt of order|order (win|received|inflow)|wins? .*(order|contract)|secures? .*(order|contract)|letter of (award|intent)`, "press_release", "order_win"),
  R("R38", String.raw`clarification|rumou?r|news item|spurt in (volume|price)|price movement`, "press_release", "clarification"),
  R("R38b", String.raw`production volume|production and (delivery|sales)|sales (in|for) (january|february|march|april|may|june|july|august|september|october|november|december)|business update|operational update|operations update|update for q[1-4]|company update for the quarter|monthly (sales|business)`, "press_release", "business_update"),
  R("R39", String.raw`share certificate|74\s?\(5\)|39\s?\(3\)|compliance certificate|certificate under|\bbrsr\b|business responsibility|\besg\b|investor complaints|registrar|registered office|shareholding pattern|reconciliation of share capital|corporate governance report|compliances?-|half[- ]yearly report|\biepf\b|investor education and protection`, "unclassified", "compliance"),
  R("R40", String.raw`press release|media release|media statement|launch|partnership|agreement|\bmou\b|memorandum of understanding|collaborat`, "press_release", "general"),
  R("R41", String.raw`outcome of (the )?board meeting`, "resolve:board_outcome", null),
];

export interface RuleResult {
  ruleId: string | null;
  category: Category | "needs_llm";
  subtype: string | null;
  also: Category[];
}

const ALSO_FROM_RESULTS = new Set<Category>(["management_change", "fund_raise", "M&A", "capex"]);

function resolve(name: string, text: string): { category: Category | "needs_llm"; subtype: string | null } {
  const has = (re: RegExp) => re.test(text);
  switch (name) {
    case "nclt":
      // NCLT also sanctions mergers; only insolvency words make it insolvency.
      if (/insolvency|\bcirp\b|\bibc\b|resolution professional|winding up/.test(text)) return { category: "litigation", subtype: "insolvency" };
      if (/scheme|amalgamation|merger|demerger|arrangement/.test(text)) return { category: "M&A", subtype: /certified true copy|pronouncement/.test(text) ? "restructuring_update" : "restructuring" };
      return { category: "litigation", subtype: "dispute" };
    case "pledge_direction":
      return { category: "pledging", subtype: has(/revok|release|invocation/) ? "pledge_release" : "pledge_create" };
    case "rating_direction":
      return {
        category: "credit_rating",
        subtype: has(/downgrad/) ? "downgrade" : has(/upgrad/) ? "upgrade" : has(/outlook/) ? "outlook_change"
          : has(/reaffirm|affirm/) ? "reaffirm" : "rating_action",
      };
    case "people":
      return { category: "management_change", subtype: "pending_people" };
    case "newspaper":
      return has(/result/) ? { category: "results", subtype: "results_admin" } : { category: "unclassified", subtype: "compliance" };
    case "board_notice":
      return has(/result/) ? { category: "results", subtype: "results_notice" } : { category: "unclassified", subtype: "board_notice" };
    case "board_outcome":
      return has(/result/) ? { category: "results", subtype: "financial_results" } : { category: "needs_llm", subtype: null };
    case "insider": {
      const promoter = has(/promoter/);
      if (promoter && has(/acqui|purchase|buy/)) return { category: "insider_trading", subtype: "promoter_buy" };
      if (promoter && has(/dispos|sale|sold|sell/)) return { category: "insider_trading", subtype: "promoter_sell" };
      return { category: "insider_trading", subtype: "other_insider" };
    }
    default:
      return { category: "needs_llm", subtype: null };
  }
}

export function classifyText(subcategory: string | null, subject: string, headline: string | null): RuleResult {
  const text = [subcategory ?? "", subject ?? "", headline ?? ""].join(" | ").toLowerCase();
  const hits: { rule: Rule; category: Category | "needs_llm"; subtype: string | null }[] = [];
  for (const rule of RULES) {
    if (!rule.re.test(text)) continue;
    let category: Category | "needs_llm";
    let subtype = rule.subtype;
    if (rule.category.startsWith("resolve:")) {
      const r = resolve(rule.category.slice(8), text);
      category = r.category; subtype = r.subtype;
    } else if (subtype?.startsWith("resolve:")) {
      const r = resolve(subtype.slice(8), text);
      category = r.category; subtype = r.subtype;
    } else {
      category = rule.category as Category;
    }
    hits.push({ rule, category, subtype });
  }
  if (!hits.length) return { ruleId: null, category: "needs_llm", subtype: null, also: [] };
  const first = hits[0];
  const also: Category[] = [];
  if (first.category === "results" && first.subtype === "financial_results") {
    for (const h of hits.slice(1)) {
      if (h.category !== "needs_llm" && ALSO_FROM_RESULTS.has(h.category) && !also.includes(h.category)) also.push(h.category);
    }
  }
  return { ruleId: first.rule.id, category: first.category, subtype: first.subtype, also };
}

// Base materiality per category/subtype (spec Appendix B.2).
const BASE: Record<string, number> = {
  "results:financial_results": 90,
  "results:results_notice": 20,
  "results:results_admin": 20,
  "management_change:auditor_exit": 95,
  "management_change:top": 85,
  "management_change:independent": 45,
  "management_change:kmp": 30,
  "management_change:other": 25,
  "management_change:pending_people": 50,
  "M&A:acquisition": 80,
  "M&A:restructuring": 80,
  "M&A:divestment": 70,
  "M&A:jv": 60,
  "M&A:subsidiary": 30,
  "M&A:listing": 60,
  "M&A:restructuring_update": 40,
  "fund_raise:equity_raise": 75,
  "fund_raise:buyback": 70,
  "fund_raise:fund_raise_other": 55,
  "fund_raise:debt_raise": 40,
  "litigation:insolvency": 90,
  "litigation:regulatory_action": 65,
  "litigation:dispute": 40,
  "credit_rating:downgrade": 75,
  "credit_rating:upgrade": 55,
  "credit_rating:outlook_change": 45,
  "credit_rating:rating_action": 30,
  "credit_rating:reaffirm": 15,
  "pledging:pledge_create": 70,
  "pledging:pledge_release": 35,
  "insider_trading:promoter_sell": 60,
  "insider_trading:promoter_buy": 55,
  "insider_trading:other_insider": 20,
  "insider_trading:pit_violation": 45,
  "earnings_call:guidance_change": 75,
  "earnings_call:transcript": 30,
  "earnings_call:presentation": 20,
  "earnings_call:call_notice": 10,
  "earnings_call:recording": 10,
  "capex:capex": 60,
  "capex:commissioning": 50,
  "press_release:clarification": 60,
  "press_release:order_win": 50,
  "press_release:general": 30,
  "press_release:business_update": 40,
  "unclassified:guarantee": 15,
  "unclassified:allotment": 10,
  "bonus_split:bonus_split": 55,
  "dividend:special_dividend": 50,
  "dividend:dividend": 35,
  "postal_ballot:postal_ballot": 15,
  "agm_egm:agm_egm": 15,
  "investor_meetings:meeting": 5,
};

const CATEGORY_DEFAULT: Record<string, number> = {
  results: 60, management_change: 40, "M&A": 60, fund_raise: 50, litigation: 40, credit_rating: 30,
  pledging: 50, insider_trading: 20, earnings_call: 10, capex: 50, press_release: 30, bonus_split: 50,
  dividend: 35, postal_ballot: 15, agm_egm: 15, investor_meetings: 5, unclassified: 5,
};

export function baseScore(category: string, subtype: string | null): number {
  if (subtype && BASE[`${category}:${subtype}`] !== undefined) return BASE[`${category}:${subtype}`];
  return CATEGORY_DEFAULT[category] ?? 5;
}

export const CATEGORY_LABEL: Record<string, string> = {
  results: "Results",
  "M&A": "M&A",
  fund_raise: "Fund raise",
  management_change: "Management change",
  litigation: "Litigation",
  insider_trading: "Insider trade",
  earnings_call: "Earnings call",
  investor_meetings: "Investor meeting",
  credit_rating: "Credit rating",
  dividend: "Dividend",
  bonus_split: "Bonus or split",
  capex: "Capex",
  press_release: "Press release",
  postal_ballot: "Postal ballot",
  agm_egm: "AGM or EGM",
  pledging: "Pledge",
  unclassified: "Compliance",
};
