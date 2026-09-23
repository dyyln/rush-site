import type { TrustLevel } from "@rushsite/shared";
import { api, ApiError } from "@/lib/api";
import { isMock } from "@/lib/env";
import { MockNotFound, mockAdmin } from "./mock";
import type {
  ActionResult,
  EventView,
  HostView,
  MatchDetailView,
  MatchSummaryView,
  OverviewView,
  QueueView,
  UserDetailView,
} from "./types";

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms));

async function mocked<T>(fn: () => T): Promise<T> {
  await delay();
  try {
    return structuredClone(fn());
  } catch (e) {
    if (e instanceof MockNotFound) throw new ApiError(404, "not_found", e.message);
    throw e;
  }
}

const action = async (fn: () => ActionResult["audit"]): Promise<ActionResult> => ({ ok: true, audit: await mocked(fn) });

export const adminApi = {
  overview(): Promise<OverviewView> {
    if (isMock) return mocked(() => mockAdmin.overview());
    return api.get("/admin/overview");
  },
  queue(): Promise<QueueView> {
    if (isMock) return mocked(() => mockAdmin.queue());
    return api.get("/admin/queue");
  },
  async matches(status: "active" | "recent", limit = 50): Promise<MatchSummaryView[]> {
    if (isMock) return mocked(() => mockAdmin.matches(status));
    return (await api.get<{ matches: MatchSummaryView[] }>("/admin/matches", { status, limit })).matches;
  },
  async match(id: string): Promise<MatchDetailView> {
    if (isMock) return mocked(() => mockAdmin.match(id));
    return (await api.get<{ match: MatchDetailView }>(`/admin/matches/${encodeURIComponent(id)}`)).match;
  },
  async hosts(): Promise<HostView[]> {
    if (isMock) return mocked(() => mockAdmin.hosts());
    return (await api.get<{ hosts: HostView[] }>("/admin/hosts")).hosts;
  },
  async events(limit = 100): Promise<EventView[]> {
    if (isMock) return mocked(() => mockAdmin.events(limit));
    return (await api.get<{ events: EventView[] }>("/admin/events", { limit })).events;
  },
  user(steamId: string): Promise<UserDetailView> {
    if (isMock) return mocked(() => mockAdmin.user(steamId));
    return api.get(`/admin/users/${encodeURIComponent(steamId)}`);
  },

  removeTicket(ticketId: string, reason?: string): Promise<ActionResult> {
    if (isMock) return action(() => mockAdmin.removeTicket(ticketId, reason));
    return api.post(`/admin/queue/${ticketId}/remove`, { reason });
  },
  cancelMatch(id: string, reason: string): Promise<ActionResult> {
    if (isMock) return action(() => mockAdmin.cancelMatch(id, reason));
    return api.post(`/admin/matches/${id}/cancel`, { reason });
  },
  ban(steamId: string, reason: string, until: string | null): Promise<ActionResult> {
    if (isMock) return action(() => mockAdmin.ban(steamId, reason, until));
    return api.post(`/admin/users/${steamId}/ban`, { reason, until });
  },
  unban(steamId: string): Promise<ActionResult> {
    if (isMock) return action(() => mockAdmin.unban(steamId));
    return api.post(`/admin/users/${steamId}/unban`, {});
  },
  setTrust(steamId: string, level: TrustLevel): Promise<ActionResult> {
    if (isMock) return action(() => mockAdmin.setTrust(steamId, level));
    return api.post(`/admin/users/${steamId}/trust`, { level });
  },
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message || e.code;
  return e instanceof Error ? e.message : String(e);
}

export function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}
