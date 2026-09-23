"use client";

import { FriendsCard } from "@/components/friends/FriendsCard";
import type { InviteSource } from "@/components/party/useFriendInvite";

// Kept for existing imports. The friends card now lives with the friends feature
export function FriendsChallenge(invite: InviteSource) {
  return <FriendsCard {...invite} />;
}
