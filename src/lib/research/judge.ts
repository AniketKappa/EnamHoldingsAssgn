// Narrative vs numbers: management's qualitative claims, judged by a mid-tier
// model against the computed facts only. Code keeps a verdict only when its
// evidence cites real facts and its numbers match them.
import { llm } from "../llm/router";
import { LedgerJudge } from "../llm/schemas";
import type { Fact } from "./facts";
import type { Judged } from "./types";
import { citeExists, numbersGrounded, stripUrls, type GroundingContext } from "./validate";

const PROMPT = `For each management claim below, decide whether the financial facts agree with it, diverge from it, or whether it is too early to tell.
Use only the facts given. The evidence is one sentence of at most 30 words that quotes numbers from the facts, with their fact ids in cites.
Never use: robust, significant, notably, impressive, strong, delve, landscape.`;

export async function judgeClaims(
  claims: { id: number; claim: string; quote: string; cite: string }[],
  facts: Record<string, Fact>,
  ctx: GroundingContext,
  ref: string,
): Promise<Judged[]> {
  if (!claims.length) return [];
  const factLines = Object.values(facts).map((f) => `fact:${f.key} = ${f.label} ${f.value} ${f.unit} (${f.period})`).join("\n");
  const claimLines = claims.map((c) => `[${c.id}] ${c.claim} (said: "${c.quote}")`).join("\n");
  const out = await llm({ task: "ledger_judge", prompt: `${PROMPT}\n\nFacts:\n${factLines}\n\nClaims:\n${claimLines}`, schema: LedgerJudge, ref });
  const res: Judged[] = [];
  for (const item of out.data.items) {
    const c = claims.find((x) => x.id === item.claim_id);
    if (!c) continue;
    const cites = item.cites.map((x) => (x.startsWith("fact:") ? x : `fact:${x}`)).filter((x) => citeExists(x, ctx));
    const evidence = stripUrls(item.evidence);
    if (item.verdict !== "too_early" && !cites.length) continue;
    if (!numbersGrounded(evidence, cites, ctx).ok) continue;
    res.push({ id: c.id, claim: c.claim, quote: c.quote, cite: c.cite, verdict: item.verdict, evidence, cites });
  }
  return res;
}
