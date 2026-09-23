import type { Bracket, BracketMatch } from "@/lib/types";

export type BracketPath = {
  // Every match on the entry's route, played and still to come
  matchIds: Set<string>;
  // Matches whose outgoing connector is part of the route
  connectorIds: Set<string>;
  // First match on the route that is not finished
  nextId: string | null;
  outcome: "alive" | "eliminated" | "champion";
  // Round the entry reached last
  round: number;
};

const key = (round: number, index: number) => `${round}:${index}`;

// The entry's past matches plus the slots it would play if it keeps winning
export function bracketPath(bracket: Bracket, entryId: string | null | undefined): BracketPath | null {
  if (!entryId) return null;
  const own = bracket.matches.filter((m) => m.a === entryId || m.b === entryId).sort((x, y) => x.round - y.round);
  const last = own.at(-1);
  if (!last) return null;
  const byPos = new Map<string, BracketMatch>(bracket.matches.map((m) => [key(m.round, m.index), m]));
  const route: BracketMatch[] = [...own];
  const lost = last.status === "done" && !!last.winner && last.winner !== entryId;
  if (!lost) {
    let index = last.index;
    for (let r = last.round + 1; r <= bracket.rounds; r++) {
      index = Math.floor(index / 2);
      const m = byPos.get(key(r, index));
      if (m) route.push(m);
    }
  }
  const matchIds = new Set(route.map((m) => m.id));
  const connectorIds = new Set(route.filter((m) => m.round < bracket.rounds && !(lost && m.id === last.id)).map((m) => m.id));
  const next = route.find((m) => m.status !== "done") ?? null;
  const champion = last.round === bracket.rounds && last.status === "done" && last.winner === entryId;
  return {
    matchIds,
    connectorIds,
    nextId: lost ? null : (next?.id ?? null),
    outcome: lost ? "eliminated" : champion ? "champion" : "alive",
    round: last.round,
  };
}
