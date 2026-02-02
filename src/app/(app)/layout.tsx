"use client";

import { useRouter } from "next/navigation";
import { TopNav } from "@/components/layout/top-nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const handleNewChat = () => {
    router.push("/chat");
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      <TopNav onNewChat={handleNewChat} />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        {children}
      </main>
    </div>
  );
}
