// Code checks on what the extraction model read from a call (CLAUDE.md rule 2: LLMs
// extract, code decides). A small model copies prompt examples ("FY27") into every
// horizon, skips "Rs 1,356 billion" -> crore conversions and files working capital under
// net debt, so each promise's horizon, units, metric key and scope are re-derived here from
// its own quote and the page around it. Restatements by analysts, numbers that are not in
// the quote and "promises" about periods already over are dropped.
import type { GuidanceIn, KpiIn } from "./ledger";

/** The call a statement was made on: the quarter it reported and the fiscal year then in progress. */
export interface CallRef { fy: number; q: 1 | 2 | 3 | 4; inProgress: number }

export type Scope = { scope: "company" } | { scope: "segment"; label: string };

export interface Period { kind: "fy" | "half" | "quarter"; fy: number; q?: 1 | 2 | 3 | 4; h?: 1 | 2 }

const ord = (fy: number, q: number) => fy * 4 + (q - 1);
export const endOrd = (p: Period) => ord(p.fy, p.kind === "quarter" ? p.q! : p.kind === "half" ? (p.h === 1 ? 2 : 4) : 4);
const yy = (fy: number) => String(fy % 100).padStart(2, "0");
export const periodLabel = (p: Period) =>
  p.kind === "quarter" ? `Q${p.q} FY${yy(p.fy)}` : p.kind === "half" ? `H${p.h} FY${yy(p.fy)}` : `FY${yy(p.fy)}`;

/** "Q2 FY26" (or, failing that, the call date) -> the call's reported quarter and the year in progress. */
export function callRef(saidPeriod: string, saidOn?: string | null): CallRef {
  const m = saidPeriod.match(/Q\s?([1-4])\s*FY\s*['’]?(\d{2,4})/i);
  let fy: number, q: 1 | 2 | 3 | 4;
  if (m) {
    q = Number(m[1]) as 1 | 2 | 3 | 4;
    fy = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  } else {
    // Results calls come a few weeks after the quarter: a July call reports Q1, a January call Q3.
    const d = saidOn ? new Date(saidOn) : new Date();
    const month = d.getUTCMonth() + 1, year = d.getUTCFullYear();
    const fyOfDate = month >= 4 ? year + 1 : year;
    const qOfDate = month >= 4 ? Math.ceil((month - 3) / 3) : 4;
    q = (qOfDate === 1 ? 4 : qOfDate - 1) as 1 | 2 | 3 | 4;
    fy = qOfDate === 1 ? fyOfDate - 1 : fyOfDate;
  }
  return { fy, q, inProgress: q === 4 ? fy + 1 : fy };
}

function fyOf(digits: string): number | null {
  const s = digits.replace(/\s/g, "");
  const range = s.match(/^(\d{2,4})[-–/](\d{2,4})$/);
  if (range) {
    const b = range[2];
    return b.length === 2 ? 2000 + Number(b) : Number(b);
  }
  if (/^\d{2}$/.test(s)) return 2000 + Number(s);
  if (/^20\d{2}$/.test(s)) return Number(s);
  return null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const QUARTER_END: Record<string, 1 | 2 | 3 | 4> = { june: 1, september: 2, december: 3, march: 4 };
function monthPeriod(month: number, year: number): Period {
  const fy = month >= 4 ? year + 1 : year;
  if (month === 3) return { kind: "fy", fy };            // "by March '26": the year-end
  const q = (month >= 4 ? Math.ceil((month - 3) / 3) : 4) as 1 | 2 | 3 | 4;
  return { kind: "quarter", fy, q };
}

export interface Mention { p: Period; start: number; end: number; prep: string; span?: Period }

const YR = String.raw`['’‘]?\s*(\d{4}\s*[-–/]\s*\d{2,4}|\d{2}\s*[-–/]\s*\d{2}(?!\d)|\d{4}|\d{2})(?!\d)`;
const FYW = String.raw`(?:FY|F\.Y\.|fiscal(?:\s+year)?|financial\s+year)\s*-?\s*`;
const PATTERNS: [RegExp, (m: RegExpExecArray) => Period | null][] = [
  [new RegExp(String.raw`\bQ\s?([1-4])\s*(?:of\s+)?(?:the\s+)?${FYW}${YR}`, "gi"), (m) => { const fy = fyOf(m[2]); return fy ? { kind: "quarter", fy, q: Number(m[1]) as 1 | 2 | 3 | 4 } : null; }],
  [new RegExp(String.raw`\b([1-4])Q\s*${FYW}${YR}`, "gi"), (m) => { const fy = fyOf(m[2]); return fy ? { kind: "quarter", fy, q: Number(m[1]) as 1 | 2 | 3 | 4 } : null; }],
  [new RegExp(String.raw`\b(?:H\s?([12])|([12])H|(first|second)\s+half(?:\s+of)?(?:\s+the)?)\s*${FYW}${YR}`, "gi"), (m) => {
    const fy = fyOf(m[4]);
    const h = (m[1] ? Number(m[1]) : m[2] ? Number(m[2]) : m[3].toLowerCase() === "first" ? 1 : 2) as 1 | 2;
    return fy ? { kind: "half", fy, h } : null;
  }],
  [new RegExp(String.raw`\b${FYW}${YR}`, "gi"), (m) => { const fy = fyOf(m[1]); return fy ? { kind: "fy", fy } : null; }],
  [/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s*(?:of\s+)?(?:(20\d{2})|['’‘-]\s*(\d{2}))(?!\d)/gi, (m) => {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    const year = m[2] ? Number(m[2]) : 2000 + Number(m[3]);
    return monthPeriod(month, year);
  }],
  [/\b(20\d{2})\s*[-–]\s*(\d{2})(?!\d)/g, (m) => {
    const a = Number(m[1]), b = 2000 + Number(m[2]);
    return b === a + 1 ? { kind: "fy", fy: b } : null;
  }],
];

/** Every explicit period in a text: FY '26, Q3 FY26, H2 FY 2026, financial year 2027, March '26, 2025-26. */
export function periodMentions(text: string): Mention[] {
  const taken: [number, number][] = [];
  const out: Mention[] = [];
  for (const [re, toPeriod] of PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const start = m.index, end = m.index + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      const p = toPeriod(m);
      if (!p) continue;
      taken.push([start, end]);
      const prep = (text.slice(Math.max(0, start - 28), start).match(/\b((?:through|till|until|up)\s+to|by|before|till|until|through|thru|upto|in|for|during|of|from|to|over|vs\.?|versus|than|since)\s*(?:the\s+)?(?:end\s+of\s+)?(?:the\s+)?$/i)?.[1] ?? "")
        .toLowerCase().replace(/\s+/g, " ").replace(/^(?:through|till|until|up) to$|^upto$|^thru$/, "through");
      out.push({ p, start, end, prep });
    }
  }
  out.sort((a, b) => a.start - b.start);
  // "FY26-FY28", "FY26 to FY28": a span.
  for (let i = 0; i + 1 < out.length; i++) {
    const between = text.slice(out[i].end, out[i + 1].start);
    if (/^\s*(?:-|–|to|through|till|until)\s*$/i.test(between)) { out[i].span = out[i + 1].p; out.splice(i + 1, 1); }
  }
  return out;
}

const THIS_YEAR = /\b(?:full[- ]year|this year|current year|(?:rest|end|balance|remainder) of the year|the year\b|this fiscal|current fiscal|full fiscal|this financial year|current financial year|the financial year|the fiscal year|year[- ]end|end of (?:the |this )?(?:fiscal |financial )?year|close the year|for the year)/i;
const NEXT_YEAR = /\b(?:next (?:fiscal |financial )?year|next fiscal|following year|coming year|year ahead)\b/i;
const H2_REL = /\b(?:second half|back half|H2|2H)\b(?!\s*(?:of\s+)?(?:the\s+)?(?:FY|fiscal\s*(?:year\s*)?\d|financial\s+year\s*\d))/i;
const H1_REL = /\b(?:first half|H1|1H)\b(?!\s*(?:of\s+)?(?:the\s+)?(?:FY|fiscal\s*(?:year\s*)?\d|financial\s+year\s*\d))/i;
const NUMW = String.raw`(?:\d+|two|three|four|five|six|seven|eight|ten|several|few|couple of)`;
const MULTI = new RegExp(String.raw`\b(?:medium[- ](?:to[- ]long[- ])?term|long[- ]term|mid[- ]term|next ${NUMW}(?:\s*(?:to|-|–)\s*${NUMW})? (?:years|quarters)|over the next|CAGR|compounded|${NUMW}[- ]year (?:plan|target|horizon|period|journey|roadmap)|in the coming years|over (?:the )?(?:medium|long) (?:term|run)|years? ahead|over time)\b`, "i");
const BARE_MONTH = /\b(?:by|till|until|before|in|of|for)\s+(?:the\s+)?(?:end\s+of\s+)?(March|June|September|December)(?!\s*(?:['’‘-]\s*\d{2}|\s*20\d{2}))(\s+quarter)?\b/i;

/** The period a promise is for: from the quote, then the call's own year words, then the page, then the model. */
export function resolveHorizon(g: Pick<GuidanceIn, "quote" | "label_raw" | "horizon">, call: CallRef, before = ""):
  { horizon: string; source: "quote" | "relative" | "context" | "model" | "default" } | null {
  const reported = ord(call.fy, call.q);
  const text = `${g.quote} | ${g.label_raw}`;
  const parsed = parseModel(g.horizon);
  const model = parsed === "multi" ? null : parsed;
  const all = periodMentions(text);
  const future = all.filter((m) => endOrd(m.span ?? m.p) > reported);
  const span = future.find((m) => m.span || /^(through|till|until)$/.test(m.prep));
  if (span) {
    const to = span.span ?? span.p;
    return { horizon: span.span ? `${periodLabel(span.p)}–${periodLabel(to)}` : `Through ${periodLabel(to)}`, source: "quote" };
  }
  const targets = future.filter((m) => !/^(from|vs\.?|versus|than|since|over)$/.test(m.prep));
  if (targets.length) {
    const labels = targets.map((m) => periodLabel(m.p));
    if (model && labels.includes(periodLabel(model))) return { horizon: periodLabel(model), source: "quote" };
    const pick = targets.find((m) => /^(by|for|in|during|of|before)$/.test(m.prep)) ?? targets[targets.length - 1];
    return { horizon: periodLabel(pick.p), source: "quote" };
  }
  if (MULTI.test(g.quote)) return { horizon: "Medium term", source: "quote" };
  const next = NEXT_YEAR.test(g.quote), cur = THIS_YEAR.test(g.quote);
  if (next || cur) {
    const nextFy = call.q === 4 ? call.inProgress : call.fy + 1;   // after a year closes, "next year" is the one just begun
    const options = [...(cur ? [call.inProgress] : []), ...(next ? [nextFy] : [])];
    const fy = model?.kind === "fy" && options.includes(model.fy) ? model.fy : next ? nextFy : call.inProgress;
    return { horizon: `FY${yy(fy)}`, source: "relative" };
  }
  if (H2_REL.test(g.quote)) {
    const h: Period = { kind: "half", fy: call.inProgress, h: 2 };
    return { horizon: periodLabel(endOrd(h) > reported ? h : { ...h, fy: h.fy + 1 }), source: "relative" };
  }
  if (H1_REL.test(g.quote)) {
    const h: Period = { kind: "half", fy: call.inProgress, h: 1 };
    if (endOrd(h) > reported) return { horizon: periodLabel(h), source: "relative" };
  }
  const bare = g.quote.match(BARE_MONTH) ?? g.label_raw.match(BARE_MONTH);
  if (bare) {
    const qi = QUARTER_END[bare[1].toLowerCase()];
    const fy = qi > call.q ? call.fy : call.fy + 1;
    return { horizon: periodLabel(qi === 4 ? { kind: "fy", fy } : { kind: "quarter", fy, q: qi }), source: "relative" };
  }
  // A heading on the page ("guidance on the various parameters for FY '26:") carries to the lines under it.
  const ctx = periodMentions(before).filter((m) => m.p.kind === "fy" && endOrd(m.p) > reported && !/^(from|vs\.?|versus|than|since|over)$/.test(m.prep));
  if (ctx.length) return { horizon: periodLabel(ctx[ctx.length - 1].p), source: "context" };
  if (parsed === "multi") return { horizon: "Medium term", source: "model" };
  if (model) {
    if (endOrd(model) <= reported) return null;                        // about a period already reported: not a promise
    if (model.kind !== "fy" || model.fy === call.inProgress) return { horizon: periodLabel(model), source: "model" };
  }
  // Nothing in the quote or the page names a period: an earnings call's guidance is for the year in progress.
  return { horizon: `FY${yy(call.inProgress)}`, source: "default" };
}

function parseModel(h: string | null | undefined): Period | "multi" | null {
  const t = (h ?? "").trim();
  if (!t) return null;
  if (/medium|long|multi|years|cagr/i.test(t) && !/FY\s*\d/i.test(t)) return "multi";
  const ms = periodMentions(t);
  if (ms.length === 1 && !ms[0].span) return ms[0].p;
  if (ms.length && ms[0].span) return "multi";
  return null;
}

const COMPARE_PREP = /^(from|vs\.?|versus|than|since|with|against|over)$/;
const COMPARE_BEFORE = /\b(?:compared (?:to|with)|as against|in line with|versus|vs\.?|from|against|than|over)\b(?:[^.;]|\.(?=\d)){0,30}$/i;

/** The period a reported number is for. Actuals are never for a period after the call's own quarter. */
export function resolveKpiPeriod(k: Pick<KpiIn, "quote" | "period">, call: CallRef): string {
  const reported = ord(call.fy, call.q);
  const own: Period = { kind: "quarter", fy: call.fy, q: call.q };
  if (/\b(?:9|nine)[- ]?months?\b|\b9M\b/i.test(k.quote)) return `9M FY${yy(call.fy)}`;
  // The period the number is for comes first ("Order inflows in Q4 FY26 stood at ..., in line with Q4 FY25").
  const past = periodMentions(k.quote).filter((m) => endOrd(m.span ?? m.p) <= reported && !m.span)
    .filter((m) => !COMPARE_PREP.test(m.prep) && !COMPARE_BEFORE.test(k.quote.slice(Math.max(0, m.start - 40), m.start)));
  if (past.length) return periodLabel(past[0].p);
  if (/\b(?:full[- ]year|for the year|the fiscal year|the financial year|this year)\b/i.test(k.quote) && call.q === 4) return `FY${yy(call.fy)}`;
  if (/\b(?:first half|H1)\b/i.test(k.quote) && call.q === 2) return `H1 FY${yy(call.fy)}`;
  const bases = new Set(periodMentions(k.quote).filter((m) => COMPARE_PREP.test(m.prep) || COMPARE_BEFORE.test(k.quote.slice(Math.max(0, m.start - 40), m.start))).map((m) => periodLabel(m.p)));
  const bare = /\bQ([1-4])\b(?!\s*(?:of\s+)?(?:FY|fiscal|financial))/gi;
  for (let m = bare.exec(k.quote); m; m = bare.exec(k.quote)) {
    const label = `Q${m[1]} FY${yy(Number(m[1]) <= call.q ? call.fy : call.fy - 1)}`;
    if (COMPARE_BEFORE.test(k.quote.slice(Math.max(0, m.index - 40), m.index))) { bases.add(label); continue; }
    if (Number(m[1]) <= call.q) return label;
  }
  const qn = k.quote.match(/\b(June|September|December|March)\s+quarter\b/i);
  if (qn) {
    const qi = QUARTER_END[qn[1].toLowerCase()];
    return `Q${qi} FY${yy(qi <= call.q ? call.fy : call.fy - 1)}`;
  }
  const model = parseModel(k.period);
  // The model's period stands unless it is past the call or is the quote's comparison base.
  if (model && model !== "multi" && endOrd(model) <= reported && !bases.has(periodLabel(model)) && !/\b(?:the|this) quarter\b/i.test(k.quote)) return periodLabel(model);
  return periodLabel(own);
}

// ---------- Scope: the whole company or a part of it ----------

const COMPANY = /\b(?:group|consolidated|overall|company[- ]wide|company level|whole company|total company|entire company|for the company)\b/i;
const SEGMENT_NAMED: [RegExp, string][] = [
  [/\bP\s?&\s?M\b|\bprojects\s*(?:&|and)\s*manufacturing\b/i, "Projects and Manufacturing portfolio"],
  [/\bPP\s?&\s?M\b|\bPPM\b|\bprojects,?\s*products\s*(?:&|and)\s*manufacturing\b/i, "Projects, Products and Manufacturing portfolio"],
  [/\bFMEG\b/i, "FMEG business"],
  [/\bwires?\s*(?:&|and)\s*cables?\b|\bW\s?&\s?C\b/i, "wires and cables business"],
  [/\bMSME\b/i, "MSME business"],
  [/\bgold loans?\b/i, "gold loan business"],
  [/\bquick commerce\b|\bblinkit\b/i, "quick commerce business"],
  [/\bfood delivery\b/i, "food delivery business"],
  [/\bon a stand-?alone basis\b|\bstand-?alone (?:revenue|margins?|profit|entity|numbers|financials)\b/i, "standalone entity"],
  [/\bdomestic\b/i, "domestic business"],
  [/\bexports?\b|\binternational business\b/i, "export business"],
];
const SEGMENT_GENERIC = /\b(?:segment|division|vertical|SBU|this business|that business|the business segment|core business)\b|\b(?!(?:loan|credit|lending|total|overall|entire|whole|our|the|investment|order)\b)[A-Za-z&]{2,}\s+portfolio\b/i;

function segmentIn(text: string): string | null {
  for (const [re, label] of SEGMENT_NAMED) if (re.test(text)) return label;
  const g = text.match(SEGMENT_GENERIC);
  return g ? "segment" : null;
}

/** Sentences of `before`, last first: the two lines leading into a quote set its subject. */
function lastSentences(before: string, n: number): string {
  const parts = before.replace(/\s+/g, " ").split(/(?<=[.!?:])\s+(?=[A-Z])/);
  return parts.slice(-n).join(" ");
}

/** Words that tie a lead-in sentence to the same measure as the promise. */
const FAMILY: [RegExp, RegExp][] = [
  [/margin/, /margin|EBITDA|EBIT\b|profitability/i],
  [/revenue|sales|growth$/, /revenue|top ?line|sales|grow/i],
  [/pat|profit/, /profit|PAT\b|earnings/i],
  [/aum/, /AUM|assets under management|book|loans?\b/i],
  [/store|branch/, /store|branch|outlet/i],
  [/ebitda$/, /EBITDA/i],
];
/** "On Working Capital, ...", "Coming to revenue, ...": the quote opens a new subject. */
const NEW_SUBJECT = /^\s*(?:(?:and|lastly|finally|now)[, ]+)?(?:on|coming to|moving to|turning to|regarding|as for|as regards|with respect to|in terms of)\b[^,]{2,60},/i;

export function scopeOf(quote: string, label: string, before = "", metric = ""): Scope {
  const own = `${quote} ${label}`;
  if (COMPANY.test(own)) return { scope: "company" };
  const seg = segmentIn(own);
  const lead = NEW_SUBJECT.test(quote) ? "" : lastSentences(before, 2);
  const leadNamed = (() => {
    if (!lead || COMPANY.test(lead)) return null;
    const fam = FAMILY.find(([k]) => k.test(metric))?.[1];
    if (!fam || !fam.test(lead)) return null;
    for (const [re, l] of SEGMENT_NAMED) if (re.test(lead)) return l;
    return null;
  })();
  if (seg) return { scope: "segment", label: seg === "segment" && leadNamed ? leadNamed : seg };
  return leadNamed ? { scope: "segment", label: leadNamed } : { scope: "company" };
}

// ---------- Metric keys ----------

const slug = (s: string) => s.toLowerCase().replace(/<|>/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

/** Remap metric keys the quote does not support ("net_debt" for working capital, "ebitda_margin" for ROA).
 *  Names are read from the model's own label and key first: one quote often lists several targets. */
export function fixMetric(metric: string, label: string, quote: string, lender: boolean): string {
  let m = metric.trim();
  if (m.startsWith("other:")) {
    const rest = slug(m.slice(6));
    m = rest ? `other:${rest}` : `other:${slug(label.replace(/[\d.,%]+/g, " ")).split("_").slice(0, 4).join("_")}`;
  }
  const named = (text: string): string | null => {
    if (/working[- ]capital|\bNWC\b/i.test(text)) return "working_capital";
    if (/\bcost of (?:funds|borrowing)\b/i.test(text)) return "other:cost_of_funds";
    if (/\bROA\b|return on (?:average )?assets/i.test(text) && !/\bROE\b|return on (?:average )?equity/i.test(text)) return "other:roa";
    if (/\bROE\b|return on (?:average )?equity/i.test(text) && !/\bROA\b|return on (?:average )?assets/i.test(text)) return "other:roe";
    if (/\bopex[- ]to[- ](?:NTI|net total income)\b/i.test(text)) return "other:opex_to_nti";
    return null;
  };
  const own = `${label} ${m.replace(/^other:/, "").replace(/_/g, " ")}`;
  const text = `${label} ${quote}`;
  const byName = named(own);
  if (byName) return byName;
  if (/\b(?:NOV|GOV|GMV)\b/.test(text) && /^(revenue|revenue_growth|ebitda|ebitda_margin)$/.test(m)) {
    if (/margin/i.test(text)) return "other:margin_on_nov";
    return /grow|CAGR/i.test(text) ? "other:nov_growth" : "other:nov";
  }
  if (/\bcustomer/i.test(text) && /^(store_count|customer_count|customer_franchise|other:customer.*|other:new_customers.*)$/.test(m)) {
    return /\b(?:add|adding|added|new customers|acquire|acquisition)\b/i.test(text) ? "customer_additions" : "customer_franchise";
  }
  if (/\bfranchise\b/i.test(text) && m === "store_count") return "customer_franchise";
  if (lender && m === "revenue_growth" && /\bAUM\b|assets under management|loan book|book growth/i.test(text)) return "aum_growth";
  const need: Record<string, RegExp> = {
    net_debt: /debt|borrowing|leverage|net cash|cash surplus|gearing/i,
    ebitda_margin: /margin|EBITDA|EBIT\b|operating profit/i,
    ebit_margin: /margin|EBIT|operating/i,
    nim: /\bNIM\b|net interest margin|spread/i,
    store_count: /store|branch|outlet|location|shop|showroom|touch ?point/i,
    capex: /capex|capital expenditure|invest|spend/i,
    order_inflow: /order|inflow|deal|booking|TCV/i,
    order_inflow_growth: /order|inflow|deal|booking|TCV/i,
    gnpa: /GNPA|gross NPA|stage 3|stage iii|non[- ]performing/i,
    credit_cost: /credit cost|loan loss|provision|impairment/i,
  };
  if (need[m] && !need[m].test(text)) {
    const fromQuote = named(quote);
    if (fromQuote) return fromQuote;
    if (/\bloss(?:es)?\b/i.test(text)) return "other:losses";
    return `other:${slug(label.replace(/[\d.,%₹$]+|\b(?:rs|inr|cr|crore|bps|basis points?)\b/gi, " ")).split("_").filter(Boolean).slice(0, 4).join("_") || "target"}`;
  }
  return m;
}

// ---------- Amounts and units ----------

const SCALE_CR: Record<string, number> = { "lakh crore": 100_000, "lakh crores": 100_000, "trillion": 100_000, "tn": 100_000, "billion": 100, "bn": 100, "million": 0.1, "mn": 0.1, "crore": 1, "crores": 1, "cr": 1, "lakh": 0.01, "lakhs": 0.01 };
const AMOUNT = /(\$|US\$|USD|Rs\.?|INR|₹)?\s*([\d][\d,]*(?:\.\d+)?)\s*(lakh crores?|trillion|tn|billion|bn|million|mn|crores?|cr|lakhs?)\b/gi;
const COUNT_SCALE: Record<string, number> = { million: 1e6, mn: 1e6, mm: 1e6, billion: 1e9, bn: 1e9 };

const num = (s: string) => Number(s.replace(/,/g, ""));

export interface AmountFix { low: number | null; high: number | null; unit: GuidanceIn["unit"]; text: string | null }

const COUNTLIKE = /^(customer_|store_count|capacity|other:(?:new_)?(?:loans?|customers?|branches|stores|users|subscribers|employees|clients))/;
const CURRENCY_NEAR = /(?:\$|US\$|USD|Rs\.?|INR|₹)\s*[\d]|\b(?:crores?|cr)\b/i;

/** Re-derive money and count targets from the quote's own words ("Rs 1,356 billion" is ₹1,35,600 cr). */
export function fixAmounts(lo: number | null, hi: number | null, unit: GuidanceIn["unit"], quote: string, metric: string): AmountFix {
  const vals = [lo, hi];
  const countLike = unit === "count" || COUNTLIKE.test(metric);
  if (!countLike && (unit === "cr" || (unit === "other" && CURRENCY_NEAR.test(quote)))) {
    const found: { v: number; scale: number; usd: boolean; raw: string }[] = [];
    AMOUNT.lastIndex = 0;
    for (let m = AMOUNT.exec(quote); m; m = AMOUNT.exec(quote)) {
      found.push({ v: num(m[2]), scale: SCALE_CR[m[3].toLowerCase()] ?? 1, usd: !!m[1] && /\$|USD/i.test(m[1]), raw: m[0].trim() });
    }
    // A bare number before "to ₹16 billion" shares its scale: "₹ 12 billion - ₹ 16 billion", "60 to 80 billion".
    const ranged = quote.match(/([\d][\d,]*(?:\.\d+)?)\s*(?:to|-|–)\s*(?:Rs\.?|INR|₹|\$)?\s*([\d][\d,]*(?:\.\d+)?)\s*(lakh crores?|trillion|tn|billion|bn|million|mn|crores?|cr|lakhs?)\b/i);
    if (ranged) found.push({ v: num(ranged[1]), scale: SCALE_CR[ranged[3].toLowerCase()] ?? 1, usd: /\$|USD/i.test(quote.slice(Math.max(0, (ranged.index ?? 0) - 4), (ranged.index ?? 0) + 2)), raw: ranged[0] });
    const hits = found.filter((f) => vals.some((v) => v !== null && Math.abs(f.v - v) < 1e-9));
    if (hits.length) {
      if (hits.some((f) => f.usd)) return { low: lo, high: hi, unit: "other", text: hits.filter((f) => f.usd).map((f) => f.raw).join(" to ") };
      const out = vals.map((v) => {
        if (v === null) return v;
        const hit = hits.find((f) => Math.abs(f.v - v) < 1e-9);
        return hit ? round(v * hit.scale) : v;
      });
      return { low: out[0], high: out[1], unit: "cr", text: null };
    }
    return { low: lo, high: hi, unit, text: null };
  }
  if (countLike) {
    const scaled = new Map<number, number>();
    const range = /([\d][\d,]*(?:\.\d+)?)\s*(?:MM|mn|million)?\s*(?:to|-|–)\s*([\d][\d,]*(?:\.\d+)?)\s*(million|mn|MM|billion|bn)\b/gi;
    for (let m = range.exec(quote); m; m = range.exec(quote)) { const s = COUNT_SCALE[m[3].toLowerCase()]; scaled.set(num(m[1]), s); scaled.set(num(m[2]), s); }
    const single = /([\d][\d,]*(?:\.\d+)?)\s*(million|mn|MM|billion|bn)\b/gi;
    for (let m = single.exec(quote); m; m = single.exec(quote)) scaled.set(num(m[1]), COUNT_SCALE[m[2].toLowerCase()]);
    const conv = vals.map((v) => (v !== null && scaled.has(v) ? v * scaled.get(v)! : v));
    return { low: conv[0], high: conv[1], unit: "count", text: null };
  }
  return { low: lo, high: hi, unit, text: null };
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Every target number must be in the quote or its label (allowing ₹ scale words and % vs bps). */
export function grounded(lo: number | null, hi: number | null, quote: string, label: string): boolean {
  const text = `${quote} ${label}`;
  const nums = (text.match(/\d[\d,]*(?:\.\d+)?|\.\d+/g) ?? []).map(num).filter(Number.isFinite);
  const scales = [1, 100, 0.01, 0.1, 10, 100_000, 1e6, 1e9, 1e7, 1e5];
  return [lo, hi].every((v) => v === null || nums.some((n) => scales.some((s) => Math.abs(n * s - v) <= Math.max(1e-9, Math.abs(v) * 1e-6))));
}

const ANALYST = /\byou(?:'ve|'re| have| had| are| were)?\s+(?:mentioned|said|guided|guiding|indicated|talked|maintained|given|spoken|planned|plan to|targeted|promised|stated)\b|\byour\s+(?:guidance|target|outlook|plan|estimate)/i;
/** Analysts restating guidance ("you have mentioned that you plan to ...") are not management's promise. */
export const analystVoice = (quote: string) => ANALYST.test(quote);

/** A YoY growth number, not a sequential one: "grew 2.2% sequentially and 2.9% year-on-year". */
export function isSequential(value: number, quote: string): boolean {
  const re = new RegExp(String.raw`(?<![\d.])${String(value).replace(".", "\\.")}(?:\.0)?\s*%[^%.;]{0,28}?\b(sequential(?:ly)?|q-?o-?q|q-on-q|quarter[- ]on[- ]quarter)\b`, "i");
  const yoy = new RegExp(String.raw`(?<![\d.])${String(value).replace(".", "\\.")}(?:\.0)?\s*%[^%.;]{0,28}?\b(y-?o-?y|y-on-y|year[- ]on[- ]year|year[- ]over[- ]year)\b`, "i");
  return re.test(quote) && !yoy.test(quote);
}

/** The text on a page before a quote (whitespace-collapsed), or "" when the quote is not found. */
export function textBefore(quote: string, page: string, max = 1200): string {
  const p = page.replace(/\s+/g, " ");
  const lower = p.toLowerCase();
  const words = quote.replace(/\s+/g, " ").trim().toLowerCase().split(" ");
  for (let i = 0; i + 4 <= words.length && i < 6; i++) {
    const probe = words.slice(i, i + 6).join(" ");
    const at = lower.indexOf(probe);
    if (at >= 0) return p.slice(Math.max(0, at - max), at);
  }
  return "";
}

// ---------- The passes ----------

export interface NormalizeOpts {
  lender: boolean;
  /** Text on the quote's page before the quote, for headings and the subject of the paragraph. */
  before?: (g: { doc_id: number; page: number; quote: string }) => string;
}

export interface GuidanceOut extends GuidanceIn { scope: Scope; horizon_source: string; target_text_raw: string | null; checks: string[] }

export function normalizeGuidance(items: GuidanceIn[], opts: NormalizeOpts): GuidanceOut[] {
  const out = normalizeEach(items, opts);
  // The same promise restated without its subject ("8–10% by FY30" after "FMEG margins of 8–10% by FY30")
  // keeps the subject: same metric, horizon and numbers as a segment-scoped statement.
  const key = (g: GuidanceOut) => `${g.metric}|${g.horizon}|${g.target_low}|${g.target_high}`;
  const seg = new Map<string, Scope>();
  for (const g of out) if (g.scope.scope === "segment" && g.direction !== "qualitative") seg.set(key(g), g.scope);
  for (const g of out) {
    const s = g.scope.scope === "company" && !COMPANY.test(`${g.quote} ${g.label_raw}`) ? seg.get(key(g)) : undefined;
    if (s) { g.scope = s; g.checks.push(`scope from the same target in another call`); }
  }
  return out;
}

function normalizeEach(items: GuidanceIn[], opts: NormalizeOpts): GuidanceOut[] {
  const out: GuidanceOut[] = [];
  for (const g of items) {
    if (analystVoice(g.quote)) continue;
    const call = callRef(g.said_period, g.said_on);
    const before = opts.before?.(g) ?? "";
    const checks: string[] = [];
    const h = resolveHorizon(g, call, before);
    if (!h) continue;
    if (h.horizon !== (g.horizon ?? "").trim()) checks.push(`horizon ${g.horizon || "none"} -> ${h.horizon} (${h.source})`);
    const metric = fixMetric(g.metric, g.label_raw, g.quote, opts.lender);
    if (metric !== g.metric) checks.push(`metric ${g.metric} -> ${metric}`);
    let { target_low: lo, target_high: hi, direction } = g;
    let unit = g.unit;
    let raw: string | null = null;
    if (direction !== "qualitative" && (lo !== null || hi !== null)) {
      if (!grounded(lo, hi, g.quote, g.label_raw)) {
        checks.push("target not in the quote");
        lo = null; hi = null; direction = "qualitative";
      } else {
        const a = fixAmounts(lo, hi, unit, g.quote, metric);
        if (a.low !== lo || a.high !== hi || a.unit !== unit) checks.push(`amount ${lo}-${hi} ${unit} -> ${a.low}-${a.high} ${a.unit}`);
        lo = a.low; hi = a.high; unit = a.unit; raw = a.text;
      }
    }
    let scope = scopeOf(g.quote, g.label_raw, before, metric);
    if (scope.scope === "segment" && metricNames(metric, scope.label)) scope = { scope: "company" };
    out.push({ ...g, metric, horizon: h.horizon, target_low: lo, target_high: hi, unit, direction, scope, horizon_source: h.source, target_text_raw: raw, checks });
  }
  return out;
}

/** "other:fmeg_growth" already says FMEG; "other:export_contribution" already says exports. */
function metricNames(metric: string, scopeLabel: string): boolean {
  const first = scopeLabel.split(/\s+/)[0].toLowerCase().replace(/s$/, "");
  return first.length > 2 && metric.toLowerCase().includes(first);
}

export interface KpiOut extends KpiIn { scope: Scope }

export function normalizeKpis(items: KpiIn[], opts: NormalizeOpts & { periods: Map<number, string> }): KpiOut[] {
  const out: KpiOut[] = [];
  for (const k of items) {
    if (analystVoice(k.quote)) continue;
    const said = opts.periods.get(k.doc_id) ?? "";
    const call = callRef(said, k.said_on);
    let metric = fixMetric(k.metric, "", k.quote, opts.lender);
    if (/_growth$/.test(metric) && isSequential(k.value, k.quote)) metric = `${metric}_qoq`;
    const a = fixAmounts(k.value, null, k.unit as GuidanceIn["unit"], k.quote, metric);
    out.push({ ...k, metric, value: a.low ?? k.value, unit: a.unit, period: resolveKpiPeriod(k, call), scope: scopeOf(k.quote, "", "", metric) });
  }
  return out;
}
