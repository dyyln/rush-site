import type { CupSchedule, CupSchedulePatch, CupScheduleCreate, CreateCup } from "@rushsite/shared";
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
  async updateSchedule(id: string, patch: CupSchedulePatch): Promise<CupSchedule> {
    if (isMock) return mocked(() => mockCups.updateSchedule(id, patch));
    return (await api.patch<{ schedule: CupSchedule }>(`/admin/tournaments/schedules/${id}`, patch)).schedule;
  },
  async deleteSchedule(id: string): Promise<void> {
    if (isMock) return mocked(() => mockCups.deleteSchedule(id));
    await api.del(`/admin/tournaments/schedules/${id}`);
  },

  // Open and running cups, soonest first
  async active(): Promise<TournamentSummary[]> {
    if (isMock) return mocked(() => mockCups.active());
    return api.tournaments.list({ status: ["open", "running"] });
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
  forceResult(id: string, bracketMatchId: string, winnerEntryId: string, reason: string): Promise<Ok> {
    if (isMock) return mocked(() => mockCups.forceResult(id, bracketMatchId, winnerEntryId));
    return api.post(`/admin/tournaments/${id}/matches/${encodeURIComponent(bracketMatchId)}/force-result`, {
      winnerEntryId,
      reason,
    });
  },
};
