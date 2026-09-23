// In-memory friends for mock mode. One friend is in a live match, one is queued
import {
  PARTY_INVITE_TTL_SEC,
  type Friend,
  type FriendRequest,
  type FriendsPendingResponse,
  type FriendsResponse,
  type FriendUpdatePayload,
  type PartyInvite,
  type PartyUpdatePayload,
  type RecentPlayer,
  type SteamOnlyFriend,
} from "@rushsite/shared";
import { MOCK_ME, mockParty, mockSteamId, mockUser, mockUserBySteamId, mockUuid } from "@/lib/mock";
import { getRealtime } from "@/lib/ws";
import { MockRealtime } from "@/lib/ws-mock";

const LIVE_MATCH_ID = "3c7e2a10-5d4b-4f8e-9a61-7b2c0d1e4f53";

const card = (i: number) => {
  const u = mockUser(i);
  return { steamId: u.steamId, displayName: u.displayName, avatarUrl: u.avatarUrl };
};

const tiers = (a: Friend["tiers"]["aim1v1"], b: Friend["tiers"]["aim1v1"], c: Friend["tiers"]["aim1v1"]): Friend["tiers"] => ({
  aim1v1: a,
  aim2v2: b,
  rush3v3: c,
});

type Store = {
  friends: Friend[];
  requests: FriendRequest[];
  recent: RecentPlayer[];
  steamOnly: SteamOnlyFriend[];
  invites: PartyInvite[];
  score: [number, number];
};

let store: Store | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

function rt(): MockRealtime | null {
  const r = getRealtime();
  return r instanceof MockRealtime ? r : null;
}

function request(from: ReturnType<typeof card>, to: ReturnType<typeof card>, minutesAgo: number): FriendRequest {
  return {
    id: mockUuid(`freq-${from.steamId}-${to.steamId}`),
    from,
    to,
    status: "pending",
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    respondedAt: null,
  };
}

const STEAM_NAMES = ["kettle_fish", "nomad.cs", "wraith", "pilot", "moss", "glint", "tarn", "fjord", "cinder", "ledger", "quill", "hollow", "brisk", "ember", "slate"];

// A long Steam list like a real account has, so paging and search get exercised
function steamOnlyFriends(n: number): SteamOnlyFriend[] {
  return Array.from({ length: n }, (_, i) => ({
    steamId: mockSteamId(400 + i),
    displayName: `${STEAM_NAMES[i % STEAM_NAMES.length]}${i < STEAM_NAMES.length ? "" : `_${i}`}`,
    avatarUrl: null,
    personaState: i % 4 === 0 ? 1 : 0,
  }));
}

function init(): Store {
  if (store) return store;
  const me = card(0);
  const recentAt = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  store = {
    score: [5, 3],
    friends: [
      {
        ...card(2),
        presence: "match",
        detail: { matchId: LIVE_MATCH_ID, mode: "rush3v3", mapId: "rush_001", score: [5, 3] },
        source: "steam",
        tiers: tiers("gold", "silver", "platinum"),
      },
      { ...card(5), presence: "queue", detail: { modes: ["aim1v1", "aim2v2"] }, source: "request", tiers: tiers("platinum", "gold", "unranked") },
      { ...card(9), presence: "online", source: "steam", tiers: tiers("silver", "unranked", "bronze") },
      { ...card(14), presence: "offline", source: "steam", tiers: tiers("bronze", "bronze", "iron") },
      { ...card(17), presence: "offline", source: "request", tiers: tiers("unranked", "unranked", "unranked") },
    ],
    requests: [request(card(11), me, 12), request(me, card(23), 90)],
    recent: [
      { ...card(6), matchId: mockUuid("recent-1"), mode: "aim1v1", playedAt: recentAt(2), requested: false },
      { ...card(12), matchId: mockUuid("recent-2"), mode: "rush3v3", playedAt: recentAt(5), requested: false },
      { ...card(19), matchId: mockUuid("recent-2"), mode: "rush3v3", playedAt: recentAt(5), requested: false },
    ],
    steamOnly: steamOnlyFriends(150),
    invites: [],
    // The live friend's score ticks so the card visibly updates
  };
  if (typeof window !== "undefined" && !ticker) {
    ticker = setInterval(() => {
      const s = store!;
      const f = s.friends.find((x) => x.presence === "match");
      if (!f?.detail?.score) return;
      const [a, b] = f.detail.score;
      if (a >= 8 || b >= 8) return;
      f.detail = { ...f.detail, score: Math.random() < 0.55 ? [a + 1, b] : [a, b + 1] };
      push({ kind: "presence", steamId: f.steamId, presence: f.presence, detail: f.detail });
    }, 20_000);
  }
  return store;
}

function push(p: FriendUpdatePayload) {
  rt()?.emitFriends("friend_update", structuredClone(p));
}

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

export function mockList(): FriendsResponse {
  const s = init();
  return structuredClone({
    friends: s.friends,
    incoming: s.requests.filter((r) => r.to.steamId === MOCK_ME.steamId && r.status === "pending"),
    outgoing: s.requests.filter((r) => r.from.steamId === MOCK_ME.steamId && r.status === "pending"),
    steamListAvailable: true,
    steamOnly: s.steamOnly,
  });
}

export function mockPending(): FriendsPendingResponse {
  const s = init();
  const now = Date.now();
  return structuredClone({
    requests: s.requests.filter((r) => r.to.steamId === MOCK_ME.steamId && r.status === "pending").length,
    invites: s.invites.filter((i) => i.status === "pending" && Date.parse(i.expiresAt) > now),
  });
}

export function mockRecent(): RecentPlayer[] {
  const s = init();
  const friends = new Set(s.friends.map((f) => f.steamId));
  return structuredClone(s.recent.filter((r) => !friends.has(r.steamId)));
}

function befriend(u: { steamId: string; displayName: string; avatarUrl: string | null }) {
  const s = init();
  if (s.friends.some((f) => f.steamId === u.steamId)) return;
  s.friends.push({ ...u, presence: "online", source: "request", tiers: tiers("silver", "unranked", "unranked") });
}

export function mockSend(steamId: string): FriendRequest {
  const s = init();
  if (steamId === MOCK_ME.steamId) fail("cannot_add_self", "You cannot add yourself");
  if (s.friends.some((f) => f.steamId === steamId)) fail("already_friends", "Already friends");
  const reverse = s.requests.find((r) => r.status === "pending" && r.from.steamId === steamId);
  if (reverse) return mockAccept(reverse.id);
  const existing = s.requests.find((r) => r.status === "pending" && r.to.steamId === steamId);
  if (existing) return structuredClone(existing);
  const u = mockUserBySteamId(steamId);
  const r = request(card(0), { steamId: u.steamId, displayName: u.displayName, avatarUrl: u.avatarUrl }, 0);
  s.requests.push(r);
  s.recent = s.recent.map((p) => (p.steamId === steamId ? { ...p, requested: true } : p));
  push({ kind: "request", steamId, request: r });
  return structuredClone(r);
}

function find(id: string): FriendRequest {
  const r = init().requests.find((x) => x.id === id);
  if (!r) fail("request_not_found", "Request not found");
  if (r.status !== "pending") fail("request_not_pending", "Request already answered");
  return r;
}

export function mockAccept(id: string): FriendRequest {
  const r = find(id);
  r.status = "accepted";
  r.respondedAt = new Date().toISOString();
  const other = r.from.steamId === MOCK_ME.steamId ? r.to : r.from;
  befriend(other);
  push({ kind: "accepted", steamId: other.steamId, request: r });
  return structuredClone(r);
}

export function mockDecline(id: string): FriendRequest {
  const r = find(id);
  r.status = "declined";
  r.respondedAt = new Date().toISOString();
  push({ kind: "declined", steamId: r.from.steamId, request: r });
  return structuredClone(r);
}

export function mockCancel(id: string): FriendRequest {
  const r = find(id);
  r.status = "cancelled";
  r.respondedAt = new Date().toISOString();
  push({ kind: "declined", steamId: r.to.steamId, request: r });
  return structuredClone(r);
}

export function mockUnfriend(steamId: string): void {
  const s = init();
  if (!s.friends.some((f) => f.steamId === steamId)) fail("not_friends", "Not friends");
  s.friends = s.friends.filter((f) => f.steamId !== steamId);
  push({ kind: "removed", steamId });
}

export function mockInvite(steamId: string): { invite: PartyInvite; party: PartyUpdatePayload } {
  const s = init();
  const f = s.friends.find((x) => x.steamId === steamId);
  if (!f) fail("not_friends", "Only friends can be invited");
  const party = mockParty(1);
  const invite: PartyInvite = {
    id: mockUuid(`invite-out-${steamId}-${Date.now()}`),
    partyId: party.partyId!,
    from: card(0),
    inviteCode: party.inviteCode!,
    expiresAt: new Date(Date.now() + PARTY_INVITE_TTL_SEC * 1000).toISOString(),
    status: "pending",
  };
  return { invite, party };
}

// An invite from the online friend arrives once per tab so the toast can be tried
export function mockScheduleIncomingInvite(delayMs = 6000): () => void {
  const KEY = "rushsite-mock-invite-shown";
  try {
    if (window.sessionStorage.getItem(KEY)) return () => undefined;
  } catch {
    // Storage can be blocked. The invite then shows on every load
  }
  const t = setTimeout(() => {
    try {
      window.sessionStorage.setItem(KEY, "1");
    } catch {
      // Ignored, see above
    }
    const s = init();
    const from = s.friends.find((f) => f.presence === "online") ?? s.friends[0]!;
    const invite: PartyInvite = {
      id: mockUuid(`invite-in-${Date.now()}`),
      partyId: mockUuid(`party-${from.steamId}`),
      from: { steamId: from.steamId, displayName: from.displayName, avatarUrl: from.avatarUrl },
      inviteCode: "M0CK-1NV1",
      expiresAt: new Date(Date.now() + PARTY_INVITE_TTL_SEC * 1000).toISOString(),
      status: "pending",
    };
    s.invites.push(invite);
    rt()?.emitFriends("party_invite", { invite: structuredClone(invite) });
  }, delayMs);
  return () => clearTimeout(t);
}

function answer(id: string, status: "accepted" | "declined"): PartyInvite {
  const inv = init().invites.find((i) => i.id === id);
  if (!inv) fail("invite_not_found", "Invite not found");
  if (inv.status !== "pending") fail("invite_not_pending", "Invite already answered");
  inv.status = status;
  rt()?.emitFriends("party_invite", { invite: structuredClone(inv) });
  return structuredClone(inv);
}

export function mockAcceptInvite(id: string): { invite: PartyInvite; party: PartyUpdatePayload } {
  const invite = answer(id, "accepted");
  const base = mockParty(1);
  const party: PartyUpdatePayload = {
    ...base,
    partyId: invite.partyId,
    leaderSteamId: invite.from.steamId,
    members: [invite.from, ...base.members],
    inviteCode: invite.inviteCode,
  };
  return { invite, party };
}

export function mockDeclineInvite(id: string): PartyInvite {
  return answer(id, "declined");
}
