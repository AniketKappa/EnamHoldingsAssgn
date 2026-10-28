// USD per 1M tokens on paid tiers (providers' pricing pages, Oct 2026).
// FINN runs on free tiers; these numbers only power the cost page's
// "what this would cost if we paid" estimate.
const PRICES: Record<string, { in: number; out: number }> = {
  "gemini-3.8-flash": { in: 0.75, out: 3.75 },
  "gemini-3.6-flash": { in: 0.75, out: 3.75 },
  "gemini-3.5-flash": { in: 0.75, out: 3.75 },
  "gemini-3.5-flash-lite": { in: 0.3, out: 2.5 },
  "gemini-3.1-flash-lite": { in: 0.25, out: 1.5 },
  "gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
  "gemini-2.5-pro": { in: 1.25, out: 10 },
  "openai/gpt-oss-20b": { in: 0.075, out: 0.3 },
  "openai/gpt-oss-120b": { in: 0.15, out: 0.6 },
};

export function estimateCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICES[model] ?? PRICES["gemini-3.6-flash"];
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}
