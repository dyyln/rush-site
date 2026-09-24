"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/lib/session";

// Home is for visitors. A signed in player goes straight to Play
export function GuestOnly({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (user) router.replace("/play");
  }, [user, router]);
  if (user) return null;
  return <>{children}</>;
}
