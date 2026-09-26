import type { MapLoadout, PoolMap, PoolMode, PoolView, TrustLevel } from "@rushsite/shared";
import { api, ApiError } from "@/lib/api";
import { isMock } from "@/lib/env";
import { mockCall } from "@/lib/mock";
import { MockNotFound, mockAdmin } from "./mock";
import { mockOps } from "./ops-mock";
import { mockMaps } from "./maps-mock";
import { mockAdmins } from "./admins-mock";
import { mockActivity } from "./activity-mock";
import { mockGslt } from "./gslt-mock";
import type {
  ActivityOverview,
  AdminDiscordView,
  UserActivityView,
  ActionResult,
  AdminCandidateView,
  AdminListView,
  AdminView,
  BuildInfo,
  EventView,
  GsltAddResult,
  GsltPoolView,
  GsltView,
  HostView,
  MatchDetailView,
  MatchSummaryView,
  OverviewView,
  QueueView,
  UserDetailView,
  UserSearchHit,
  Announcement,
  AuditEntry,
  FeatureFlag,
  MetricsRange,
  MetricsView,
  ResolvedProfile,
  WorkshopPreview,
} from "./types";

export type PoolMapInput = { workshop: string; id?: string; displayName?: string; modes: PoolMode[]; loadout?: MapLoadout };
export type PoolMapPatch = { displayName?: string; modes?: PoolMode[]; loadout?: MapLoadout | null };

export type AnnouncementInput = {
  text: string;
  level: "info" | "warn";
  startsAt?: string;
  endsAt?: string | null;
  dismissible: boolean;
};

async function mocked<T>(fn: () => T): Promise<T> {
  try {
    return await mockCall(fn, 200);
  } catch (e) {
    if (e instanceof MockNotFound) throw new ApiError(404, "not_found", e.message);
    throw e;
  }
}

const action = async (fn: () => ActionResult["audit"]): Promise<ActionResult> => ({ ok: true, audit: await mocked(fn) });

export const adminApi = {
  build(): Promise<BuildInfo> {
    if (isMock)
      return mocked(() => ({
        sha: "652cedf1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7",
        subject: "Backdrop parallax toned down: 5px at most instead of 12px, and a slower follow",
        builtAt: new Date(Date.now() - 42 * 60_000).toISOString(),
      }));
    return api.get("/admin/build");
  },
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
  async searchUsers(q: string): Promise<UserSearchHit[]> {
    if (isMock) return mocked(() => mockAdmin.searchUsers(q));
    return (await api.get<{ users: UserSearchHit[] }>("/admin/users", { q })).users;
  },
  activity(): Promise<ActivityOverview> {
    if (isMock) return mocked(() => mockActivity.overview());
    return api.get("/admin/activity");
  },
  userActivity(steamId: string): Promise<UserActivityView> {
    if (isMock) return mocked(() => mockActivity.user(steamId));
    return api.get(`/admin/users/${steamId}/activity`);
  },
  // Most recent sign ups first
  async newestUsers(limit: number): Promise<UserSearchHit[]> {
    if (isMock) return mocked(() => mockAdmin.newestUsers(limit));
    return (await api.get<{ users: UserSearchHit[] }>("/admin/users", { limit })).users;
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
  discord(steamId: string): Promise<AdminDiscordView> {
    if (isMock) return mocked(() => mockAdmin.discord(steamId));
    return api.get(`/admin/users/${steamId}/discord`);
  },
  discordUnlink(steamId: string): Promise<ActionResult> {
    if (isMock) return action(() => mockAdmin.discordUnlink(steamId));
    return api.post(`/admin/users/${steamId}/discord/unlink`, {});
  },
  discordSync(steamId: string): Promise<ActionResult> {
    if (isMock) return action(() => mockAdmin.discordSync(steamId));
    return api.post(`/admin/users/${steamId}/discord/sync`, {});
  },
  clearCooldown(steamId: string): Promise<ActionResult> {
    if (isMock) return action(() => mockAdmin.clearCooldown(steamId));
    return api.post(`/admin/users/${steamId}/cooldown/clear`, {});
  },

  resolveProfile(q: string): Promise<ResolvedProfile> {
    if (isMock) return mocked(() => mockOps.resolve(q));
    return api.get("/admin/users/resolve", { q });
  },
  metrics(range: MetricsRange): Promise<MetricsView> {
    if (isMock) return mocked(() => mockOps.metrics(range));
    return api.get("/admin/metrics", { range });
  },
  async flags(): Promise<FeatureFlag[]> {
    if (isMock) return mocked(() => mockOps.flags());
    return (await api.get<{ flags: FeatureFlag[] }>("/admin/flags")).flags;
  },
  setFlag(key: string, enabled: boolean, value?: unknown): Promise<{ flag: FeatureFlag; audit: AuditEntry; drained?: number }> {
    if (isMock) return mocked(() => mockOps.setFlag(key, enabled, value));
    return api.put(`/admin/flags/${encodeURIComponent(key)}`, value === undefined ? { enabled } : { enabled, value });
  },
  deleteFlag(key: string): Promise<{ ok: true; audit: AuditEntry }> {
    if (isMock) return mocked(() => mockOps.deleteFlag(key));
    return api.del(`/admin/flags/${encodeURIComponent(key)}`);
  },
  async announcements(): Promise<Announcement[]> {
    if (isMock) return mocked(() => mockOps.announcements());
    return (await api.get<{ announcements: Announcement[] }>("/admin/announcements")).announcements;
  },
  createAnnouncement(input: AnnouncementInput): Promise<{ announcement: Announcement; audit: AuditEntry }> {
    if (isMock) return mocked(() => mockOps.createAnnouncement(input));
    return api.post("/admin/announcements", input);
  },
  updateAnnouncement(id: string, patch: Partial<AnnouncementInput>): Promise<{ announcement: Announcement; audit: AuditEntry }> {
    if (isMock) return mocked(() => mockOps.updateAnnouncement(id, patch));
    return api.patch(`/admin/announcements/${id}`, patch);
  },
  deleteAnnouncement(id: string): Promise<{ ok: true; audit: AuditEntry }> {
    if (isMock) return mocked(() => mockOps.deleteAnnouncement(id));
    return api.del(`/admin/announcements/${id}`);
  },

  maps(): Promise<PoolView> {
    if (isMock) return mocked(() => mockMaps.view());
    return api.get("/admin/maps");
  },
  workshopPreview(q: string): Promise<WorkshopPreview> {
    if (isMock) return mocked(() => mockMaps.preview(q));
    return api.get("/admin/maps/workshop", { q });
  },
  addMap(input: PoolMapInput): Promise<{ map: PoolMap; audit: AuditEntry }> {
    if (isMock) return mocked(() => mockMaps.add(input));
    return api.post("/admin/maps", input);
  },
  updateMap(id: string, patch: PoolMapPatch): Promise<{ map: PoolMap; audit: AuditEntry }> {
    if (isMock) return mocked(() => mockMaps.update(id, patch));
    return api.patch(`/admin/maps/${encodeURIComponent(id)}`, patch);
  },
  reorderMaps(ids: string[]): Promise<{ maps: PoolMap[]; audit: AuditEntry }> {
    if (isMock) return mocked(() => mockMaps.reorder(ids));
    return api.put("/admin/maps/order", { ids });
  },
  removeMap(id: string): Promise<{ ok: true; audit: AuditEntry }> {
    if (isMock) return mocked(() => mockMaps.remove(id));
    return api.del(`/admin/maps/${encodeURIComponent(id)}`);
  },

  gslt(): Promise<GsltPoolView> {
    if (isMock) return mocked(() => mockGslt.list());
    return api.get("/admin/gslt");
  },
  addGslt(text: string, memo?: string): Promise<GsltAddResult> {
    if (isMock) return mocked(() => mockGslt.add(text, memo));
    return api.post("/admin/gslt", memo ? { text, memo } : { text });
  },
  updateGslt(id: string, memo: string | null): Promise<{ token: GsltView; audit: AuditEntry }> {
    if (isMock) return mocked(() => mockGslt.update(id, memo));
    return api.patch(`/admin/gslt/${encodeURIComponent(id)}`, { memo });
  },
  removeGslt(id: string): Promise<{ ok: true; audit: AuditEntry }> {
    if (isMock) return mocked(() => mockGslt.remove(id));
    return api.del(`/admin/gslt/${encodeURIComponent(id)}`);
  },

  admins(): Promise<AdminListView> {
    if (isMock) return mocked(() => mockAdmins.list());
    return api.get("/admin/admins");
  },
  adminCandidate(q: string): Promise<AdminCandidateView> {
    if (isMock) return mocked(() => mockAdmins.lookup(q));
    return api.get("/admin/admins/lookup", { q });
  },
  addAdmin(steamId: string, note?: string): Promise<{ admin: AdminView; audit: AuditEntry }> {
    if (isMock) return mocked(() => mockAdmins.grant(steamId, note));
    return api.post("/admin/admins", note ? { steamId, note } : { steamId });
  },
  removeAdmin(steamId: string): Promise<{ ok: true; audit: AuditEntry }> {
    if (isMock) return mocked(() => mockAdmins.revoke(steamId));
    return api.del(`/admin/admins/${encodeURIComponent(steamId)}`);
  },
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message || e.code;
  return e instanceof Error ? e.message : String(e);
}

export function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}
