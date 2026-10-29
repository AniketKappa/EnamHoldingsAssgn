// The one strong-model call per dossier (spec 6.6). It never sees raw
// documents: only compact JSON of facts, the ledger, extracts and concerns.
// Code then checks every cite and every number; failing bullets are dropped.
import { llm } from "../llm/router";
import { Synthesis, type SynthesisT } from "../llm/schemas";
import type { Fact } from "./facts";
import { bannedWordsIn, citeExists, numbersGrounded, stripUrls, type GroundingContext } from "./validate";
import type { Cited } from "./types";

const PROMPT = (company: string, input: string) => `Write the research summary of ${company} for a concentrated public-markets investor deciding whether to own it.
Use only the facts, ledger and extracts below; do not use any outside knowledge of the company.
Each bullet is one sentence of at most 25 words: the subject first, plain verbs, the numbers inside the sentence.
For example: "Revenue grew 15.8% YoY to ₹78,750 cr in Q2 FY27, but EBITDA margin fell 133 bps to 11.2%."
Write numbers the way the inputs show them: ₹78,750 cr, 11.6%, 133 bps, 1.24×. Numbers must come from the inputs.
Every bullet cites at least one input id exactly as given (fact:<key> or doc:<id>:p<n>).
what_matters_now (3 bullets): the latest results and what management promised against what it delivered (the ledger's delivered, missed and revised targets).
bull (3) and bear (3): reasons to own or avoid the stock, each tied to a number: growth, margins, cash conversion, balance sheet, the guidance record, risks management names. Use each number once.
seed_questions (3): questions an investor would ask next that the call transcripts and annual report can answer.
Never use: robust, significant, notably, impressive, strong, delve, landscape.

Inputs:
${input}`;

export interface SynthesisInput {
  company: string;
  facts: Record<string, Fact>;
  ledger: { id: number; call: string; metric: string; target: string; horizon: string; status: string; actual: string | null; cite: string; actual_cite: string | null }[];
  credibility: string | null;
  business: { description: string | null; segments: string[]; risks: string[]; cites: string[] };
  auditor: string | null;
  concerns: { topic: string; summary: string; cite: string }[];
  claims: { claim: string; verdict: string; evidence: string; cite: string }[];
  flags: string[];
}

/** A fact as an Indian investor reads it: ₹78,750 cr, 11.6%, −133 bps, 1.24×. */
export function factText(f: Fact): string {
  const v = f.value;
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  const grouped = abs.toLocaleString("en-IN", { maximumFractionDigits: abs >= 100 ? 0 : 2 });
  switch (f.unit) {
    case "cr": return `${sign}₹${grouped} cr`;
    case "rs": return `${sign}₹${grouped}`;
    case "pct": return `${sign}${grouped}%`;
    case "bps": return `${sign}${grouped} bps`;
    case "x": return `${sign}${grouped}×`;
    case "days": return `${sign}${grouped} days`;
    default: return `${sign}${grouped}`;
  }
}

/**
 * Safety net for the writer's output: bare crore figures get the rupee sign and
 * Indian grouping, and "1.24x" becomes "1.24×". Values are unchanged, so number
 * grounding still holds.
 */
export function formatNumbers(text: string): string {
  return text
    .replace(/(?:₹|Rs\.?\s?|INR\s?)?(\d{1,3}(?:,\d{2,3})+|\d{4,})(\.\d+)?\s?(?:cr|crore)\b/gi, (_m, int: string, dec: string | undefined) =>
      `₹${Number(int.replace(/,/g, "")).toLocaleString("en-IN")}${dec ?? ""} cr`)
    .replace(/(\d(?:\.\d+)?)x\b/g, "$1×");
}

export function compactInput(i: SynthesisInput): string {
  const facts = Object.values(i.facts).map((f) => `fact:${f.key} = ${f.label} ${factText(f)} (${f.period})`);
  return JSON.stringify({
    facts,
    say_vs_do: { credibility: i.credibility, items: i.ledger },
    business: i.business,
    auditor: i.auditor,
    analyst_concerns: i.concerns,
    narrative_checks: i.claims,
    flags: i.flags,
  });
}

function validBullets(list: { text: string; cites: string[] }[], ctx: GroundingContext, log: string[]): Cited[] {
  const out: Cited[] = [];
  for (const b of list) {
    const cites = b.cites.filter((c) => citeExists(c, ctx));
    if (!cites.length) { log.push(`dropped (no valid cite): ${b.text}`); continue; }
    const text = formatNumbers(stripUrls(b.text));
    const g = numbersGrounded(text, cites, ctx);
    if (!g.ok) { log.push(`dropped (ungrounded ${g.bad.join(", ")}): ${text}`); continue; }
    out.push({ text, cites });
  }
  return out;
}

export async function synthesize(input: SynthesisInput, ctx: GroundingContext, ref: string): Promise<{
  what_matters_now: Cited[]; bull: Cited[]; bear: Cited[]; seed_questions: string[]; dropped: number; log: string[]; model: string;
}> {
  const prompt = PROMPT(input.company, compactInput(input));
  let out = await llm({ task: "synthesize", prompt, schema: Synthesis, ref });
  let data: SynthesisT = out.data;
  const allText = (d: SynthesisT) => [...d.what_matters_now, ...d.bull, ...d.bear].map((b) => b.text).join(" ") + " " + d.seed_questions.join(" ");
  const banned = bannedWordsIn(allText(data));
  if (banned.length) {
    out = await llm({ task: "synthesize", prompt: `${prompt}\n\nYour previous draft used banned words (${banned.join(", ")}). Rewrite without them.`, schema: Synthesis, ref, noCache: true });
    data = out.data;
  }
  const log: string[] = [];
  const w = validBullets(data.what_matters_now, ctx, log);
  const bull = validBullets(data.bull, ctx, log);
  const bear = validBullets(data.bear, ctx, log);
  const qs = data.seed_questions.map((q) => stripUrls(q)).filter((q) => q.length > 8 && q.length < 140 && !bannedWordsIn(q).length).slice(0, 3);
  const total = data.what_matters_now.length + data.bull.length + data.bear.length;
  return { what_matters_now: w, bull, bear, seed_questions: qs, dropped: total - (w.length + bull.length + bear.length), log, model: out.model };
}
