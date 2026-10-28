"use client";
// The Brief's cards and rows. Hierarchy shows through surface and rail:
// Top items are cards, Worth items are rows, Routine is one collapsed line.
import { Check, ExternalLink, MessageCircle, ShieldCheck, TriangleAlert } from "lucide-react";
import type { BriefItem, PersonT, ResultsCardT } from "@/lib/api/types";
import { crore, pct, bps, whenIst } from "@/lib/format";
import { Chip, Delta, Initials, Rail, cx } from "./ui";

const CAT_LABEL: Record<string, string> = {
  results: "Results", management_change: "Management", "M&A": "M&A", fund_raise: "Fund raise", litigation: "Litigation",
  insider_trading: "Insider trade", earnings_call: "Earnings call", investor_meetings: "Investor meeting", credit_rating: "Credit rating",
  dividend: "Dividend", bonus_split: "Bonus or split", capex: "Capex", press_release: "Press release", postal_ballot: "Postal ballot",
  agm_egm: "AGM or EGM", pledging: "Pledge", unclassified: "Compliance",
};
export const categoryLabel = (c: string) => CAT_LABEL[c] ?? c;

/** One sentence, numbers first, written by code from the extracted metrics. */
export function resultsSentence(r: ResultsCardT): string {
  if (r.unreliable) return "FINN couldn't verify this filing's numbers; the filing itself is one tap away.";
  const m = r.metrics;
  const verb = (v: number | null) => (v === null ? "was flat" : v > 0 ? "rose" : v < 0 ? "fell" : "was flat");
  const amt = (v: number | null) => (v === null ? "" : ` ${Math.abs(v).toFixed(1)}%`);
  if (r.template === "lender") {
    return `Net interest income ${verb(m.revenue.yoy_pct)}${amt(m.revenue.yoy_pct)} YoY; net profit ${verb(m.pat.yoy_pct)}${amt(m.pat.yoy_pct)} to ${crore(m.pat.value)}.`;
  }
  const parts = [`Revenue ${verb(m.revenue.yoy_pct)}${amt(m.revenue.yoy_pct)} YoY to ${crore(m.revenue.value)}`];
  const yb = m.ebitda_margin.yoy_bps;
  if (yb !== null && Math.abs(yb) >= 30) parts.push(`EBITDA margin ${yb > 0 ? "rose" : "fell"} ${Math.abs(yb)} bps to ${m.ebitda_margin.value?.toFixed(1)}%`);
  else parts.push(`net profit ${verb(m.pat.yoy_pct)}${amt(m.pat.yoy_pct)} to ${crore(m.pat.value)}`);
  let s = `${parts.join("; ")}.`;
  if (m.exceptional && Math.abs(m.exceptional) >= 1) s += ` Includes a ${crore(m.exceptional)} exceptional item.`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Tile({ label, value, yoy, qoq, extra }: { label: string; value: number | null; yoy: number | null; qoq: number | null; extra?: React.ReactNode }) {
  return (
    <div className="min-w-0 py-3 pr-3">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="num mt-0.5 text-lg font-semibold tracking-tight text-ink">{crore(value)}</div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        <Delta value={yoy} suffix="YoY" />
        <Delta value={qoq} suffix="QoQ" />
      </div>
      {extra}
    </div>
  );
}

export function ResultsGrid({ r }: { r: ResultsCardT }) {
  const m = r.metrics;
  if (r.unreliable) return null;
  const lender = r.template === "lender";
  return (
    <div className="mt-3 grid grid-cols-2 border-t border-rule [&>*]:border-rule [&>*:nth-child(2n)]:border-l [&>*:nth-child(2n)]:pl-3 [&>*:nth-child(n+3)]:border-t">
      <Tile label={lender ? "Net interest income" : "Revenue"} value={m.revenue.value} yoy={m.revenue.yoy_pct} qoq={m.revenue.qoq_pct} />
      <Tile label={lender ? "Pre-provision profit" : "EBITDA"} value={m.ebitda.value} yoy={m.ebitda.yoy_pct} qoq={m.ebitda.qoq_pct}
        extra={!lender && m.ebitda_margin.value !== null ? (
          <div className="mt-1 text-xs text-ink-2"><span className="num">Margin {m.ebitda_margin.value.toFixed(1)}%</span>{" "}
            <Delta value={m.ebitda_margin.yoy_bps} kind="bps" suffix="YoY" /></div>
        ) : lender && m.gnpa_pct !== null ? <div className="num mt-1 text-xs text-ink-2">Gross NPA {m.gnpa_pct.toFixed(2)}%</div> : null} />
      <Tile label="Profit before tax" value={m.pbt.value} yoy={m.pbt.yoy_pct} qoq={m.pbt.qoq_pct} />
      <Tile label="Net profit to owners" value={m.pat.value} yoy={m.pat.yoy_pct} qoq={m.pat.qoq_pct} />
    </div>
  );
}

export function ChecksLine({ r }: { r: ResultsCardT }) {
  const passed = r.checks.filter((c) => c.ok).length;
  if (r.verified === "match") return <span className="inline-flex items-center gap-1 text-xs text-up"><ShieldCheck size={14} aria-hidden /> Matches exchange data</span>;
  if (r.checks_ok) return <span className="inline-flex items-center gap-1 text-xs text-ink-2"><Check size={14} aria-hidden className="text-up" /> {passed} of {r.checks.length} checks passed</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-down"><TriangleAlert size={14} aria-hidden /> Unverified: {r.checks.length - passed} check{r.checks.length - passed > 1 ? "s" : ""} failed</span>;
}

function pageLink(url: string | null, page?: number) {
  if (!url) return null;
  return page ? `${url}#page=${page}` : url;
}

function CardHead({ item }: { item: BriefItem }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0 truncate">
        <span className="text-sm font-semibold text-ink">{item.symbol}</span>
        <span className="ml-2 text-xs text-ink-2">{item.company}</span>
      </div>
      <time className="num shrink-0 text-xs text-ink-2" dateTime={item.at}>{whenIst(item.at)}</time>
    </div>
  );
}

/** Reason chips that add something the card doesn't already show. */
function Reasons({ item, max = 3 }: { item: BriefItem; max?: number }) {
  const flags = new Set(item.red_flags);
  const shown = item.reasons.filter((r) => {
    if (item.kind === "results") return !/^(Results|PAT |Margin |Revenue |NII )/.test(r);
    if (item.kind === "person") return !/^(New |.* exit$|.* re-)/.test(r) || flags.has(r);
    return true;
  }).slice(0, max);
  if (!shown.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {shown.map((r) => <Chip key={r} tone={flags.has(r) ? "flag" : /^(Price|Volume) /.test(r) ? "accent" : "neutral"}>{r}</Chip>)}
    </div>
  );
}

export function PersonBlock({ p, full = false }: { p: PersonT; full?: boolean }) {
  const verb: Record<string, string> = { appointment: "Appointed", resignation: "Resigned as", retirement: "Retiring as", cessation: "Ceased to be", redesignation: "Re-designated as", reappointment: "Re-appointed as" };
  const eff = p.effective_date ? `, effective ${new Date(`${p.effective_date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : "";
  const bg = p.background;
  const roles = bg?.previous_roles ?? [];
  return (
    <div className="mt-3">
      <div className="flex items-start gap-3">
        <Initials name={p.person_name} />
        <div className="min-w-0">
          <div className="text-base font-semibold leading-snug text-ink">{p.person_name}</div>
          <div className="text-sm text-ink-2">{verb[p.change_type] ?? p.change_type} {p.designation}{eff}</div>
        </div>
      </div>
      {bg?.headline ? <p className="serif mt-3 text-base text-ink">{bg.headline}</p> : null}
      {roles.length ? (
        <ul className="mt-2 space-y-1.5">
          {roles.slice(0, full ? 4 : 3).map((r, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="num w-[88px] shrink-0 text-ink-2">{r.start_year ?? "?"}{r.end_year ? `–${r.end_year}` : r.start_year ? "–" : ""}</span>
              <span className="min-w-0 text-ink">{r.title}, {r.organisation}</span>
            </li>
          ))}
        </ul>
      ) : p.brief_profile ? (
        <p className="mt-3 text-sm text-ink-2">{full ? p.brief_profile : p.brief_profile.slice(0, 220) + (p.brief_profile.length > 220 ? "…" : "")}</p>
      ) : null}
      {bg?.education?.length ? <p className="mt-2 text-sm text-ink-2">Education: {bg.education.join("; ")}</p> : null}
      {p.reason && p.change_type !== "appointment" ? <p className="mt-2 text-sm text-ink-2">Stated reason: {p.reason}</p> : null}
      {p.flags.length ? <div className="mt-2 flex flex-wrap gap-1.5">{p.flags.map((f) => <Chip key={f} tone="flag">{f}</Chip>)}</div> : null}
      {bg?.sources?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {bg.sources.slice(0, 4).map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
              className="pointer-events-auto relative z-10 inline-flex items-center gap-1 rounded-full border border-rule px-2 py-0.5 text-xs text-ink-2">
              {hostOf(s.url)} <ExternalLink size={11} aria-hidden />
            </a>
          ))}
          {bg.linkedin_url ? <a href={bg.linkedin_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="pointer-events-auto relative z-10 rounded-full border border-rule px-2 py-0.5 text-xs text-ink-2">LinkedIn</a> : null}
        </div>
      ) : full && p.role_class === "top" && p.change_type === "appointment" ? <p className="mt-2 text-xs text-ink-3">No sourced background found yet; the profile above is from the filing.</p> : null}
    </div>
  );
}

function hostOf(u: string) { try { return new URL(u).host.replace(/^www\./, ""); } catch { return "source"; } }

/** A Top item: a card on surface with the accent rail. */
export function TopCard({ item, onOpen, onDone, onAsk, leaving }: { item: BriefItem; onOpen: () => void; onDone: () => void; onAsk: () => void; leaving?: boolean }) {
  const r = item.results;
  const people = item.people ?? [];
  const primary = people[item.primary_index ?? 0] ?? people[0];
  return (
    <article className={cx("relative overflow-hidden rounded-[14px] border border-rule bg-surface py-4 pl-5 pr-4", leaving && "done-out")}>
      <Rail tier={item.tier} />
      <button type="button" onClick={onOpen} className="absolute inset-0 z-0 rounded-[14px]" aria-label={`Open details: ${item.symbol}, ${item.title}`} />
      <div className="pointer-events-none relative">
        <CardHead item={item} />
        {r ? (
          <>
            <div className="mt-1 text-xs text-ink-2">{r.quarter} results, {r.basis}</div>
            <p className="serif mt-2 text-base text-ink">{resultsSentence(r)}</p>
            <ResultsGrid r={r} />
          </>
        ) : primary ? (
          <PersonBlock p={primary} />
        ) : item.guidance ? (
          <>
            <div className="mt-1 text-xs text-ink-2">Guidance change, {item.guidance.horizon}</div>
            <p className="serif mt-2 text-base text-ink">{item.guidance.metric}: {item.guidance.from} → {item.guidance.to}</p>
          </>
        ) : (
          <>
            <div className="mt-1 text-xs text-ink-2">{categoryLabel(item.category)}</div>
            <p className="serif mt-2 text-base text-ink">{item.title}</p>
          </>
        )}
        <Reasons item={item} />
      </div>
      <div className="relative z-10 mt-3 flex items-center justify-between gap-2 border-t border-rule pt-3">
        <div className="min-w-0">
          {r ? <ChecksLine r={r} /> : item.status === "pending" ? <span className="text-xs text-ink-3">Reading the filing…</span> : null}
          {item.pdf_url ? (
            <a href={pageLink(item.pdf_url, r?.source_pages?.[0]) ?? undefined} target="_blank" rel="noreferrer"
              className="mt-1 flex items-center gap-1 text-xs text-accent">
              Open filing{r?.source_pages?.[0] ? ` p.${r.source_pages[0]}` : ""} <ExternalLink size={12} aria-hidden />
            </a>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={onAsk} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-rule px-3 text-xs text-ink">
            <MessageCircle size={14} aria-hidden /> Ask
          </button>
          <button type="button" onClick={onDone} aria-pressed={item.done} className={cx("inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs", item.done ? "bg-accent text-white dark:text-paper" : "border border-rule text-ink")}>
            <Check size={14} aria-hidden /> Done
          </button>
        </div>
      </div>
    </article>
  );
}

/** A Worth-a-look item: a row, no card chrome. Symbol and time on top, the line below. */
export function EventRow({ item, onOpen, compact = false }: { item: BriefItem | { key: string; symbol: string; title: string; at: string; tier?: BriefItem["tier"]; reasons?: string[]; red_flags?: string[] }; onOpen: () => void; compact?: boolean }) {
  const tier = ("tier" in item && item.tier) || "routine";
  let size = (item.reasons ?? []).find((r) => /₹|% of|Volume|Price/.test(r));
  // "₹2,500 cr = 0.9% of revenue" -> "0.9% of revenue" when the line already states the amount.
  const m = size?.match(/^(₹[\d,]+ cr) = (.+)$/);
  if (m && item.title.includes(m[1])) size = m[2];
  const flag = (item.red_flags ?? [])[0];
  return (
    <li className="relative">
      <button type="button" onClick={onOpen} className={cx("relative block w-full py-3 pl-4 pr-1 text-left", compact && "py-2.5")}>
        <Rail tier={tier} />
        <span className="flex items-baseline justify-between gap-3">
          <span className={cx("truncate text-sm font-semibold", compact ? "text-ink-2" : "text-ink")}>{item.symbol}</span>
          <time className="num shrink-0 text-xs text-ink-2" dateTime={item.at}>{whenIst(item.at)}</time>
        </span>
        <span className={cx("mt-0.5 line-clamp-2 block text-sm", compact ? "text-ink-2" : "text-ink")}>{item.title}</span>
        {!compact && (size || flag) ? (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {flag ? <Chip tone="flag">{flag}</Chip> : null}
            {size ? <Chip tone={/Volume|Price/.test(size) ? "accent" : "neutral"}>{size}</Chip> : null}
          </span>
        ) : null}
      </button>
    </li>
  );
}

export { pct, bps };
