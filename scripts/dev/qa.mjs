// Live QA against a deployed FINN: phone-size screenshots of every screen in light
// and dark, console errors, failed requests and API timings. Run by .github/workflows/qa.yml;
// results land on the `qa` branch. Usage: node scripts/dev/qa.mjs <base url> <out dir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const base = (process.argv[2] || "https://enam-holdings-assgn.vercel.app").replace(/\/$/, "");
const out = process.argv[3] || "qa";
mkdirSync(out, { recursive: true });

const PAGES = [
  ["brief", "/"], ["brief-7d", "/?w=7d"], ["brief-30d", "/?w=30d"], ["alerts", "/alerts"], ["rules", "/alerts?tab=rules"],
  ["portfolio", "/portfolio"], ["research", "/research"], ["dossier-LT", "/dossier?s=LT"], ["company-LT", "/company?s=LT"],
  ["settings", "/settings"], ["cost", "/cost"],
];

const report = { base, at: new Date().toISOString(), pages: [], errors: [], failed: [], api: [] };
const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    colorScheme: scheme, locale: "en-IN", timezoneId: "Asia/Kolkata",
  });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") report.errors.push(`${scheme} ${page.url().replace(base, "")}: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => report.errors.push(`${scheme} ${page.url().replace(base, "")}: ${String(e).slice(0, 300)}`));
  page.on("requestfailed", (r) => report.failed.push(`${r.url().replace(base, "")} ${r.failure()?.errorText}`));
  page.on("response", async (r) => {
    const u = r.url();
    if (!u.startsWith(base) || !u.includes("/api/")) return;
    const t = r.request().timing();
    report.api.push({ url: u.replace(base, ""), status: r.status(), ms: Math.round(t.responseEnd > 0 ? t.responseEnd : -1) });
  });
  const list = scheme === "light" ? PAGES : PAGES.filter(([n]) => ["brief", "dossier-LT", "alerts"].includes(n));
  for (const [name, path] of list) {
    const t0 = Date.now();
    let status = 0;
    try {
      const resp = await page.goto(base + path, { waitUntil: "networkidle", timeout: 45_000 });
      status = resp?.status() ?? 0;
    } catch (e) { report.errors.push(`${scheme} ${path}: navigation ${String(e).slice(0, 200)}`); }
    await page.waitForTimeout(1200);
    const ms = Date.now() - t0;
    await page.screenshot({ path: `${out}/${scheme}-${name}.png` });
    if (scheme === "light") await page.screenshot({ path: `${out}/full-${name}.png`, fullPage: true });
    const text = (await page.locator("main").innerText().catch(() => "")).slice(0, 600);
    report.pages.push({ scheme, name, path, status, ms, text });
  }
  if (scheme === "light") {
    // Open the first item in the Brief and capture its sheet.
    try {
      await page.goto(base + "/?w=7d", { waitUntil: "networkidle", timeout: 45_000 });
      const card = page.locator("article").first();
      if (await card.count()) {
        await card.click({ position: { x: 40, y: 24 } });
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `${out}/light-sheet.png` });
        await page.screenshot({ path: `${out}/full-sheet.png`, fullPage: true });
      }
    } catch (e) { report.errors.push(`sheet: ${String(e).slice(0, 200)}`); }
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
const slow = report.api.filter((a) => a.ms > 2000).map((a) => `${a.url} ${a.ms} ms`);
const bad = report.api.filter((a) => a.status >= 400).map((a) => `${a.url} ${a.status}`);
console.log(`QA ${base}: ${report.pages.length} screens, ${report.errors.length} console errors, ${report.failed.length} failed requests, ${bad.length} API errors, ${slow.length} slow API calls`);
for (const p of report.pages) console.log(`- ${p.scheme} ${p.path}: HTTP ${p.status}, ${p.ms} ms`);
for (const e of report.errors.slice(0, 15)) console.log(`! ${e}`);
for (const b of bad.slice(0, 15)) console.log(`x ${b}`);
for (const s of slow.slice(0, 15)) console.log(`~ ${s}`);
