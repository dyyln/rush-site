// REST client for the review queue and report outcomes. Mock mode serves a small fixed set
import type {
  FlagStatus,
  MyReport,
  ReviewDecideBody,
  ReviewDecideResponse,
  ReviewFlag,
  ReviewListResponse,
} from "@rushsite/shared";
import { api } from "@/lib/api";
import { isMock } from "@/lib/env";
import { mockCall } from "@/lib/mock";
import { mockClaim, mockDecide, mockFlag, mockList, mockMyReports, mockUnclaim } from "./mock";

export const reviewApi = {
  list(status: FlagStatus | "all"): Promise<ReviewListResponse> {
    if (isMock) return mockCall(() => mockList(status));
    return api.get("/admin/review", { status });
  },
  async flag(id: string): Promise<ReviewFlag> {
    if (isMock) return mockCall(() => mockFlag(id));
    return (await api.get<{ flag: ReviewFlag }>(`/admin/review/${encodeURIComponent(id)}`)).flag;
  },
  async claim(id: string): Promise<ReviewFlag> {
    if (isMock) return mockCall(() => mockClaim(id));
    return (await api.post<{ flag: ReviewFlag }>(`/admin/review/${encodeURIComponent(id)}/claim`, {})).flag;
  },
  async unclaim(id: string): Promise<ReviewFlag> {
    if (isMock) return mockCall(() => mockUnclaim(id));
    return (await api.post<{ flag: ReviewFlag }>(`/admin/review/${encodeURIComponent(id)}/unclaim`, {})).flag;
  },
  decide(id: string, body: ReviewDecideBody): Promise<ReviewDecideResponse> {
    if (isMock) return mockCall(() => mockDecide(id, body));
    return api.post(`/admin/review/${encodeURIComponent(id)}/decide`, body);
  },
  async myReports(matchId?: string): Promise<MyReport[]> {
    if (isMock) return mockCall(() => mockMyReports(matchId));
    return (await api.get<{ reports: MyReport[] }>("/me/reports", { matchId })).reports;
  },
};
