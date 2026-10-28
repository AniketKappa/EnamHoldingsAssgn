"use client";
// Cost and efficiency: every model call FINN has made, what the cache saved,
// and what the same work would cost at paid rates.
import { useApi } from "@/lib/client/api";
import { Notice, SectionTitle, SkeletonRows } from "@/components/ui";

interface Cost {
  totals: { calls: number; cached: number; usd: number; calls_24h: number };
  classification: { filings: number; by_rule: number; by_model: number };
  by_task: { task: string; calls: number; cached: number; failed: number; tokens_in: number; tokens_out: number; usd: number }[];
  by_model: { model: string; provider: string; calls: number; tokens_in: number; tokens_out: number; usd: number }[];
  dossiers: { symbol: string; at: string; calls?: number; cached_calls?: number; tokens_in?: number; cost_usd_est?: number; seconds?: number }[];
}

const TASK: Record<string, string> = {
  classify_batch: "Classify ambiguous filings", one_liners_batch: "One-line summaries", results_extract: "Read results statements",
  people_extract: "Read management changes", person_background: "Search a person's background", person_structure: "Structure the background",
  transcript_extract: "Read call transcripts", ar_extract: "Read annual reports", ledger_judge: "Check claims against numbers",
  synthesize: "Write the dossier summary", ask: "Answer questions", parse_rule: "Draft watch rules",
};

const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

export default function Page() {
  const { data, error, loading } = useApi<Cost>("/api/cost");
  return (
    <main className="pt-5">
      <h1 className="text-xl font-semibold tracking-tight">Cost and efficiency</h1>
      {error ? <div className="mt-4"><Notice tone="error">{error.message}</Notice></div> : null}
      {loading && !data ? <div className="mt-4"><SkeletonRows rows={6} /></div> : null}
      {data ? (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-[14px] border border-rule bg-rule">
            <div className="bg-surface px-3 py-3"><dt className="text-xs text-ink-2">Spent</dt><dd className="num mt-1 text-lg font-semibold">₹0</dd></div>
            <div className="bg-surface px-3 py-3"><dt className="text-xs text-ink-2">Model calls</dt><dd className="num mt-1 text-lg font-semibold">{data.totals.calls.toLocaleString("en-IN")}</dd></div>
            <div className="bg-surface px-3 py-3"><dt className="text-xs text-ink-2">From cache</dt><dd className="num mt-1 text-lg font-semibold">{data.totals.calls ? Math.round((data.totals.cached / data.totals.calls) * 100) : 0}%</dd></div>
          </dl>
          <p className="mt-3 text-sm text-ink-2">
            FINN runs on free tiers. At paid rates, everything so far would have cost about <span className="num text-ink">${data.totals.usd.toFixed(2)}</span>.
            {data.classification.filings ? <> Of {data.classification.filings.toLocaleString("en-IN")} filings, <span className="num text-ink">{Math.round((data.classification.by_rule / data.classification.filings) * 100)}%</span> were classified by rules with no model call.</> : null}
          </p>
          {!data.by_task.length ? <div className="mt-6"><Notice>No model calls yet. The first filings run and the first dossier build will appear here.</Notice></div> : null}
          {data.by_task.length ? <SectionTitle>By task</SectionTitle> : null}
          {data.by_task.length ? <table className="w-full text-sm">
            <thead><tr className="text-xs text-ink-2"><th className="py-1 text-left font-normal">Task</th><th className="py-1 text-right font-normal">Calls</th><th className="py-1 text-right font-normal">Cached</th><th className="py-1 text-right font-normal">Tokens in</th></tr></thead>
            <tbody>
              {data.by_task.map((t) => (
                <tr key={t.task} className="border-t border-rule"><td className="py-2 pr-2">{TASK[t.task] ?? t.task}</td><td className="num py-2 text-right">{t.calls}</td><td className="num py-2 text-right">{t.cached}</td><td className="num py-2 text-right">{k(t.tokens_in)}</td></tr>
              ))}
            </tbody>
          </table> : null}
          {data.by_model.length ? <SectionTitle>By model</SectionTitle> : null}
          {data.by_model.length ? <table className="w-full text-sm">
            <thead><tr className="text-xs text-ink-2"><th className="py-1 text-left font-normal">Model</th><th className="py-1 text-right font-normal">Calls</th><th className="py-1 text-right font-normal">Tokens</th><th className="py-1 text-right font-normal">At paid rates</th></tr></thead>
            <tbody>
              {data.by_model.map((m) => (
                <tr key={m.model} className="border-t border-rule"><td className="py-2 pr-2">{m.model}</td><td className="num py-2 text-right">{m.calls}</td><td className="num py-2 text-right">{k(m.tokens_in + m.tokens_out)}</td><td className="num py-2 text-right">${m.usd.toFixed(3)}</td></tr>
              ))}
            </tbody>
          </table> : null}
          {data.dossiers.length ? (
            <>
              <SectionTitle>Per dossier</SectionTitle>
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-ink-2"><th className="py-1 text-left font-normal">Company</th><th className="py-1 text-right font-normal">Calls</th><th className="py-1 text-right font-normal">Minutes</th><th className="py-1 text-right font-normal">At paid rates</th></tr></thead>
                <tbody>
                  {data.dossiers.map((d) => (
                    <tr key={`${d.symbol}${d.at}`} className="border-t border-rule"><td className="py-2">{d.symbol}</td><td className="num py-2 text-right">{d.calls ?? "–"}</td><td className="num py-2 text-right">{d.seconds ? (d.seconds / 60).toFixed(1) : "–"}</td><td className="num py-2 text-right">${(d.cost_usd_est ?? 0).toFixed(3)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          <p className="mt-4 text-xs text-ink-3">How the work is routed: rules first; a Flash-Lite model for batches of ambiguous filings and one-liners; a Flash model reads one or two targeted pages per results filing and each transcript; the strongest model writes only the dossier summary, from compact JSON, never raw documents. Responses are cached by content hash, so a repeat view costs nothing.</p>
        </>
      ) : null}
    </main>
  );
}
