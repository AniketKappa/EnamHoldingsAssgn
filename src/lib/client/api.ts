"use client";
// A tiny stale-while-revalidate fetch hook. Screens show the last good data at
// once on tab switches and refresh in the background; no data library needed.
import { useCallback, useEffect, useRef, useState } from "react";

const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { error: text.slice(0, 200) }; }
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string })?.error ?? `FINN's server answered ${res.status}.`);
  return body as T;
}

export function post<T>(url: string, data: unknown, method = "POST") {
  return api<T>(url, { method, body: JSON.stringify(data) });
}

/** Ask every screen showing `prefix*` to refetch (after a mutation). */
export function invalidate(prefix: string) {
  for (const [k, set] of listeners) if (k.startsWith(prefix)) set.forEach((fn) => fn());
}

export function useApi<T>(url: string | null, opts: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | undefined>(() => (url ? (cache.get(url) as T | undefined) : undefined));
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url && !cache.has(url));
  const current = useRef(url);
  current.current = url;

  const load = useCallback(async () => {
    if (!url) return;
    setLoading(!cache.has(url));
    try {
      const d = await api<T>(url);
      cache.set(url, d);
      if (current.current === url) { setData(d); setError(null); }
    } catch (e) {
      if (current.current === url) setError(e instanceof ApiError ? e : new ApiError(0, "Couldn't reach FINN. Check your connection."));
    } finally {
      if (current.current === url) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (!url) return;
    setData(cache.get(url) as T | undefined);
    void load();
    const set = listeners.get(url) ?? new Set();
    set.add(load);
    listeners.set(url, set);
    let timer: ReturnType<typeof setInterval> | undefined;
    if (opts.refreshMs) timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, opts.refreshMs);
    return () => { set.delete(load); if (timer) clearInterval(timer); };
  }, [url, load, opts.refreshMs]);

  const mutate = useCallback((fn: (d: T | undefined) => T | undefined) => {
    setData((prev) => {
      const next = fn(prev);
      if (url && next !== undefined) cache.set(url, next);
      return next;
    });
  }, [url]);

  return { data, error, loading, reload: load, mutate };
}
