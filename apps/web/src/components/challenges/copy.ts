// Words for challenge links. Used by the page, its link preview and the share line
import { BRAND_NAME, isRushMode, MODE_CONFIGS, type ChallengeMap, type ChallengeStatus, type Mode } from "@rushsite/shared";
import { MODE_COPY } from "@/lib/modes";

// "1v1 on Redline", or "1v1 Aim" when the veto picks the map
export function challengeWhat(mode: Mode, map: ChallengeMap | null): string {
  const copy = MODE_COPY[mode];
  return map ? `${copy.format} on ${map.displayName}` : `${copy.format} ${copy.name}`;
}

export function challengeHeadline(name: string, mode: Mode, map: ChallengeMap | null): string {
  return `${name} challenges you to a ${challengeWhat(mode, map)}`;
}

export function challengeRules(mode: Mode, map: ChallengeMap | null): string {
  if (isRushMode(mode)) return "Valve's Rush rules on a dedicated CS2 server.";
  const maps = map ? "" : " Both sides ban maps first.";
  return `First to 13 rounds on a dedicated CS2 server.${maps}`;
}

const CLOSED: Record<Exclude<ChallengeStatus, "open">, string> = {
  accepted: "This challenge was already taken.",
  declined: "This challenge was declined.",
  expired: "This challenge has expired.",
  cancelled: "This challenge was withdrawn.",
};

export function challengeClosedLine(status: Exclude<ChallengeStatus, "open">): string {
  return CLOSED[status];
}

export function challengeDescription(mode: Mode, map: ChallengeMap | null, status: ChallengeStatus): string {
  if (status !== "open") return `${CLOSED[status]} Queue for ${MODE_COPY[mode].label} on ${BRAND_NAME} instead.`;
  return `${challengeRules(mode, map)} Sign in with Steam and accept before the link expires.`;
}

// Text to paste into a chat, such as "1v1 me on Redline: https://..."
export function shareLine(mode: Mode, map: ChallengeMap | null, url: string): string {
  const who = MODE_CONFIGS[mode].teamSize > 1 ? "us" : "me";
  return `${MODE_COPY[mode].format} ${who} on ${map ? map.displayName : BRAND_NAME}: ${url}`;
}
