"use client";
// Hand-drawn SVG charts: one line, the last point marked, no axes (spec 7.3).
import { useId } from "react";

export function Sparkline({ values, width = 72, height = 24, className }: { values: number[]; width?: number; height?: number; className?: string }) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return <svg width={width} height={height} aria-hidden className={className} />;
  const min = Math.min(...v), max = Math.max(...v);
  const span = max - min || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * (width - 4) + 2, height - 3 - ((y - min) / span) * (height - 6)]);
  const up = v[v.length - 1] >= v[0];
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className={className}>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill={up ? "var(--up)" : "var(--down)"} />
    </svg>
  );
}

export interface Marker { d: string; tier: "top" | "worth" | "routine" | "hidden"; label: string; onClick?: () => void }

/** A price line with event markers on the dates filings landed. */
export function PriceChart({ prices, markers, height = 150 }: { prices: { d: string; close: number }[]; markers: Marker[]; height?: number }) {
  const id = useId();
  const width = 528;
  if (prices.length < 2) return <div className="grid h-[150px] place-items-center text-sm text-ink-3">No price history yet.</div>;
  const closes = prices.map((p) => p.close);
  const min = Math.min(...closes), max = Math.max(...closes);
  const span = max - min || 1;
  const x = (i: number) => (i / (prices.length - 1)) * (width - 8) + 4;
  const y = (c: number) => height - 18 - ((c - min) / span) * (height - 30);
  const path = prices.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join(" ");
  const area = `${path} L${x(prices.length - 1).toFixed(1)},${height - 12} L${x(0).toFixed(1)},${height - 12} Z`;
  const idxOf = (d: string) => {
    let best = -1;
    for (let i = 0; i < prices.length; i++) if (prices[i].d <= d) best = i;
    return best;
  };
  const up = closes[closes.length - 1] >= closes[0];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`Price over ${prices.length} sessions, from ${closes[0].toFixed(0)} to ${closes[closes.length - 1].toFixed(0)}, with ${markers.length} filing markers`}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={up ? "var(--up)" : "var(--down)"} stopOpacity="0.12" />
          <stop offset="1" stopColor={up ? "var(--up)" : "var(--down)"} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#g${id})`} />
      <path d={path} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="1.6" strokeLinejoin="round" />
      {markers.map((m, k) => {
        const i = idxOf(m.d);
        if (i < 0) return null;
        const cx = x(i), cy = height - 6;
        return (
          <g key={k} onClick={m.onClick} style={{ cursor: m.onClick ? "pointer" : undefined }}>
            <title>{m.label}</title>
            <line x1={cx} x2={cx} y1={y(prices[i].close)} y2={cy - 4} stroke="var(--rule)" strokeDasharray="2 3" />
            <circle cx={cx} cy={cy} r={m.tier === "top" ? 4.5 : 3.5} fill={m.tier === "top" ? "var(--accent)" : "var(--surface)"} stroke="var(--accent)" strokeWidth="1.5" />
          </g>
        );
      })}
    </svg>
  );
}

/** Ten-year bars for a metric, latest highlighted. */
export function Bars({ labels, values, unit = "", height = 64 }: { labels: string[]; values: (number | null)[]; unit?: string; height?: number }) {
  const v = values.map((x) => (x === null ? 0 : x));
  const max = Math.max(...v.map((x) => Math.abs(x)), 1);
  const w = 100 / Math.max(v.length, 1);
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-16 w-full" role="img"
      aria-label={labels.map((l, i) => `${l}: ${values[i] ?? "n/a"}${unit}`).join(", ")}>
      {v.map((x, i) => {
        const h = (Math.abs(x) / max) * (height - 4);
        const last = i === v.length - 1;
        return <rect key={i} x={i * w + w * 0.18} width={w * 0.64} y={x >= 0 ? height - h : height - 2} height={Math.max(h, 1)} rx="0.8"
          fill={x < 0 ? "var(--down)" : last ? "var(--accent)" : "var(--ink-3)"} opacity={last || x < 0 ? 1 : 0.45} />;
      })}
    </svg>
  );
}
