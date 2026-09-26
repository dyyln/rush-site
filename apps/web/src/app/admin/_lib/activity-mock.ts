// Fake activity stats for NEXT_PUBLIC_MOCK=1
import { mockSteamId } from "@/lib/mock";
import type { ActivityEvent, ActivityOverview, ActivityWindow, UserActivityView } from "./types";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function window(scale: number): ActivityWindow {
  return {
    activePlayers: Math.round(40 * scale),
    newPlayers: Math.round(6 * scale),
    queueJoins: Math.round(120 * scale),
    queueSeconds: Math.round(120 * scale * 95),
    matchesFound: Math.round(48 * scale),
    matchesPlayed: Math.round(41 * scale),
    cupSignups: Math.round(9 * scale),
    pageViews: Math.round(900 * scale),
    avgWaitSec: 95,
  };
}

export const mockActivity = {
  overview(): ActivityOverview {
    const today = Math.floor(Date.now() / DAY) * DAY;
    return {
      generatedAt: iso(Date.now()),
      inactiveDays: 7,
      totals: {
        players: 412,
        sessions: 3890,
        pageViews: 41200,
        queueJoins: 5210,
        queueSeconds: 5210 * 92,
        matchesFound: 2100,
        matchesPlayed: 1830,
        cupSignups: 340,
      },
      windows: { "24h": window(1), "7d": window(4.5), "30d": window(14) },
      modes30d: [
        { mode: "aim1v1", queueJoins: 820, matchesFound: 390, matchesPlayed: 350, avgWaitSec: 41 },
        { mode: "aim2v2", queueJoins: 310, matchesFound: 120, matchesPlayed: 104, avgWaitSec: 118 },
        { mode: "rush3v3", queueJoins: 560, matchesFound: 170, matchesPlayed: 150, avgWaitSec: 164 },
      ],
      daily: Array.from({ length: 30 }, (_, i) => {
        const day = today - (29 - i) * DAY;
        const wave = 1 + 0.35 * Math.sin(i / 2.2);
        return {
          day: iso(day).slice(0, 10),
          activePlayers: Math.round(38 * wave),
          newPlayers: Math.round(5 * wave),
          queueJoins: Math.round(115 * wave),
          matchesFound: Math.round(46 * wave),
        };
      }),
      cohorts: Array.from({ length: 8 }, (_, i) => {
        const players = 30 + ((i * 7) % 13);
        const age = i * 7;
        const r = (n: number, rate: number) => (age >= n ? { eligible: players, returned: Math.round(players * rate) } : { eligible: 0, returned: 0 });
        return { week: iso(today - age * DAY).slice(0, 10), players, retention: { d1: r(1, 0.52), d7: r(7, 0.31), d30: r(30, 0.18) } };
      }),
      inactivePlayers: 231,
      lastActions: [
        { action: "page_view", detail: "/play", players: 64 },
        { action: "queue_leave", detail: "left", players: 41 },
        { action: "match_end", detail: "loss", players: 38 },
        { action: "match_end", detail: "win", players: 29 },
        { action: "page_view", detail: "/", players: 22 },
        { action: "match_missed", detail: null, players: 14 },
        { action: "cup_signup", detail: null, players: 9 },
        { action: null, detail: null, players: 14 },
      ],
    };
  },

  user(steamId: string): UserActivityView {
    const now = Date.now();
    const events: ActivityEvent[] = [
      { kind: "page_view", mode: null, ref: null, detail: "/leaderboard", value: null, at: iso(now - 20 * 60_000) },
      { kind: "match_end", mode: "aim1v1", ref: "m1", detail: "win", value: 780, at: iso(now - 25 * 60_000) },
      { kind: "match_start", mode: "aim1v1", ref: "m1", detail: null, value: null, at: iso(now - 38 * 60_000) },
      { kind: "match_accept", mode: "aim1v1", ref: "m1", detail: null, value: null, at: iso(now - 41 * 60_000) },
      { kind: "match_found", mode: "aim1v1", ref: "m1", detail: "queue", value: null, at: iso(now - 41 * 60_000) },
      { kind: "queue_matched", mode: "aim1v1", ref: "t1", detail: "m1", value: 64, at: iso(now - 41 * 60_000) },
      { kind: "queue_join", mode: null, ref: "t1", detail: "aim1v1,aim2v2", value: null, at: iso(now - 42 * 60_000) },
      { kind: "page_view", mode: null, ref: null, detail: "/play", value: null, at: iso(now - 43 * 60_000) },
      { kind: "session_start", mode: null, ref: null, detail: null, value: null, at: iso(now - 44 * 60_000) },
      { kind: "cup_signup", mode: "aim1v1", ref: "c1", detail: null, value: null, at: iso(now - 2 * DAY) },
      { kind: "match_missed", mode: "rush3v3", ref: "m0", detail: null, value: null, at: iso(now - 3 * DAY) },
    ];
    return {
      totals: {
        sessions: 23,
        pageViews: 310,
        queueJoins: 48,
        queueSeconds: 48 * 88,
        matchesFound: 31,
        matchesAccepted: 29,
        matchesDeclined: 1,
        matchesMissed: 1,
        matchesPlayed: 27,
        matchesWon: 15,
        cupSignups: 4,
        firstSeenAt: iso(now - 40 * DAY),
        lastSeenAt: iso(now - 18 * 60_000),
        lastAction: "page_view",
        lastActionDetail: "/leaderboard",
        lastActionMode: null,
        lastActionAt: iso(now - 20 * 60_000),
        lastPage: "/leaderboard",
      },
      avgWaitSec: 88,
      events: steamId === mockSteamId(1) ? [] : events,
    };
  },
};
