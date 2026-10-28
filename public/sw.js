// FINN service worker: push notifications only (no offline caching).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "FINN", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "FINN";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    tag: data.tag || undefined,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    data: { url: data.url || "/alerts" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/alerts";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) { await c.navigate(url).catch(() => undefined); return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
