import { isMatchSlug, type Mode, type ModeStatsPayload, type PartyUpdatePayload, type QueueStatusPayload } from "@rushsite/shared";
import { apiUrl, isMock } from "./env";
import * as mock from "./mock";
import { mockCall, mockDelay, mockMatchDetail, mockSignedIn, setMockSignedIn } from "./mock";
import { mockRealtime } from "./ws";
import { mockModeStats } from "./ws-mock";
import { challengeApi } from "@/components/challenges/api";
import { friendsApi } from "@/components/friends/api";
import type {
  Leaderboard,
  MatchDetail,
  Profile,
  ReportReason,
  TournamentBracket,
  TournamentDetail,
  TournamentStatus,
  TournamentSummary,
  User,
  UserSettings,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type InvitePreview = {
  partyId: string;
  leader: { steamId: string; displayName: string; avatarUrl: string | null };
  size: number;
  capacity: number;
  full: boolean;
  isMember: boolean;
};

export type Query = Record<string, string | number | undefined>;

function buildUrl(path: string, query?: Query): string {
  const url = new URL(apiUrl + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
  const res = await fetch(buildUrl(path, opts.query), {
    method,
    credentials: "include",
    headers: opts.body !== undefined ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; message?: string; details?: unknown };
    throw new ApiError(res.status, err.error ?? "http_error", err.message ?? res.statusText, err.details);
  }
  return data as T;
}

function mocked<T>(value: T | null, what = "Not found"): Promise<T> {
  return mockCall(() => {
    if (value === null) throw new ApiError(404, "not_found", what);
    return value;
  });
}

// Only same site paths are allowed as a return target
export function safeReturnTo(v: string | null | undefined): string {
  // Backslashes and control characters can turn a path into another host in some browsers
  return v && v.startsWith("/") && !v.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(v) ? v : "/play";
}

// Where a sign in link points. Mock mode goes through /login which fakes the session
export function steamLoginUrl(returnTo = "/play"): string {
  const target = safeReturnTo(returnTo);
  if (isMock) return `/login?returnTo=${encodeURIComponent(target)}`;
  return buildUrl("/auth/steam", { returnTo: target });
}

// Open mock cups start relative to the real clock, like the home page, so start countdowns run
function onMockClock<T extends { status: TournamentStatus; startsAt: string }>(t: T): T {
  if (t.status !== "open") return t;
  return { ...t, startsAt: new Date(Date.parse(t.startsAt) + Date.now() - mock.MOCK_NOW).toISOString() };
}

export const api = {
  challenges: challengeApi((method, path, body) => request(method, path, { body })),
  friends: friendsApi((method, path, body) => request(method, path, { body })),

  // Generic calls for pages without a dedicated helper
  get: <T>(path: string, query?: Query) => request<T>("GET", path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
  del: <T = void>(path: string) => request<T>("DELETE", path),

  // Returns null when signed out
  async me(): Promise<User | null> {
    if (isMock) return mocked(typeof window !== "undefined" && !mockSignedIn() ? null : mock.MOCK_ME);
    try {
      const res = await request<{ user: User } | User>("GET", "/me");
      return "user" in res ? res.user : res;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  },

  async updateSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
    if (isMock) {
      mock.MOCK_ME.settings = { minTrust: "new", ...mock.MOCK_ME.settings, ...patch };
      return mocked(mock.MOCK_ME.settings);
    }
    const res = await request<{ settings: UserSettings } | UserSettings>("PATCH", "/me/settings", { body: patch });
    return "settings" in res ? res.settings : res;
  },

  async logout(): Promise<void> {
    if (isMock) return setMockSignedIn(false);
    await request("POST", "/auth/logout");
  },

  party: {
    async get(): Promise<PartyUpdatePayload> {
      if (isMock) return mocked(mock.mockParty(2));
      return request("GET", "/parties/me");
    },
    async create(): Promise<PartyUpdatePayload> {
      if (isMock) return mocked(mock.mockParty(1));
      return request("POST", "/parties");
    },
    async join(inviteCode: string): Promise<PartyUpdatePayload> {
      if (isMock) return mocked(mock.mockParty(2));
      return request("POST", `/parties/join/${encodeURIComponent(inviteCode)}`);
    },
    async leave(): Promise<void> {
      if (isMock) return;
      await request("POST", "/parties/leave");
    },
    // In-site invite to a friend. Creates the party when needed
    async inviteUser(steamId: string): Promise<PartyUpdatePayload> {
      return (await api.friends.invite(steamId)).party;
    },
    async kick(steamId: string): Promise<void> {
      if (isMock) return;
      await request("DELETE", `/parties/members/${steamId}`);
    },
    async setLeader(steamId: string): Promise<void> {
      if (isMock) return;
      await request("POST", "/parties/leader", { body: { steamId } });
    },
    // New invite code. The old link stops working
    async rotateInvite(): Promise<PartyUpdatePayload> {
      if (isMock) return mocked({ ...mock.mockParty(1), inviteCode: Math.random().toString(36).slice(2, 10).toUpperCase() });
      return request("POST", "/parties/invite");
    },
    // Public. Throws invite_not_found for bad, rotated or closed links
    async preview(inviteCode: string): Promise<InvitePreview> {
      if (isMock) {
        const p = mock.mockParty(2);
        if (inviteCode !== p.inviteCode) return mocked<InvitePreview>(null, "invite_not_found");
        return mocked({ partyId: p.partyId!, leader: p.members[0]!, size: 2, capacity: 3, full: false, isMember: false });
      }
      return request("GET", `/parties/join/${encodeURIComponent(inviteCode)}`);
    },
  },

  async queueStatus(): Promise<QueueStatusPayload> {
    if (isMock) {
      return mocked(mockRealtime()?.snapshot() ?? null);
    }
    return request("GET", "/queue/status");
  },

  async modeStats(): Promise<ModeStatsPayload> {
    if (isMock) return mocked(mockModeStats());
    return request("GET", "/stats/modes");
  },

  async match(id: string): Promise<MatchDetail> {
    if (isMock) return mocked(/^[0-9a-f-]{36}$/i.test(id) || isMatchSlug(id) ? mockMatchDetail(id) : null, "Match not found");
    return (await request<{ match: MatchDetail }>("GET", `/matches/${id}`)).match;
  },

  // 409 means this viewer already reported that player in this match
  async reportPlayer(matchId: string, body: { steamId: string; reason: ReportReason; note?: string }): Promise<void> {
    if (isMock) return mockDelay(400);
    await request("POST", `/matches/${matchId}/report`, { body });
  },

  async leaderboard(mode: Mode, opts: { offset?: number; limit?: number } = {}): Promise<Leaderboard> {
    if (isMock) return mocked(mock.mockLeaderboard(mode, opts.offset, opts.limit));
    return request("GET", `/leaderboard/${mode}`, { query: opts });
  },

  async profile(steamId: string): Promise<Profile> {
    if (isMock) return mocked(/^\d{17}$/.test(steamId) ? mock.mockProfile(steamId) : null, "Player not found");
    return request("GET", `/users/${steamId}/profile`);
  },

  tournaments: {
    async list(opts: { status?: TournamentStatus[]; mode?: Mode } = {}): Promise<TournamentSummary[]> {
      if (isMock) {
        return mocked(
          mock.MOCK_TOURNAMENTS.filter(
            (t) => (!opts.status || opts.status.includes(t.status)) && (!opts.mode || t.mode === opts.mode),
          ).map(onMockClock),
        );
      }
      const res = await request<{ tournaments: TournamentSummary[] }>("GET", "/tournaments", {
        query: { status: opts.status?.join(","), mode: opts.mode },
      });
      return res.tournaments;
    },
    async detail(id: string): Promise<TournamentDetail> {
      if (isMock) {
        const t = mock.mockTournamentDetail(id);
        return mocked(t && onMockClock(t), "Tournament not found");
      }
      return (await request<{ tournament: TournamentDetail }>("GET", `/tournaments/${id}`)).tournament;
    },
    // Returns null when the bracket is still at knownVersion
    async bracket(id: string, knownVersion?: number): Promise<TournamentBracket | null> {
      if (isMock) {
        const d = await mocked(mock.mockTournamentDetail(id), "Tournament not found");
        if (knownVersion === d.bracketVersion) return null;
        return { tournamentId: id, version: d.bracketVersion, bracket: d.bracket };
      }
      const headers: Record<string, string> = { accept: "application/json" };
      if (knownVersion !== undefined) headers["if-none-match"] = `"${knownVersion}"`;
      const res = await fetch(buildUrl(`/tournaments/${id}/bracket`), { credentials: "include", headers, cache: "no-cache" });
      if (res.status === 304) return null;
      if (!res.ok) throw new ApiError(res.status, "http_error", res.statusText);
      return (await res.json()) as TournamentBracket;
    },
    // teamName is only for 2v2 and 3v3 cups
    async enter(id: string, teamName?: string): Promise<void> {
      if (isMock) return mockDelay();
      await request("POST", `/tournaments/${id}/enter`, teamName ? { body: { teamName } } : {});
    },
    async withdraw(id: string): Promise<void> {
      if (isMock) return mockDelay();
      await request("DELETE", `/tournaments/${id}/enter`);
    },
  },
};
