"use client";
// The event sheet: the full card, why it is here, what FINN read and checked,
// every filing in the event, and feedback that tunes this user's ranking.
import { Check, ExternalLink, X } from "lucide-react";
import { useState } from "react";
import type { EventDetailT } from "@/lib/api/types";
import { useApi, post, invalidate } from "@/lib/client/api";
import { crore, whenIst, pct, multiple } from "@/lib/format";
import { Sheet } from "./Sheet";
import { ChecksLine, PersonBlock, ResultsGrid, categoryLabel, resultsSentence } from "./cards";
import { Button, Chip, Notice, SkeletonRows, cx } from "./ui";
import { AskSheet } from "./AskSheet";

const TIER_NAME = { top: "Top", worth: "Worth a look", routine: "Routine", hidden: "Hidden" } as const;

export function EventSheet({ eventKey, onClose }: { eventKey: string | null; onClose: () => void }) {
  const { data, error, loading, reload } = useApi<EventDetailT>(eventKey ? `/api/events?key=${encodeURIComponent(eventKey)}` : null);
  const [asking, setAsking] = useState(false);
  const it = data?.item;

  async function feedback(action: string, on: boolean) {
    if (!eventKey) return;
    await post("/api/feedback", { event_key: eventKey, action, on });
    await reload();
    invalidate("/api/brief");
  }

  const askSeeds = it?.results
    ? [`What did management guide for ${it.results.quarter.split(" ")[1]}?`, it.results.template === "lender" ? "What drove credit costs this quarter?" : "Why did EBITDA margin change this quarter?", "What did they say about demand?"]
    : it ? ["What does this filing say?", "Has the company guided on this before?"] : [];

  return (
    <>
      <Sheet open={!!eventKey} onOpenChange={(o) => { if (!o) onClose(); }} title={it ? `${it.symbol}: ${it.title}` : "Event"}>
        {loading && !data ? <div className="py-6"><SkeletonRows rows={4} card /></div> : null}
        {error ? <div className="py-6"><Notice tone="error">{error.message}</Notice></div> : null}
        {it && data ? (
          <div className="pb-4 pt-2">
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <span className="text-base font-semibold">{it.symbol}</span>
                <span className="ml-2 text-sm text-ink-2">{it.company}</span>
              </div>
              <time className="num shrink-0 text-xs text-ink-2" dateTime={it.at}>{whenIst(it.at)}</time>
            </div>
            <div className="mt-0.5 text-xs text-ink-2">{categoryLabel(it.category)}{it.filings > 1 ? `, ${it.filings} filings grouped` : ""}</div>

            {it.results ? (
              <>
                <p className="serif mt-3 text-base">{resultsSentence(it.results)}</p>
                <ResultsGrid r={it.results} />
                {it.results.metrics.exceptional && Math.abs(it.results.metrics.exceptional) >= 1 ? (
                  <p className="mt-2 text-xs text-ink-2">Profit includes an exceptional item of <span className="num">{crore(it.results.metrics.exceptional)}</span>.</p>
                ) : null}
                <p className="mt-2 text-xs text-ink-3">EBITDA here excludes other income: profit before exceptional items and tax, plus finance costs and depreciation, minus other income.</p>
              </>
            ) : it.people?.length ? (
              <div className="space-y-5">{it.people.map((p) => <PersonBlock key={p.person_name} p={p} full />)}</div>
            ) : (
              <p className="serif mt-3 text-base">{it.title}</p>
            )}

            <section className="mt-6">
              <h3 className="text-sm font-semibold">Why this is here</h3>
              <p className="mt-1 text-sm text-ink-2">Scores <span className="num font-medium text-ink">{it.score}</span> of 100, so it sits in {TIER_NAME[it.tier]}. {data.how}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">{it.reasons.map((r) => <Chip key={r} tone={it.red_flags.includes(r) ? "flag" : "neutral"}>{r}</Chip>)}</div>
              {data.signal ? (
                <p className="mt-2 text-sm text-ink-2">The stock moved <span className={cx("num", (data.signal.ret_pct ?? 0) >= 0 ? "text-up" : "text-down")}>{pct(data.signal.ret_pct)}</span>
                  {data.signal.vol_ratio ? <> on <span className="num">{multiple(data.signal.vol_ratio)}</span> its usual volume</> : null} in the session after this filing.</p>
              ) : null}
            </section>

            {it.results ? (
              <section className="mt-6">
                <h3 className="text-sm font-semibold">What FINN read and checked</h3>
                <p className="mt-1 text-sm text-ink-2">The {it.results.basis} statement on page{it.results.source_pages.length > 1 ? "s" : ""} {it.results.source_pages.join(" and ")} of the results filing, in {it.results.unit === "crore" ? "₹ crore" : `₹ ${it.results.unit}, converted to crore`}.</p>
                <div className="mt-2"><ChecksLine r={it.results} /></div>
                <ul className="mt-2 divide-y divide-rule rounded-[12px] border border-rule">
                  {it.results.checks.map((c) => (
                    <li key={c.name} className="flex items-start gap-2 px-3 py-2 text-sm">
                      {c.ok ? <Check size={16} className="mt-0.5 shrink-0 text-up" aria-label="Passed" /> : <X size={16} className="mt-0.5 shrink-0 text-down" aria-label="Failed" />}
                      <span className="text-ink-2">{c.detail}</span>
                    </li>
                  ))}
                </ul>
                {it.results.verified_detail ? (
                  <div className="mt-3">
                    <p className="text-sm text-ink-2">Compared with screener&apos;s {it.results.verified_detail.column} column:</p>
                    <table className="mt-1 w-full text-sm">
                      <tbody>
                        {it.results.verified_detail.rows.map((r) => (
                          <tr key={r.line} className="border-b border-rule last:border-0">
                            <td className="py-1.5 text-ink-2">{r.line}</td>
                            <td className="num py-1.5 text-right">{crore(r.ours)}</td>
                            <td className="num py-1.5 text-right text-ink-2">{crore(r.theirs)}</td>
                            <td className="w-6 py-1.5 text-right">{r.ok === null ? "" : r.ok ? <Check size={14} className="inline text-up" aria-label="Match" /> : <X size={14} className="inline text-down" aria-label="Differs" />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            ) : null}

            {data.error ? <div className="mt-4"><Notice>FINN couldn&apos;t extract details from this filing ({data.error.slice(0, 120)}). The filing itself is below.</Notice></div> : null}

            <section className="mt-6">
              <h3 className="text-sm font-semibold">{data.filings.length > 1 ? `The ${data.filings.length} filings in this event` : "The filing"}</h3>
              <ul className="mt-1 divide-y divide-rule">
                {data.filings.map((f) => (
                  <li key={f.id} className="py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-ink">{f.subject}</span>
                      <time className="num shrink-0 text-xs text-ink-2" dateTime={f.at}>{whenIst(f.at)}</time>
                    </div>
                    {f.headline && f.headline !== f.subject ? <p className="mt-0.5 text-xs text-ink-2">{f.headline.slice(0, 240)}</p> : null}
                    {f.pdf_url ? (
                      <a href={f.is_primary && it.results?.source_pages?.[0] ? `${f.pdf_url}#page=${it.results.source_pages[0]}` : f.pdf_url} target="_blank" rel="noreferrer"
                        className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs text-accent">Open PDF <ExternalLink size={12} aria-hidden /></a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-5 flex flex-wrap gap-2">
              <Button onClick={() => setAsking(true)} variant="primary">Ask about this</Button>
              <Button onClick={() => feedback("useful", !data.feedback.includes("useful"))} className={data.feedback.includes("useful") ? "border-accent text-accent" : ""}>
                Useful
              </Button>
              <Button onClick={() => feedback("not_useful", !data.feedback.includes("not_useful"))} className={data.feedback.includes("not_useful") ? "border-accent text-accent" : ""}>
                Not useful
              </Button>
              <Button onClick={() => feedback("mute_category", !data.feedback.includes("mute_category"))} className={data.feedback.includes("mute_category") ? "border-accent text-accent" : ""}>
                {data.feedback.includes("mute_category") ? `${categoryLabel(it.category)} muted` : `Mute ${categoryLabel(it.category).toLowerCase()}`}
              </Button>
            </section>
            <p className="mt-2 text-xs text-ink-3">Not useful lowers this kind of filing for {it.symbol}; muting lowers {categoryLabel(it.category).toLowerCase()} filings for every holding. Only your Brief changes.</p>
          </div>
        ) : null}
      </Sheet>
      {it ? (
        <AskSheet open={asking} onOpenChange={setAsking} symbol={it.symbol} company={it.company} seeds={askSeeds}
          context={`${it.symbol}: ${it.title}`} />
      ) : null}
    </>
  );
}
