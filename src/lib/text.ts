// Small text helpers shared by extraction and validation.

export function norm(s: string): string {
  return s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^a-z0-9%₹.'" ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** True when the quote (or most of it) appears on the page text. */
export function quoteOnPage(quote: string, page: string): boolean {
  const q = norm(quote);
  const p = norm(page);
  if (!q) return false;
  if (p.includes(q)) return true;
  const words = q.split(" ").filter((w) => w.length > 2);
  if (words.length < 4) return p.includes(q.slice(0, 30));
  // Sliding check: at least 80% of the quote's words appear in order-insensitive window.
  const pageWords = new Set(p.split(" "));
  const hit = words.filter((w) => pageWords.has(w)).length;
  return hit / words.length >= 0.8;
}

/** Join pages with [p.N] markers, capped by characters. */
export function markPages(pages: string[], opts: { from?: number; maxChars?: number; only?: number[] } = {}): string {
  const max = opts.maxChars ?? 120_000;
  const idx = opts.only ?? pages.map((_, i) => i).slice(opts.from ?? 0);
  let out = "";
  for (const i of idx) {
    const chunk = `\n[p.${i + 1}]\n${pages[i] ?? ""}\n`;
    if (out.length + chunk.length > max) break;
    out += chunk;
  }
  return out.trim();
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Numbers mentioned in a sentence, normalised (handles Indian grouping, %, bps, x). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  const re = /(?<![\w.])[-−]?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|(?<![\w.])[-−]?\d+(?:\.\d+)?/g;
  for (const m of text.matchAll(re)) {
    const v = Number(m[0].replace(/,/g, "").replace("−", "-"));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

export function sha1(s: string): string {
  // Lightweight non-crypto hash for keys (FNV-1a 64-bit as hex).
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
