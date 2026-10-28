// Ask FINN (spec 6.8): one company at a time, answered only from that
// company's stored documents and computed facts, with page citations.
import { db } from "../db";
import { llm, llmConfigured } from "../llm/router";
import { Answer } from "../llm/schemas";
import { latestDossier } from "./job";
import { citeExists, numbersGrounded, stripUrls, type GroundingContext } from "./validate";
import { truncate } from "../text";

export interface AskResult { answer: string; citations: { id: string; label: string; url: string | null; quote: string | null }[]; found: boolean; cached: boolean; warning: string | null }

const STOP = new Set(["what", "when", "where", "which", "who", "why", "how", "did", "does", "do", "the", "and", "for", "with", "this", "that", "they", "their",
  "are", "was", "were", "is", "of", "on", "in", "to", "a", "an", "about", "from", "by", "be", "has", "have", "had", "it", "its", "as", "at", "or", "any", "much", "many"]);

export function keywords(q: string): string[] {
  return [...new Set(q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 8);
}

/** A window of the page around the first keyword hit. */
export function excerpt(text: string, words: string[], size = 1600): string {
  const t = text.replace(/\s+/g, " ");
  const lower = t.toLowerCase();
  let pos = -1;
  for (const w of words) { const i = lower.indexOf(w); if (i >= 0 && (pos < 0 || i < pos)) pos = i; }
  const start = Math.max(0, pos < 0 ? 0 : pos - size / 3);
  return t.slice(start, start + size);
}

async function retrieve(symbol: string, question: string) {
  const sql = db();
  let rows = await sql`select d.id, d.doc_type, d.period_label, d.url, p.page_no, p.text, ts_rank_cd(p.tsv, q) as rank
    from doc_pages p join documents d on d.id = p.document_id, websearch_to_tsquery('english', ${question}) q
    where d.symbol = ${symbol} and p.tsv @@ q order by rank desc limit 8`;
  if (rows.length < 3) {
    const words = keywords(question);
    if (words.length) {
      const orq = words.map((w) => `${w}:*`).join(" | ");
      rows = await sql`select d.id, d.doc_type, d.period_label, d.url, p.page_no, p.text, ts_rank_cd(p.tsv, q) as rank
        from doc_pages p join documents d on d.id = p.document_id, to_tsquery('english', ${orq}) q
        where d.symbol = ${symbol} and p.tsv @@ q order by rank desc limit 8`;
    }
  }
  return rows;
}

const DOC_LABEL: Record<string, string> = { transcript: "call transcript", presentation: "investor presentation", annual_report: "annual report", results: "results filing", filing: "filing" };

export async function ask(args: { symbol: string; question: string; context?: string | null; userId?: string | null }): Promise<AskResult> {
  const sql = db();
  const symbol = args.symbol.toUpperCase();
  const question = args.question.trim().slice(0, 300);
  const dossier = await latestDossier(symbol);
  const version = dossier?.version ?? "none";
  const cached = await sql`select answer, citations, found from qa_messages where symbol = ${symbol} and dossier_version = ${version}
    and lower(question) = ${question.toLowerCase()} and coalesce(${args.context ?? ""}, '') = '' order by created_at desc limit 1`;
  if (cached.length) {
    return { answer: String(cached[0].answer), citations: cached[0].citations as AskResult["citations"], found: !!cached[0].found, cached: true, warning: null };
  }
  if (!llmConfigured()) {
    return { answer: "Ask needs the language model, which isn't configured on this deployment.", citations: [], found: false, cached: false, warning: null };
  }
  const pages = await retrieve(symbol, `${question} ${args.context ?? ""}`.trim());
  const words = keywords(question);
  const facts = dossier?.data.facts ?? {};
  const pageMap = new Map<string, string>();
  for (const p of pages) pageMap.set(`${p.id}:${p.page_no}`, String(p.text));
  const ctx: GroundingContext = { facts, extraNumbers: [], pageText: (d, p) => pageMap.get(`${d}:${p}`) ?? null };
  const excerpts = pages.map((p) => `<excerpt id="doc:${p.id}:p${p.page_no}" source="${p.period_label ?? ""} ${DOC_LABEL[String(p.doc_type)] ?? p.doc_type}, page ${p.page_no}">\n${excerpt(String(p.text), words)}\n</excerpt>`).join("\n");
  const factLines = Object.values(facts).slice(0, 80).map((f) => `fact:${f.key} = ${f.label} ${f.value} ${f.unit} (${f.period})`).join("\n");
  const company = dossier?.data.name ?? symbol;
  const prompt = `Answer the investor's question about ${company} using only the excerpts and facts below.
Cite an excerpt id or fact id for every statement, exactly as given. If the answer is not there, set found = false and give the closest available fact.
At most 120 words. Numbers with units. Never use: robust, significant, notably, impressive, strong, delve, landscape.
Question: ${question}
${args.context ? `Context: ${truncate(args.context, 600)}\n` : ""}
Excerpts:
${excerpts || "(none)"}

Facts:
${factLines || "(none)"}`;
  let out = await llm({ task: "ask", prompt, schema: Answer, ref: `ask:${symbol}` });
  let cites = out.data.cites.filter((c) => citeExists(c, ctx));
  let g = numbersGrounded(out.data.answer, cites, ctx);
  if (!g.ok) {
    out = await llm({ task: "ask", prompt: `${prompt}\n\nYour previous answer used numbers not in the excerpts or facts (${g.bad.join(", ")}). Use only numbers that appear there.`, schema: Answer, ref: `ask:${symbol}`, noCache: true });
    cites = out.data.cites.filter((c) => citeExists(c, ctx));
    g = numbersGrounded(out.data.answer, cites, ctx);
  }
  const answer = stripUrls(out.data.answer);
  const found = out.data.found && cites.length > 0;
  const citations: AskResult["citations"] = cites.map((c) => {
    const d = c.match(/^doc:(\d+):p(\d+)$/);
    if (d) {
      const p = pages.find((x) => String(x.id) === d[1] && String(x.page_no) === d[2]);
      return {
        id: c, label: `${p?.period_label ?? ""} ${DOC_LABEL[String(p?.doc_type)] ?? "document"}, p. ${d[2]}`.trim(),
        url: p ? `${String(p.url)}#page=${d[2]}` : null, quote: p ? truncate(excerpt(String(p.text), words, 300), 300) : null,
      };
    }
    const f = facts[c.replace(/^fact:/, "")];
    return { id: c, label: f ? `${f.label}, ${f.period}` : c, url: dossier?.data.header.screener_url ?? null, quote: f ? f.source : null };
  });
  const result: AskResult = {
    answer: found ? answer : answer.startsWith("Not in") ? answer : `Not in FINN's documents for this company. ${answer}`,
    citations, found, cached: false,
    warning: g.ok ? null : "Some numbers in this answer could not be matched to the documents.",
  };
  await sql`insert into qa_messages (symbol, dossier_version, user_id, question, answer, citations, found)
    values (${symbol}, ${version}, ${args.userId ?? null}, ${question}, ${result.answer}, ${sql.json(citations as never)}, ${found})`;
  return result;
}
