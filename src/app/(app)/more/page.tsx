import Link from "next/link";
import { Card } from "@/components/ui";

const SECTIONS = [
  { href: "/documents", label: "Documents", icon: "📄", hint: "Capture, file, find" },
  { href: "/food", label: "Food", icon: "🍜", hint: "Meals, gently logged" },
  { href: "/move", label: "Move", icon: "🏃", hint: "Movement sessions" },
  { href: "/reading", label: "Reading", icon: "📚", hint: "The list" },
  { href: "/settings", label: "Settings", icon: "⚙️", hint: "Push, connections, quiet hours" },
];

export default function MorePage() {
  return (
    <main>
      <header className="pt-6 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">More</h1>
      </header>
      <div className="space-y-2">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="block">
            <Card className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden>
                {s.icon}
              </span>
              <div>
                <div className="font-medium">{s.label}</div>
                <div className="text-sm text-(--color-fog)">{s.hint}</div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
