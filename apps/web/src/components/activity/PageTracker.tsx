"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/session";
import { getRealtime } from "@/lib/ws";

// Tells the api which page a signed in player is on, for activity stats
export function PageTracker() {
  const pathname = usePathname();
  const { user } = useSession();
  const signedIn = !!user;

  useEffect(() => {
    if (!signedIn || !pathname) return;
    const rt = getRealtime();
    rt.connect();
    rt.send("page_view", { path: pathname });
  }, [pathname, signedIn]);

  return null;
}
