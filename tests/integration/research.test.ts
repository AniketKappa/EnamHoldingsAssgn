// The research engine end to end, offline: screener's real L&T page from the
// HTTP cache, synthetic call transcripts stored as documents, model stand-ins.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDb, stopDb } from "../helpers/pg";
import { mockLlm } from "../helpers/mockLlm";
import { TRANSCRIPTS, ANNUAL_REPORT_PAGES } from "../helpers/fixtures";
import type { DossierV1 } from "@/lib/research/types";

let dossier: DossierV1;

beforeAll(async () => {
  await startDb();
  const { setMockLlm } = await import("@/lib/llm/router");
  setMockLlm(mockLlm);
  const { seedDemo } = await import("@/lib/pipeline/seed");
  await seedDemo();
  const { db } = await import("@/lib/db");
  const { sha1 } = await import("@/lib/text");
  const html = readFileSync("tests/fixtures/screener_LT_consolidated.html", "utf8");
  const url = "https://www.screener.in/company/LT/consolidated/";
  await db()`insert into http_cache (url_hash, url, status, body) values (${sha1(url)}, ${url}, 200, ${html})`;
  const { parseScreenerHtml } = await import("@/lib/sources/screener");
  const { pickDocuments } = await import("@/lib/research/docs");
  const { storeDocument } = await import("@/lib/pipeline/filings");
  for (const d of pickDocuments(parseScreenerHtml(html, "LT", url))) {
    const label = d.label.match(/\(([^)]+)\)/)?.[1] ?? "";
    const pages = d.doc_type === "annual_report" ? ANNUAL_REPORT_PAGES : TRANSCRIPTS[label];
    if (pages) await storeDocument({ symbol: "LT", docType: d.doc_type, url: d.url, pages, periodLabel: d.period_label, periodEnd: d.period_end });
  }
}, 60_000);

afterAll(async () => { await stopDb(); });

describe("research job", () => {
  it("builds a dossier in resumable steps", async () => {
    const { createResearchJob, runResearchJob, latestDossier } = await import("@/lib/research/job");
    const id = await createResearchJob("LT", "demo");
    let finished = false;
    for (let i = 0; i < 5 && !finished; i++) finished = await runResearchJob(id, Date.now() + 120_000);
    const { db } = await import("@/lib/db");
    const [job] = await db()`select status, error, progress, log from jobs where id = ${id}`;
    expect(job.error).toBeNull();
    expect(job.status).toBe("done");
    expect(job.progress).toBe(100);
    const d = await latestDossier("LT");
    expect(d).not.toBeNull();
    dossier = d!.data;
    expect(dossier.documents.filter((x) => x.type === "transcript")).toHaveLength(5);
  });

  it("matches promises to the tables, deterministically", () => {
    const items = dossier.say_vs_do.items;
    const fy26Growth = items.find((x) => x.metric === "revenue_growth" && x.horizon === "FY26")!;
    expect(fy26Growth.status).toBe("missed");          // guided 15%, FY26 grew 11.8%
    expect(fy26Growth.actual?.value).toBe(11.8);
    expect(fy26Growth.call).toBe("Q3 FY26 call");       // reiterated earlier statements collapse into the latest
    const margin = items.find((x) => x.metric === "ebitda_margin" && x.horizon === "FY26")!;
    expect(margin.status).toBe("near_miss");           // guided 13%, delivered 12.7%
    const revised = items.find((x) => x.status === "revised")!;
    expect(revised.target_text).toBe("12–14%");
    expect(revised.revised_to?.text).toBe("15%");
    const fy27 = items.find((x) => x.metric === "revenue_growth" && x.horizon === "FY27" && x.status !== "revised")!;
    expect(fy27.status).toBe("off_track");             // H1 FY27 grew 11.4% against 15%
    const inflow = items.find((x) => x.metric === "order_inflow_growth")!;
    expect(inflow.status).toBe("pending");
    expect(dossier.say_vs_do.credibility.resolved).toBe(2);
    expect(dossier.say_vs_do.credibility.score).toBeNull(); // fewer than 3 resolved: no score shown
  });

  it("keeps only cited, number-grounded bullets", () => {
    const all = [...dossier.what_matters_now, ...dossier.bull, ...dossier.bear];
    expect(all.some((b) => b.text.includes("double"))).toBe(false); // invalid cite
    expect(all.some((b) => b.text.includes("13.3%"))).toBe(false);  // number not in any fact
    expect(dossier.what_matters_now.length).toBe(2);
    expect(dossier.stats.dropped_bullets).toBe(2);
    for (const b of all) expect(b.cites.length).toBeGreaterThan(0);
    expect(dossier.narrative_vs_numbers[0]?.verdict).toBe("diverge");
  });

  it("computes the financial facts from screener's tables", () => {
    expect(dossier.facts.q_revenue.value).toBe(78750);
    expect(dossier.facts.q_opm_yoy_bps.value).toBe(-133);
    expect(dossier.facts.fy_revenue_growth.value).toBe(11.8);
    expect(dossier.facts.de_ratio.value).toBeCloseTo(1.24, 2);
    expect(dossier.business.segments[0].name).toBe("Infrastructure Projects");
    expect(dossier.balance_sheet.contingent_cr).toBe(9500);
  });

  it("answers questions from the company's own pages, with citations", async () => {
    const { ask } = await import("@/lib/research/ask");
    const a = await ask({ symbol: "LT", question: "What revenue growth did management guide for FY27?" });
    expect(a.found).toBe(true);
    expect(a.citations[0].label).toMatch(/call transcript, p\. \d/);
    const again = await ask({ symbol: "LT", question: "What revenue growth did management guide for FY27?" });
    expect(again.cached).toBe(true);
  });
});
