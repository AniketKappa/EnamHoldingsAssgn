// End-of-day signals: 1-day move, volume vs its 20-session average, and how
// unusual the move is for this particular stock (z-score over 60 sessions).

export interface DayBar { d: string; close: number; volume: number }
export interface Signal { d: string; close: number; ret_pct: number | null; vol_ratio: number | null; ret_z: number | null }

export function computeSignals(bars: DayBar[], lastN = 30): Signal[] {
  const out: Signal[] = [];
  const sorted = [...bars].sort((a, b) => a.d.localeCompare(b.d));
  const start = Math.max(1, sorted.length - lastN);
  for (let i = start; i < sorted.length; i++) {
    const b = sorted[i];
    const prev = sorted[i - 1];
    const ret = prev?.close ? ((b.close - prev.close) / prev.close) * 100 : null;
    const volWin = sorted.slice(Math.max(0, i - 20), i).map((x) => x.volume).filter((v) => v > 0);
    const avgVol = volWin.length >= 10 ? volWin.reduce((s, v) => s + v, 0) / volWin.length : null;
    const rets: number[] = [];
    for (let j = Math.max(1, i - 60); j < i; j++) {
      const a = sorted[j - 1], c = sorted[j];
      if (a.close) rets.push(((c.close - a.close) / a.close) * 100);
    }
    let z: number | null = null;
    if (ret !== null && rets.length >= 20) {
      const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
      const sd = Math.sqrt(rets.reduce((s, v) => s + (v - mean) ** 2, 0) / (rets.length - 1));
      z = sd > 0 ? ret / sd : null;
    }
    out.push({
      d: b.d,
      close: b.close,
      ret_pct: ret === null ? null : round(ret, 2),
      vol_ratio: avgVol && b.volume ? round(b.volume / avgVol, 2) : null,
      ret_z: z === null ? null : round(z, 2),
    });
  }
  return out;
}

function round(v: number, d: number) { const f = 10 ** d; return Math.round(v * f) / f; }

export interface Thresholds { pct: number; multiple: number; z: number }
export const DEFAULT_THRESHOLDS: Thresholds = { pct: 4, multiple: 2, z: 2.5 };

export function signalHits(s: Signal, t: Thresholds) {
  return {
    price: s.ret_pct !== null && Math.abs(s.ret_pct) >= t.pct,
    volume: s.vol_ratio !== null && s.vol_ratio >= t.multiple,
    sigma: s.ret_z !== null && Math.abs(s.ret_z) >= t.z,
  };
}
