"use client";
// Company page: 120 sessions of price with a marker wherever a filing landed,
// the recent events, the next results date and the way into the Dossier.
import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { CompanyT } from "@/lib/api/types";
import { useApi, post, api, invalidate, ApiError } from "@/lib/client/api";
import { mcap, price, multiple, whenIst } from "@/lib/format";
import { PriceChart } from "@/components/charts";
import { EventRow, kindLabel } from "@/components/cards";
import { EventSheet } from "@/components/EventSheet";
import { Button, Delta, Notice, SectionTitle, SkeletonRows } from "@/components/ui";

export default function Page() {
  return <Suspense fallback={<div className="pt-6"><SkeletonRows rows={5} card /></div>}><Company /></Suspense>;
}

function Company() {
  const sp = useSearchParams();
  const router = useRouter();
  const symbol = (sp.get("s") ?? "").toUpperCase();
  const { data, error, loading, reload } = useApi<CompanyT>(symbol ? `/api/company?symbol=${encodeURIComponent(symbol)}` : null);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function toggleHolding() {
    if (!data) return;
    try {
      if (data.held) await api(`/api/portfolio?symbol=${encodeURIComponent(data.symbol)}`, { method: "DELETE" });
      else await post("/api/portfolio", { symbol: data.symbol });
      setMsg(data.held ? `Removed ${data.symbol} from your portfolio.` : `Added ${data.symbol} to your portfolio.`);
      invalidate("/api/portfolio"); invalidate("/api/brief");
      await reload();
    } catch (e) { setMsg(e instanceof ApiError ? e.message : "Couldn't update your portfolio."); }
  }

  if (!symbol) return <main className="pt-6"><Notice>Pick a company from your portfolio or search in Research.</Notice></main>;
  const last = data?.prices[data.prices.length - 1];
  return (
    <main className="pt-3">
      <button type="button" onClick={() => router.back()} className="-ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-sm text-ink-2"><ChevronLeft size={18} aria-hidden /> Back</button>
      {error ? <Notice tone="error">{error.message}</Notice> : null}
      {loading && !data ? <SkeletonRows rows={5} card /> : null}
      {data ? (
        <>
          <header>
            <h1 className="text-xl font-semibold tracking-tight">{data.name}</h1>
            <p className="mt-0.5 text-sm text-ink-2">{data.symbol}{data.sector ? `, ${data.sector}` : ""}{data.mcap_cr ? `, market cap ${mcap(data.mcap_cr)}` : ""}</p>
            {last ? (
              <p className="mt-3 flex items-baseline gap-3">
                <span className="num text-lg font-semibold">{price(last.close)}</span>
                {data.signal ? <Delta value={data.signal.ret_pct} className="text-sm" /> : null}
                {data.signal?.vol_ratio ? <span className="num text-xs text-ink-2">Volume {multiple(data.signal.vol_ratio)} average</span> : null}
              </p>
            ) : null}
          </header>
          <div className="mt-3 rounded-[14px] border border-rule bg-surface px-2 pb-1 pt-3">
            <PriceChart prices={data.prices} markers={data.events.filter((e) => e.tier === "top" || e.tier === "worth").map((e) => ({
              d: new Date(new Date(e.at).getTime() + 330 * 60_000).toISOString().slice(0, 10), tier: e.tier, label: e.title, onClick: () => setOpen(e.key),
            }))} />
            <p className="px-2 pb-2 text-xs text-ink-3">{data.prices.length} sessions. Dots mark material filings; tap one to open it.</p>
          </div>
          {data.upcoming ? <p className="mt-3 text-sm text-ink-2">Next results: <span className="text-ink">{new Date(`${data.upcoming}T00:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span></p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" href={data.dossier ? `/dossier?s=${data.symbol}` : `/research?build=${data.symbol}`}>{data.dossier ? "Open dossier" : "Build dossier"}</Button>
            <Button onClick={toggleHolding}>{data.held ? "Remove from portfolio" : "Add to portfolio"}</Button>
          </div>
          {data.dossier ? <p className="mt-2 text-xs text-ink-3">Dossier built {whenIst(data.dossier.built_at)}.</p> : null}
          {msg ? <p className="mt-2 text-xs text-ink-2" role="status">{msg}</p> : null}
          <SectionTitle>Recent events</SectionTitle>
          {data.events.length ? (
            <ul className="divide-y divide-rule border-y border-rule">
              {data.events.map((e) => <EventRow key={e.key} item={{ key: e.key, symbol: kindLabel(e.category, e.subtype), title: e.title, at: e.at, tier: e.tier }} onOpen={() => setOpen(e.key)} />)}
            </ul>
          ) : <Notice>No filings stored for {data.symbol} yet.{data.held ? " The first run fetches 30 days." : " Add it to your portfolio to follow its filings."}</Notice>}
          {!data.held ? <p className="mt-3 text-xs text-ink-3">FINN follows filings for portfolio companies only; research works for any NSE company.</p> : null}
          <Link href="/portfolio" className="mt-6 inline-flex min-h-11 items-center text-sm text-accent">All holdings</Link>
        </>
      ) : null}
      <EventSheet eventKey={open} onClose={() => setOpen(null)} />
    </main>
  );
}
