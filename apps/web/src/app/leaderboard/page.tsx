import type { Metadata } from "next";
import { Suspense } from "react";
import { LeaderboardView } from "./LeaderboardView";

export const metadata: Metadata = { title: "Leaderboard" };

export default function LeaderboardPage() {
  return (
    <Suspense>
      <LeaderboardView />
    </Suspense>
  );
}
