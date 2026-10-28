"use client";
// Small building blocks shared by every screen.
import clsx from "clsx";
import type { ReactNode } from "react";
import { pct, bps } from "@/lib/format";

export function cx(...a: Parameters<typeof clsx>) { return clsx(...a); }

/** A signed change. Colour is never the only signal: the sign is always printed. */
/** A signed change. `lowerIsBetter` (bad loans, debt) colours a fall as good. */
export function Delta({ value, kind = "pct", suffix, digits = 1, className, lowerIsBetter = false }: { value: number | null | undefined; kind?: "pct" | "bps"; suffix?: string; digits?: number; className?: string; lowerIsBetter?: boolean }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={cx("num text-ink-3", className)}>–{suffix ? ` ${suffix}` : ""}</span>;
  const good = lowerIsBetter ? value < 0 : value > 0;
  const tone = value === 0 ? "text-ink-2" : good ? "text-up" : "text-down";
  return <span className={cx("num whitespace-nowrap", tone, className)}>{kind === "bps" ? bps(value) : pct(value, digits)}{suffix ? ` ${suffix}` : ""}</span>;
}

export function Chip({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: "neutral" | "accent" | "up" | "down" | "flag" | "outline"; className?: string; title?: string }) {
  const tones = {
    neutral: "bg-paper text-ink-2",
    accent: "bg-accent-soft text-accent",
    up: "bg-up-soft text-up",
    down: "bg-down-soft text-down",
    flag: "bg-down-soft text-down font-medium",
    outline: "border border-rule text-ink-2",
  } as const;
  return <span title={title} className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs leading-5 whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

/** The materiality rail: a 3px left edge. Top = accent, worth = 40% accent, routine = hairline. */
export function Rail({ tier }: { tier: "top" | "worth" | "routine" | "hidden" }) {
  return (
    <span aria-hidden className={cx("absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[inherit]",
      tier === "top" ? "bg-accent" : tier === "worth" ? "bg-accent/40" : "bg-rule")} />
  );
}

export function SectionTitle({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 pt-6 pb-2" id={id}>
      <h2 className="text-sm font-semibold text-ink">{children}</h2>
      {aside ? <div className="text-xs text-ink-2">{aside}</div> : null}
    </div>
  );
}

export function SkeletonRows({ rows = 3, card = false }: { rows?: number; card?: boolean }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {card ? <div className="skeleton h-44 w-full rounded-[14px]" /> : null}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-2 py-1">
          <div className="skeleton h-3.5 w-1/3" />
          <div className="skeleton h-3.5 w-11/12" />
        </div>
      ))}
    </div>
  );
}

export function Notice({ children, action, tone = "neutral" }: { children: ReactNode; action?: ReactNode; tone?: "neutral" | "error" }) {
  return (
    <div className={cx("rounded-[14px] border px-4 py-3 text-sm", tone === "error" ? "border-down/30 bg-down-soft text-ink" : "border-rule bg-surface text-ink-2")} role={tone === "error" ? "alert" : undefined}>
      <div>{children}</div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Button({ children, onClick, variant = "secondary", disabled, type = "button", className, href, target }: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "quiet"; disabled?: boolean; type?: "button" | "submit"; className?: string; href?: string; target?: string;
}) {
  const cls = cx(
    "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors disabled:opacity-50",
    variant === "primary" && "bg-accent text-white dark:text-paper",
    variant === "secondary" && "border border-rule bg-surface text-ink active:bg-paper",
    variant === "quiet" && "px-2 text-accent",
    className,
  );
  if (href) return <a className={cls} href={href} target={target} rel={target ? "noreferrer" : undefined}>{children}</a>;
  return <button type={type} className={cls} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function Initials({ name }: { name: string }) {
  const parts = name.replace(/^(mr|ms|mrs|dr|shri|smt)\.?\s+/i, "").split(/\s+/).filter(Boolean);
  const ini = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  return <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{ini}</span>;
}

/** "Q2 FY27 results" from a category; used for compact labels. */
export function plural(n: number, one: string, many?: string) {
  return `${n.toLocaleString("en-IN")} ${n === 1 ? one : many ?? `${one}s`}`;
}
