"use client";
// The funnel line is FINN's hero: how much came in, and how little of it matters.
import { useEffect } from "react";
import { useClientValue } from "@/lib/client/api";
import { cx } from "./ui";

// Decided once per page load: animate only on the first view in this session.
let firstView: boolean | null = null;
function isFirstView() {
  if (firstView === null) {
    try { firstView = !sessionStorage.getItem("finn_funnel"); } catch { firstView = false; }
  }
  return firstView;
}

function Step({ n, label, strong }: { n: number; label: string; strong?: boolean }) {
  return (
    <span className="funnel-step inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className={cx("num font-semibold tracking-tight", strong ? "text-accent" : "text-ink")} style={{ fontSize: "clamp(24px, 7.4vw, 30px)", lineHeight: 1.1 }}>
        {n.toLocaleString("en-IN")}
      </span>
      <span className={cx("text-sm", strong ? "font-medium text-accent" : "text-ink-2")}>{label}</span>
    </span>
  );
}

function Sep() {
  return (
    <svg className="funnel-step mx-0.5 shrink-0 self-center text-ink-3" width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M4 2.5 9 7l-5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FunnelLine({ filings, events, matter }: { filings: number; events: number; matter: number }) {
  const animate = useClientValue(isFirstView, false);
  useEffect(() => { try { sessionStorage.setItem("finn_funnel", "1"); } catch { /* storage blocked */ } }, []);
  return (
    <p className={cx("flex flex-wrap items-baseline gap-x-2 gap-y-1", !animate && "funnel-still")}
      aria-label={`${filings} filings, grouped into ${events} events worth reading, of which ${matter} matter`}>
      <Step n={filings} label={filings === 1 ? "filing" : "filings"} />
      <Sep />
      <Step n={events} label={events === 1 ? "event" : "events"} />
      <Sep />
      <Step n={matter} label="matter" strong />
    </p>
  );
}
