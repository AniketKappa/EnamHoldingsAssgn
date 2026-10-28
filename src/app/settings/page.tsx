"use client";
// Settings and "How FINN decides": the scoring and treatment rules in plain words.
import Link from "next/link";
import { useApi } from "@/lib/client/api";
import { whenIst } from "@/lib/format";
import { PushControls } from "@/components/PushControls";
import { SectionTitle } from "@/components/ui";

const BASES: [string, string, string][] = [
  ["Results", "90", "Card with revenue, EBITDA, profit before tax and net profit, this quarter against last quarter and last year"],
  ["Auditor resigns", "95", "Person card; always at the top"],
  ["CEO, CFO, MD or chair changes", "85", "Person card with sourced background for the incoming person"],
  ["Acquisition or merger", "80", "One line with the deal size against market value"],
  ["Equity raise or buyback", "75 or 70", "One line with the amount against market value"],
  ["Rating downgrade", "75", "Flagged; reaffirmations score 15 and stay routine"],
  ["New promoter pledge", "70", "Flagged"],
  ["Order win", "50", "One line with the order against annual revenue"],
  ["Dividend", "35", "Title only"],
  ["Analyst meets, AGM notices, trading windows", "5 to 15", "Counted, not shown"],
];

export default function Page() {
  const { data } = useApi<{ freshness: { filings_checked_at: string | null; prices_at: string | null }; llm: boolean }>("/api/status", { refreshMs: 60_000 });
  return (
    <main className="pt-5">
      <Link href="/" className="-ml-2 inline-flex min-h-11 items-center px-2 text-sm text-ink-2">Back to the Brief</Link>
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <SectionTitle>Alerts on this device</SectionTitle>
      <PushControls />
      <p className="mt-2 text-xs text-ink-2">Thresholds and the categories that alert you are set as <Link href="/alerts?tab=rules" className="text-accent">watch rules</Link>.</p>

      <SectionTitle>Data</SectionTitle>
      <p className="text-sm text-ink-2">
        Filings checked {data?.freshness.filings_checked_at ? whenIst(data.freshness.filings_checked_at) : "not yet"}; prices {data?.freshness.prices_at ? `at ${whenIst(data.freshness.prices_at)}` : "not yet loaded"}.
        {" "}Filings come from BSE every 10 minutes from 07:00 to midnight, hourly overnight. Prices are end of day from Yahoo Finance, with BSE as the fallback.
      </p>
      {data && !data.llm ? <p className="mt-2 text-sm text-down">Model features are off on this deployment: no API key is configured.</p> : null}

      <section id="how" className="scroll-mt-4">
        <SectionTitle>How FINN decides</SectionTitle>
        <p className="text-sm text-ink">FINN groups the filings of one corporate action into a single event, then scores each event from 0 to 100:</p>
        <ul className="num mt-2 space-y-1 text-sm text-ink-2">
          <li><span className="text-ink">Base</span> for the kind of event (table below)</li>
          <li><span className="text-ink">+15</span> for a governance red flag, such as an unplanned CFO exit or a downgrade</li>
          <li><span className="text-ink">+5 or +15</span> when the amount is 5% or 10% of market value</li>
          <li><span className="text-ink">+10</span> when the stock then moves past the alert thresholds</li>
          <li><span className="text-ink">+5 or +10</span> when the holding is 5% or 10% of your portfolio</li>
          <li><span className="text-ink">× 0.7</span> after &ldquo;Not useful&rdquo; on that kind of filing for that company; <span className="text-ink">× 0.3</span> for a muted category</li>
        </ul>
        <ul className="mt-3 space-y-2 text-sm">
          {([["top", "70 and above", "Top: a card"], ["worth", "40 to 69", "Worth a look: one line"], ["routine", "15 to 39", "Routine: collapsed into one row"], ["hidden", "Below 15", "Counted, not shown"]] as const).map(([tier, range, what]) => (
            <li key={tier} className="relative pl-4">
              <span aria-hidden className={`absolute left-0 top-0.5 bottom-0.5 w-[3px] rounded-full ${tier === "top" ? "bg-accent" : tier === "worth" ? "bg-accent/40" : "bg-rule"}`} />
              <span className="num text-ink">{range}</span> <span className="text-ink-2">{what}</span>
            </li>
          ))}
        </ul>
        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-xs text-ink-2"><th className="py-1 text-left font-normal">Event</th><th className="py-1 text-right font-normal">Base</th></tr></thead>
          <tbody>
            {BASES.map(([e, b, how]) => (
              <tr key={e} className="border-t border-rule align-top">
                <td className="py-2 pr-3"><span className="text-ink">{e}</span><span className="block text-xs text-ink-2">{how}</span></td>
                <td className="num py-2 text-right">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-ink-2">About 90% of filings are classified by ordered rules, not a model. Models read only what code can&apos;t: a results statement page, a management-change disclosure, the size of a deal. Every number is checked by arithmetic, and every dossier claim must cite a page or a table cell.</p>
      </section>

      <SectionTitle>Efficiency</SectionTitle>
      <p className="text-sm text-ink-2">Every model call is logged with its tokens and cached by content. <Link href="/cost" className="text-accent">See calls, cache hits and cost</Link>.</p>

      <SectionTitle>About</SectionTitle>
      <p className="text-sm text-ink-2">FINN is a research prototype, not investment advice. Sources: BSE corporate filings, company call transcripts and annual reports, screener.in&apos;s financial tables (never its commentary), and Yahoo Finance prices. Person backgrounds come from web search results with their links; FINN never reads LinkedIn.</p>
      <p className="mt-2 text-xs text-ink-3">Your portfolio, rules and feedback are tied to an anonymous id in this browser.</p>
    </main>
  );
}
