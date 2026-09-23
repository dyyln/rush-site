import type { TeamSide } from "@/components/ui/TeamMarker";
import type { MatchDetail, MatchPlayer, MvpReason } from "@/lib/types";

export type RosterEntry = { player: MatchPlayer; side: TeamSide; team: string };
export type Roster = Map<string, RosterEntry>;

// The viewer's team is own. A neutral viewer sees the first team as own
export function ownTeamIndex(m: MatchDetail, viewer?: string | null): number {
  const i = m.teams.findIndex((t) => t.players.some((p) => p.steamId === viewer));
  return i === -1 ? 0 : i;
}

export function buildRoster(m: MatchDetail, ownIndex: number): Roster {
  const map: Roster = new Map();
  m.teams.forEach((t, i) => {
    for (const p of t.players) map.set(p.steamId, { player: p, side: i === ownIndex ? "own" : "enemy", team: t.name });
  });
  return map;
}

export function mvpReason(reason: MvpReason | string, p: MatchPlayer): string {
  const stats = `${p.damage} damage, ${p.kills} kills, ${p.deaths} deaths`;
  if (reason === "most_damage") return `Highest damage. ${stats}`;
  if (reason === "most_kills") return `Most kills on tied damage. ${stats}`;
  return stats;
}
