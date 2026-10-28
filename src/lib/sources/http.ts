// Polite HTTP: per-host spacing, timeouts, a couple of retries on 429/5xx.

export const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const lastHit = new Map<string, number>();
const spacingMs: Record<string, number> = {
  "api.bseindia.com": 600,
  "www.bseindia.com": 600,
  "www.screener.in": 2500,
  "www.nseindia.com": 400,
};

async function waitTurn(host: string) {
  const gap = spacingMs[host] ?? 0;
  if (!gap) return;
  const last = lastHit.get(host) ?? 0;
  const wait = last + gap - Date.now();
  lastHit.set(host, Math.max(Date.now(), last + gap));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export class HttpError extends Error {
  constructor(public status: number, public url: string, msg?: string) {
    super(msg ?? `HTTP ${status} for ${url}`);
  }
}

export interface FetchOpts {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  method?: string;
  body?: string;
}

export async function fetchRetry(url: string, opts: FetchOpts = {}): Promise<Response> {
  const host = new URL(url).host;
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await waitTurn(host);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: { "User-Agent": CHROME_UA, ...opts.headers },
        body: opts.body,
        signal: ctrl.signal,
        redirect: "follow",
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new HttpError(res.status, url);
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) ** 2));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function getJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  const res = await fetchRetry(url, opts);
  if (!res.ok) throw new HttpError(res.status, url);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(res.status, url, `Non-JSON response from ${url}: ${text.slice(0, 120)}`);
  }
}

export async function getText(url: string, opts: FetchOpts = {}): Promise<string> {
  const res = await fetchRetry(url, opts);
  if (!res.ok) throw new HttpError(res.status, url);
  return res.text();
}

export async function getBuffer(url: string, opts: FetchOpts & { maxBytes?: number } = {}): Promise<Uint8Array> {
  const res = await fetchRetry(url, { timeoutMs: 60_000, ...opts });
  if (!res.ok) throw new HttpError(res.status, url);
  const max = opts.maxBytes ?? 60 * 1024 * 1024;
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len && len > max) throw new Error(`File too large (${len} bytes): ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > max) throw new Error(`File too large (${buf.byteLength} bytes): ${url}`);
  return buf;
}
