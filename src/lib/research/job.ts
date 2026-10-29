// Research jobs (spec 6.1). A job runs in resumable steps under a lease, so it
// can span several short serverless invocations: each step stores its output
// and the next invocation continues where the last one stopped.
import { db } from "../db";
import { llmConfigured } from "../llm/router";
import { getJson } from "../sources/http";
import { sha1 } from "../text";
import { fetchAndStore, documentByUrl } from "../pipeline/filings";
import { screenerFor, storeScreener } from "../pipeline/financials";
import type { TranscriptExtractT, AnnualReportExtractT } from "../llm/schemas";
import { pickDocuments, type DocPick } from "./docs";
import { extractTranscript, extractAnnualReport } from "./extractDocs";
import { computeFacts, type Fact } from "./facts";
import { buildLedger, targetText, type GuidanceIn, type KpiIn } from "./ledger";
import { normalizeGuidance, normalizeKpis, textBefore } from "./normalize";
import { judgeClaims } from "./judge";
import { synthesize } from "./synthesize";
import type { GroundingContext } from "./validate";
import { metricLabel, type DossierV1, type LedgerRow, type DossierDoc, type Judged } from "./types";
import { estimateCostUsd } from "../llm/pricing";

type StepName = "resolve" | "financials" | "documents" | "extract" | "annual_report" | "ledger" | "synthesis" | "save";
const STEPS: StepName[] = ["resolve", "financials", "documents", "extract", "annual_report", "ledger", "synthesis", "save"];
const PROGRESS: Record<StepName, number> = { resolve: 3, financials: 10, documents: 30, extract: 60, annual_report: 72, ledger: 82, synthesis: 95, save: 100 };

interface DocState extends DocPick { id: number | null; pages: number; status: "new" | "fetched" | "failed" | "extracted"; error?: string }
interface JobState {
  symbol: string;
  name: string;
  sector: string | null;
  done: StepName[];
  docs: DocState[];
  t0: number;
  pending: string[];
  judged?: Judged[];
  synthesis?: { what_matters_now: DossierV1["what_matters_now"]; bull: DossierV1["bull"]; bear: DossierV1["bear"]; seed_questions: string[]; dropped: number };
  version?: string;
}

export class JobError extends Error {}

async function logStep(jobId: string, step: string, progress: number, line?: string) {
  const sql = db();
  await sql`update jobs set step = ${step}, progress = greatest(progress, ${progress}),
    log = case when ${line ?? null}::text is null then log else log || ${sql.json([{ at: new Date().toISOString(), text: line ?? "" }])} end,
    updated_at = now(), lease_until = now() + interval '4 minutes' where id = ${jobId}`;
}

async function saveState(jobId: string, state: JobState) {
  await db()`update jobs set result = ${db().json(state as never)}, updated_at = now() where id = ${jobId}`;
}

/** Find the company, adding it from screener's search when it is not in the symbol master. */
export async function resolveCompany(input: string): Promise<{ symbol: string; name: string; sector: string | null }> {
  const sql = db();
  const q = input.trim().toUpperCase().replace(/\.NS$|\.BO$/, "");
  const rows = await sql`select symbol, name, sector, industry from companies where symbol = ${q}`;
  if (rows.length) return { symbol: String(rows[0].symbol), name: String(rows[0].name), sector: (rows[0].sector ?? rows[0].industry ?? null) as string | null };
  const hits = await getJson<{ name: string; url: string }[]>(`https://www.screener.in/api/company/search/?q=${encodeURIComponent(q)}`, {
    headers: { Accept: "application/json" }, timeoutMs: 15_000,
  }).catch(() => []);
  const hit = hits.find((h) => new RegExp(`^/company/${q.replace(/[&]/g, "\\&")}/`, "i").test(h.url)) ?? null;
  if (!hit) throw new JobError(`Couldn't find ${q} on NSE. Check the symbol (for example INFY, TITAN).`);
  const sym = hit.url.split("/")[2].toUpperCase();
  const name = hit.name.replace(/\s+Ltd\.?$/i, "").trim();
  await sql`insert into companies (symbol, name) values (${sym}, ${name}) on conflict (symbol) do nothing`;
  return { symbol: sym, name, sector: null };
}

export async function createResearchJob(symbol: string, userId: string | null): Promise<string> {
  const sql = db();
  const open = await sql`select id from jobs where kind = 'research' and symbol = ${symbol} and status in ('queued', 'running')
    and updated_at > now() - interval '15 minutes' order by created_at desc limit 1`;
  if (open.length) return String(open[0].id);
  const [j] = await sql`insert into jobs (kind, symbol, user_id, status, step, progress) values ('research', ${symbol}, ${userId}, 'queued', ${`Finding ${symbol}`}, 0) returning id`;
  return String(j.id);
}

/** Claim the job's lease. Returns false when another runner holds it or it is finished. */
async function claim(jobId: string): Promise<boolean> {
  const rows = await db()`update jobs set status = 'running', lease_until = now() + interval '4 minutes', updated_at = now()
    where id = ${jobId} and (status = 'queued' or (status = 'running' and (lease_until is null or lease_until < now())))
    returning id`;
  return rows.length > 0;
}

function citeOf(docId: number, page: number) { return `doc:${docId}:p${page}`; }

/** Run as many steps as fit before the deadline. Returns true when the job is finished (done or failed). */
export async function runResearchJob(jobId: string, deadline: number): Promise<boolean> {
  const sql = db();
  if (!(await claim(jobId))) return false;
  const [job] = await sql`select * from jobs where id = ${jobId}`;
  const symbolIn = String(job.symbol);
  let state: JobState = (job.result as JobState | null)?.done ? (job.result as JobState) : {
    symbol: symbolIn, name: symbolIn, sector: null, done: [], docs: [], t0: Date.now(), pending: [],
  };
  const left = () => deadline - Date.now();
  try {
    for (const step of STEPS) {
      if (state.done.includes(step)) continue;
      if (left() < 25_000) { await saveState(jobId, state); await sql`update jobs set lease_until = now() where id = ${jobId}`; return false; }
      switch (step) {
        case "resolve": {
          await logStep(jobId, `Finding ${symbolIn}`, 1);
          const c = await resolveCompany(symbolIn);
          state = { ...state, symbol: c.symbol, name: c.name, sector: c.sector };
          await sql`update jobs set symbol = ${c.symbol} where id = ${jobId}`;
          break;
        }
        case "financials": {
          await logStep(jobId, "Reading the financial tables", 5);
          const sc = await screenerFor(state.symbol, 12).catch((e) => { throw new JobError(`Screener didn't respond (${(e as Error).message.slice(0, 60)}). Try again in a minute.`); });
          await storeScreener(sc);
          const years = sc.tables.profit_loss?.periods.filter((p) => p.date).length ?? 0;
          if (sc.name) state.name = sc.name.replace(/\s+Ltd\.?$/i, "").trim();
          state.docs = pickDocuments(sc).map((d) => ({ ...d, id: null, pages: 0, status: "new" }));
          const nT = state.docs.filter((d) => d.doc_type !== "annual_report").length;
          const ar = state.docs.find((d) => d.doc_type === "annual_report");
          await logStep(jobId, "Reading the financial tables", PROGRESS.financials,
            `Read ${years} years of ${sc.basis} financials. Found ${nT} call document${nT === 1 ? "" : "s"}${ar ? ` and the ${ar.period_label} annual report` : ""}.`);
          break;
        }
        case "documents": {
          for (const d of state.docs) {
            if (d.status !== "new") continue;
            if (left() < 30_000) { await saveState(jobId, state); await sql`update jobs set lease_until = now() where id = ${jobId}`; return false; }
            await logStep(jobId, `Reading the ${d.label}`, PROGRESS.financials + 2);
            try {
              const doc = await fetchAndStore({
                symbol: state.symbol, docType: d.doc_type, url: d.url, periodLabel: d.period_label, periodEnd: d.period_end,
                maxPages: d.doc_type === "annual_report" ? 450 : 120,
              });
              d.id = doc.id; d.pages = doc.pages.length; d.status = "fetched";
              await logStep(jobId, `Reading the ${d.label}`, PROGRESS.financials + 2, `Read the ${d.label} (${d.pages} pages).`);
            } catch (e) {
              d.status = "failed"; d.error = (e as Error).message.slice(0, 160);
              await logStep(jobId, `Reading the ${d.label}`, PROGRESS.financials + 2, `Couldn't open the ${d.label}; continuing without it.`);
            }
            await saveState(jobId, state);
          }
          break;
        }
        case "extract": {
          const calls = state.docs.filter((d) => d.doc_type !== "annual_report" && d.status === "fetched" && d.id);
          if (!llmConfigured()) { state.pending.push("say_vs_do"); break; }
          await logStep(jobId, `Extracting guidance from ${calls.length} calls`, PROGRESS.documents);
          for (let i = 0; i < calls.length; i += 3) {
            if (left() < 70_000) { await saveState(jobId, state); await sql`update jobs set lease_until = now() where id = ${jobId}`; return false; }
            await Promise.all(calls.slice(i, i + 3).map(async (d) => {
              try {
                const pages = (await documentByUrl(d.url))?.pages ?? [];
                const r = await extractTranscript(d.id!, pages, state.name, d.period_label);
                d.status = "extracted";
                await logStep(jobId, `Extracting guidance from ${calls.length} calls`, PROGRESS.documents + 5,
                  `${d.label}: ${r.data.guidance.length} guidance items, ${r.data.reported_kpis.length} reported numbers.`);
              } catch (e) {
                d.status = "failed"; d.error = (e as Error).message.slice(0, 160);
                await logStep(jobId, `Extracting guidance from ${calls.length} calls`, PROGRESS.documents + 5, `${d.label}: extraction failed; skipped.`);
              }
            }));
            await saveState(jobId, state);
          }
          break;
        }
        case "annual_report": {
          const d = state.docs.find((x) => x.doc_type === "annual_report" && x.status === "fetched" && x.id);
          if (!d || !llmConfigured()) break;
          if (left() < 60_000) { await saveState(jobId, state); await sql`update jobs set lease_until = now() where id = ${jobId}`; return false; }
          await logStep(jobId, `Reading the ${d.label}`, PROGRESS.extract);
          try {
            const pages = (await documentByUrl(d.url))?.pages ?? [];
            const r = await extractAnnualReport(d.id!, pages, state.name, d.period_label);
            d.status = "extracted";
            await logStep(jobId, `Reading the ${d.label}`, PROGRESS.annual_report, `Read ${r.pagesRead.length} targeted pages of the ${d.label}.`);
          } catch {
            await logStep(jobId, `Reading the ${d.label}`, PROGRESS.annual_report, `Couldn't read the ${d.label}; the business and auditor sections will be thin.`);
          }
          break;
        }
        case "ledger": {
          const { guidance, claims } = await loadExtracts(state);
          const ctx = await groundingContext(state, {});
          const facts = computeFacts(await screenerFor(state.symbol, 24)).facts;
          await logStep(jobId, `Checking ${guidance.filter((g) => g.direction !== "qualitative").length} promises`, PROGRESS.annual_report + 2);
          if (llmConfigured() && claims.length && left() > 50_000) {
            try {
              state.judged = await judgeClaims(claims.slice(0, 10), facts, { ...ctx, facts }, `dossier:${state.symbol}`);
            } catch { state.pending.push("narrative_vs_numbers"); }
          }
          break;
        }
        case "synthesis": {
          if (!llmConfigured()) { state.pending.push("synthesis"); break; }
          await logStep(jobId, "Writing the bull and bear case", PROGRESS.ledger);
          try {
            const { dossier: d, facts } = await assemble(state, jobId);
            const ctx = await groundingContext(state, facts, d);
            const s = await synthesize({
              company: state.name, facts,
              ledger: d.say_vs_do.items.filter((x) => x.status !== "revised").slice(0, 25).map((x) => ({
                id: x.id, call: x.call, metric: x.metric_label, target: x.target_text, horizon: x.horizon, status: x.status,
                actual: x.actual ? `${x.actual.value}${x.actual.unit === "pct" ? "%" : ` ${x.actual.unit}`} (${x.actual.label})` : null,
                cite: x.cite, actual_cite: x.actual?.cite ?? null,
              })),
              credibility: d.say_vs_do.credibility.score !== null ? `${d.say_vs_do.credibility.delivered + d.say_vs_do.credibility.near_miss} of ${d.say_vs_do.credibility.resolved} resolved promises met (${d.say_vs_do.credibility.score}%)` : null,
              business: { description: d.business.description, segments: d.business.segments.map((s) => `${s.name}: ${s.revenue_cr ?? "?"} cr (${s.share_pct ?? "?"}%) ${s.cite ?? ""}`), risks: d.business.risks, cites: Object.values(d.business.cites) },
              auditor: d.balance_sheet.auditor_opinion,
              concerns: d.analyst_concerns.slice(0, 6),
              claims: d.narrative_vs_numbers.map((j) => ({ claim: j.claim, verdict: j.verdict, evidence: j.evidence, cite: j.cite })),
              flags: d.flags,
            }, ctx, `dossier:${state.symbol}`);
            state.synthesis = s;
            if (s.dropped) await logStep(jobId, "Checking every citation", PROGRESS.synthesis, `Dropped ${s.dropped} bullet${s.dropped > 1 ? "s" : ""} that failed citation or number checks.`);
          } catch (e) {
            state.pending.push("synthesis");
            await logStep(jobId, "Writing the bull and bear case", PROGRESS.synthesis, `The writing model is unavailable (${(e as Error).message.slice(0, 80)}); numbers and Say vs Do are ready.`);
          }
          break;
        }
        case "save": {
          await logStep(jobId, "Saving the dossier", PROGRESS.synthesis);
          const d = await assemble(state, jobId);
          await sql`insert into dossiers (symbol, version, data, stats) values (${state.symbol}, ${d.version_id}, ${sql.json(d.dossier as never)}, ${sql.json(d.dossier.stats as never)})
            on conflict (symbol, version) do update set data = excluded.data, stats = excluded.stats, created_at = now()`;
          await guidanceChangeEvents(state.symbol, d.dossier);
          state.version = d.version_id;
          await sql`update jobs set status = 'done', progress = 100, step = 'Dossier built', result = ${sql.json(state as never)}, lease_until = null, updated_at = now() where id = ${jobId}`;
          return true;
        }
      }
      state.done.push(step);
      await sql`update jobs set progress = greatest(progress, ${PROGRESS[step]}), updated_at = now(), lease_until = now() + interval '4 minutes' where id = ${jobId}`;
      await saveState(jobId, state);
    }
    return true;
  } catch (e) {
    const msg = e instanceof JobError ? e.message : `Research failed: ${(e as Error).message.slice(0, 200)}`;
    await sql`update jobs set status = 'failed', error = ${msg}, result = ${sql.json(state as never)}, lease_until = null, updated_at = now() where id = ${jobId}`;
    return true;
  }
}

async function loadExtracts(state: JobState) {
  const sql = db();
  const docIds = state.docs.filter((d) => d.id).map((d) => d.id!) as number[];
  const rows = docIds.length ? await sql`select document_id, kind, data from doc_extracts where document_id in ${sql(docIds)}` : [];
  const guidance: GuidanceIn[] = [];
  const kpis: KpiIn[] = [];
  const claims: { id: number; claim: string; quote: string; cite: string }[] = [];
  let gid = 1, cid = 1;
  const callDocs = state.docs.filter((d) => d.doc_type !== "annual_report" && d.id).sort((a, b) => (b.said_on ?? "").localeCompare(a.said_on ?? ""));
  for (const d of callDocs) {
    const r = rows.find((x) => Number(x.document_id) === d.id && x.kind === "transcript");
    if (!r) continue;
    const t = r.data as TranscriptExtractT;
    for (const g of t.guidance) {
      guidance.push({
        id: gid++, doc_id: d.id!, said_period: d.period_label, said_on: d.said_on ?? "", metric: g.metric, label_raw: g.label_raw,
        target_low: g.target_low, target_high: g.target_high, unit: g.unit, basis: g.basis, horizon: g.horizon, direction: g.direction,
        speaker: g.speaker, quote: g.quote, page: g.page,
      });
    }
    for (const k of t.reported_kpis) kpis.push({ doc_id: d.id!, said_on: d.said_on ?? "", metric: k.metric, value: k.value, unit: k.unit, basis: k.basis, period: k.period, quote: k.quote, page: k.page });
    if (callDocs.indexOf(d) < 3) {
      for (const c of t.narrative_claims.slice(0, 4)) claims.push({ id: cid++, claim: c.claim, quote: c.quote, cite: citeOf(d.id!, c.page) });
    }
  }
  return { guidance, kpis, claims, rows };
}

/** Page texts by "doc:page". */
async function loadPages(pairs: [number, number][]): Promise<Map<string, string>> {
  const sql = db();
  const out = new Map<string, string>();
  const uniq = [...new Set(pairs.filter(([a, b]) => a > 0 && b > 0).map(([a, b]) => `${a}:${b}`))].map((k) => k.split(":").map(Number));
  for (let i = 0; i < uniq.length; i += 200) {
    const chunk = uniq.slice(i, i + 200);
    const res = await sql`select p.document_id, p.page_no, p.text from doc_pages p
      join (values ${sql(chunk.map(([a, b]) => [String(a), String(b)]) as never)}) as v(doc, page)
        on p.document_id = v.doc::bigint and p.page_no = v.page::int`;
    for (const r of res) out.set(`${r.document_id}:${r.page_no}`, String(r.text));
  }
  return out;
}

/** The extracts after code's checks (normalize.ts): horizons, units, metric keys and scope re-derived from the quotes. */
async function normalizedExtracts(state: JobState, lender: boolean) {
  const raw = await loadExtracts(state);
  const pages = await loadPages(raw.guidance.flatMap((g) => [[g.doc_id, g.page], [g.doc_id, g.page - 1], [g.doc_id, g.page + 1]] as [number, number][]));
  const before = (g: { doc_id: number; page: number; quote: string }) => {
    for (const p of [g.page, g.page - 1, g.page + 1]) {
      const t = pages.get(`${g.doc_id}:${p}`);
      const b = t ? textBefore(g.quote, t) : "";
      if (b) return b;
    }
    return "";
  };
  const periods = new Map(state.docs.filter((d) => d.id).map((d) => [d.id!, d.period_label] as [number, string]));
  return { ...raw, guidance: normalizeGuidance(raw.guidance, { lender, before }), kpis: normalizeKpis(raw.kpis, { lender, periods }) };
}

async function groundingContext(state: JobState, facts: Record<string, Fact>, d?: DossierV1): Promise<GroundingContext> {
  const sql = db();
  // Only pages that can be cited: the ones the extracts point at, plus the annual-report pages read.
  const wanted = new Set<string>();
  const { guidance, kpis, claims, rows } = await loadExtracts(state);
  for (const g of guidance) wanted.add(`${g.doc_id}:${g.page}`);
  for (const k of kpis) wanted.add(`${k.doc_id}:${k.page}`);
  for (const c of claims) wanted.add(c.cite.replace(/^doc:/, "").replace(":p", ":"));
  for (const r of rows) {
    const data = r.data as { pages_read?: number[]; analyst_concerns?: { page: number }[] };
    for (const p of data.pages_read ?? []) wanted.add(`${r.document_id}:${p}`);
    for (const a of data.analyst_concerns ?? []) wanted.add(`${r.document_id}:${a.page}`);
  }
  const pageMap = new Map<string, string>();
  const pairs = [...wanted].map((k) => k.split(":").map(Number)).filter(([a, b]) => a > 0 && b > 0);
  for (let i = 0; i < pairs.length; i += 200) {
    const chunk = pairs.slice(i, i + 200);
    const res = await sql`select p.document_id, p.page_no, p.text from doc_pages p
      join (values ${sql(chunk.map(([a, b]) => [String(a), String(b)]) as never)}) as v(doc, page)
        on p.document_id = v.doc::bigint and p.page_no = v.page::int`;
    for (const r of res) pageMap.set(`${r.document_id}:${r.page_no}`, String(r.text));
  }
  const extra: number[] = [];
  if (d) {
    for (const it of d.say_vs_do.items) {
      if (it.actual) extra.push(it.actual.value);
      for (const n of it.target_text.match(/\d+(?:\.\d+)?/g) ?? []) extra.push(Number(n));
    }
    for (const s of d.business.segments) { if (s.revenue_cr !== null) extra.push(s.revenue_cr); if (s.share_pct !== null) extra.push(s.share_pct); }
    if (d.balance_sheet.contingent_cr !== null) extra.push(d.balance_sheet.contingent_cr);
    if (d.balance_sheet.contingent_pct_networth !== null) extra.push(d.balance_sheet.contingent_pct_networth);
    if (d.say_vs_do.credibility.score !== null) extra.push(d.say_vs_do.credibility.score);
  }
  return { facts, extraNumbers: extra, pageText: (doc, page) => pageMap.get(`${doc}:${page}`) ?? null };
}

/** Build the DossierV1 from stored extracts, facts and the ledger. Pure code; no model calls. */
async function assemble(state: JobState, jobId: string): Promise<{ dossier: DossierV1; version_id: string; facts: Record<string, Fact> }> {
  const sql = db();
  const sc = await screenerFor(state.symbol, 24);
  const fb = computeFacts(sc);
  const facts = { ...fb.facts };
  const { guidance, kpis, rows } = await normalizedExtracts(state, fb.lender);
  const ledger = buildLedger(guidance, kpis, fb);
  // Table-derived actuals become citable facts.
  const items: LedgerRow[] = ledger.items.map((it) => {
    let actual: LedgerRow["actual"] = null;
    if (it.actual) {
      let cite = it.actual.cite;
      if (cite.startsWith("fact:quarters:") || cite.startsWith("fact:annual:")) {
        const key = `actual_${it.id}`;
        facts[key] = {
          key, label: `${metricLabel(it.metric)} actual`, value: it.actual.value, unit: it.actual.unit as Fact["unit"], period: it.actual.label,
          source: `${fb.basis === "consolidated" ? "Screener consolidated" : "Screener standalone"} ${cite.startsWith("fact:annual") ? "P&L" : "quarterly results"}, ${it.actual.label}`,
        };
        cite = `fact:${key}`;
      }
      actual = { value: it.actual.value, unit: it.actual.unit, label: it.actual.label, cite };
    }
    return {
      id: it.id, call: `${it.said_period} call`, said_on: it.said_on, metric: it.metric, metric_label: metricLabel(it.metric), label_raw: it.label_raw,
      scope: it.scope?.scope === "segment" ? it.scope.label : null,
      target_text: targetText(it), horizon: it.horizon_label, basis: it.basis, status: it.status, actual,
      revised_to: it.revised_to ? { text: targetText({ target_low: it.revised_to.low, target_high: it.revised_to.high, unit: it.unit, direction: it.revised_to.direction, target_text_raw: it.target_text_raw }), said_period: it.revised_to.said_period, cite: citeOf(it.revised_to.doc_id, it.revised_to.page) } : null,
      note: it.note, quote: it.quote, cite: citeOf(it.doc_id, it.page), speaker: it.speaker,
    };
  });
  const arDoc = state.docs.find((d) => d.doc_type === "annual_report" && d.id);
  const ar = arDoc ? (rows.find((r) => Number(r.document_id) === arDoc.id && r.kind === "annual_report")?.data as (AnnualReportExtractT & { pages_read?: number[] }) | undefined) : undefined;
  const arCite = (field: string) => {
    const c = ar?.citations.find((x) => x.field.toLowerCase().includes(field));
    return c && arDoc?.id ? citeOf(arDoc.id, c.page) : null;
  };
  const netWorth = facts.net_worth?.value ?? null;
  const contingent = ar?.contingent_liabilities_cr ?? null;
  const concerns: DossierV1["analyst_concerns"] = [];
  for (const d of state.docs.filter((x) => x.doc_type === "transcript" && x.id).slice(0, 2)) {
    const t = rows.find((r) => Number(r.document_id) === d.id && r.kind === "transcript")?.data as TranscriptExtractT | undefined;
    for (const c of t?.analyst_concerns ?? []) concerns.push({ topic: c.topic, summary: c.summary, cite: citeOf(d.id!, c.page) });
  }
  const docs: DossierDoc[] = state.docs.filter((d) => d.id && d.status !== "failed").map((d) => ({
    id: d.id!, type: d.doc_type, label: d.label, period_label: d.period_label, url: d.url, pages: d.pages,
    used_pages: d.doc_type === "annual_report" ? ar?.pages_read : undefined,
  }));
  const tiles: DossierV1["numbers"]["tiles"] = [];
  const tile = (key: string, changeKey?: string, changeLabel?: string) => {
    const f = facts[key];
    if (!f) return;
    const ch = changeKey && facts[changeKey] ? { value: facts[changeKey].value, unit: facts[changeKey].unit, label: changeLabel ?? "YoY" } : undefined;
    tiles.push({ key, label: f.label, value: f.value, unit: f.unit, period: f.period, change: ch });
  };
  if (fb.lender) { tile("q_nii"); tile("q_pat", "q_pat_yoy"); tile("q_gnpa", "q_gnpa_yoy_bps"); tile("roe"); if (tiles.length < 4) tile("q_ebitda"); }
  else { tile("q_revenue", "q_revenue_yoy"); tile("q_opm", "q_opm_yoy_bps"); tile("q_pat", "q_pat_yoy"); tile("roce"); }
  const cagrs = (["revenue", "ebitda", "pat"] as const).map((k) => ({
    key: k, label: k === "revenue" ? "Revenue" : k === "ebitda" ? (fb.lender ? "Financing profit" : "EBITDA") : "Net profit",
    y3: facts[`${k}_cagr_3y`]?.value ?? null, y5: facts[`${k}_cagr_5y`]?.value ?? null,
  }));
  const company = await sql`select sector, industry from companies where symbol = ${state.symbol}`;
  const stats = await jobStats(state, jobId);
  const dossier: DossierV1 = {
    version: 1, symbol: state.symbol, name: state.name, built_at: new Date().toISOString(), basis: fb.basis, lender: fb.lender,
    sector: (company[0]?.sector ?? company[0]?.industry ?? state.sector ?? null) as string | null,
    header: { price: facts.price?.value ?? null, mcap_cr: facts.mcap?.value ?? null, pe: facts.pe?.value ?? null, roe: facts.roe?.value ?? null, roce: facts.roce?.value ?? null, screener_url: sc.url },
    documents: docs,
    what_matters_now: state.synthesis?.what_matters_now ?? [],
    bull: state.synthesis?.bull ?? [],
    bear: state.synthesis?.bear ?? [],
    seed_questions: state.synthesis?.seed_questions ?? [],
    say_vs_do: {
      credibility: ledger.credibility, items,
      note: !state.docs.some((d) => d.doc_type !== "annual_report") ? "No call transcripts published" : state.docs.some((d) => d.doc_type === "presentation") ? "Some quarters use investor presentations because transcripts were missing" : null,
    },
    narrative_vs_numbers: state.judged ?? [],
    numbers: { tiles, annual: fb.annual, quarterly: fb.quarterly, cagr: cagrs },
    cash: { cfo_pat_5y: facts.cfo_pat_5y?.value ?? null, cfo_ebitda: facts.cfo_ebitda?.value ?? null, fcf: facts.fcf?.value ?? null, flag: fb.flags[0] ?? null },
    asset_quality: fb.lender ? { gnpa: facts.q_gnpa?.value ?? null, nnpa: facts.q_nnpa?.value ?? null, gnpa_yoy_bps: facts.q_gnpa_yoy_bps?.value ?? null } : undefined,
    balance_sheet: {
      borrowings: facts.borrowings?.value ?? null, de_ratio: facts.de_ratio?.value ?? null, interest_cover: facts.interest_cover?.value ?? null, net_worth: netWorth,
      wc_days: { debtor: facts.debtor_days?.value ?? null, inventory: facts.inventory_days?.value ?? null, payable: facts.days_payable?.value ?? null, ccc: facts.ccc_days?.value ?? null },
      contingent_cr: contingent, contingent_pct_networth: contingent !== null && netWorth ? Math.round((contingent / netWorth) * 1000) / 10 : null,
      auditor_opinion: ar?.auditor_opinion ?? null, key_audit_matters: ar?.key_audit_matters ?? [],
      cites: Object.fromEntries(([["contingent", arCite("contingent")], ["auditor", arCite("audit")]] as const).filter(([, v]) => v) as [string, string][]),
    },
    business: {
      description: ar?.business_description ?? null,
      segments: (ar?.segments ?? []).map((s) => ({ name: s.name, revenue_cr: s.revenue_cr, share_pct: s.share_pct, cite: arDoc?.id ? citeOf(arDoc.id, s.page) : null })),
      risks: ar?.top_risks ?? [], related_party: ar?.related_party_highlights ?? [],
      cites: Object.fromEntries(([["description", arCite("business") ?? arCite("description")], ["risks", arCite("risk")]] as const).filter(([, v]) => v) as [string, string][]),
    },
    analyst_concerns: concerns,
    facts,
    flags: fb.flags,
    pending: [...new Set(state.pending)],
    stats: { ...stats, dropped_bullets: state.synthesis?.dropped ?? 0 },
  };
  const version_id = sha1([state.symbol, ...docs.map((d) => d.url).sort(), fb.latestQuarter ?? "", state.synthesis ? "s" : "-"].join("|")).slice(0, 12);
  return { dossier, version_id, facts };
}

async function jobStats(state: JobState, jobId: string) {
  const sql = db();
  const refs = [...state.docs.filter((d) => d.id).map((d) => `doc:${d.id}`), `dossier:${state.symbol}`];
  const [job] = await sql`select created_at from jobs where id = ${jobId}`;
  const rows = await sql`select model, tokens_in, tokens_out, cache_hit, ok from llm_calls where ref in ${sql(refs)} and created_at >= ${job.created_at}`;
  let calls = 0, cached = 0, tin = 0, tout = 0, cost = 0;
  for (const r of rows) {
    if (!r.ok) continue;
    calls++;
    if (r.cache_hit) { cached++; continue; }
    tin += Number(r.tokens_in ?? 0); tout += Number(r.tokens_out ?? 0);
    cost += estimateCostUsd(String(r.model), Number(r.tokens_in ?? 0), Number(r.tokens_out ?? 0));
  }
  return { calls, cached_calls: cached, tokens_in: tin, tokens_out: tout, cost_usd_est: Math.round(cost * 10000) / 10000, seconds: Math.round((Date.now() - state.t0) / 1000) };
}

/** A new call that raises or cuts guidance becomes a push event for anyone holding the stock (spec 6.5). */
async function guidanceChangeEvents(symbol: string, d: DossierV1) {
  const sql = db();
  const newest = [...d.documents].filter((x) => x.type !== "annual_report").sort((a, b) => b.period_label.localeCompare(a.period_label))[0];
  if (!newest) return;
  for (const it of d.say_vs_do.items) {
    if (it.status !== "revised" || !it.revised_to) continue;
    const callDoc = Number(it.revised_to.cite.split(":")[1]);
    if (callDoc !== newest.id) continue;
    const saidOn = d.say_vs_do.items.find((x) => x.cite.startsWith(`doc:${newest.id}:`))?.said_on;
    if (!saidOn || Date.now() - new Date(saidOn).getTime() > 45 * 86_400_000) continue;
    const key = `${symbol}:guidance:${it.metric}:${it.horizon}:${newest.id}`;
    const title = `Guidance changed: ${it.horizon} ${it.metric_label.toLowerCase()} ${it.target_text} → ${it.revised_to.text}`;
    await sql`insert into events (event_key, symbol, category, subtype, title, primary_id, first_filed_at, last_filed_at, filings, base_score, reasons, detail, status)
      values (${key}, ${symbol}, 'earnings_call', 'guidance_change', ${title}, null, ${new Date(saidOn)}, ${new Date(saidOn)}, 1, 75,
        ${sql.json(["Guidance change"])}, ${sql.json({ guidance_change: { metric: it.metric_label, horizon: it.horizon, from: it.target_text, to: it.revised_to.text, cite: it.revised_to.cite, quote: it.quote } } as never)}, 'done')
      on conflict (event_key) do nothing`;
  }
}

/** Cached dossier, newest first. */
export async function latestDossier(symbol: string): Promise<{ version: string; data: DossierV1; created_at: string } | null> {
  const rows = await db()`select version, data, created_at from dossiers where symbol = ${symbol.toUpperCase()} order by created_at desc limit 1`;
  if (!rows.length) return null;
  return { version: String(rows[0].version), data: rows[0].data as DossierV1, created_at: new Date(rows[0].created_at as string).toISOString() };
}
