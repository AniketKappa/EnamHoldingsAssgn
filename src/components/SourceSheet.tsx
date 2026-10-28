"use client";
// The source drawer: every citation opens the page (or table cell) it came from.
import { ExternalLink } from "lucide-react";
import { useApi } from "@/lib/client/api";
import type { Fact } from "@/lib/research/facts";
import { Sheet } from "./Sheet";
import { Notice, SkeletonRows } from "./ui";

interface PageT { doc_type: string; period_label: string | null; url: string; symbol: string; page: number; text: string }

const DOC_NAME: Record<string, string> = { transcript: "call transcript", presentation: "investor presentation", annual_report: "annual report", results: "results filing", filing: "filing" };

export function factValue(f: Fact) {
  const v = f.value;
  if (f.unit === "pct") return `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
  if (f.unit === "cr") return `₹${Math.round(v).toLocaleString("en-IN")} cr`;
  if (f.unit === "bps") return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)} bps`;
  if (f.unit === "x") return `${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}×`;
  if (f.unit === "days") return `${Math.round(v)} days`;
  if (f.unit === "rs") return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  return String(v);
}

function highlight(text: string, quote: string | null) {
  if (!quote) return text;
  const words = quote.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 6);
  if (!words.length) return text;
  const lower = text.toLowerCase();
  let best = -1;
  for (const w of words) { const i = lower.indexOf(w); if (i >= 0 && (best < 0 || i < best)) best = i; }
  if (best < 0) return text;
  const start = Math.max(0, best - 400);
  return (start ? "…" : "") + text.slice(start, start + 1600) + (start + 1600 < text.length ? "…" : "");
}

export function SourceSheet({ cite, onClose, facts, quote, screenerUrl }: {
  cite: string | null; onClose: () => void; facts: Record<string, Fact>; quote?: string | null; screenerUrl?: string;
}) {
  const doc = cite?.match(/^doc:(\d+):p(\d+)$/);
  const factKey = cite?.startsWith("fact:") ? cite.slice(5) : null;
  const many = cite?.startsWith("facts:") ? cite.slice(6).split(",").map((k) => facts[k]).filter(Boolean) : null;
  const { data, error, loading } = useApi<PageT>(doc ? `/api/page?doc=${doc[1]}&p=${doc[2]}` : null);
  const f = factKey ? facts[factKey] : null;
  return (
    <Sheet open={!!cite} onOpenChange={(o) => { if (!o) onClose(); }} title="Source">
      <div className="pb-4 pt-2">
        {many ? (
          <>
            <h2 className="text-base font-semibold">Figures behind this line</h2>
            <ul className="mt-3 divide-y divide-rule border-y border-rule">
              {many.map((x) => (
                <li key={x.key} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3"><span className="text-sm">{x.label}, {x.period}</span><span className="num text-sm font-semibold">{factValue(x)}</span></div>
                  <p className="mt-0.5 text-xs text-ink-2">{x.source}</p>
                </li>
              ))}
            </ul>
            {screenerUrl ? <a href={screenerUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm text-accent">Open the tables on screener <ExternalLink size={13} aria-hidden /></a> : null}
          </>
        ) : f ? (
          <>
            <h2 className="text-base font-semibold">{f.label}</h2>
            <p className="num mt-2 text-xl font-semibold">{factValue(f)}</p>
            <p className="mt-1 text-sm text-ink-2">{f.period}</p>
            <p className="mt-3 text-sm text-ink-2">Computed by FINN from {f.source}.</p>
            {screenerUrl ? <a href={screenerUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm text-accent">Open the table on screener <ExternalLink size={13} aria-hidden /></a> : null}
          </>
        ) : factKey || cite?.startsWith("facts:") ? (
          <Notice>This figure isn&apos;t in the stored facts any more; rebuild the dossier to refresh it.</Notice>
        ) : (
          <>
            {loading && !data ? <SkeletonRows rows={5} /> : null}
            {error ? <Notice tone="error">{error.message}</Notice> : null}
            {data ? (
              <>
                <h2 className="text-base font-semibold">{data.period_label ? `${data.period_label} ` : ""}{DOC_NAME[data.doc_type] ?? data.doc_type}, page {data.page}</h2>
                {quote ? <blockquote className="serif mt-3 border-l-2 border-accent pl-3 text-base text-ink">“{quote}”</blockquote> : null}
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-2">{highlight(data.text, quote ?? null)}</p>
                <a href={`${data.url}#page=${data.page}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm text-accent">
                  Open the PDF at page {data.page} <ExternalLink size={13} aria-hidden />
                </a>
              </>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
