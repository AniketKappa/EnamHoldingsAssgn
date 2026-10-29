// Replay the Say-vs-Do ledger offline against real data: a `dump` branch checkout
// (scripts/finn.ts dump) and screener pages from the `fixtures` branch.
// Usage: npx tsx scripts/dev/ledger-replay.ts <dump dir> <screener dir> [SYMBOL ...]
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fetchScreener } from "../../src/lib/sources/screener";
import { computeFacts } from "../../src/lib/research/facts";
import { buildLedger, targetText, type GuidanceIn, type KpiIn } from "../../src/lib/research/ledger";
import { normalizeGuidance, normalizeKpis, textBefore } from "../../src/lib/research/normalize";
import { metricLabel } from "../../src/lib/research/types";
import type { TranscriptExtractT } from "../../src/lib/llm/schemas";

const [dumpDir, scrDir, ...only] = process.argv.slice(2);
const symbols = only.length ? only : ["LT", "INFY", "BAJFINANCE", "ETERNAL", "POLYCAB"];

interface Dump {
  state: { docs: { id?: number; doc_type: string; period_label: string; said_on?: string }[] };
  extracts: { document_id: string | number; kind: string; data: TranscriptExtractT }[];
  pages: { document_id: string | number; page_no: number; text: string }[];
}

for (const symbol of symbols) {
  const d = JSON.parse(readFileSync(join(dumpDir, `${symbol}.json`), "utf8")) as Dump;
  const sc = await fetchScreener(symbol, async (url) => {
    const f = join(scrDir, `${symbol}_${url.includes("/consolidated/") ? "consolidated" : "standalone"}.html`);
    if (!existsSync(f)) throw new Error(`missing ${f}`);
    return readFileSync(f, "utf8");
  });
  const fb = computeFacts(sc);
  const guidance: GuidanceIn[] = [];
  const kpis: KpiIn[] = [];
  let gid = 1;
  const calls = d.state.docs.filter((x) => x.doc_type !== "annual_report" && x.id).sort((a, b) => (b.said_on ?? "").localeCompare(a.said_on ?? ""));
  for (const doc of calls) {
    const t = d.extracts.find((e) => Number(e.document_id) === doc.id && e.kind === "transcript")?.data;
    if (!t) continue;
    for (const g of t.guidance) guidance.push({ id: gid++, doc_id: doc.id!, said_period: doc.period_label, said_on: doc.said_on ?? "", metric: g.metric, label_raw: g.label_raw, target_low: g.target_low, target_high: g.target_high, unit: g.unit, basis: g.basis, horizon: g.horizon, direction: g.direction, speaker: g.speaker, quote: g.quote, page: g.page });
    for (const k of t.reported_kpis) kpis.push({ doc_id: doc.id!, said_on: doc.said_on ?? "", metric: k.metric, value: k.value, unit: k.unit, basis: k.basis, period: k.period, quote: k.quote, page: k.page });
  }
  const pages = new Map(d.pages.map((p) => [`${p.document_id}:${p.page_no}`, p.text]));
  const before = (g: { doc_id: number; page: number; quote: string }) => {
    for (const p of [g.page, g.page - 1, g.page + 1]) {
      const txt = pages.get(`${g.doc_id}:${p}`);
      const b = txt ? textBefore(g.quote, txt) : "";
      if (b) return b;
    }
    return "";
  };
  const periods = new Map(d.state.docs.filter((x) => x.id).map((x) => [x.id!, x.period_label] as [number, string]));
  const ng = normalizeGuidance(guidance, { lender: fb.lender, before });
  const nk = normalizeKpis(kpis, { lender: fb.lender, periods });
  const { items, credibility } = buildLedger(ng, nk, fb);
  console.log(`\n===== ${symbol} (${fb.basis}${fb.lender ? ", lender" : ""}): ${guidance.length} raw, ${ng.length} kept; credibility ${JSON.stringify(credibility)}`);
  for (const g of ng) if (g.checks.length) console.log(`  · #${g.id} ${g.said_period}: ${g.checks.join("; ")}${g.scope.scope === "segment" ? `; scope ${g.scope.label}` : ""}`);
  for (const it of items) {
    const a = it.actual ? `${it.actual.value}${it.actual.unit === "pct" ? "%" : ` ${it.actual.unit}`} (${it.actual.label}; ${it.actual.cite})` : "";
    const rev = it.revised_to ? ` -> ${targetText({ target_low: it.revised_to.low, target_high: it.revised_to.high, unit: it.revised_to.unit, direction: it.revised_to.direction })} (${it.revised_to.said_period})` : "";
    const scope = it.scope?.scope === "segment" ? ` [${it.scope.label}]` : "";
    console.log(`  #${it.id} ${it.said_period} | ${metricLabel(it.metric)}${scope}, ${it.horizon_label} | ${targetText(it)}${rev} | ${it.status}${a ? ` | actual ${a}` : ""}${it.note ? ` | ${it.note}` : ""}`);
  }
  const kp = nk.filter((k) => /FY\d{2}$/.test(k.period)).map((k) => `${k.metric} ${k.period} ${k.value}${k.unit === "pct" ? "%" : ` ${k.unit}`}${k.scope.scope === "segment" ? ` [${k.scope.label}]` : ""}`);
  console.log(`  KPIs: ${kp.join("; ")}`);
}
