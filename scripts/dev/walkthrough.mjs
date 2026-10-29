// A silent, scripted walkthrough of the live app at phone size, recorded as video by
// Playwright (run by .github/workflows/walkthrough.yml; the MP4 lands on the `qa` branch).
// Usage: node walkthrough.mjs <base url> <out dir>
import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync } from "node:fs";

const base = (process.argv[2] || "https://enam-holdings-assgn.vercel.app").replace(/\/$/, "");
const out = process.argv[3] || "walkthrough";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  colorScheme: "light", locale: "en-IN", timezoneId: "Asia/Kolkata",
  recordVideo: { dir: out, size: { width: 390, height: 844 } },
});
const page = await ctx.newPage();
const pause = (ms) => page.waitForTimeout(ms);
const glide = async (px, steps = 12) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, px / steps); await pause(60); } };
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log(`step ${name} skipped: ${String(e).slice(0, 160)}`); } };

await step("brief", async () => {
  await page.goto(`${base}/`, { waitUntil: "networkidle", timeout: 45_000 });
  await pause(2500);
  await glide(700); await pause(1200); await glide(-700); await pause(600);
});
await step("7d", async () => {
  await page.getByRole("tab", { name: "7d" }).click();
  await page.waitForLoadState("networkidle"); await pause(1800);
  await glide(500); await pause(800); await glide(-500);
});
await step("results sheet", async () => {
  const card = page.locator("article").filter({ hasText: /Q2 FY27/ }).first();
  await (await card.count() ? card : page.locator("article").first()).click({ position: { x: 40, y: 24 } });
  await pause(2500);
  await glide(600); await pause(1500);
  await page.keyboard.press("Escape"); await pause(800);
});
await step("rules", async () => {
  await page.goto(`${base}/alerts?tab=rules`, { waitUntil: "networkidle" });
  await pause(1500);
  const input = page.getByPlaceholder(/moves 5%/);
  await input.click();
  await input.pressSequentially("Tell me if SUZLON moves 5%", { delay: 55 });
  await pause(500);
  await page.getByRole("button", { name: "Add" }).click();
  await pause(3500);
});
await step("dossier", async () => {
  await page.goto(`${base}/research`, { waitUntil: "networkidle" });
  await pause(1500);
  await page.locator('a[href="/dossier?s=LT"]').first().click();
  await page.waitForLoadState("networkidle"); await pause(2500);
  await glide(500); await pause(1500);
  await glide(700); await pause(2500);
  await glide(700); await pause(1500);
  await glide(900); await pause(1500);
});
await step("cost", async () => {
  await page.goto(`${base}/cost`, { waitUntil: "networkidle" });
  await pause(2500); await glide(500); await pause(1500);
});

await page.close();
await ctx.close();
await browser.close();
const webm = readdirSync(out).find((f) => f.endsWith(".webm"));
if (webm) renameSync(`${out}/${webm}`, `${out}/walkthrough.webm`);
console.log(`recorded ${webm ? "walkthrough.webm" : "nothing"}`);
