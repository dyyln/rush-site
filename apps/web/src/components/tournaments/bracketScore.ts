import type { Bracket, BracketMatch, MatchUpdate } from "@/lib/types";

type Side = "a" | "b";
type Update = Pick<MatchUpdate, "matchId" | "teams" | "maps">;

// Cup games name their teams A and B. Other names fall back to roster order
function teamNames(teams: Update["teams"]): Record<Side, string | undefined> {
  const a = teams.find((t) => t.name === "A") ?? teams[0];
  const b = teams.find((t) => t.name === "B") ?? teams[1];
  return { a: a?.name, b: b?.name };
}

// Live score from a match_update for the bracket match playing that game
export function applyMatchUpdate(m: BracketMatch, p: Update): BracketMatch {
  if (!m.liveMatchId || m.liveMatchId !== p.matchId) return m;
  const names = teamNames(p.teams);
  const of = (score: Record<string, number>, side: Side) => (names[side] ? (score[names[side]] ?? 0) : 0);
  const byName = Object.fromEntries(p.teams.map((t) => [t.name, t.score]));
  const top = names.a && names.b ? { a: of(byName, "a"), b: of(byName, "b") } : null;
  if (m.bestOf <= 1) return top ? { ...m, score: top } : m;
  if (!p.maps) return top ? { ...m, score: top } : m;
  const sideOf = (team: string | null): Side | null => (team === names.a ? "a" : team === names.b ? "b" : null);
  const maps = p.maps
    .filter((x) => x.status !== "upcoming")
    .map((x) => {
      const prev = m.maps?.find((y) => y.mapNumber === x.mapNumber);
      // Maps carried over from an earlier server have no score on this match
      if (x.playedIn && prev) return prev;
      return {
        mapNumber: x.mapNumber,
        mapId: x.mapId || null,
        status: x.status === "done" ? ("done" as const) : ("live" as const),
        score: { a: of(x.score, "a"), b: of(x.score, "b") },
        winner: x.status === "done" ? sideOf(x.winnerTeam) : null,
      };
    });
  return { ...m, score: top ?? m.score, maps };
}

export function applyMatchUpdates(bracket: Bracket, updates: ReadonlyMap<string, Update>): Bracket {
  if (updates.size === 0) return bracket;
  return {
    ...bracket,
    matches: bracket.matches.map((m) => {
      const p = m.liveMatchId ? updates.get(m.liveMatchId) : undefined;
      return p ? applyMatchUpdate(m, p) : m;
    }),
  };
}

// What each side's score cell reads. W/O for a win without playing, FF and DQ for the side that lost that way
export function sideMarks(m: BracketMatch): [string, string] {
  const r = m.resolution;
  const aWon = !!m.a && m.winner === m.a;
  const bWon = !!m.b && m.winner === m.b;
  if (r === "double_forfeit") return ["FF", "FF"];
  if (r === "forfeit" || r === "walkover" || r === "disqualified") {
    const lose = r === "disqualified" ? "DQ" : r === "forfeit" ? "FF" : "";
    return [aWon ? "W/O" : m.a ? lose : "", bWon ? "W/O" : m.b ? lose : ""];
  }
  const s = m.score;
  if (s && m.status !== "pending" && m.status !== "ready") return [String(s.a), String(s.b)];
  if (r === "admin_decision") return [aWon ? "W" : "", bWon ? "W" : ""];
  // Older brackets without scores still show series wins
  if (m.status === "done" && r === "played" && !s) {
    const wins = (side: Side) => m.games.filter((g) => g.winner === side).length;
    return [String(wins("a")), String(wins("b"))];
  }
  return ["", ""];
}

// Plain words for the footer and screen readers
export function resolutionText(m: BracketMatch): string | null {
  switch (m.resolution) {
    case "forfeit":
      return "Won by forfeit";
    case "double_forfeit":
      return "Both sides forfeited";
    case "walkover":
      return "Walkover";
    case "disqualified":
      return "Disqualification";
    case "admin_decision":
      return "Admin decision";
    case "void":
      return "Void";
    default:
      return null;
  }
}

export function liveMatchIds(bracket: Bracket | null | undefined): string[] {
  if (!bracket) return [];
  return [...new Set(bracket.matches.flatMap((m) => (m.status === "live" && m.liveMatchId ? [m.liveMatchId] : [])))];
}
