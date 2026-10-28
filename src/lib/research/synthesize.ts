// The one strong-model call per dossier (spec 6.6). It never sees raw
// documents: only compact JSON of facts, the ledger, extracts and concerns.
// Code then checks every cite and every number; failing bullets are dropped.
import { llm } from "../llm/router";
import { Synthesis, type SynthesisT } from "../llm/schemas";
import type { Fact } from "./facts";
import { bannedWordsIn, citeExists, numbersGrounded, stripUrls, type GroundingContext } from "./validate";
import type { Cited } from "./types";

const PROMPT = (company: string, input: string) => `Write the research summary of ${company} for a concentrated public-markets investor.
Use only the facts, ledger and extracts below; do not use any outside knowledge of the company.
Every bullet cites at least one input id exactly as given (fact:<key> or doc:<id>:p<n>). Numbers carry units and must come from the inputs.
At most 25 words per bullet. Plain verbs, numbers first. Never use: robust, significant, notably, impressive, strong, delve, landscape.
Produce: what_matters_now (3 bullets: the few things that matter for the thesis today), bull (3), bear (3),
and seed_questions (3 questions an investor would ask next that these documents can answer).

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

export function compactInput(i: SynthesisInput): string {
  const facts = Object.values(i.facts).map((f) => `fact:${f.key} = ${f.label} ${f.value}${f.unit === "pct" ? "%" : f.unit === "cr" ? " cr" : f.unit === "bps" ? " bps" : f.unit === "x" ? "x" : f.unit === "days" ? " days" : ""} (${f.period})`);
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
    const text = stripUrls(b.text);
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
