"use client";
// A tiny stale-while-revalidate fetch hook. Screens show the last good data at
// once on tab switches and refresh in the background; no data library needed.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<() => Promise<void>>>();

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
  for (const [k, set] of listeners) if (k.startsWith(prefix)) set.forEach((fn) => void fn());
}

interface State<T> { url: string | null; data: T | undefined; error: ApiError | null; loading: boolean }

export function useApi<T>(url: string | null, opts: { refreshMs?: number } = {}) {
  const [state, setState] = useState<State<T>>(() => ({ url, data: url ? (cache.get(url) as T | undefined) : undefined, error: null, loading: !!url && !cache.has(url) }));

  const reload = useCallback(async () => {
    if (!url) return;
    try {
      const d = await api<T>(url);
      cache.set(url, d);
      setState({ url, data: d, error: null, loading: false });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "Couldn't reach FINN. Check your connection.");
      setState((s) => ({ url, data: s.url === url ? s.data : (cache.get(url) as T | undefined), error: err, loading: false }));
    }
  }, [url]);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    const guarded = async () => { if (alive) await reload(); };
    void guarded();
    const set = listeners.get(url) ?? new Set();
    set.add(guarded);
    listeners.set(url, set);
    const timer = opts.refreshMs ? setInterval(() => { if (document.visibilityState === "visible") void guarded(); }, opts.refreshMs) : undefined;
    return () => { alive = false; set.delete(guarded); if (timer) clearInterval(timer); };
  }, [url, reload, opts.refreshMs]);

  // While FINN is still being set up (503), look again every 30 seconds.
  const settingUp = state.url === url && state.error?.status === 503;
  useEffect(() => {
    if (!settingUp) return;
    const t = setTimeout(() => void reload(), 30_000);
    return () => clearTimeout(t);
  }, [settingUp, reload, state]);

  const mutate = useCallback((fn: (d: T | undefined) => T | undefined) => {
    setState((s) => {
      const next = fn(s.url === url ? s.data : (url ? (cache.get(url) as T | undefined) : undefined));
      if (url && next !== undefined) cache.set(url, next);
      return { url, data: next, error: s.error, loading: false };
    });
  }, [url]);

  // A new url renders its cached copy at once, before its own fetch lands.
  const current = state.url === url;
  const data = current ? state.data : url ? (cache.get(url) as T | undefined) : undefined;
  const loading = url ? (current ? state.loading : !cache.has(url)) : false;
  return { data, error: current ? state.error : null, loading, reload, mutate };
}

const noop = () => () => {};

/** A value that only exists in the browser (time, storage, APIs); the server renders `fallback`. */
export function useClientValue<T>(get: () => T, fallback: T): T {
  return useSyncExternalStore(noop, get, () => fallback);
}
