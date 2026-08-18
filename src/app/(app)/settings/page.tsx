import Link from "next/link";
import { db, tables } from "@/db";
import { NotificationSetup } from "@/components/NotificationSetup";
import { LogoutButton, SettingsControls } from "@/components/SettingsControls";
import { Card, Pill, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settingsRow] = await db.select().from(tables.settings).limit(1);
  const connections = await db.select().from(tables.providerConnections);
  const monzo = connections.find((c) => c.provider === "monzo");
  const lunchflow = connections.find((c) => c.provider === "lunchflow");

  return (
    <main>
      <header className="pt-6 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      </header>

      <NotificationSetup />

      <SectionTitle>Connections</SectionTitle>
      <Card className="divide-y divide-(--color-card-edge)">
        <div className="flex items-center justify-between py-2 first:pt-0">
          <div>
            <div className="font-medium">Monzo</div>
            <div className="text-xs text-(--color-fog)">
              {monzo?.status === "active"
                ? "Connected — polling every 3 minutes"
                : "Full history imports in the 5 minutes after you approve — do it when you can grab your phone"}
            </div>
          </div>
          {monzo?.status === "active" ? (
            <Pill tone="sea">connected</Pill>
          ) : (
            <Link
              href="/api/oauth/monzo/start"
              prefetch={false}
              className="rounded-xl bg-(--color-beacon) px-4 py-2 text-sm font-semibold text-(--color-ink)"
            >
              Connect
            </Link>
          )}
        </div>
        <div className="flex items-center justify-between py-2 last:pb-0">
          <div>
            <div className="font-medium">Lunchflow</div>
            <div className="text-xs text-(--color-fog)">
              {lunchflow?.status === "active"
                ? "Synced nightly"
                : "Set LUNCHFLOW_API_KEY in .env — syncs nightly"}
            </div>
          </div>
          <Pill tone={lunchflow?.status === "active" ? "sea" : "neutral"}>
            {lunchflow?.status === "active" ? "active" : "via .env"}
          </Pill>
        </div>
      </Card>

      <SectionTitle>Notifications</SectionTitle>
      <SettingsControls
        quietHoursStart={settingsRow?.quietHoursStart ?? 22 * 60}
        quietHoursEnd={settingsRow?.quietHoursEnd ?? 8 * 60}
        toggles={
          settingsRow?.notificationToggles ?? {
            money: true,
            impulse: true,
            payday: true,
            goals: true,
            documents: true,
            digest: true,
            system: true,
          }
        }
      />

      <div className="mt-6">
        <LogoutButton />
      </div>
    </main>
  );
}
