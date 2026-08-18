"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Today", icon: "🕯️" },
  { href: "/money", label: "Money", icon: "🪙" },
  { href: "/goals", label: "Goals", icon: "✨" },
  { href: "/chat", label: "Chat", icon: "💬" },
  { href: "/more", label: "More", icon: "☰" },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-(--color-card-edge) bg-(--color-ink)/90 backdrop-blur-lg">
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        {TABS.map((tab) => {
          const active =
            tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex min-w-16 flex-col items-center gap-0.5 px-2 pb-1 pt-2 text-[10px] font-medium ${
                active ? "text-(--color-beacon)" : "text-(--color-fog)"
              }`}
            >
              <span className="text-xl leading-none" aria-hidden>
                {tab.icon}
              </span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
