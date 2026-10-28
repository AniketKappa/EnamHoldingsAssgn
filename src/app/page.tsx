"use client";
// The Brief: a finite, ranked list of what changed across the portfolio.
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Settings, Volume2, Square } from "lucide-react";
import type { BriefItem, BriefT } from "@/lib/api/types";
import { useApi, post, invalidate } from "@/lib/client/api";
import { FunnelLine } from "@/components/Funnel";
import { EventRow, TopCard, resultsSentence } from "@/components/cards";
import { EventSheet } from "@/components/EventSheet";
import { AskSheet } from "@/components/AskSheet";
import { Sheet } from "@/components/Sheet";
import { Button, Notice, SectionTitle, SkeletonRows, cx, plural } from "@/components/ui";
import { whenIst } from "@/lib/format";

const WINDOWS = [["24h", "24h"], ["3d", "3d"], ["7d", "7d"], ["30d", "30d"]] as const;

export default function Page() {
  return (
    <Suspense fallback={<BriefSkeleton />}>
      <Brief />
    </Suspense>
  );
}

function todayLabel() {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" }).format(new Date());
}

function BriefSkeleton() {
  return (
    <div className="pt-6">
      <div className="skeleton h-5 w-28" />
      <div className="skeleton mt-4 h-8 w-4/5" />
      <div className="mt-8"><SkeletonRows rows={4} card /></div>
    </div>
  );
}

function Brief() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const w = sp.get("w") ?? "24h";
  const from = sp.get("from"), to = sp.get("to");
  const url = `/api/brief?w=${encodeURIComponent(w)}${w === "custom" && from ? `&from=${from}${to ? `&to=${to}` : ""}` : ""}`;
  const { data, error, loading, mutate } = useApi<BriefT>(url, { refreshMs: 120_000 });
  const openKey = sp.get("e");
  const [askFor, setAskFor] = useState<BriefItem | null>(null);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const [routineOpen, setRoutineOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [day, setDay] = useState("");
  useEffect(() => setDay(todayLabel()), []);

  const setParam = (k: string, v: string | null, extra: Record<string, string | null> = {}) => {
    const p = new URLSearchParams(sp.toString());
    for (const [kk, vv] of Object.entries({ [k]: v, ...extra })) { if (vv === null) p.delete(kk); else p.set(kk, vv); }
    router.replace(`${path}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };
  const open = (key: string) => setParam("e", key);

  async function done(item: BriefItem) {
    const on = !item.done;
    if (on && !showDone) {
      setLeaving((s) => new Set(s).add(item.key));
      await new Promise((r) => setTimeout(r, 300));
    }
    mutate((d) => d && { ...d, top: d.top.map((x) => (x.key === item.key ? { ...x, done: on } : x)), worth: d.worth.map((x) => (x.key === item.key ? { ...x, done: on } : x)) });
    setLeaving((s) => { const n = new Set(s); n.delete(item.key); return n; });
    await post("/api/feedback", { event_key: item.key, action: "done", on }).catch(() => undefined);
    invalidate("/api/alerts");
  }

  const top = useMemo(() => (data?.top ?? []).filter((x) => showDone || !x.done), [data, showDone]);
  const worth = useMemo(() => (data?.worth ?? []).filter((x) => showDone || !x.done), [data, showDone]);
  const doneCount = (data?.top ?? []).concat(data?.worth ?? []).filter((x) => x.done).length;
  const caughtUp = !!data && (data.top.length + data.worth.length) > 0 && !top.length && !worth.length;

  return (
    <main className="pt-5">
      <header className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-ink" suppressHydrationWarning>{day || " "}</h1>
        <div className="flex items-center gap-1">
          {data ? <ListenButton data={data} /> : null}
          <Link href="/settings" aria-label="Settings and how FINN decides" className="grid h-11 w-11 place-items-center rounded-full text-ink-2">
            <Settings size={21} aria-hidden />
          </Link>
        </div>
      </header>

      <section className="mt-2" aria-label="Today in numbers">
        {data ? <FunnelLine {...data.funnel} /> : <div className="skeleton h-8 w-4/5" />}
        <div className="scroll-x -mx-4 mt-4 flex gap-2 px-4" role="tablist" aria-label="Time window">
          {WINDOWS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={w === k} type="button" onClick={() => setParam("w", k === "24h" ? null : k, { from: null, to: null })}
              className={cx("min-h-9 shrink-0 rounded-full px-3.5 text-sm", w === k ? "bg-ink text-paper" : "border border-rule bg-surface text-ink-2")}>
              {label}
            </button>
          ))}
          <button role="tab" aria-selected={w === "custom"} type="button" onClick={() => setCustomOpen(true)}
            className={cx("min-h-9 shrink-0 rounded-full px-3.5 text-sm", w === "custom" ? "bg-ink text-paper" : "border border-rule bg-surface text-ink-2")}>
            {w === "custom" && data ? data.window.label : "Custom"}
          </button>
        </div>
        {data?.freshness.delayed ? <p className="mt-3 text-xs text-down">Data may be delayed: filings last checked {whenIst(data.freshness.filings_checked_at!)}.</p> : null}
      </section>

      {error ? <div className="mt-6"><Notice tone="error">{error.message}</Notice></div> : null}
      {loading && !data ? <div className="mt-6"><SkeletonRows rows={4} card /></div> : null}

      {data ? (
        <>
          {caughtUp ? (
            <div className="mt-6 rounded-[14px] border border-rule bg-surface px-5 py-6">
              <p className="serif text-lg text-ink">You&apos;re caught up.</p>
              <p className="mt-1 text-sm text-ink-2">
                {data.upcoming[0] ? <>Next: {data.upcoming[0].name} results, {fmtDay(data.upcoming[0].date)}.</> : "Nothing else in this window needs you."}
              </p>
            </div>
          ) : null}

          {data.quiet ? (
            <div className="mt-6 rounded-[14px] border border-rule bg-surface px-5 py-6">
              <p className="serif text-lg text-ink">Quiet {w === "24h" ? "day" : "stretch"} across your {plural(data.holdings, "holding")}.</p>
              <p className="mt-1 text-sm text-ink-2">
                {data.routine.count ? `${plural(data.routine.count, "routine filing")}. ` : ""}
                {data.quiet.last_material ? <>Last material event: {data.quiet.last_material.symbol}, {data.quiet.last_material.title.charAt(0).toLowerCase() + data.quiet.last_material.title.slice(1)} ({whenIst(data.quiet.last_material.at)}).</> : null}
              </p>
              {w !== "7d" && w !== "30d" ? <div className="mt-4"><Button onClick={() => setParam("w", "7d", { from: null, to: null })}>Show 7 days</Button></div> : null}
            </div>
          ) : null}

          {top.length ? (
            <section aria-label="Top" className="mt-6 space-y-4">
              {top.map((item) => (
                <TopCard key={item.key} item={item} leaving={leaving.has(item.key)} onOpen={() => open(item.key)} onDone={() => done(item)} onAsk={() => setAskFor(item)} />
              ))}
            </section>
          ) : null}

          {worth.length ? (
            <section aria-labelledby="worth-h">
              <SectionTitle id="worth-h" aside={plural(worth.length, "event")}>Worth a look</SectionTitle>
              <ul className="divide-y divide-rule border-y border-rule">
                {worth.map((item) => <EventRow key={item.key} item={item} onOpen={() => open(item.key)} />)}
              </ul>
            </section>
          ) : null}

          {data.routine.count ? (
            <section className="mt-6" aria-label="Routine">
              <button type="button" onClick={() => setRoutineOpen((o) => !o)} aria-expanded={routineOpen}
                className="flex min-h-12 w-full items-center justify-between rounded-[12px] border border-rule bg-surface/60 px-4 text-left text-sm text-ink-2">
                <span>{plural(data.routine.count, "routine filing")}</span>
                <ChevronDown size={18} aria-hidden className={cx("transition-transform", routineOpen && "rotate-180")} />
              </button>
              {routineOpen ? (
                <ul className="mt-1 divide-y divide-rule">
                  {data.routine.items.map((r) => <EventRow key={r.key} item={r} compact onOpen={() => open(r.key)} />)}
                </ul>
              ) : null}
            </section>
          ) : null}

          <footer className="mt-6 space-y-2 text-xs text-ink-2">
            {data.hidden_count ? <p>{plural(data.hidden_count, "compliance filing")} not shown: trading windows, certificates and similar paperwork.</p> : null}
            {doneCount ? (
              <button type="button" className="min-h-9 text-accent" onClick={() => setShowDone((s) => !s)}>
                {showDone ? "Hide done items" : `Show ${plural(doneCount, "done item")}`}
              </button>
            ) : null}
            {data.upcoming.length && !caughtUp ? (
              <p>Results coming up: {data.upcoming.map((u) => `${u.name} ${fmtDay(u.date)}`).join(", ")}.</p>
            ) : null}
            {!data.configured.llm ? <p>Model features are off on this deployment, so results numbers and summaries are pending.</p> : null}
          </footer>
        </>
      ) : null}

      <EventSheet eventKey={openKey} onClose={() => setParam("e", null)} />
      {askFor ? (
        <AskSheet open={!!askFor} onOpenChange={(o) => { if (!o) setAskFor(null); }} symbol={askFor.symbol} company={askFor.company}
          context={`${askFor.symbol}: ${askFor.title}`}
          seeds={askFor.results ? [`What did management guide for ${askFor.results.quarter.split(" ")[1]}?`, "What drove the change in margins?", "What did they say about demand?"] : ["What does this filing say?", "Has the company said anything about this before?"]} />
      ) : null}
      <CustomRange open={customOpen} onOpenChange={setCustomOpen} onApply={(f, t) => { setCustomOpen(false); setParam("w", "custom", { from: f, to: t }); }} />
    </main>
  );
}

function fmtDay(d: string) {
  return new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

function CustomRange({ open, onOpenChange, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; onApply: (from: string, to: string) => void }) {
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const [f, setF] = useState(today);
  const [t, setT] = useState(today);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Custom range">
      <div className="pt-2 pb-4">
        <h2 className="text-base font-semibold">Custom range</h2>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-xs text-ink-2">From
            <input type="date" value={f} max={t} onChange={(e) => setF(e.target.value)} className="mt-1 min-h-11 w-full rounded-[10px] border border-rule bg-paper px-3 text-sm text-ink" />
          </label>
          <label className="text-xs text-ink-2">To
            <input type="date" value={t} min={f} max={today} onChange={(e) => setT(e.target.value)} className="mt-1 min-h-11 w-full rounded-[10px] border border-rule bg-paper px-3 text-sm text-ink" />
          </label>
        </div>
        <div className="mt-4"><Button variant="primary" onClick={() => onApply(f, t)}>Show this range</Button></div>
      </div>
    </Sheet>
  );
}

/** Listen: a spoken Brief for the commute, using the phone's own speech synthesis (no cost, no model). */
function ListenButton({ data }: { data: BriefT }) {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(typeof window !== "undefined" && "speechSynthesis" in window), []);
  if (!supported) return null;
  const script = () => {
    const say = (s: string) => s.replace(/₹/g, "rupees ").replace(/ cr\b/g, " crore").replace(/YoY/g, "year on year").replace(/QoQ/g, "quarter on quarter").replace(/bps/g, "basis points").replace(/−/g, "minus ");
    const lines = [`${data.funnel.matter} ${data.funnel.matter === 1 ? "thing matters" : "things matter"} in your FINN Brief.`];
    for (const t of data.top.filter((x) => !x.done).slice(0, 4)) lines.push(`${t.company}. ${t.results ? resultsSentence(t.results) : t.title}.`);
    const w = data.worth.filter((x) => !x.done);
    if (w.length) lines.push(`Also worth a look: ${w.slice(0, 4).map((x) => `${x.company}, ${x.title}`).join(". ")}.`);
    if (data.routine.count) lines.push(`${data.routine.count} routine filings are collapsed.`);
    return say(lines.join(" "));
  };
  const toggle = () => {
    const synth = window.speechSynthesis;
    if (speaking) { synth.cancel(); setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(script());
    u.lang = "en-IN";
    u.rate = 1.02;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.speak(u);
    setSpeaking(true);
  };
  return (
    <button type="button" onClick={toggle} aria-label={speaking ? "Stop reading the Brief" : "Listen to the Brief"} className="grid h-11 w-11 place-items-center rounded-full text-ink-2">
      {speaking ? <Square size={18} aria-hidden /> : <Volume2 size={21} aria-hidden />}
    </button>
  );
}
