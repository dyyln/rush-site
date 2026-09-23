"use client";

import { useEffect, useRef } from "react";
import type { Challenge } from "@rushsite/shared";
import { ApiError } from "@/lib/api";
import { isMock } from "@/lib/env";
import { getRealtime } from "@/lib/ws";

// Calls handler for every challenge_update. Opens the socket so updates arrive on any page
export function useChallengeUpdates(handler: (c: Challenge) => void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const rt = getRealtime();
    rt.connect();
    return rt.on("challenge_update", (p) => ref.current(p.challenge));
  }, [enabled]);
}

// Hands over to the match flow on /play. A full load makes the api resend the veto or server state on connect.
// Mock mode keeps the in-memory socket, so it navigates client side
export function goToMatch(push: (href: string) => void) {
  if (isMock) push("/play");
  else if (window.location.pathname === "/play") return;
  else window.location.assign("/play");
}

const MESSAGES: Record<string, string> = {
  not_target: "This challenge is for someone else.",
  own_challenge: "You cannot accept your own challenge.",
  party_size: "You need a full party for this mode.",
  not_leader: "Only your party leader can do that.",
  roster_changed: "A rematch needs the same players as the original match.",
  opponents_split: "The other team is no longer in one party.",
  in_match: "A player is already in a match.",
  cooldown: "A player is on a queue cooldown.",
  banned: "A player is banned.",
  challenge_expired: "This challenge has expired.",
  challenge_accepted: "This challenge was already accepted.",
  challenge_declined: "This challenge was declined.",
  challenge_cancelled: "This challenge was withdrawn.",
  too_many_challenges: "You have too many open challenges.",
  match_not_finished: "The match has not finished yet.",
  mode_unavailable: "This mode is not available yet.",
  self_challenge: "You cannot challenge yourself.",
};

export function challengeError(e: unknown): string {
  if (e instanceof ApiError) return MESSAGES[e.code] ?? e.message;
  return e instanceof Error ? e.message : "Something went wrong";
}

export function isParticipant(c: Challenge, steamId: string | undefined): boolean {
  return !!steamId && (c.createdBy.steamId === steamId || c.target?.steamId === steamId);
}
