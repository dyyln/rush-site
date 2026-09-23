import type { CupSchedule, CupSchedulePatch, CupScheduleCreate, CreateCup, OpenCupOutcome } from "@rushsite/shared";
import { api, ApiError } from "@/lib/api";
import { isMock } from "@/lib/env";
import { mockCall } from "@/lib/mock";
import type { TournamentDetail, TournamentSummary } from "@/lib/types";
import { MockCupError, mockCups } from "./mock";

async function mocked<T>(fn: () => T): Promise<T> {
  try {
    return await mockCall(fn, 200);
  } catch (e) {
    if (e instanceof MockCupError) throw new ApiError(e.status, e.code, e.message);
    throw e;
  }
}

type Ok = { ok: true; tournament: TournamentSummary };

export const cupsApi = {
  async schedules(): Promise<CupSchedule[]> {
    if (isMock) return mocked(() => mockCups.schedules());
    return (await api.get<{ schedules: CupSchedule[] }>("/admin/tournaments/schedules")).schedules;
  },
  async createSchedule(body: CupScheduleCreate): Promise<CupSchedule> {
    if (isMock) return mocked(() => mockCups.createSchedule(body));
    return (await api.post<{ schedule: CupSchedule }>("/admin/tournaments/schedules", body)).schedule;
  },
  updateSchedule(id: string, patch: CupSchedulePatch): Promise<{ schedule: CupSchedule; openCup: OpenCupOutcome | null }> {
    if (isMock) return mocked(() => mockCups.updateSchedule(id, patch));
    return api.patch(`/admin/tournaments/schedules/${id}`, patch);
  },
  async deleteSchedule(id: string): Promise<OpenCupOutcome | null> {
    if (isMock) return mocked(() => mockCups.deleteSchedule(id));
    return (await api.del<{ openCup: OpenCupOutcome | null }>(`/admin/tournaments/schedules/${id}`)).openCup;
  },

  // Open and running cups, soonest first
  async active(): Promise<TournamentSummary[]> {
    if (isMock) return mocked(() => mockCups.active());
    return api.tournaments.list({ status: ["open", "running"] });
  },
  // Most recent completed cups first
  async completed(limit = 10): Promise<TournamentSummary[]> {
    if (isMock) return mocked(() => mockCups.completed());
    const rows = await api.tournaments.list({ status: ["completed"] });
    return rows.slice(-limit).reverse();
  },
  async detail(id: string): Promise<TournamentDetail> {
    if (isMock) return mocked(() => mockCups.detail(id));
    return api.tournaments.detail(id);
  },
  async createCup(body: CreateCup): Promise<TournamentSummary> {
    if (isMock) return mocked(() => mockCups.createCup(body));
    return (await api.post<{ tournament: TournamentSummary }>("/admin/tournaments", body)).tournament;
  },
  cancel(id: string, reason: string): Promise<Ok> {
    if (isMock) return mocked(() => mockCups.cancel(id));
    return api.post(`/admin/tournaments/${id}/cancel`, { reason });
  },
  reschedule(id: string, startsAt: string): Promise<Ok> {
    if (isMock) return mocked(() => mockCups.reschedule(id, startsAt));
    return api.post(`/admin/tournaments/${id}/reschedule`, { startsAt });
  },
  disqualify(id: string, entryId: string, reason: string): Promise<Ok> {
    if (isMock) return mocked(() => mockCups.disqualify(id, entryId));
    return api.post(`/admin/tournaments/${id}/entries/${entryId}/disqualify`, { reason });
  },
  stripBadges(id: string, entryId: string, reason: string): Promise<{ ok: true; removed: number }> {
    if (isMock) return mocked(() => mockCups.stripBadges(id, entryId));
    return api.post(`/admin/tournaments/${id}/entries/${entryId}/strip-badges`, { reason });
  },
  forceResult(id: string, bracketMatchId: string, winnerEntryId: string, reason: string): Promise<Ok> {
    if (isMock) return mocked(() => mockCups.forceResult(id, bracketMatchId, winnerEntryId));
    return api.post(`/admin/tournaments/${id}/matches/${encodeURIComponent(bracketMatchId)}/force-result`, {
      winnerEntryId,
      reason,
    });
  },
};
