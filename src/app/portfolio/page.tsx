"use client";
// Portfolio: the holdings FINN watches, with today's move, volume against its
// average, and the latest event that mattered. Any NSE stock can be added.
import Link from "next/link";
import { useState } from "react";
import type { HoldingT } from "@/lib/api/types";
import { useApi, post, invalidate, ApiError } from "@/lib/client/api";
import { price, whenIst, multiple } from "@/lib/format";
import { SymbolSearch } from "@/components/SymbolSearch";
import { Sparkline } from "@/components/charts";
import { Delta, Notice, SkeletonRows, cx, plural } from "@/components/ui";

export default function Page() {
  const { data, error, loading, reload } = useApi<{ holdings: HoldingT[] }>("/api/portfolio", { refreshMs: 30_000 });
  const [msg, setMsg] = useState<string | null>(null);

  async function add(symbol: string) {
    setMsg(null);
    try {
      const r = await post<{ symbol: string; name: string; job_id: string | null }>("/api/portfolio", { symbol });
      setMsg(r.job_id ? `Added ${r.name}. Fetching 30 days of filings and a year of prices; it joins your Brief in a few minutes.` : `Added ${r.name}.`);
      await reload();
      invalidate("/api/brief");
      if (r.job_id) void fetch(`/api/jobs?id=${r.job_id}`);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Couldn't add that stock.");
    }
  }

  const holdings = data?.holdings ?? [];
  return (
    <main className="pt-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Portfolio</h1>
        {holdings.length ? <span className="text-xs text-ink-2">{plural(holdings.length, "holding")}</span> : null}
      </div>
      <div className="mt-4"><SymbolSearch onPick={add} placeholder="Add any NSE stock" action="Add" /></div>
      {msg ? <p className="mt-2 text-xs text-ink-2" role="status">{msg}</p> : null}
      {error ? <div className="mt-6"><Notice tone="error">{error.message}</Notice></div> : null}
      {loading && !data ? <div className="mt-6"><SkeletonRows rows={6} /></div> : null}
      {data && !holdings.length ? <div className="mt-6"><Notice>Your portfolio is empty. Add a stock above and FINN starts watching its filings and prices.</Notice></div> : null}
      <ul className="mt-4 divide-y divide-rule border-y border-rule">
        {holdings.map((h) => (
          <li key={h.symbol}>
            <Link href={`/company?s=${encodeURIComponent(h.symbol)}`} className="block py-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold">{h.symbol}</span>
                    {h.weight_pct ? <span className="num text-xs text-ink-3">{h.weight_pct}%</span> : null}
                  </div>
                  <div className="truncate text-xs text-ink-2">{h.name}</div>
                </div>
                <Sparkline values={h.spark} />
                <div className="w-[92px] shrink-0 text-right">
                  <div className="num text-sm">{price(h.last_close)}</div>
                  <Delta value={h.ret_pct} className="text-xs" />
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <VolumeBar ratio={h.vol_ratio} />
                <span className={cx("min-w-0 flex-1 truncate text-xs", h.latest ? "text-ink-2" : "text-ink-3")}>
                  {h.backfilling ? "Fetching 30 days of filings…" : h.latest ? `${whenIst(h.latest.at)}: ${h.latest.title}` : "No material filings in the last month"}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {holdings.length ? <p className="mt-3 text-xs text-ink-3">Weights are illustrative; they raise the ranking of events in larger positions. Prices are end of day.</p> : null}
    </main>
  );
}

/** Volume against its 20-session average: the tick marks the average, the bar today. */
function VolumeBar({ ratio }: { ratio: number | null }) {
  const r = ratio ?? 0;
  const w = Math.min(r / 3, 1) * 100;
  const hot = r >= 2;
  return (
    <span className="flex w-[104px] shrink-0 items-center gap-1.5" title={ratio ? `Volume ${multiple(ratio)} its 20-day average` : "No volume data"}>
      <span className="relative h-1.5 w-14 rounded-full bg-rule">
        <span className={cx("absolute inset-y-0 left-0 rounded-full", hot ? "bg-accent" : "bg-ink-3")} style={{ width: `${w}%` }} />
        <span aria-hidden className="absolute -top-0.5 h-2.5 w-px bg-ink-2" style={{ left: `${100 / 3}%` }} />
      </span>
      <span className={cx("num text-xs", hot ? "font-medium text-accent" : "text-ink-3")}>{ratio ? multiple(ratio) : "–"}</span>
    </span>
  );
}
