// In-memory challenge flows for mock mode. Opponents answer on their own after a short wait
import { CHALLENGE_TTL_SEC, MODES, type Challenge, type ChallengePlayer, type CreateChallengeBody, type CreateChallengeResponse } from "@rushsite/shared";
import { MOCK_ME, mockUser, mockUserBySteamId, mockUuid } from "@/lib/mock";
import { getRealtime } from "@/lib/ws";
import { MockRealtime } from "@/lib/ws-mock";

export type Friend = {
  steamId: string;
  displayName: string;
  avatarUrl: string | null;
  personaState: number;
  inGame: string | null;
  registered: boolean;
};

const store = new Map<string, Challenge>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const player = (u: { steamId: string; displayName: string; avatarUrl: string | null }): ChallengePlayer => ({
  steamId: u.steamId,
  displayName: u.displayName,
  avatarUrl: u.avatarUrl,
});

function hash(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function code(): string {
  const abc = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  return Array.from({ length: 8 }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
}

function rt(): MockRealtime | null {
  const r = getRealtime();
  return r instanceof MockRealtime ? r : null;
}

function publish(c: Challenge) {
  store.set(c.code, c);
  rt()?.emitChallenge({ challenge: structuredClone(c) });
}

function startMatch(c: Challenge, accepter: ChallengePlayer): Challenge {
  const matchId = rt()?.startChallengeMatch(c.mode) ?? mockUuid(`challenge-${c.code}`);
  const next: Challenge = { ...c, status: "accepted", target: accepter, matchId };
  publish(next);
  return next;
}

export function mockCreate(body: CreateChallengeBody): CreateChallengeResponse {
  const existing = body.rematchOfMatchId
    ? [...store.values()].find((c) => c.rematchOfMatchId === body.rematchOfMatchId && c.status === "open")
    : undefined;
  if (existing) return { challenge: structuredClone(existing), url: urlFor(existing.code) };
  const target = body.targetSteamId ? mockUserBySteamId(body.targetSteamId) : body.rematchOfMatchId ? mockUser(3) : null;
  const now = Date.now();
  const c: Challenge = {
    id: mockUuid(`challenge-${now}-${Math.random()}`),
    code: code(),
    mode: body.mode,
    status: "open",
    createdBy: player(MOCK_ME),
    target: target ? player(target) : null,
    rematchOfMatchId: body.rematchOfMatchId ?? null,
    matchId: null,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CHALLENGE_TTL_SEC * 1000).toISOString(),
  };
  publish(c);
  // The other side accepts after a moment. Open links wait for a stranger
  const accepter = target ? player(target) : player(mockUser(7));
  timers.set(
    c.code,
    setTimeout(() => {
      const cur = store.get(c.code);
      if (cur?.status === "open") startMatch(cur, accepter);
    }, target ? 8000 : 15000),
  );
  return { challenge: structuredClone(c), url: urlFor(c.code) };
}

function urlFor(c: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/challenge/${c}`;
}

// Unknown codes read as an incoming challenge so /challenge/ANYCODE can be tried in mock mode
export function mockGet(raw: string): Challenge {
  const key = raw.toUpperCase();
  const known = store.get(key);
  if (known) return structuredClone(known);
  const h = hash(key);
  const now = Date.now();
  const c: Challenge = {
    id: mockUuid(`challenge-${key}`),
    code: key,
    mode: MODES[h % MODES.length]!,
    status: key.startsWith("EXPIRED") ? "expired" : "open",
    createdBy: player(mockUser(1 + (h % 20))),
    target: h % 2 === 0 ? player(MOCK_ME) : null,
    rematchOfMatchId: null,
    matchId: null,
    createdAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + (CHALLENGE_TTL_SEC - 60) * 1000).toISOString(),
  };
  store.set(key, c);
  return structuredClone(c);
}

export function mockAccept(raw: string): Challenge {
  const c = mockGet(raw);
  if (c.status !== "open") throw new Error(`Challenge is ${c.status}`);
  clearTimeout(timers.get(c.code));
  return structuredClone(startMatch(c, player(MOCK_ME)));
}

export function mockDecline(raw: string): Challenge {
  const c = mockGet(raw);
  if (c.status !== "open") throw new Error(`Challenge is ${c.status}`);
  clearTimeout(timers.get(c.code));
  const next: Challenge = { ...c, status: c.createdBy.steamId === MOCK_ME.steamId ? "cancelled" : "declined" };
  publish(next);
  return structuredClone(next);
}

export function mockMine(): Challenge[] {
  return [...store.values()]
    .filter((c) => c.status === "open" && (c.createdBy.steamId === MOCK_ME.steamId || c.target?.steamId === MOCK_ME.steamId))
    .map((c) => structuredClone(c));
}

export function mockFriends(): Friend[] {
  return [2, 5, 9, 14, 21].map((i, n) => {
    const u = mockUser(i);
    return {
      steamId: u.steamId,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      personaState: n < 3 ? 1 : 0,
      inGame: n === 1 ? "730" : null,
      registered: n !== 4,
    };
  });
}
