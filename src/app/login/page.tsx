"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((d) => setHasCredentials(Boolean(d.hasCredentials)))
      .catch(() => setHasCredentials(true));
  }, []);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const options = await fetch("/api/auth/login/options", { method: "POST" }).then((r) =>
        r.json(),
      );
      const assertion = await startAuthentication({ optionsJSON: options });
      const result = await fetch("/api/auth/login/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(assertion),
      });
      if (!result.ok) throw new Error((await result.json()).error ?? "Sign-in failed");
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    setBusy(true);
    setError(null);
    try {
      const optionsRes = await fetch("/api/auth/register/options", { method: "POST" });
      if (!optionsRes.ok) throw new Error((await optionsRes.json()).error ?? "Registration closed");
      const options = await optionsRes.json();
      const attestation = await startRegistration({ optionsJSON: options });
      const result = await fetch("/api/auth/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(attestation),
      });
      if (!result.ok) throw new Error((await result.json()).error ?? "Registration failed");
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-safe mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 pb-16">
      <div className="mb-10 text-center">
        {/* the generated beacon icon, not an emoji — 🗼 is the Tokyo Tower */}
        <img
          src="/icons/icon-192.png"
          alt=""
          width={88}
          height={88}
          className="mx-auto rounded-2xl"
        />
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Lighthouse</h1>
        <p className="mt-1 text-sm text-(--color-fog)">Your private harbour</p>
      </div>

      <Card className="space-y-3">
        {hasCredentials !== false ? (
          <Button className="w-full" onClick={signIn} disabled={busy}>
            {busy ? "…" : "Sign in with Face ID"}
          </Button>
        ) : null}
        {hasCredentials === false ? (
          <Button className="w-full" onClick={register} disabled={busy}>
            {busy ? "…" : "Set up this device"}
          </Button>
        ) : null}
        {error ? <p className="text-center text-sm text-(--color-amber-warn)">{error}</p> : null}
      </Card>
    </div>
  );
}
