"use client";
// The Dossier: is management doing what it said? Built only from the company's
// own call transcripts, annual report and standardised financial tables.
import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ExternalLink, Send } from "lucide-react";
import type { DossierV1, LedgerRow, Cited } from "@/lib/research/types";
import type { Status } from "@/lib/research/ledger";
import { useApi, post, ApiError } from "@/lib/client/api";
import { mcap, price, whenIst } from "@/lib/format";
import { SourceSheet, factValue } from "@/components/SourceSheet";
import { AskSheet } from "@/components/AskSheet";
import { Bars } from "@/components/charts";
import { Button, Chip, Delta, Notice, SectionTitle, SkeletonRows, cx } from "@/components/ui";

export default function Page() {
  return <Suspense fallback={<div className="pt-6"><SkeletonRows rows={6} card /></div>}><Dossier /></Suspense>;
}

const STATUS: Record<Status, { label: string; tone: "up" | "down" | "accent" | "neutral" | "outline" }> = {
  delivered: { label: "Delivered", tone: "up" },
  near_miss: { label: "Near miss", tone: "outline" },
  missed: { label: "Missed", tone: "down" },
  on_track: { label: "On track", tone: "up" },
  off_track: { label: "Off track", tone: "down" },
  revised: { label: "Revised", tone: "accent" },
  pending: { label: "Pending", tone: "neutral" },
  unverifiable: { label: "Can't verify", tone: "neutral" },
  basis_differs: { label: "Basis differs", tone: "outline" },
};

const VERDICT = { agree: { label: "Numbers agree", tone: "up" }, diverge: { label: "Numbers diverge", tone: "down" }, too_early: { label: "Too early", tone: "neutral" } } as const;

type Opened = { cite: string; quote?: string | null } | null;

/** Source chips: one per cited page, and one for all cited table figures. */
function Cites({ cites, onOpen, quote }: { cites: string[]; onOpen: (o: Opened) => void; quote?: string | null }) {
  const pages = [...new Set(cites.filter((c) => c.startsWith("doc:")))].slice(0, 3);
  const facts = [...new Set(cites.filter((c) => c.startsWith("fact:")))];
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-baseline">
      {pages.map((c) => (
        <button key={c} type="button" onClick={() => onOpen({ cite: c, quote })} aria-label={`Source: page ${c.split(":p")[1]}`}
          className="num inline-flex min-h-6 items-center rounded-full bg-accent-soft px-1.5 font-sans text-[11px] leading-5 text-accent">
          p.{c.split(":p")[1]}
        </button>
      ))}
      {facts.length ? (
        <button type="button" onClick={() => onOpen({ cite: facts.length === 1 ? facts[0] : `facts:${facts.map((f) => f.slice(5)).join(",")}` })}
          aria-label={`Source: ${facts.length} figure${facts.length > 1 ? "s" : ""} from the financial tables`}
          className="num inline-flex min-h-6 items-center rounded-full bg-accent-soft px-1.5 font-sans text-[11px] leading-5 text-accent">
          {facts.length > 1 ? `${facts.length} figures` : "table"}
        </button>
      ) : null}
    </span>
  );
}

function Bullets({ items, onOpen, serif = false }: { items: Cited[]; onOpen: (o: Opened) => void; serif?: boolean }) {
  return (
    <ul className="space-y-3">
      {items.map((b, i) => (
        <li key={i} className={cx("flex gap-3", serif ? "serif text-base" : "text-sm")}>
          <span aria-hidden className="mt-[0.7em] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
          <span>{b.text}<Cites cites={b.cites} onOpen={onOpen} /></span>
        </li>
      ))}
    </ul>
  );
}

function Dossier() {
  const sp = useSearchParams();
  const router = useRouter();
  const symbol = (sp.get("s") ?? "").toUpperCase();
  const { data, error, loading } = useApi<{ version: string; data: DossierV1; created_at: string }>(symbol ? `/api/dossier?symbol=${encodeURIComponent(symbol)}` : null);
  const [opened, setOpened] = useState<Opened>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [side, setSide] = useState<"bull" | "bear">("bull");
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);
  const d = data?.data;

  async function rebuild() {
    try {
      const r = await post<{ job_id?: string; symbol: string }>("/api/research", { symbol, refresh: true });
      if (r.job_id) router.push(`/research?job=${r.job_id}&s=${r.symbol}`);
    } catch (e) { setRebuildMsg(e instanceof ApiError ? e.message : "Couldn't start a rebuild."); }
  }

  if (!symbol) return <main className="pt-6"><Notice>Open a dossier from Research.</Notice></main>;
  if (error && error.status === 404) {
    return (
      <main className="pt-6">
        <div className="rounded-[14px] border border-rule bg-surface px-5 py-6">
          <h1 className="text-lg font-semibold">No dossier for {symbol} yet</h1>
          <p className="mt-1 text-sm text-ink-2">FINN reads {symbol}&apos;s last five call transcripts, its annual report and its financial tables, then checks what management promised against what it delivered. A first build takes two to four minutes.</p>
          <div className="mt-4"><Button variant="primary" href={`/research?build=${symbol}`}>Build the dossier</Button></div>
        </div>
      </main>
    );
  }
  if (error) {
    return (
      <main className="pt-6">
        <Notice tone="error" action={<Button variant="primary" href={`/research?build=${symbol}`}>Try building it again</Button>}>{error.message}</Notice>
      </main>
    );
  }
  if (loading || !d) return <main className="pt-6"><SkeletonRows rows={6} card /></main>;

  const calls = d.documents.filter((x) => x.type !== "annual_report");
  const ar = d.documents.find((x) => x.type === "annual_report");
  const byCall = new Map<string, LedgerRow[]>();
  for (const it of d.say_vs_do.items) {
    const list = byCall.get(it.call) ?? [];
    list.push(it);
    byCall.set(it.call, list);
  }
  const cred = d.say_vs_do.credibility;
  const met = cred.delivered + cred.near_miss;
  const t = (k: string) => d.facts[k];
  const sections = [["numbers", "Numbers"], ["cash", d.lender ? "Asset quality" : "Cash"], ["balance", "Balance sheet"], ["business", "Business"], ["case", "Bull vs bear"]] as const;
  const seeds = d.seed_questions.length ? d.seed_questions : ["What did management guide for this year?", "What did analysts worry about on the last call?", "What are the main risks management names?"];

  return (
    <main className="pt-3">
      <button type="button" onClick={() => router.back()} className="-ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-sm text-ink-2"><ChevronLeft size={18} aria-hidden /> Back</button>
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{d.name}</h1>
        <p className="mt-0.5 text-sm text-ink-2">
          {d.symbol}{d.sector ? `, ${d.sector}` : ""}{d.basis === "standalone" ? ", standalone figures" : ""}
        </p>
        <p className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {d.header.price ? <span className="font-medium text-ink">{price(d.header.price)}</span> : null}
          {d.header.mcap_cr ? <span className="text-ink-2">Market cap {mcap(d.header.mcap_cr)}</span> : null}
          {d.header.pe ? <span className="text-ink-2">P/E {d.header.pe}</span> : null}
        </p>
        <p className="mt-1 text-xs text-ink-2">
          Built {whenIst(d.built_at)} from {calls.length} call {calls.length === 1 ? "document" : "documents"}{ar ? ` and the ${ar.period_label} annual report` : ""}.{" "}
          <button type="button" onClick={rebuild} className="min-h-8 text-accent">Rebuild</button>
        </p>
        {rebuildMsg ? <p className="mt-1 text-xs text-down">{rebuildMsg}</p> : null}
      </header>

      <section className="mt-6" aria-labelledby="wmn">
        <h2 id="wmn" className="text-sm font-semibold">What matters now</h2>
        <div className="mt-3">
          {d.what_matters_now.length ? <Bullets items={d.what_matters_now} onOpen={setOpened} serif /> : (
            <Notice>{d.pending.includes("synthesis") ? "The summary is pending: the writing model was unavailable during the build. Numbers and Say vs Do below are complete." : "No summary bullets passed FINN's citation checks for this build."}</Notice>
          )}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="svd">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="svd" className="text-sm font-semibold">Say vs do</h2>
          <span className="text-xs text-ink-2">Last {calls.length} calls</span>
        </div>
        <div className="mt-3 rounded-[14px] border border-rule bg-surface px-4 py-4">
          {cred.score !== null ? (
            <p className="flex items-baseline gap-3">
              <span className="num text-xl font-semibold text-accent">{cred.score}%</span>
              <span className="text-sm text-ink-2">{met} of {cred.resolved} resolved promises met{cred.pending ? `, ${cred.pending} still open` : ""}</span>
            </p>
          ) : (
            <p className="text-sm text-ink-2">{cred.resolved} resolved {cred.resolved === 1 ? "promise" : "promises"} so far: too few to score. {cred.pending ? `${cred.pending} still open.` : ""}</p>
          )}
          <p className="mt-1 text-xs text-ink-3">Met counts delivered in full and near misses at half. Statuses are computed by code from the tables and later calls.</p>
        </div>
        {d.say_vs_do.note ? <p className="mt-2 text-xs text-ink-2">{d.say_vs_do.note}.</p> : null}
        {d.pending.includes("say_vs_do") ? <div className="mt-3"><Notice>Say vs Do is pending: the extraction model was unavailable.</Notice></div> : null}
        <div className="mt-2">
          {[...byCall.entries()].map(([call, rows]) => (
            <div key={call} className="mt-4">
              <h3 className="text-xs font-medium text-ink-2">{call}</h3>
              <ul className="mt-1 divide-y divide-rule border-y border-rule">
                {rows.map((r) => <LedgerItem key={r.id} r={r} onOpen={setOpened} />)}
              </ul>
            </div>
          ))}
          {!d.say_vs_do.items.length && !d.pending.includes("say_vs_do") ? <Notice>No numeric guidance found in these calls.</Notice> : null}
        </div>
      </section>

      {d.narrative_vs_numbers.length ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold">Narrative vs numbers</h2>
          <ul className="mt-2 space-y-4">
            {d.narrative_vs_numbers.map((j) => (
              <li key={j.id}>
                <p className="serif text-base">“{j.quote}”<Cites cites={[j.cite]} onOpen={setOpened} quote={j.quote} /></p>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
                  <Chip tone={VERDICT[j.verdict].tone}>{VERDICT[j.verdict].label}</Chip>
                  <span className="text-sm text-ink-2">{j.evidence}<Cites cites={j.cites} onOpen={setOpened} /></span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav aria-label="Dossier sections" className="scroll-x sticky top-0 z-10 -mx-4 mt-8 flex gap-2 border-b border-rule bg-paper/95 px-4 py-2 backdrop-blur">
        {sections.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="min-h-9 shrink-0 rounded-full border border-rule bg-surface px-3 py-1.5 text-sm text-ink-2">{label}</a>
        ))}
      </nav>

      <section id="numbers" className="scroll-mt-16">
        <SectionTitle aside={d.numbers.tiles[0]?.period}>Numbers</SectionTitle>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-rule bg-rule">
          {d.numbers.tiles.map((tile) => (
            <button key={tile.key} type="button" onClick={() => setOpened({ cite: `fact:${tile.key}` })} className="bg-surface px-3 py-3 text-left">
              <div className="text-xs text-ink-2">{tile.label}</div>
              <div className="num mt-0.5 text-lg font-semibold">{factValue({ ...tile, unit: tile.unit as never, source: "" })}</div>
              {tile.change ? <div className="mt-0.5 text-xs"><Delta value={tile.change.value} kind={tile.change.unit === "bps" ? "bps" : "pct"} suffix={tile.change.label} lowerIsBetter={tile.key === "q_gnpa"} /></div> : null}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-4">
          {(["revenue", "opm", "pat", "roce"] as const).map((k) => {
            const s = d.numbers.annual[k];
            if (!s || !s.values.some((v) => v !== null)) return null;
            const label = k === "revenue" ? "Revenue, ₹ cr" : k === "opm" ? (d.lender ? "Financing margin, %" : "EBITDA margin, %") : k === "pat" ? "Net profit, ₹ cr" : "ROCE, %";
            const last = s.values[s.values.length - 1];
            return (
              <div key={k}>
                <div className="flex items-baseline justify-between text-xs"><span className="text-ink-2">{label}</span><span className="num text-ink">{s.labels[s.labels.length - 1]}: {last === null ? "–" : last.toLocaleString("en-IN")}</span></div>
                <Bars labels={s.labels} values={s.values} />
                <div className="num flex justify-between text-[11px] text-ink-3"><span>{s.labels[0]}</span><span>{s.labels[s.labels.length - 1]}</span></div>
              </div>
            );
          })}
        </div>
        <table className="mt-4 w-full text-sm">
          <thead><tr className="text-xs text-ink-2"><th className="py-1 text-left font-normal">Growth a year</th><th className="py-1 text-right font-normal">3 years</th><th className="py-1 text-right font-normal">5 years</th></tr></thead>
          <tbody>
            {d.numbers.cagr.map((c) => (
              <tr key={c.key} className="border-t border-rule">
                <td className="py-2">{c.label}</td>
                <td className="num py-2 text-right">{c.y3 === null ? "–" : `${c.y3.toFixed(1)}%`}</td>
                <td className="num py-2 text-right">{c.y5 === null ? "–" : `${c.y5.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {d.lender ? (
      <section id="cash" className="scroll-mt-16">
        <SectionTitle>Asset quality</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          <Stat label={`Gross NPA, ${t("q_gnpa")?.period ?? "latest"}`} value={d.asset_quality?.gnpa == null ? "–" : `${d.asset_quality.gnpa}%`} onClick={() => t("q_gnpa") && setOpened({ cite: "fact:q_gnpa" })} />
          <Stat label="Change in a year" value={d.asset_quality?.gnpa_yoy_bps == null ? "–" : `${d.asset_quality.gnpa_yoy_bps > 0 ? "+" : d.asset_quality.gnpa_yoy_bps < 0 ? "−" : ""}${Math.abs(d.asset_quality.gnpa_yoy_bps)} bps`} onClick={() => t("q_gnpa_yoy_bps") && setOpened({ cite: "fact:q_gnpa_yoy_bps" })} />
          <Stat label={`Net NPA, ${t("q_nnpa")?.period ?? "latest"}`} value={d.asset_quality?.nnpa == null ? "–" : `${d.asset_quality.nnpa}%`} onClick={() => t("q_nnpa") && setOpened({ cite: "fact:q_nnpa" })} />
        </div>
        <p className="mt-2 text-xs text-ink-3">For a lender, growing the loan book uses operating cash, so cash conversion is not shown. Bad loans are the test instead.</p>
      </section>
      ) : (
      <section id="cash" className="scroll-mt-16">
        <SectionTitle>Cash quality</SectionTitle>
        {d.cash.flag ? <div className="mb-3"><Chip tone="flag">{d.cash.flag}</Chip></div> : null}
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Cash ÷ profit, 5 years" value={d.cash.cfo_pat_5y === null ? "–" : `${d.cash.cfo_pat_5y}×`} onClick={() => t("cfo_pat_5y") && setOpened({ cite: "fact:cfo_pat_5y" })} />
          <Stat label={`Cash ÷ EBITDA, ${t("cfo_ebitda")?.period ?? "latest"}`} value={d.cash.cfo_ebitda === null ? "–" : `${d.cash.cfo_ebitda}%`} onClick={() => t("cfo_ebitda") && setOpened({ cite: "fact:cfo_ebitda" })} />
          <Stat label={`Free cash flow, ${t("fcf")?.period ?? "latest"}`} value={d.cash.fcf === null ? "–" : `₹${Math.round(d.cash.fcf).toLocaleString("en-IN")} cr`} onClick={() => t("fcf") && setOpened({ cite: "fact:fcf" })} />
        </div>
        {d.numbers.annual.cfo?.values.length ? (
          <div className="mt-3">
            <div className="text-xs text-ink-2">Cash from operations, ₹ cr</div>
            <Bars labels={d.numbers.annual.cfo.labels} values={d.numbers.annual.cfo.values} />
          </div>
        ) : null}
        <p className="mt-2 text-xs text-ink-3">Cash means cash from operations. Near or above 1× over five years, reported profits arrive as cash; below 0.7× is flagged.</p>
      </section>
      )}

      <section id="balance" className="scroll-mt-16">
        <SectionTitle>Balance sheet</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Borrowings" value={d.balance_sheet.borrowings === null ? "–" : `₹${Math.round(d.balance_sheet.borrowings).toLocaleString("en-IN")} cr`} onClick={() => t("borrowings") && setOpened({ cite: "fact:borrowings" })} />
          {t("deposits") ? <Stat label="Deposits" value={`₹${Math.round(t("deposits")!.value).toLocaleString("en-IN")} cr`} onClick={() => setOpened({ cite: "fact:deposits" })} />
            : <Stat label="Debt to equity" value={d.balance_sheet.de_ratio === null ? "–" : `${d.balance_sheet.de_ratio}×`} onClick={() => t("de_ratio") && setOpened({ cite: "fact:de_ratio" })} />}
          {!d.lender ? <Stat label="Interest cover" value={d.balance_sheet.interest_cover === null ? "–" : `${d.balance_sheet.interest_cover}×`} onClick={() => t("interest_cover") && setOpened({ cite: "fact:interest_cover" })} /> : null}
          <Stat label="Contingent liabilities" value={d.balance_sheet.contingent_cr === null ? "–" : `₹${Math.round(d.balance_sheet.contingent_cr).toLocaleString("en-IN")} cr${d.balance_sheet.contingent_pct_networth !== null ? `, ${d.balance_sheet.contingent_pct_networth}% of net worth` : ""}`}
            onClick={() => d.balance_sheet.cites.contingent && setOpened({ cite: d.balance_sheet.cites.contingent })} />
        </div>
        {!d.lender && d.balance_sheet.wc_days.ccc !== null ? (
          <p className="num mt-3 text-sm text-ink-2">Working capital: debtors {d.balance_sheet.wc_days.debtor ?? "–"} days, inventory {d.balance_sheet.wc_days.inventory ?? "–"} days, payables {d.balance_sheet.wc_days.payable ?? "–"} days, cash cycle {String(d.balance_sheet.wc_days.ccc).replace("-", "−")} days{(d.balance_sheet.wc_days.ccc ?? 0) < 0 ? ": suppliers and customer advances fund the business" : ""}.</p>
        ) : null}
        {d.balance_sheet.auditor_opinion ? (
          <p className="mt-3 text-sm">
            Auditor&apos;s opinion: <span className={d.balance_sheet.auditor_opinion === "unmodified" ? "text-ink" : "font-medium text-down"}>{d.balance_sheet.auditor_opinion}</span>
            {d.balance_sheet.cites.auditor ? <Cites cites={[d.balance_sheet.cites.auditor]} onOpen={setOpened} /> : null}
            {d.balance_sheet.key_audit_matters.length ? <span className="block text-ink-2">Key audit matters: {d.balance_sheet.key_audit_matters.join("; ")}</span> : null}
          </p>
        ) : null}
      </section>

      <section id="business" className="scroll-mt-16">
        <SectionTitle>Business</SectionTitle>
        {d.business.description ? <p className="serif text-base">{d.business.description}{d.business.cites.description ? <Cites cites={[d.business.cites.description]} onOpen={setOpened} /> : null}</p> : <p className="text-sm text-ink-2">The annual report pass didn&apos;t run for this build.</p>}
        {d.business.segments.some((s) => s.share_pct) ? (
          <div className="mt-4">
            <div className="flex h-3 overflow-hidden rounded-full bg-rule" aria-hidden>
              {d.business.segments.filter((s) => s.share_pct).map((s, i) => (
                <span key={s.name} style={{ width: `${s.share_pct}%`, opacity: 1 - i * 0.16 }} className="h-full bg-accent first:rounded-l-full" />
              ))}
            </div>
            <ul className="mt-2 space-y-1">
              {d.business.segments.map((s) => (
                <li key={s.name} className="flex items-baseline justify-between gap-3 text-sm">
                  <span>{s.name}{s.cite ? <Cites cites={[s.cite]} onOpen={setOpened} /> : null}</span>
                  <span className="num shrink-0 text-ink-2">{s.share_pct !== null ? `${s.share_pct}%` : ""}{s.revenue_cr !== null ? `  ₹${Math.round(s.revenue_cr).toLocaleString("en-IN")} cr` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {d.business.risks.length ? (
          <div className="mt-4">
            <h3 className="text-xs font-medium text-ink-2">Risks management names</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{d.business.risks.slice(0, 5).map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        ) : null}
        {d.analyst_concerns.length ? (
          <div className="mt-4">
            <h3 className="text-xs font-medium text-ink-2">What analysts pressed on</h3>
            <ul className="mt-1 space-y-1.5 text-sm">{d.analyst_concerns.slice(0, 6).map((a, i) => <li key={i}><span className="font-medium">{a.topic}.</span> <span className="text-ink-2">{a.summary}</span><Cites cites={[a.cite]} onOpen={setOpened} /></li>)}</ul>
          </div>
        ) : null}
      </section>

      <section id="case" className="scroll-mt-16">
        <SectionTitle>Bull vs bear</SectionTitle>
        <div className="grid grid-cols-2 rounded-full border border-rule bg-surface p-1" role="tablist" aria-label="Case">
          {(["bull", "bear"] as const).map((s) => (
            <button key={s} role="tab" aria-selected={side === s} type="button" onClick={() => setSide(s)} className={cx("min-h-10 rounded-full text-sm", side === s ? "bg-ink text-paper" : "text-ink-2")}>
              {s === "bull" ? "Bull case" : "Bear case"}
            </button>
          ))}
        </div>
        <div className="mt-4">
          {(side === "bull" ? d.bull : d.bear).length ? <Bullets items={side === "bull" ? d.bull : d.bear} onOpen={setOpened} /> : <Notice>{d.pending.includes("synthesis") ? "Pending: the writing model was unavailable." : "No bullets passed the citation checks."}</Notice>}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Sources</h2>
        <ul className="mt-2 divide-y divide-rule border-y border-rule">
          {d.documents.map((doc) => (
            <li key={doc.id} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
              <span>{doc.label}<span className="text-ink-3">, {doc.pages} pages{doc.used_pages?.length ? `, ${doc.used_pages.length} read` : ""}</span></span>
              <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 shrink-0 items-center gap-1 text-xs text-accent">PDF <ExternalLink size={12} aria-hidden /></a>
            </li>
          ))}
          <li className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
            <span>Financial tables, {d.basis}</span>
            <a href={d.header.screener_url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 shrink-0 items-center gap-1 text-xs text-accent">screener <ExternalLink size={12} aria-hidden /></a>
          </li>
        </ul>
        <p className="mt-2 text-xs text-ink-3">
          Built with {d.stats.calls} model calls ({d.stats.cached_calls} from cache), {(d.stats.tokens_in / 1000).toFixed(0)}k tokens read, in {Math.round(d.stats.seconds / 60) || 1} min. At paid rates this would cost about ${d.stats.cost_usd_est.toFixed(3)}; FINN runs on free tiers.
          {d.stats.dropped_bullets ? ` ${d.stats.dropped_bullets} drafted bullet${d.stats.dropped_bullets > 1 ? "s" : ""} failed the citation or number checks and ${d.stats.dropped_bullets > 1 ? "were" : "was"} dropped.` : ""}
        </p>
        <p className="mt-2 text-xs text-ink-3">Primary sources only: no broker notes, news or the model&apos;s own knowledge. <Link href="/settings#how" className="text-accent underline underline-offset-2">How FINN decides</Link></p>
      </section>

      <div className="pb-safe fixed inset-x-0 bottom-[60px] z-20 border-t border-rule bg-paper/95 px-4 pt-2 backdrop-blur">
        <div className="mx-auto max-w-[560px]">
          <button type="button" onClick={() => setAskOpen(true)} className="flex min-h-11 w-full items-center justify-between rounded-full border border-rule bg-surface px-4 text-left text-sm text-ink-3">
            Ask about {d.name}
            <Send size={16} aria-hidden className="text-accent" />
          </button>
        </div>
      </div>
      <div className="h-16" aria-hidden />

      <SourceSheet cite={opened?.cite ?? null} quote={opened?.quote ?? null} onClose={() => setOpened(null)} facts={d.facts} screenerUrl={d.header.screener_url} />
      <AskSheet open={askOpen} onOpenChange={setAskOpen} symbol={d.symbol} company={d.name} seeds={seeds} />
    </main>
  );
}

function LedgerItem({ r, onOpen }: { r: LedgerRow; onOpen: (o: Opened) => void }) {
  const s = STATUS[r.status];
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-medium">{r.metric_label}</span>
          <span className="text-sm text-ink-2">, {r.horizon}</span>
          {r.basis !== "unspecified" && r.basis !== "reported" ? <span className="text-xs text-ink-3"> ({r.basis.replace("_", " ")})</span> : null}
        </div>
        <Chip tone={s.tone} className="shrink-0">{s.label}</Chip>
      </div>
      <div className="num mt-1 text-sm">
        <span className="text-ink-2">Said </span><span className="text-ink">{r.target_text}</span>
        {r.revised_to ? <><span className="text-ink-2"> then </span><span className="text-ink">{r.revised_to.text}</span><span className="text-ink-2"> in the {r.revised_to.said_period} call</span><Cites cites={[r.revised_to.cite]} onOpen={onOpen} /></> : null}
        {r.actual ? <><span className="text-ink-2">; actual </span><span className="font-medium text-ink">{r.actual.unit === "pct" ? `${r.actual.value}%` : r.actual.unit === "cr" ? `₹${Math.round(r.actual.value).toLocaleString("en-IN")} cr` : r.actual.value}</span><span className="text-ink-2"> ({r.actual.label})</span><Cites cites={[r.actual.cite]} onOpen={onOpen} /></> : null}
      </div>
      {r.note && !r.actual && !r.revised_to ? <p className="mt-0.5 text-xs text-ink-3">{r.note}</p> : null}
      <button type="button" onClick={() => onOpen({ cite: r.cite, quote: r.quote })} className="serif mt-1.5 block text-left text-sm text-ink-2">
        “{r.quote}”{r.speaker ? <span className="font-sans text-xs text-ink-3">, {r.speaker}</span> : null}
        <span className="num ml-1 font-sans text-[11px] text-accent">p.{r.cite.split(":p")[1]}</span>
      </button>
    </li>
  );
}

function Stat({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-[12px] border border-rule bg-surface px-3 py-2.5 text-left">
      <span className="block text-xs leading-snug text-ink-2">{label}</span>
      <span className="num mt-1 block text-base font-semibold">{value}</span>
    </button>
  );
}
