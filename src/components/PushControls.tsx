"use client";
// Web Push: Android Chrome works directly; iPhone needs FINN on the Home Screen
// (iOS 16.4+), and permission must be asked from a tap.
import { useEffect, useState } from "react";
import { api, post, ApiError } from "@/lib/client/api";
import { Button } from "./ui";

type State = "unknown" | "unsupported" | "ios-install" | "off" | "on" | "denied";

function b64ToBytes(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function PushControls({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>("unknown");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState(ios && !standalone ? "ios-install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") { setState("denied"); return; }
    navigator.serviceWorker.getRegistration("/").then(async (reg) => {
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    }).catch(() => setState("off"));
  }, []);

  async function enable() {
    setBusy(true); setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      const { publicKey } = await api<{ publicKey: string }>("/api/push/key");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      await post("/api/push/subscribe", sub.toJSON());
      setState("on");
      setMsg("Alerts are on for this device.");
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : `Couldn't turn on alerts: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setMsg(null);
    try { await post("/api/push/test", {}); setMsg("Test alert sent. It should arrive within a few seconds."); }
    catch (e) { setMsg(e instanceof ApiError ? e.message : "Couldn't send the test alert."); }
    finally { setBusy(false); }
  }

  if (state === "unknown") return null;
  return (
    <div className={compact ? "" : "rounded-[14px] border border-rule bg-surface px-4 py-4"}>
      {state === "ios-install" ? (
        <p className="text-sm text-ink-2">To get alerts on iPhone, tap Share, then Add to Home Screen, and open FINN from there. Alerts work on iOS 16.4 and later. The inbox below works everywhere.</p>
      ) : state === "unsupported" ? (
        <p className="text-sm text-ink-2">This browser can&apos;t receive push alerts. The inbox below still collects every alert.</p>
      ) : state === "denied" ? (
        <p className="text-sm text-ink-2">Notifications are blocked for FINN in this browser&apos;s settings. Allow them there, then come back.</p>
      ) : state === "off" ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-2">Get alerts on this phone the moment a rule fires.</p>
          <Button variant="primary" onClick={enable} disabled={busy}>Enable alerts</Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-2">Alerts are on for this device.</p>
          <Button onClick={test} disabled={busy}>Send test alert</Button>
        </div>
      )}
      {msg ? <p className="mt-2 text-xs text-ink-2" role="status">{msg}</p> : null}
    </div>
  );
}
