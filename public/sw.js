/* Lighthouse service worker.
 * Push payloads are fully self-contained JSON — render with zero network so
 * notifications work when the phone is off wifi and off the tailnet. */

const CACHE = "lighthouse-v1";
const PRECACHE = ["/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("push", (event) => {
  let payload = { title: "Lighthouse", body: "", url: "/", tag: undefined, actions: [] };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch (e) {
    payload.body = event.data ? event.data.text() : "";
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url || "/", ...payload.data },
      actions: (payload.actions || []).slice(0, 3),
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const base = event.notification.data && event.notification.data.url ? event.notification.data.url : "/";
  // action buttons append ?action=<id> so the app can respond in-context
  const url = event.action ? base + (base.includes("?") ? "&" : "?") + "action=" + event.action : base;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const win of wins) {
        if ("focus" in win) {
          win.focus();
          if ("navigate" in win) win.navigate(url);
          return;
        }
      }
      return clients.openWindow(url);
    }),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription ? event.oldSubscription.options : { userVisibleOnly: true })
      .then((sub) =>
        fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        }),
      )
      .catch(() => {}),
  );
});

/* Navigation requests: network-first; anything cached (icons) cache-first. */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
