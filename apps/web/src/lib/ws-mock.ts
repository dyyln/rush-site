// Simulates the api side of the match flow so /play works with no backend.
import {
  MODES,
  MODE_CONFIGS,
  maxRatingDiffAfter,
  type ModeStatsPayload,
  type QueueModeStatus,
  type QueueStatusPayload,
  type ClientMessage,
  type ClientMessageType,
  type Mode,
  type ServerMessage,
  type ServerMessageType,
  type VetoState,
} from "@rushsite/shared";
import { hasLadderVeto } from "./modes";
import { MOCK_ME, MOCK_TOURNAMENTS, bumpMockBracketVersion, mockMatchDetail, mockSteamId, mockTournamentDetail } from "./mock";
import { Emitter, type ClientPayload, type ConnectionState, type Realtime } from "./ws-core";

type PayloadOf<U extends { type: string; payload: unknown }, T extends U["type"]> = Extract<U, { type: T }>["payload"];

const MATCH_ID = "9d4f1c2a-7b3e-4a5d-8c6f-1e2d3c4b5a69";
const ACCEPT_SEC = 20;
const STEP_SEC = 20;

export class MockRealtime extends Emitter implements Realtime {
  state: ConnectionState = "closed";
  private timers: ReturnType<typeof setTimeout>[] = [];
  private mode: Mode | null = null;
  private queued: { mode: Mode; queuedAt: number }[] = initialQueue();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private veto: VetoState | null = null;
  private accepted = 0;
  // The first match found is cancelled to show that flow once
  private cancelShown = false;
  private required = 2;

  connect() {
    if (this.state === "open") return;
    this.state = "open";
    this.emitState("open");
    this.startTicker();
  }

  snapshot(): QueueStatusPayload {
    return queuePayload(this.queued);
  }

  private startTicker() {
    if (this.ticker) return;
    this.ticker = setInterval(() => {
      if (this.queued.length > 0) this.emit("queue_status", this.snapshot());
      this.emit("mode_stats", mockModeStats());
    }, 5000);
  }

  close() {
    this.clear();
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.state = "closed";
    this.emitState("closed");
  }

  private matchSubs = new Map<string, ReturnType<typeof setInterval>>();

  private subscribe(matchId: string) {
    if (this.matchSubs.has(matchId)) return;
    let seen = mockMatchDetail(matchId).rounds.length;
    const t = setInterval(() => {
      const m = mockMatchDetail(matchId);
      if (m.rounds.length === seen) return;
      seen = m.rounds.length;
      this.emit("match_update", {
        matchId,
        status: m.status,
        teams: m.teams.map((x) => ({ name: x.name, score: x.score })),
        lastRound: m.rounds.at(-1),
      });
    }, 1000);
    this.matchSubs.set(matchId, t);
  }

  private unsubscribe(matchId: string) {
    clearInterval(this.matchSubs.get(matchId));
    this.matchSubs.delete(matchId);
  }

  private tournamentSubs = new Map<string, ReturnType<typeof setInterval>>();

  // Running mock cups report a bracket change every few seconds so the page refetches
  private subscribeTournament(tournamentId: string) {
    const t = MOCK_TOURNAMENTS.find((x) => x.id === tournamentId);
    if (!t || t.status !== "running" || this.tournamentSubs.has(tournamentId)) return;
    const timer = setInterval(() => {
      const live = mockTournamentDetail(tournamentId)?.bracket?.matches.find((m) => m.status === "live");
      this.emit("tournament_update", {
        kind: "match_updated",
        tournament: t,
        bracketVersion: bumpMockBracketVersion(tournamentId),
        ...(live ? { bracketMatchId: live.id } : {}),
      });
    }, 8000);
    this.tournamentSubs.set(tournamentId, timer);
  }

  private unsubscribeTournament(tournamentId: string) {
    clearInterval(this.tournamentSubs.get(tournamentId));
    this.tournamentSubs.delete(tournamentId);
  }

  send<T extends ClientMessageType>(type: T, payload: ClientPayload<T>): boolean {
    const msg = { type, payload } as ClientMessage;
    switch (msg.type) {
      case "queue_join":
        this.join(msg.payload.modes);
        break;
      case "queue_leave":
        this.leave(msg.payload.modes);
        break;
      case "accept_match":
        this.accept(msg.payload.accept);
        break;
      case "veto_vote":
        this.vote(MOCK_ME.steamId, msg.payload.mapId);
        break;
      case "subscribe_match":
        this.subscribe(msg.payload.matchId);
        break;
      case "unsubscribe_match":
        this.unsubscribe(msg.payload.matchId);
        break;
      case "subscribe_tournament":
        this.subscribeTournament(msg.payload.tournamentId);
        break;
      case "unsubscribe_tournament":
        this.unsubscribeTournament(msg.payload.tournamentId);
        break;
    }
    return true;
  }

  // Challenge flows. A challenge match skips queue and accept and goes straight to the veto
  startChallengeMatch(mode: Mode): string {
    this.clear();
    this.mode = mode;
    this.queued = [];
    this.emit("queue_status", this.snapshot());
    this.later(1200, () => this.afterAccept(mode));
    return MATCH_ID;
  }

  emitChallenge(payload: PayloadOf<ServerMessage, "challenge_update">) {
    this.emit("challenge_update", payload);
  }

  // Friends and party invite notices from the friends mock
  emitFriends<T extends "friend_update" | "party_invite">(type: T, payload: PayloadOf<ServerMessage, T>) {
    this.dispatch({ type, payload, ts: Date.now() } as ServerMessage);
  }

  private emit<T extends ServerMessageType>(type: T, payload: PayloadOf<ServerMessage, T>) {
    this.dispatch({ type, payload, ts: Date.now() } as ServerMessage);
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(setTimeout(fn, ms));
  }

  private clear() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private idle() {
    this.queued = [];
    this.emit("queue_status", this.snapshot());
  }

  private join(modes: Mode[]) {
    this.clear();
    const now = Date.now();
    const kept = this.queued.filter((q) => modes.includes(q.mode));
    const added = modes.filter((m) => !kept.some((q) => q.mode === m)).map((mode) => ({ mode, queuedAt: now }));
    this.queued = [...kept, ...added];
    this.emit("queue_status", this.snapshot());
    const first = MODES.find((m) => modes.includes(m));
    if (first) this.later(10_000, () => this.found(first));
  }

  private leave(modes?: Mode[]) {
    this.queued = modes ? this.queued.filter((q) => !modes.includes(q.mode)) : [];
    if (this.queued.length === 0) this.clear();
    this.emit("queue_status", this.snapshot());
  }

  private found(mode: Mode) {
    this.mode = mode;
    this.accepted = 0;
    this.required = MODE_CONFIGS[mode].teamSize * 2;
    this.queued = [];
    this.emit("queue_status", this.snapshot());
    this.emit("match_found", {
      matchId: MATCH_ID,
      mode,
      acceptDeadline: Date.now() + ACCEPT_SEC * 1000,
      acceptWindowSec: ACCEPT_SEC,
      accepted: 0,
      required: this.required,
    });
    if (!this.cancelShown) {
      this.cancelShown = true;
      for (let i = 1; i < this.required - 1; i++) this.later(900 * i, () => this.bumpAccepted(mode));
      this.later(6000, () => {
        this.clear();
        this.mode = null;
        this.emit("match_cancelled", { matchId: MATCH_ID, reason: "An opponent did not accept" });
        this.idle();
      });
      return;
    }
    for (let i = 1; i < this.required; i++) {
      this.later(900 * i, () => this.bumpAccepted(mode));
    }
    this.later(ACCEPT_SEC * 1000, () => {
      if (this.accepted < this.required) this.cooldown();
    });
  }

  private bumpAccepted(mode: Mode) {
    this.accepted++;
    this.emit("match_found", {
      matchId: MATCH_ID,
      mode,
      acceptDeadline: Date.now() + (ACCEPT_SEC - 1) * 1000,
      acceptWindowSec: ACCEPT_SEC,
      accepted: this.accepted,
      required: this.required,
    });
    if (this.accepted === this.required) this.later(800, () => this.afterAccept(mode));
  }

  private accept(yes: boolean) {
    if (!this.mode) return;
    if (!yes) {
      this.clear();
      this.cooldown();
      return;
    }
    this.bumpAccepted(this.mode);
  }

  private cooldown() {
    this.clear();
    this.queued = [];
    this.emit("queue_status", { state: "cooldown", partyId: null, modes: [], cooldownUntil: Date.now() + 60_000 });
  }

  private afterAccept(mode: Mode) {
    if (!hasLadderVeto(mode)) {
      this.later(1500, () => this.ready(mode, MODE_CONFIGS[mode].maps[0]!.id));
      return;
    }
    const pool = MODE_CONFIGS[mode].maps.map((m) => m.id);
    const size = MODE_CONFIGS[mode].teamSize;
    const us = [MOCK_ME.steamId, ...Array.from({ length: size - 1 }, (_, i) => mockSteamId(i + 4))];
    const them = Array.from({ length: size }, (_, i) => mockSteamId(i + 20));
    this.veto = {
      pool,
      teams: [
        { id: "team_a", steamIds: us },
        { id: "team_b", steamIds: them },
      ],
      steps: pool.slice(1).map((_, i) => ({ action: "ban" as const, team: (i % 2) as 0 | 1 })),
      stepIndex: 0,
      available: [...pool],
      votes: {},
      history: [],
      done: false,
      maps: [],
    };
    this.pushVeto();
  }

  private pushVeto() {
    const v = this.veto;
    if (!v || !this.mode) return;
    this.emit("veto_state", {
      matchId: MATCH_ID,
      mode: this.mode,
      state: structuredClone(v),
      stepDeadline: v.done ? null : Date.now() + STEP_SEC * 1000,
    });
    if (v.done) {
      this.later(1500, () => this.ready(this.mode!, v.maps[0]!));
      return;
    }
    const step = v.steps[v.stepIndex]!;
    const team = v.teams[step.team];
    const step0 = v.stepIndex;
    // Teammates and opponents vote on their own
    team.steamIds
      .filter((id) => id !== MOCK_ME.steamId)
      .forEach((id, i) =>
        this.later(1200 + i * 700, () => {
          if (v.stepIndex !== step0) return;
          const pick = v.available[(i + step0) % v.available.length]!;
          this.vote(id, pick);
        }),
      );
    this.later(STEP_SEC * 1000, () => {
      if (v.stepIndex === step0) this.resolve();
    });
  }

  private vote(steamId: string, mapId: string) {
    const v = this.veto;
    if (!v || v.done) return;
    const team = v.teams[v.steps[v.stepIndex]!.team];
    if (!team.steamIds.includes(steamId) || !v.available.includes(mapId)) return;
    v.votes = { ...v.votes, [steamId]: mapId };
    if (team.steamIds.every((id) => id in v.votes)) this.resolve();
    else this.pushVetoQuiet();
  }

  private pushVetoQuiet() {
    const v = this.veto;
    if (!v || !this.mode) return;
    this.emit("veto_state", {
      matchId: MATCH_ID,
      mode: this.mode,
      state: structuredClone(v),
      stepDeadline: Date.now() + STEP_SEC * 1000,
    });
  }

  private resolve() {
    const v = this.veto;
    if (!v) return;
    const counts = new Map<string, number>();
    Object.values(v.votes).forEach((m) => counts.set(m, (counts.get(m) ?? 0) + 1));
    const max = Math.max(0, ...counts.values());
    const leaders = max === 0 ? v.available : v.available.filter((m) => counts.get(m) === max);
    const mapId = leaders[Math.floor(Math.random() * leaders.length)]!;
    const step = v.steps[v.stepIndex]!;
    v.history.push({
      step: v.stepIndex,
      action: step.action,
      team: step.team,
      mapId,
      votes: { ...v.votes },
      tieBroken: leaders.length > 1 && max > 0,
      noVotes: max === 0,
    });
    v.available = v.available.filter((m) => m !== mapId);
    v.votes = {};
    v.stepIndex++;
    v.done = v.stepIndex >= v.steps.length;
    v.maps = v.done ? [...v.available] : [];
    this.pushVeto();
  }

  private ready(mode: Mode, mapId: string) {
    this.emit("server_ready", {
      matchId: MATCH_ID,
      ip: "203.0.113.24",
      port: 27017,
      password: "mock-7f3a",
      connect: "connect 203.0.113.24:27017; password mock-7f3a",
      mapId,
    });
    // Players join the server one by one during warm-up
    const expected = MODE_CONFIGS[mode].teamSize * 2;
    for (let n = 1; n <= expected; n++) {
      this.later(2500 * n, () =>
        this.emit("match_update", { matchId: MATCH_ID, status: "ready", teams: [], connected: n, expected }),
      );
    }
    this.later(30000, () => {
      this.emit("match_result", {
        matchId: MATCH_ID,
        mode,
        status: "completed",
        winnerTeam: "team_a",
        score: mode === "rush3v3" ? { team_a: 8, team_b: 5 } : { team_a: 16, team_b: 11 },
        ratingChanges: [
          { steamId: MOCK_ME.steamId, before: 1712, after: 1729, tierBefore: "gold", tierAfter: "gold" },
        ],
      });
      this.idle();
    });
  }
}

const PLAYERS: Record<Mode, number> = { aim1v1: 23, aim2v2: 14, rush3v3: 41 };
const ESTIMATE: Record<Mode, number> = { aim1v1: 45, aim2v2: 90, rush3v3: 70 };

// Idle at start. Start queue from the page to see the queued state
function initialQueue(): { mode: Mode; queuedAt: number }[] {
  return [];
}

function queuePayload(queued: { mode: Mode; queuedAt: number }[]): QueueStatusPayload {
  const now = Date.now();
  const modes: QueueModeStatus[] = queued.map((q) => {
    const waitSec = Math.floor((now - q.queuedAt) / 1000);
    return {
      mode: q.mode,
      queuedAt: q.queuedAt,
      waitSec,
      estimatedSec: ESTIMATE[q.mode],
      ratingWindow: maxRatingDiffAfter(waitSec),
      playersInQueue: PLAYERS[q.mode] + (Math.floor(now / 5000) % 5),
    };
  });
  return { state: modes.length > 0 ? "queued" : "idle", partyId: null, modes, cooldownUntil: null };
}

const BASE_STATS: Record<Mode, { queue: number; live: number }> = {
  aim1v1: { queue: 23, live: 18 },
  aim2v2: { queue: 14, live: 9 },
  rush3v3: { queue: 41, live: 12 },
};

// Counts drift a little every tick so the cards look live
export function mockModeStats(now = Date.now()): ModeStatsPayload {
  const tick = Math.floor(now / 5000);
  return {
    modes: MODES.map((mode, i) => {
      const wobble = (n: number) => Math.round(Math.sin(tick * 0.9 + i * 2.1) * n);
      return {
        mode,
        playersInQueue: Math.max(0, BASE_STATS[mode].queue + wobble(4)),
        matchesInProgress: Math.max(0, BASE_STATS[mode].live + wobble(2)),
      };
    }),
  };
}
