import type { Metadata } from "next";
import { FriendsView } from "./FriendsView";

export const metadata: Metadata = { title: "Friends" };

export default function FriendsPage() {
  return <FriendsView />;
}
