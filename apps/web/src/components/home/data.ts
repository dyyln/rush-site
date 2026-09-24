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
    const cup = open.filter((t) => t.mode === mode).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
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
