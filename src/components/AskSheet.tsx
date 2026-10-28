"use client";
// Anchored Ask: questions about one company, answered only from its documents.
// There is no blank chat screen; the sheet opens with questions seeded from context.
import { useState } from "react";
import { ExternalLink, Send } from "lucide-react";
import { post, ApiError } from "@/lib/client/api";
import { Sheet } from "./Sheet";
import { Chip } from "./ui";

interface AskResult { answer: string; citations: { id: string; label: string; url: string | null; quote: string | null }[]; found: boolean; cached: boolean; warning: string | null }
interface Turn { q: string; a?: AskResult; error?: string }

export function AskSheet({ open, onOpenChange, symbol, company, seeds, context }: {
  open: boolean; onOpenChange: (o: boolean) => void; symbol: string; company: string; seeds: string[]; context?: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setQ("");
    setBusy(true);
    setTurns((t) => [...t, { q: text }]);
    try {
      const a = await post<AskResult>("/api/ask", { symbol, question: text, context });
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x)));
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: e instanceof ApiError ? e.message : "Couldn't reach FINN." } : x)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Ask about ${company}`}>
      <div className="pt-2">
        <h2 className="text-base font-semibold">Ask about {company}</h2>
        <p className="mt-1 text-xs text-ink-2">Answers come only from {company}&apos;s filings, call transcripts and annual report, with the page cited.</p>
        <div className="mt-4 space-y-5">
          {turns.map((t, i) => (
            <div key={i}>
              <p className="text-sm font-medium text-ink">{t.q}</p>
              {t.a ? (
                <div className="mt-2">
                  <p className="serif text-base text-ink">{t.a.answer}</p>
                  {t.a.warning ? <p className="mt-1 text-xs text-down">{t.a.warning}</p> : null}
                  {t.a.citations.length ? (
                    <ul className="mt-2 space-y-1.5">
                      {t.a.citations.map((c) => (
                        <li key={c.id} className="text-xs">
                          {c.url ? (
                            <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent">{c.label} <ExternalLink size={11} aria-hidden /></a>
                          ) : <span className="text-ink-2">{c.label}</span>}
                          {c.quote ? <span className="mt-0.5 block text-ink-3">“{c.quote.slice(0, 180)}{c.quote.length > 180 ? "…" : ""}”</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : t.error ? <p className="mt-2 text-sm text-down">{t.error}</p> : (
                <div className="mt-2 space-y-2" aria-busy="true"><div className="skeleton h-3.5 w-11/12" /><div className="skeleton h-3.5 w-3/4" /></div>
              )}
            </div>
          ))}
        </div>
        {seeds.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {seeds.map((s) => (
              <button key={s} type="button" onClick={() => ask(s)} disabled={busy} className="text-left">
                <Chip tone="outline" className="whitespace-normal py-1.5 text-left leading-snug">{s}</Chip>
              </button>
            ))}
          </div>
        ) : null}
        <form className="sticky bottom-0 mt-4 flex items-center gap-2 bg-surface pb-1 pt-2" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
          <label className="sr-only" htmlFor="ask-input">Question about {company}</label>
          <input id="ask-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask about ${company}`} maxLength={300}
            className="min-h-11 flex-1 rounded-full border border-rule bg-paper px-4 text-sm text-ink placeholder:text-ink-3" />
          <button type="submit" disabled={busy || !q.trim()} aria-label="Ask" className="grid h-11 w-11 place-items-center rounded-full bg-accent text-white disabled:opacity-40 dark:text-paper">
            <Send size={18} aria-hidden />
          </button>
        </form>
      </div>
    </Sheet>
  );
}
