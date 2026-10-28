"use client";
// Alerts: the inbox of everything a watch rule caught, and the rules themselves,
// written in plain English and kept as editable chips that code evaluates.
import { Suspense, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Plus, Trash2, X } from "lucide-react";
import type { AlertT, RuleT } from "@/lib/api/types";
import { useApi, post, api, invalidate, ApiError } from "@/lib/client/api";
import { whenIst } from "@/lib/format";
import { PushControls } from "@/components/PushControls";
import { Button, Chip, Notice, SkeletonRows, cx, plural } from "@/components/ui";

export default function Page() {
  return <Suspense fallback={<div className="pt-6"><SkeletonRows rows={5} /></div>}><Alerts /></Suspense>;
}

function Alerts() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const tab = sp.get("tab") === "rules" ? "rules" : "inbox";
  const setTab = (t: string) => router.replace(t === "inbox" ? path : `${path}?tab=${t}`, { scroll: false });
  return (
    <main className="pt-5">
      <h1 className="text-xl font-semibold tracking-tight">Alerts</h1>
      <div className="mt-4 grid grid-cols-2 rounded-full border border-rule bg-surface p-1" role="tablist" aria-label="Alerts view">
        {(["inbox", "rules"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}
            className={cx("min-h-10 rounded-full text-sm", tab === t ? "bg-ink text-paper" : "text-ink-2")}>
            {t === "inbox" ? "Inbox" : "Watch rules"}
          </button>
        ))}
      </div>
      <div className="mt-4"><PushControls /></div>
      {tab === "inbox" ? <Inbox /> : <Rules />}
    </main>
  );
}

function Inbox() {
  const router = useRouter();
  const { data, error, loading, mutate } = useApi<{ alerts: AlertT[]; unread: number }>("/api/alerts", { refreshMs: 60_000 });
  async function openAlert(a: AlertT) {
    if (!a.read) {
      mutate((d) => d && { ...d, unread: Math.max(0, d.unread - 1), alerts: d.alerts.map((x) => (x.id === a.id ? { ...x, read: true } : x)) });
      void post("/api/alerts/read", { ids: [a.id] }).then(() => invalidate("/api/alerts"));
    }
    if (a.url) router.push(a.url);
  }
  async function readAll() {
    mutate((d) => d && { ...d, unread: 0, alerts: d.alerts.map((x) => ({ ...x, read: true })) });
    await post("/api/alerts/read", {});
    invalidate("/api/alerts");
  }
  if (error) return <div className="mt-6"><Notice tone="error">{error.message}</Notice></div>;
  if (loading && !data) return <div className="mt-6"><SkeletonRows rows={5} /></div>;
  if (!data) return null;
  if (!data.alerts.length) {
    return (
      <div className="mt-6"><Notice>No alerts yet. FINN checks filings every 10 minutes and prices after the close; anything that matches a watch rule lands here.</Notice></div>
    );
  }
  return (
    <section className="mt-4">
      <div className="flex items-center justify-between py-2 text-xs text-ink-2">
        <span>{data.unread ? `${plural(data.unread, "unread alert")}` : "All read"}</span>
        {data.unread ? <button type="button" className="min-h-9 text-accent" onClick={readAll}>Mark all read</button> : null}
      </div>
      <ul className="divide-y divide-rule border-y border-rule">
        {data.alerts.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => openAlert(a)} className="flex w-full items-start gap-3 py-3 text-left">
              <span aria-hidden className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", a.read ? "bg-transparent" : "bg-accent")} />
              <span className="min-w-0 flex-1">
                <span className={cx("block text-sm", a.read ? "text-ink-2" : "font-medium text-ink")}>{a.title}</span>
                {a.body ? <span className={cx("mt-0.5 block text-sm", /^No filing/.test(a.body) ? "text-down" : "text-ink-2")}>{a.body}</span> : null}
                {a.rule ? <span className="mt-1 block text-xs text-ink-3">Rule: {a.rule}</span> : null}
              </span>
              <time className="num shrink-0 text-xs text-ink-2" dateTime={a.at}>{whenIst(a.at)}</time>
              {!a.read ? <span className="sr-only">Unread</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Draft { kind: RuleT["kind"]; symbol: string | null; params: Record<string, unknown>; label: string }

function Rules() {
  const { data, error, loading, reload } = useApi<{ rules: RuleT[] }>("/api/rules");
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function parse(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await post<{ rules: Draft[]; unparsed: string | null }>("/api/rules/parse", { text });
      setDrafts(r.rules);
      if (!r.rules.length) setMsg("FINN couldn't turn that into a rule. Try \"Tell me if DIXON moves 5%\" or \"any promoter pledge\".");
      else if (r.unparsed) setMsg(`Not understood: "${r.unparsed}"`);
    } catch (e2) { setMsg(e2 instanceof ApiError ? e2.message : "Couldn't read that rule."); }
    finally { setBusy(false); }
  }
  async function add(d: Draft) {
    await post("/api/rules", { ...d, source_text: text });
    setDrafts((x) => x.filter((y) => y !== d));
    if (drafts.length <= 1) setText("");
    await reload();
  }
  async function toggle(r: RuleT) {
    await api(`/api/rules?id=${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !r.enabled }) });
    await reload();
  }
  async function remove(r: RuleT) {
    await api(`/api/rules?id=${r.id}`, { method: "DELETE" });
    await reload();
  }
  async function setParam(r: RuleT, params: Record<string, unknown>, label: string) {
    await api(`/api/rules?id=${r.id}`, { method: "PATCH", body: JSON.stringify({ params, label }) });
    await reload();
  }

  return (
    <section className="mt-6">
      <form onSubmit={parse}>
        <label htmlFor="rule-text" className="text-sm font-semibold">Tell me if…</label>
        <div className="mt-2 flex gap-2">
          <input id="rule-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={300}
            placeholder="DIXON moves 5%, or any pledge"
            className="min-h-11 flex-1 rounded-full border border-rule bg-surface px-4 text-sm text-ink placeholder:text-ink-3" />
          <Button type="submit" variant="primary" disabled={busy || !text.trim()}>Add</Button>
        </div>
      </form>
      {msg ? <p className="mt-2 text-xs text-ink-2" role="status">{msg}</p> : null}
      {drafts.length ? (
        <div className="mt-3 rounded-[14px] border border-accent/40 bg-accent-soft/40 p-3">
          <p className="text-xs text-ink-2">FINN will watch for:</p>
          <ul className="mt-2 space-y-2">
            {drafts.map((d, i) => (
              <li key={i} className="chip-pop flex items-center justify-between gap-2">
                <span className="text-sm text-ink">{d.label}</span>
                <span className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => add(d)} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-accent px-3 text-xs text-white dark:text-paper"><Plus size={14} aria-hidden /> Save rule</button>
                  <button type="button" onClick={() => setDrafts((x) => x.filter((y) => y !== d))} aria-label="Discard" className="grid h-9 w-9 place-items-center rounded-full text-ink-2"><X size={16} aria-hidden /></button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <h2 className="mt-8 text-sm font-semibold">Your rules</h2>
      {error ? <div className="mt-2"><Notice tone="error">{error.message}</Notice></div> : null}
      {loading && !data ? <div className="mt-3"><SkeletonRows rows={4} /></div> : null}
      <ul className="mt-2 divide-y divide-rule border-y border-rule">
        {(data?.rules ?? []).map((r) => (
          <li key={r.id} className="py-3">
            <div className="flex items-center gap-3">
              <button type="button" role="switch" aria-checked={r.enabled} aria-label={`${r.enabled ? "Turn off" : "Turn on"}: ${r.label}`} onClick={() => toggle(r)}
                className={cx("relative h-6 w-10 shrink-0 rounded-full transition-colors", r.enabled ? "bg-accent" : "bg-rule")}>
                <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left]", r.enabled ? "left-[18px]" : "left-0.5")} />
              </button>
              <span className={cx("min-w-0 flex-1 text-sm", r.enabled ? "text-ink" : "text-ink-3")}>{r.label}</span>
              <button type="button" onClick={() => remove(r)} aria-label={`Delete rule: ${r.label}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-3"><Trash2 size={16} aria-hidden /></button>
            </div>
            {r.kind === "price_move" && !r.symbol ? (
              <Threshold value={Number(r.params.pct ?? 4)} min={1} max={15} step={0.5} unit="%"
                onCommit={(v) => setParam(r, { pct: v }, `Any holding moves ${v}% in a day`)} label="Price move" />
            ) : r.kind === "volume_spike" && !r.symbol ? (
              <Threshold value={Number(r.params.multiple ?? 2)} min={1.5} max={6} step={0.5} unit="×"
                onCommit={(v) => setParam(r, { multiple: v }, `Volume at ${v}× its 20-day average`)} label="Volume multiple" />
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-3">Rules are checked by code after every filing run and after the market close. A model only drafts rules from your words; you confirm each one.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {["Tell me if any holding falls 6%", "any promoter pledge", "SUZLON volume 3x", "a credit rating downgrade"].map((s) => (
          <button key={s} type="button" onClick={() => setText(s)}><Chip tone="outline">{s}</Chip></button>
        ))}
      </div>
    </section>
  );
}

function Threshold({ value, min, max, step, unit, onCommit, label }: { value: number; min: number; max: number; step: number; unit: string; onCommit: (v: number) => void; label: string }) {
  const [v, setV] = useState(value);
  return (
    <label className="mt-2 flex items-center gap-3 pl-[52px] text-xs text-ink-2">
      <span className="sr-only">{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={() => v !== value && onCommit(v)} onKeyUp={() => v !== value && onCommit(v)} onBlur={() => v !== value && onCommit(v)} className="flex-1" />
      <span className="num w-12 text-right text-sm text-ink">{v}{unit}</span>
    </label>
  );
}
