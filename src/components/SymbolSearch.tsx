"use client";
// Symbol search with autocomplete over the symbol master (any NSE equity).
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { api } from "@/lib/client/api";
import { mcap } from "@/lib/format";
import { cx } from "./ui";

interface Hit { symbol: string; name: string; mcap_cr: number | null }

export function SymbolSearch({ onPick, placeholder, action, autoFocus }: { onPick: (symbol: string) => void; placeholder: string; action: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const t = q.trim();
    if (!t) { setHits([]); return; }
    timer.current = setTimeout(async () => {
      try { setHits((await api<{ results: Hit[] }>(`/api/symbols?q=${encodeURIComponent(t)}`)).results); setActive(0); } catch { setHits([]); }
    }, 160);
  }, [q]);

  const pick = (s: string) => { setQ(""); setHits([]); onPick(s.toUpperCase()); };

  return (
    <div className="relative">
      <form onSubmit={(e) => { e.preventDefault(); const t = hits[active]?.symbol ?? q.trim(); if (t) pick(t); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={17} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} autoCapitalize="characters" autoComplete="off" spellCheck={false}
            role="combobox" aria-expanded={hits.length > 0} aria-controls="symbol-hits" aria-label={placeholder}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            }}
            className="min-h-11 w-full rounded-full border border-rule bg-surface pl-10 pr-4 text-sm text-ink placeholder:text-ink-3" />
        </div>
        <button type="submit" disabled={!q.trim()} className="min-h-11 rounded-full bg-accent px-4 text-sm font-medium text-white disabled:opacity-40 dark:text-paper">{action}</button>
      </form>
      {hits.length ? (
        <ul id="symbol-hits" role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-[14px] border border-rule bg-surface shadow-lg">
          {hits.map((h, i) => (
            <li key={h.symbol} role="option" aria-selected={i === active}>
              <button type="button" onClick={() => pick(h.symbol)} className={cx("flex min-h-11 w-full items-baseline justify-between gap-3 px-4 py-2 text-left", i === active && "bg-paper")}>
                <span className="min-w-0 truncate"><span className="text-sm font-semibold">{h.symbol}</span> <span className="text-sm text-ink-2">{h.name}</span></span>
                {h.mcap_cr ? <span className="num shrink-0 text-xs text-ink-3">{mcap(h.mcap_cr)}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
