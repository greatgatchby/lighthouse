import { TabBar } from "@/components/TabBar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-safe mx-auto min-h-dvh max-w-lg px-4 pb-28">
      {children}
      <TabBar />
    </div>
  );
}
