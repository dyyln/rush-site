import { AIM_MAPS, MODES, RANKED_MODES, RUSH_MAP, type Mode } from "@rushsite/shared";
import { api } from "@/lib/api";
import { isMock } from "@/lib/env";
import { MOCK_LIVE_MATCH_ID, MOCK_MATCH_HINTS, MOCK_NOW, MOCK_TOURNAMENTS, mockMatchDetail, mockUuid, mockUser } from "@/lib/mock";
import { isMode, teamSize } from "@/lib/modes";
import type { TournamentSummary } from "@/lib/types";

// The list rows may carry myEntryId. When they do not, detail is fetched for signed in players
type OpenCup = TournamentSummary & { myEntryId?: string | null };

export type NextCup = { mode: Mode; cup: TournamentSummary | null; entered: boolean };

export async function fetchNextCups(signedIn: boolean): Promise<NextCup[]> {
  const open: OpenCup[] = isMock ? mockOpenCups() : await api.tournaments.list({ status: ["open"] });
  const next = RANKED_MODES.map((mode) => {
    const cup = open
      .filter((t) => t.mode === mode)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
    return { mode, cup: cup ?? null };
  });
  return Promise.all(
    next.map(async ({ mode, cup }) => {
      if (!cup) return { mode, cup: null, entered: false };
      if (cup.myEntryId !== undefined || !signedIn || isMock) return { mode, cup, entered: !!cup.myEntryId };
      try {
        const detail = await api.tournaments.detail(cup.id);
        return { mode, cup, entered: !!detail.myEntryId };
      } catch {
        return { mode, cup, entered: false };
      }
    }),
  );
}

// Moves the fixed mock times onto the real clock so the countdown runs
function mockOpenCups(): OpenCup[] {
  const shift = Date.now() - MOCK_NOW;
  return MOCK_TOURNAMENTS.filter((t) => t.status === "open").map((t, i) => ({
    ...t,
    startsAt: new Date(Date.parse(t.startsAt) + shift).toISOString(),
    myEntryId: i === 0 ? mockUuid(t.id + "entry") : null,
  }));
}

export type LiveTeam = { name: string; score: number; players: string[] };

export type LiveMatch = {
  id: string;
  mode: Mode;
  mapId: string | null;
  startedAt: string | null;
  teams: LiveTeam[];
  tournamentName: string | null;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Accepts the match detail shape and the profile history row shape until the live row is pinned down
function toLiveMatch(row: unknown): LiveMatch | null {
  if (!isObj(row)) return null;
  const id = str(row.id) ?? str(row.matchId);
  const mode = str(row.mode);
  if (!id || !isMode(mode)) return null;
  let teams: LiveTeam[] = [];
  if (Array.isArray(row.teams)) {
    teams = row.teams.filter(isObj).map((t, i) => ({
      name: str(t.name) ?? (i === 0 ? "Team A" : "Team B"),
      score: num(t.score),
      players: Array.isArray(t.players)
        ? t.players.map((p) => (isObj(p) ? str(p.displayName) : str(p))).filter((x): x is string => !!x)
        : [],
    }));
  } else if ("scoreFor" in row || "scoreAgainst" in row) {
    teams = [
      { name: "Team A", score: num(row.scoreFor), players: [] },
      { name: "Team B", score: num(row.scoreAgainst), players: [] },
    ];
  }
  const tournament = isObj(row.tournament) ? str(row.tournament.name) : null;
  return {
    id,
    mode,
    mapId: str(row.mapId),
    startedAt: str(row.startedAt) ?? str(row.playedAt),
    teams,
    tournamentName: tournament,
  };
}

export async function fetchLiveMatches(limit = 6): Promise<LiveMatch[]> {
  if (isMock) return mockLiveMatches(limit);
  const res = await api.get<unknown>("/matches/live", { limit });
  const rows = Array.isArray(res) ? res : isObj(res) && Array.isArray(res.matches) ? res.matches : [];
  return rows
    .map(toLiveMatch)
    .filter((m): m is LiveMatch => m !== null)
    .slice(0, limit);
}

function mockLiveMatches(limit: number): LiveMatch[] {
  const now = Date.now();
  const first = mockMatchDetail(MOCK_LIVE_MATCH_ID, now);
  const rows: LiveMatch[] = [toLiveMatch(first)!];
  const specs: { mode: Mode; mapId: string; a: number; b: number }[] = [
    { mode: "rush3v3", mapId: RUSH_MAP.id, a: 4, b: 3 },
    { mode: "aim2v2", mapId: AIM_MAPS[1]!.id, a: 11, b: 7 },
    { mode: "rush3v3", mapId: RUSH_MAP.id, a: 2, b: 5 },
    { mode: "aim1v1", mapId: AIM_MAPS[3]!.id, a: 13, b: 12 },
    { mode: "aim2v2", mapId: AIM_MAPS[0]!.id, a: 3, b: 6 },
  ];
  specs.forEach((s, i) => {
    const id = mockUuid(`live-${i}`);
    MOCK_MATCH_HINTS.set(id, { mode: s.mode, mapId: s.mapId });
    const size = teamSize(s.mode);
    const names = (off: number) => Array.from({ length: size }, (_, j) => mockUser(i * 10 + off + j + 2).displayName);
    rows.push({
      id,
      mode: s.mode,
      mapId: s.mapId,
      startedAt: new Date(now - (i + 2) * 4 * 60_000).toISOString(),
      teams: [
        { name: "Team A", score: s.a, players: names(0) },
        { name: "Team B", score: s.b, players: names(5) },
      ],
      tournamentName: null,
    });
  });
  return rows.slice(0, limit);
}
