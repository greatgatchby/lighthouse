"use client";

import { useEffect, useState } from "react";
import { Button, Card, Pill } from "@/components/ui";

// The push setup card. Reports the three things that have to be true on iOS,
// and requests permission ONLY inside the click handler (iOS silently swallows
// it anywhere else).

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function NotificationSetup() {
  const [standalone, setStandalone] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as { standalone?: boolean }).standalone === true,
    );
    setPermission("Notification" in window ? Notification.permission : "unsupported");
    navigator.serviceWorker?.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(Boolean(sub));
    });
  }, []);

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") throw new Error("Permission not granted");

      const { vapidPublicKey } = await fetch("/api/push/subscribe").then((r) => r.json());
      if (!vapidPublicKey) throw new Error("Server has no VAPID keys — run `pnpm vapid`");

      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
        }));

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("Failed to store subscription");
      setSubscribed(true);
      setMessage("Enabled. Fire the test push to prove it end-to-end.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function testPush() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      setMessage(
        res.status === 201
          ? "Test push sent — now try it with wifi off."
          : `Nothing delivered: ${JSON.stringify(data)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  const ok = (label: string, good: boolean, hint?: string) => (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-(--color-mist)">{label}</span>
      <Pill tone={good ? "sea" : "amber"}>{good ? "yes" : (hint ?? "not yet")}</Pill>
    </div>
  );

  return (
    <Card>
      <h3 className="mb-2 font-semibold">Notifications</h3>
      <div className="divide-y divide-(--color-card-edge)">
        {ok("Added to Home Screen", standalone, "open from Home Screen")}
        {ok("Permission granted", permission === "granted", permission)}
        {ok("Device subscribed", subscribed)}
      </div>
      <div className="mt-3 flex gap-2">
        {!subscribed || permission !== "granted" ? (
          <Button onClick={enable} disabled={busy || !standalone} className="flex-1">
            Enable notifications
          </Button>
        ) : null}
        <Button onClick={testPush} disabled={busy || !subscribed} variant="secondary" className="flex-1">
          Send test push
        </Button>
      </div>
      {!standalone ? (
        <p className="mt-2 text-xs text-(--color-fog)">
          iOS requires the app to be added to the Home Screen first: Share → Add to Home Screen.
        </p>
      ) : null}
      {message ? <p className="mt-2 text-sm text-(--color-fog)">{message}</p> : null}
    </Card>
  );
}
