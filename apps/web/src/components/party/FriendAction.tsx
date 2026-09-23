"use client";

import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { CheckIcon } from "@/components/ui/CopyButton";
import type { useFriendInvite } from "./useFriendInvite";

type Friend = { steamId: string; displayName: string; registered: boolean };

// Invite for friends here, Send link for Steam friends who have not signed in yet
export function FriendAction({ friend, actions }: { friend: Friend; actions: ReturnType<typeof useFriendInvite> }) {
  if (friend.registered) {
    const done = actions.sent[friend.steamId];
    return (
      <Button
        variant="ghost"
        onClick={() => actions.invite(friend.steamId, friend.displayName)}
        disabled={done}
        loading={actions.busy[friend.steamId]}
        aria-label={`Invite ${friend.displayName} to party`}
      >
        {done ? "Invited" : "Invite"}
      </Button>
    );
  }
  const linked = actions.linked[friend.steamId];
  return (
    <Button
      variant="ghost"
      className={linked ? buttonStyles.copied : undefined}
      icon={linked ? <CheckIcon /> : undefined}
      onClick={() => actions.sendLink(friend.steamId)}
      aria-label={linked ? `Link copied. Paste it in the Steam chat with ${friend.displayName}` : `Send party link to ${friend.displayName} in Steam chat`}
    >
      {linked ? "Copied" : "Send link"}
    </Button>
  );
}

export const STEAM_FRIENDS_SUBTITLE = "Friends here get an invite on the site. Steam friends who have not signed in get a link to paste.";
