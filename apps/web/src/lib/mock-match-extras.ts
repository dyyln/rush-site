// Mock kills, MVP, rating deltas and demo for match pages. Seeded per round so live refetches stay stable
import type { MatchDetail, MatchKill, MatchTeam } from "./types";

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const AIM_WEAPONS: Record<string, string[]> = {
  aim_usp: ["usp_silencer"],
  aim_deagle7k: ["deagle"],
  awp_india: ["awp"],
};
const AIM_DEFAULT = ["ak47", "ak47", "m4a1_silencer", "deagle", "m4a4"];
const RUSH_WEAPONS = ["ak47", "ak47", "m4a1_silencer", "awp", "mp9", "glock", "usp_silencer", "deagle", "hegrenade", "knife"];
const NO_WALLBANG = new Set(["knife", "hegrenade"]);

const TICK_RATE = 64;

function roundKills(m: MatchDetail, seed: number, roundIndex: number): MatchKill[] {
  const round = m.rounds[roundIndex];
  if (!round) return [];
  const r = rng(seed * 31 + round.round * 7919);
  const winIdx = m.teams.findIndex((t) => t.name === round.winnerTeam);
  const winners = m.teams[winIdx === -1 ? 0 : winIdx]!.players;
  const losers = m.teams[winIdx === 1 ? 0 : 1]!.players;
  const pool = m.mode === "rush3v3" ? RUSH_WEAPONS : (AIM_WEAPONS[m.mapId ?? ""] ?? AIM_DEFAULT);
  // Winners kill every loser in aim. In rush tower control can end the round early
  const loserDeaths = m.mode === "rush3v3" ? 1 + Math.floor(r() * losers.length) : losers.length;
  const winnerDeaths = Math.floor(r() * winners.length);
  const aliveW = winners.map((p) => p.steamId);
  const aliveL = losers.map((p) => p.steamId);
  const kills: MatchKill[] = [];
  let tick = (round.round - 1) * TICK_RATE * 75 + TICK_RATE * (8 + Math.floor(r() * 12));
  let wLeft = winnerDeaths;
  let lLeft = loserDeaths;
  while (lLeft > 0 || wLeft > 0) {
    // The last kill of the round always goes to the winners
    const loserKill = wLeft > 0 && (lLeft <= 1 ? true : r() < 0.4);
    const atk = loserKill ? aliveL : aliveW;
    const vic = loserKill ? aliveW : aliveL;
    const victimIndex = Math.floor(r() * vic.length);
    const victim = vic[victimIndex]!;
    vic.splice(victimIndex, 1);
    // Now and then a loser dies to a teammate to show team kills
    const tk = !loserKill && vic.length > 0 && r() < 0.08;
    const attacker = tk ? vic[Math.floor(r() * vic.length)]! : atk[Math.floor(r() * atk.length)]!;
    const weapon = pool[Math.floor(r() * pool.length)]!;
    const mates = (tk ? [] : atk).filter((s) => s !== attacker);
    kills.push({
      round: round.round,
      tick,
      attacker,
      victim,
      weapon,
      headshot: weapon !== "hegrenade" && weapon !== "knife" && r() < 0.45,
      wallbang: !NO_WALLBANG.has(weapon) && r() < 0.07,
      assister: mates.length > 0 && r() < 0.3 ? mates[Math.floor(r() * mates.length)] : undefined,
    });
    if (loserKill) wLeft--;
    else lLeft--;
    tick += TICK_RATE * (1 + Math.floor(r() * 9));
  }
  return kills;
}

export function mockMatchExtras(m: MatchDetail, seed: number, opts: { demo?: boolean } = {}): Partial<MatchDetail> {
  const kills = m.rounds.flatMap((_, i) => roundKills(m, seed, i));
  const r = rng(seed ^ 0x5bd1e995);
  const teams: MatchTeam[] = m.teams.map((t) => ({
    ...t,
    players: t.players.map((p) => {
      const k = kills.filter((x) => x.attacker === p.steamId);
      const hs = k.filter((x) => x.headshot).length;
      return {
        ...p,
        kills: k.length,
        deaths: kills.filter((x) => x.victim === p.steamId).length,
        headshots: hs,
        damage: Math.round(k.length * (88 + r() * 30) + hs * 6 + r() * 60),
      };
    }),
  }));
  const done = m.status === "finished";
  if (!done) return { teams, kills, mvp: null, demo: { available: false } };

  const everyone = teams.flatMap((t) => t.players);
  const top = [...everyone].sort((a, b) => b.damage - a.damage || b.kills - a.kills)[0];
  const winner = m.teams.reduce((a, b) => (b.score > a.score ? b : a)).name;
  const ratingDeltas: Record<string, number> = {};
  for (const t of teams) {
    for (const p of t.players) {
      const d = 8 + Math.round(r() * 16);
      ratingDeltas[p.steamId] = t.name === winner ? d : -d;
    }
  }
  const available = opts.demo ?? true;
  return {
    teams,
    kills,
    mvp: top ? { steamId: top.steamId, reason: everyone.some((p) => p !== top && p.damage === top.damage) ? "most_kills" : "most_damage" } : null,
    ratingDeltas,
    demo: available
      ? {
          available: true,
          url: `https://demos.rushsite.invalid/matches/${m.id}.dem?X-Amz-Expires=600`,
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        }
      : { available: false },
  };
}
