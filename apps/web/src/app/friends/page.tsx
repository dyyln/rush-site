import type { Metadata } from "next";
import { Suspense } from "react";
import { FriendsView } from "./FriendsView";

export const metadata: Metadata = { title: "Friends" };

export default function FriendsPage() {
  return (
    <Suspense>
      <FriendsView />
    </Suspense>
  );
}
