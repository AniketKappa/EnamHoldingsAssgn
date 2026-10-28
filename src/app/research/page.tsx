"use client";
// Research: build a Dossier for any NSE company. The build runs in steps you
// can watch; a repeat visit opens the cached dossier at once.
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import type { JobT } from "@/lib/api/types";
import { api, post, useApi, ApiError } from "@/lib/client/api";
import { whenIst } from "@/lib/format";
import { SymbolSearch } from "@/components/SymbolSearch";
import { Button, Notice, SectionTitle, cx } from "@/components/ui";

const PICKS = [
  { symbol: "LT", name: "Larsen & Toubro", why: "Order inflow, revenue and margin guidance every year" },
  { symbol: "INFY", name: "Infosys", why: "Growth bands revised every quarter" },
  { symbol: "BAJFINANCE", name: "Bajaj Finance", why: "AUM growth and credit-cost guidance" },
  { symbol: "ETERNAL", name: "Eternal", why: "Store counts alongside margin targets" },
  { symbol: "POLYCAB", name: "Polycab India", why: "Multi-year revenue and margin targets" },
];

export default function Page() {
  return <Suspense fallback={null}><Research /></Suspense>;
}

function Research() {
  const sp = useSearchParams();
  const router = useRouter();
  const [job, setJob] = useState<{ id: string; symbol: string } | null>(() => (sp.get("job") && sp.get("s") ? { id: sp.get("job")!, symbol: sp.get("s")! } : null));
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(false);
  const { data: recent } = useApi<{ dossiers: { symbol: string; name: string; built_at: string; credibility: { score: number | null; resolved: number } | null }[] }>("/api/dossiers");

  async function build(symbol: string, refresh = false) {
    setErr(null);
    try {
      const r = await post<{ symbol: string; job_id?: string; version?: string }>("/api/research", { symbol, refresh });
      if (r.version && !r.job_id) { router.push(`/dossier?s=${r.symbol}`); return; }
      if (r.job_id) {
        setJob({ id: r.job_id, symbol: r.symbol });
        router.replace(`/research?job=${r.job_id}&s=${r.symbol}`, { scroll: false });
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't start the build.");
    }
  }

  useEffect(() => {
    const b = sp.get("build");
    if (b && !started.current) { started.current = true; void build(b); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  return (
    <main className="pt-5">
      <h1 className="text-xl font-semibold tracking-tight">Research</h1>
      <p className="mt-1 text-sm text-ink-2">A dossier for any NSE company, built from its own call transcripts and annual report: what management promised, what it delivered, and the numbers behind both.</p>
      <div className="mt-4"><SymbolSearch onPick={(s) => build(s)} placeholder="Any NSE symbol or company" action="Build" /></div>
      {err ? <div className="mt-3"><Notice tone="error">{err}</Notice></div> : null}
      {job ? <JobProgress key={job.id} job={job} onDone={(s) => router.push(`/dossier?s=${s}`)} onRetry={() => build(job.symbol, true)} /> : null}

      {recent?.dossiers.length ? (
        <section>
          <SectionTitle>Recent dossiers</SectionTitle>
          <ul className="divide-y divide-rule border-y border-rule">
            {recent.dossiers.map((d) => (
              <li key={d.symbol}>
                <Link href={`/dossier?s=${d.symbol}`} className="flex min-h-12 items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0"><span className="text-sm font-semibold">{d.symbol}</span> <span className="text-sm text-ink-2">{d.name}</span></span>
                  <span className="shrink-0 text-right text-xs text-ink-2">
                    {d.credibility?.score !== null && d.credibility?.score !== undefined ? <span className="num mr-2 text-accent">{d.credibility.score}% met</span> : null}
                    {whenIst(d.built_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <SectionTitle>Good first dossiers</SectionTitle>
        <ul className="divide-y divide-rule border-y border-rule">
          {PICKS.map((p) => (
            <li key={p.symbol}>
              <button type="button" onClick={() => build(p.symbol)} className="flex min-h-12 w-full items-center justify-between gap-3 py-2.5 text-left">
                <span className="min-w-0">
                  <span className="text-sm font-semibold">{p.symbol}</span> <span className="text-sm text-ink-2">{p.name}</span>
                  <span className="block text-xs text-ink-3">{p.why}</span>
                </span>
                <span className="shrink-0 text-xs text-accent">{recent?.dossiers.some((x) => x.symbol === p.symbol) ? "Open" : "Build"}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-3">Try any other ticker too, such as TITAN, HCLTECH or ASIANPAINT. A first build takes two to four minutes; repeat visits open instantly.</p>
      </section>
    </main>
  );
}

function JobProgress({ job, onDone, onRetry }: { job: { id: string; symbol: string }; onDone: (s: string) => void; onRetry: () => void }) {
  const [j, setJ] = useState<JobT | null>(null);
  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await api<JobT>(`/api/jobs?id=${job.id}`);
        if (!alive) return;
        setJ(r);
        if (r.status === "done") { setTimeout(() => onDone(r.symbol ?? job.symbol), 600); return; }
        if (r.status === "failed") return;
      } catch { /* keep polling */ }
      if (alive) setTimeout(tick, 2000);
    };
    void tick();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearInterval(clock); };
  }, [job.id, job.symbol, onDone]);
  const secs = Math.round((now - t0) / 1000);
  return (
    <section className="mt-5 rounded-[14px] border border-rule bg-surface px-4 py-4" aria-live="polite">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Building the {j?.symbol ?? job.symbol} dossier</h2>
        <span className="num text-xs text-ink-2">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-rule" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={j?.progress ?? 0}>
        <div className={cx("h-full rounded-full transition-[width] duration-700", j?.status === "failed" ? "bg-down" : "bg-accent")} style={{ width: `${Math.max(3, j?.progress ?? 3)}%` }} />
      </div>
      <ul className="mt-3 space-y-1.5">
        {(j?.log ?? []).map((l, i) => (
          <li key={i} className="flex gap-2 text-sm text-ink-2"><Check size={15} className="mt-0.5 shrink-0 text-up" aria-hidden />{l.text}</li>
        ))}
        {j && j.status !== "done" && j.status !== "failed" ? <li className="flex gap-2 text-sm text-ink"><span className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden />{j.step ?? "Starting"}…</li> : null}
        {!j ? <li className="text-sm text-ink-2">Starting…</li> : null}
      </ul>
      {j?.status === "failed" ? (
        <div className="mt-3"><Notice tone="error" action={<Button onClick={onRetry}>Try again</Button>}>{j.error ?? "The build stopped."}</Notice></div>
      ) : null}
      {j?.status === "done" ? <p className="mt-2 text-sm text-up">Dossier built. Opening it…</p> : null}
    </section>
  );
}
