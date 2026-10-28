// The only way any FINN code calls a model. Routing by task tier, content-hash
// caching, schema validation with one corrective retry, provider fallback, and
// a row in llm_calls for every attempt (that table powers the cost page).
import { createHash } from "node:crypto";
import { GoogleGenAI, ThinkingLevel, type Part } from "@google/genai";
import type { z } from "zod";
import { env } from "../env";
import { db, hasDb } from "../db";
import { estimateCostUsd } from "./pricing";
import { toGeminiSchema } from "./schemas";

export type Tier = "t1" | "t2" | "t3" | "grounded";

interface TaskConfig {
  tier: Tier;
  temperature: number;
  thinking: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
  maxOutputTokens: number;
  version: number; // bump when the prompt changes to invalidate the cache
}

export const TASKS: Record<string, TaskConfig> = {
  classify_batch: { tier: "t1", temperature: 0.1, thinking: "MINIMAL", maxOutputTokens: 4000, version: 1 },
  one_liners_batch: { tier: "t1", temperature: 0.2, thinking: "MINIMAL", maxOutputTokens: 6000, version: 1 },
  parse_rule: { tier: "t1", temperature: 0.1, thinking: "MINIMAL", maxOutputTokens: 1200, version: 1 },
  person_structure: { tier: "t1", temperature: 0.1, thinking: "MINIMAL", maxOutputTokens: 2500, version: 1 },
  brief_script: { tier: "t1", temperature: 0.4, thinking: "MINIMAL", maxOutputTokens: 1200, version: 1 },
  results_extract: { tier: "t2", temperature: 0.0, thinking: "LOW", maxOutputTokens: 6000, version: 1 },
  people_extract: { tier: "t2", temperature: 0.1, thinking: "LOW", maxOutputTokens: 4000, version: 1 },
  transcript_extract: { tier: "t2", temperature: 0.1, thinking: "LOW", maxOutputTokens: 16000, version: 1 },
  ar_extract: { tier: "t2", temperature: 0.1, thinking: "LOW", maxOutputTokens: 8000, version: 1 },
  ledger_judge: { tier: "t2", temperature: 0.1, thinking: "MEDIUM", maxOutputTokens: 6000, version: 1 },
  ask: { tier: "t2", temperature: 0.2, thinking: "LOW", maxOutputTokens: 2500, version: 1 },
  synthesize: { tier: "t3", temperature: 0.3, thinking: "HIGH", maxOutputTokens: 12000, version: 1 },
  person_background: { tier: "grounded", temperature: 0.2, thinking: "LOW", maxOutputTokens: 3000, version: 1 },
};

export interface LlmRequest<T> {
  task: keyof typeof TASKS | string;
  system?: string;
  prompt: string;
  parts?: Part[];             // e.g. an inline PDF
  schema?: z.ZodType<T>;
  tools?: "google_search";
  ref?: string;               // what this call is about (announcement id, symbol)
  noCache?: boolean;
}

export interface LlmResult<T> {
  data: T;
  text: string;
  model: string;
  cached: boolean;
  tokensIn: number;
  tokensOut: number;
  sources?: { title: string; url: string }[];
  /** For grounded calls: which answer segments each source supports (indexes into sources). */
  supports?: { text: string; sources: number[] }[];
}

type MockFn = (req: LlmRequest<unknown>) => unknown | Promise<unknown>;
let mock: MockFn | null = null;
/** Tests replace model calls with a deterministic function. */
export function setMockLlm(fn: MockFn | null) { mock = fn; }

let gemini: GoogleGenAI | null = null;
function geminiClient(): GoogleGenAI {
  if (!gemini) {
    const apiKey = env.geminiKey();
    if (!apiKey) throw new LlmUnavailable("GEMINI_API_KEY is not set");
    gemini = new GoogleGenAI({ apiKey });
  }
  return gemini;
}

export class LlmUnavailable extends Error {}

function chainFor(tier: Tier): string[] {
  switch (tier) {
    case "t1": return [...env.models.t1(), ...(env.groqKey() ? [`groq:${env.models.groqT1()}`] : [])];
    case "t2": return env.models.t2();
    case "t3": return env.models.t3();
    case "grounded": return env.models.grounded();
  }
}

function hashKey(parts: unknown[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(typeof p === "string" ? p : JSON.stringify(p ?? null)).update("\u0001");
  return h.digest("hex");
}

function partsDigest(parts?: Part[]): string {
  if (!parts?.length) return "";
  const h = createHash("sha256");
  for (const p of parts) {
    if (p.inlineData?.data) h.update(p.inlineData.data);
    else if (p.text) h.update(p.text);
  }
  return h.digest("hex");
}

async function logCall(row: {
  task: string; model: string; provider: string; tokensIn: number; tokensOut: number; latency: number;
  ok: boolean; cacheHit: boolean; error?: string; ref?: string;
}) {
  if (!hasDb()) return;
  try {
    await db()`insert into llm_calls (task, model, provider, tokens_in, tokens_out, latency_ms, ok, cache_hit, cost_usd_est, error, ref)
      values (${row.task}, ${row.model}, ${row.provider}, ${row.tokensIn}, ${row.tokensOut}, ${row.latency}, ${row.ok},
      ${row.cacheHit}, ${row.cacheHit ? 0 : estimateCostUsd(row.model, row.tokensIn, row.tokensOut)}, ${row.error ?? null}, ${row.ref ?? null})`;
  } catch {
    // Logging must never break the pipeline.
  }
}

function parseJsonLoose(text: string): unknown {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* fall through */ } }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new Error("Model did not return JSON");
}

function thinkingFor(model: string, level: TaskConfig["thinking"]) {
  if (model.startsWith("gemini-2.5")) {
    const pro = model.includes("pro");
    const budget = { MINIMAL: pro ? 128 : 0, LOW: 1024, MEDIUM: 4096, HIGH: 12000 }[level];
    return { thinkingBudget: budget };
  }
  return { thinkingLevel: ThinkingLevel[level] };
}

async function callGemini(model: string, req: LlmRequest<unknown>, cfg: TaskConfig, extraInstruction?: string) {
  const schema = req.schema && req.tools !== "google_search" ? toGeminiSchema(req.schema) : undefined;
  const res = await geminiClient().models.generateContent({
    model,
    contents: [{ role: "user", parts: [...(req.parts ?? []), { text: extraInstruction ? `${req.prompt}\n\n${extraInstruction}` : req.prompt }] }],
    config: {
      systemInstruction: req.system,
      temperature: cfg.temperature,
      maxOutputTokens: cfg.maxOutputTokens,
      ...(schema ? { responseMimeType: "application/json", responseJsonSchema: schema } : {}),
      thinkingConfig: thinkingFor(model, cfg.thinking),
      ...(req.tools === "google_search" ? { tools: [{ googleSearch: {} }] } : {}),
      httpOptions: { timeout: 120_000, retryOptions: { attempts: 1 } },
    },
  });
  const text = res.text ?? "";
  const um = res.usageMetadata;
  const gm = res.candidates?.[0]?.groundingMetadata;
  const chunks = gm?.groundingChunks ?? [];
  const sources = chunks.map((c) => ({ title: c.web?.title ?? c.web?.uri ?? "", url: c.web?.uri ?? "" }));
  const supports = (gm?.groundingSupports ?? [])
    .map((s) => ({ text: s.segment?.text ?? "", sources: (s.groundingChunkIndices ?? []).filter((i) => sources[i]?.url) }))
    .filter((s) => s.text && s.sources.length);
  return {
    text,
    tokensIn: um?.promptTokenCount ?? 0,
    tokensOut: (um?.candidatesTokenCount ?? 0) + (um?.thoughtsTokenCount ?? 0),
    sources,
    supports,
  };
}

async function callGroq(model: string, req: LlmRequest<unknown>, cfg: TaskConfig, extraInstruction?: string) {
  const key = env.groqKey();
  if (!key) throw new LlmUnavailable("GROQ_API_KEY is not set");
  if (req.parts?.length) throw new Error("Groq fallback cannot read attachments");
  const schemaHint = req.schema ? `\n\nReturn only JSON matching this JSON Schema:\n${JSON.stringify(toGeminiSchema(req.schema))}` : "";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: cfg.temperature,
      max_tokens: Math.min(cfg.maxOutputTokens, 8000),
      response_format: req.schema ? { type: "json_object" } : undefined,
      messages: [
        ...(req.system ? [{ role: "system", content: req.system }] : []),
        { role: "user", content: `${req.prompt}${extraInstruction ? `\n\n${extraInstruction}` : ""}${schemaHint}` },
      ],
    }),
  });
  if (!res.ok) throw Object.assign(new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: res.status });
  const j = (await res.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
  return { text: j.choices?.[0]?.message?.content ?? "", tokensIn: j.usage?.prompt_tokens ?? 0, tokensOut: j.usage?.completion_tokens ?? 0, sources: [], supports: [] };
}

const inflight = new Map<string, number>();
async function withSlot<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  const limit = provider === "groq" ? 2 : 4;
  while ((inflight.get(provider) ?? 0) >= limit) await new Promise((r) => setTimeout(r, 150));
  inflight.set(provider, (inflight.get(provider) ?? 0) + 1);
  try { return await fn(); } finally { inflight.set(provider, (inflight.get(provider) ?? 1) - 1); }
}

const deadModels = new Set<string>();

function statusOf(e: unknown): number | undefined {
  const any = e as { status?: number; code?: number; message?: string };
  if (typeof any?.status === "number") return any.status;
  if (typeof any?.code === "number") return any.code;
  const m = any?.message?.match(/\b(4\d\d|5\d\d)\b/);
  return m ? Number(m[1]) : undefined;
}

export async function llm<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
  const cfg = TASKS[req.task] ?? TASKS.ask;
  const schemaJson = req.schema ? JSON.stringify(toGeminiSchema(req.schema)) : "";
  const key = hashKey([req.task, cfg.version, req.system ?? "", req.prompt, partsDigest(req.parts), schemaJson, req.tools ?? ""]);

  if (mock) {
    const out = await mock(req as LlmRequest<unknown>);
    // A mock may return { __result: Partial<LlmResult> } to simulate grounded text and sources.
    const full = (out as { __result?: Partial<LlmResult<T>> } | null)?.__result;
    if (full) return { data: full.data as T, text: full.text ?? "", model: "mock", cached: false, tokensIn: 0, tokensOut: 0, sources: full.sources, supports: full.supports };
    const data = out as T;
    return { data, text: typeof data === "string" ? data : JSON.stringify(data), model: "mock", cached: false, tokensIn: 0, tokensOut: 0 };
  }

  if (!req.noCache && hasDb()) {
    try {
      const rows = await db()`select response, model from llm_cache where key = ${key}`;
      if (rows.length) {
        const cached = rows[0].response as { data: T; text: string; sources?: LlmResult<T>["sources"]; supports?: LlmResult<T>["supports"] };
        await logCall({ task: req.task, model: String(rows[0].model), provider: "cache", tokensIn: 0, tokensOut: 0, latency: 0, ok: true, cacheHit: true, ref: req.ref });
        return { data: cached.data, text: cached.text, model: String(rows[0].model), cached: true, tokensIn: 0, tokensOut: 0, sources: cached.sources, supports: cached.supports };
      }
    } catch { /* cache miss on error */ }
  }

  const chain = chainFor(cfg.tier).filter((m) => !deadModels.has(m));
  let lastErr: unknown = new LlmUnavailable("No model configured");
  for (const entry of chain) {
    const isGroq = entry.startsWith("groq:");
    const model = isGroq ? entry.slice(5) : entry;
    const provider = isGroq ? "groq" : "gemini";
    let extra: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now();
      try {
        const out = await withSlot(provider, () =>
          isGroq ? callGroq(model, req as LlmRequest<unknown>, cfg, extra) : callGemini(model, req as LlmRequest<unknown>, cfg, extra));
        let data: T;
        if (req.schema) {
          const parsed = parseJsonLoose(out.text);
          const v = req.schema.safeParse(parsed);
          if (!v.success) {
            await logCall({ task: req.task, model, provider, tokensIn: out.tokensIn, tokensOut: out.tokensOut, latency: Date.now() - t0, ok: false, cacheHit: false, error: "schema", ref: req.ref });
            extra = `Your previous answer did not match the required schema: ${v.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Return corrected JSON only.`;
            lastErr = new Error(`Schema validation failed: ${extra}`);
            continue;
          }
          data = v.data;
        } else {
          data = out.text as unknown as T;
        }
        await logCall({ task: req.task, model, provider, tokensIn: out.tokensIn, tokensOut: out.tokensOut, latency: Date.now() - t0, ok: true, cacheHit: false, ref: req.ref });
        if (hasDb() && !req.noCache) {
          try {
            await db()`insert into llm_cache (key, response, model) values (${key}, ${db().json({ data, text: out.text, sources: out.sources, supports: out.supports } as never)}, ${model})
              on conflict (key) do nothing`;
          } catch { /* ignore */ }
        }
        return { data, text: out.text, model, cached: false, tokensIn: out.tokensIn, tokensOut: out.tokensOut, sources: out.sources, supports: out.supports };
      } catch (e) {
        lastErr = e;
        const st = statusOf(e);
        await logCall({ task: req.task, model, provider, tokensIn: 0, tokensOut: 0, latency: Date.now() - t0, ok: false, cacheHit: false, error: String((e as Error)?.message ?? e).slice(0, 300), ref: req.ref });
        if (e instanceof LlmUnavailable) break;
        if (st === 404) deadModels.add(entry); // retired or misspelt: skip it for the rest of this process
        if (st === 429) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
        if (st && st >= 500 && attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        break; // 4xx (model not found, bad request): next model
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function llmConfigured(): boolean {
  return !!env.geminiKey() || !!mock;
}

/** Shared system preamble for extraction tasks. */
export const EXTRACTION_SYSTEM = [
  "You extract facts from Indian stock-exchange filings for an investment research tool.",
  "Use only the text provided. If a field is not stated, return null.",
  "Never infer, estimate or calculate numbers. Copy numbers as plain decimals without thousands separators, in the units the document states.",
  "Every fact must carry a short verbatim quote and the page number where it appears. Pages are marked [p.N].",
].join(" ");

export const BANNED_WORDS = ["robust", "significant", "notably", "impressive", "strong", "delve", "landscape"];
