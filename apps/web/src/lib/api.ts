import type { Mode, PartyUpdatePayload, QueueStatusPayload } from "@rushsite/shared";
import { apiUrl, isMock } from "./env";
import * as mock from "./mock";
import type {
  Leaderboard,
  Profile,
  TournamentDetail,
  TournamentStatus,
  TournamentSummary,
  User,
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

type Query = Record<string, string | number | undefined>;

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

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

async function mocked<T>(value: T | null, what = "Not found"): Promise<T> {
  await delay();
  if (value === null) throw new ApiError(404, "not_found", what);
  return structuredClone(value);
}

export function steamLoginUrl(returnTo = "/play"): string {
  if (isMock) return returnTo;
  return buildUrl("/auth/steam", { returnTo });
}

export const api = {
  // Returns null when signed out
  async me(): Promise<User | null> {
    if (isMock) return mocked(mock.MOCK_ME);
    try {
      return (await request<{ user: User }>("GET", "/auth/me")).user;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  },

  async logout(): Promise<void> {
    if (isMock) return;
    await request("POST", "/auth/logout");
  },

  party: {
    async get(): Promise<PartyUpdatePayload> {
      if (isMock) return mocked(mock.mockParty(1));
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
    async kick(steamId: string): Promise<void> {
      if (isMock) return;
      await request("DELETE", `/parties/members/${steamId}`);
    },
  },

  async queueStatus(): Promise<QueueStatusPayload> {
    if (isMock) {
      return mocked({ state: "idle", mode: null, partyId: null, queuedAt: null, cooldownUntil: null });
    }
    return request("GET", "/queue/status");
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
          ),
        );
      }
      const res = await request<{ tournaments: TournamentSummary[] }>("GET", "/tournaments", {
        query: { status: opts.status?.join(","), mode: opts.mode },
      });
      return res.tournaments;
    },
    async detail(id: string): Promise<TournamentDetail> {
      if (isMock) return mocked(mock.mockTournamentDetail(id), "Tournament not found");
      return (await request<{ tournament: TournamentDetail }>("GET", `/tournaments/${id}`)).tournament;
    },
    async enter(id: string): Promise<void> {
      if (isMock) return delay();
      await request("POST", `/tournaments/${id}/enter`);
    },
    async withdraw(id: string): Promise<void> {
      if (isMock) return delay();
      await request("DELETE", `/tournaments/${id}/enter`);
    },
  },
};
