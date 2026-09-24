import type {
  TeamIndex,
  VetoAction,
  VetoHistoryEntry,
  VetoState,
  VetoStep,
  VetoTeam,
} from "../schemas/veto.js"
import type { VetoFormat } from "../schemas/mode.js"

export type Rng = () => number

export class VetoError extends Error {
  override name = "VetoError"
}

export const BO3_PICKBAN_ACTIONS: readonly VetoAction[] = ["ban", "ban", "pick", "pick", "ban", "ban"]

// Minimum pool is ban ban pick pick plus one decider
export const BO3_MIN_POOL = 5

// Standard sequence with teams alternating. Trailing bans are dropped when the pool
// is too small to leave exactly one decider, so a six map pool runs ban ban pick pick ban.
export function bo3Steps(poolSize: number, firstTeam: TeamIndex = 0): VetoStep[] {
  if (poolSize < BO3_MIN_POOL) {
    throw new VetoError(`bo3 pick-ban needs at least ${BO3_MIN_POOL} maps, got ${poolSize}`)
  }
  const count = Math.min(BO3_PICKBAN_ACTIONS.length, poolSize - 1)
  const other: TeamIndex = firstTeam === 0 ? 1 : 0
  return BO3_PICKBAN_ACTIONS.slice(0, count).map((action, i) => ({
    action,
    team: i % 2 === 0 ? firstTeam : other,
  }))
}

const otherTeam = (t: TeamIndex): TeamIndex => (t === 0 ? 1 : 0)

function alternatingBans(count: number, firstTeam: TeamIndex): VetoStep[] {
  return Array.from({ length: count }, (_, i) => ({
    action: "ban" as const,
    team: i % 2 === 0 ? firstTeam : otherTeam(firstTeam),
  }))
}

// Alternating bans until keep maps remain. The remaining maps are the ordered deciders
export function banToNSteps(poolSize: number, keep: number, firstTeam: TeamIndex = 0): VetoStep[] {
  if (!Number.isInteger(keep) || keep < 1) throw new VetoError(`keep must be a positive integer, got ${keep}`)
  if (poolSize <= keep) throw new VetoError(`pool of ${poolSize} must be larger than keep ${keep}`)
  return alternatingBans(poolSize - keep, firstTeam)
}

// Alternating bans until one map remains. That map is played
export function bo1Steps(poolSize: number, firstTeam: TeamIndex = 0): VetoStep[] {
  return banToNSteps(poolSize, 1, firstTeam)
}

export const BAN_TO_7_KEEP = 7

export function stepsForFormat(format: VetoFormat, poolSize: number, firstTeam: TeamIndex = 0): VetoStep[] {
  switch (format) {
    case "none":
      return []
    case "bo1-ban":
      return bo1Steps(poolSize, firstTeam)
    case "ban-to-7":
      return banToNSteps(poolSize, BAN_TO_7_KEEP, firstTeam)
    case "bo3-pickban":
      return bo3Steps(poolSize, firstTeam)
  }
}

export type CreateVetoOptions = {
  pool: string[]
  teams: [VetoTeam, VetoTeam]
  firstTeam?: TeamIndex
  // Defaults to bo3-pickban. Ignored when steps is given
  format?: VetoFormat
  steps?: VetoStep[]
}

export function createVeto(opts: CreateVetoOptions): VetoState {
  const { pool, teams } = opts
  if (new Set(pool).size !== pool.length) throw new VetoError("pool has duplicate map ids")
  const steps = opts.steps ?? stepsForFormat(opts.format ?? "bo3-pickban", pool.length, opts.firstTeam ?? 0)
  if (pool.length === 0) throw new VetoError("pool is empty")
  if (steps.length >= pool.length) {
    throw new VetoError("pool must be larger than the number of steps")
  }
  const all = [...teams[0].steamIds, ...teams[1].steamIds]
  if (new Set(all).size !== all.length) throw new VetoError("a player is on both teams")
  // With no steps the veto is done at once and plays the whole pool in order
  const done = steps.length === 0
  return {
    pool: [...pool],
    teams: [
      { id: teams[0].id, steamIds: [...teams[0].steamIds] },
      { id: teams[1].id, steamIds: [...teams[1].steamIds] },
    ],
    steps: steps.map((s) => ({ ...s })),
    stepIndex: 0,
    available: [...pool],
    votes: {},
    history: [],
    done,
    maps: done ? [...pool] : [],
  }
}

export function currentStep(state: VetoState): VetoStep | null {
  if (state.done) return null
  return state.steps[state.stepIndex] ?? null
}

export function actingTeam(state: VetoState): VetoTeam | null {
  const step = currentStep(state)
  return step ? state.teams[step.team] : null
}

// Maps the current step can take. A step with a phase is limited to that phase's pool
export function stepAvailable(state: VetoState): string[] {
  const step = currentStep(state)
  const pool = step?.phase !== undefined ? state.phases?.[step.phase]?.pool : undefined
  return pool ? state.available.filter((m) => pool.includes(m)) : state.available
}

export function allVoted(state: VetoState): boolean {
  const team = actingTeam(state)
  if (!team) return false
  return team.steamIds.every((id) => id in state.votes)
}

// Records or replaces a vote. Does not resolve the step.
export function castVote(state: VetoState, steamId: string, mapId: string): VetoState {
  const team = actingTeam(state)
  if (!team) throw new VetoError("veto is finished")
  if (!team.steamIds.includes(steamId)) throw new VetoError("player is not on the acting team")
  if (!stepAvailable(state).includes(mapId)) throw new VetoError("map is not available")
  return { ...state, votes: { ...state.votes, [steamId]: mapId } }
}

// Tally votes. Most votes wins. Ties and empty votes are broken at random among the leaders.
export function tallyVotes(
  votes: Record<string, string>,
  available: string[],
  rng: Rng,
): { mapId: string; tieBroken: boolean; noVotes: boolean } {
  const counts = new Map<string, number>()
  for (const mapId of Object.values(votes)) {
    if (available.includes(mapId)) counts.set(mapId, (counts.get(mapId) ?? 0) + 1)
  }
  let leaders: string[]
  if (counts.size === 0) {
    leaders = [...available]
  } else {
    const max = Math.max(...counts.values())
    // Keep pool order so the tie break is deterministic for a given rng
    leaders = available.filter((m) => counts.get(m) === max)
  }
  if (leaders.length === 0) throw new VetoError("no maps available")
  const idx = leaders.length === 1 ? 0 : Math.min(Math.floor(rng() * leaders.length), leaders.length - 1)
  return { mapId: leaders[idx]!, tieBroken: leaders.length > 1 && counts.size > 0, noVotes: counts.size === 0 }
}

// Resolves the current step with whatever votes exist. Use on timeout or once all have voted.
export function resolveStep(state: VetoState, rng: Rng = Math.random): VetoState {
  const step = currentStep(state)
  if (!step) throw new VetoError("veto is finished")
  const { mapId, tieBroken, noVotes } = tallyVotes(state.votes, stepAvailable(state), rng)
  const entry: VetoHistoryEntry = {
    step: state.stepIndex,
    action: step.action,
    team: step.team,
    mapId,
    votes: { ...state.votes },
    tieBroken,
    noVotes,
  }
  const available = state.available.filter((m) => m !== mapId)
  const history = [...state.history, entry]
  const stepIndex = state.stepIndex + 1
  const done = stepIndex >= state.steps.length
  const maps = done ? [...history.filter((h) => h.action === "pick").map((h) => h.mapId), ...available] : []
  return { ...state, available, history, stepIndex, votes: {}, done, maps }
}

// Casts a vote and resolves the step once every member of the acting team has voted.
export function vote(state: VetoState, steamId: string, mapId: string, rng: Rng = Math.random): VetoState {
  const next = castVote(state, steamId, mapId)
  return allVoted(next) ? resolveStep(next, rng) : next
}

export function vetoResult(state: VetoState): { picks: string[]; bans: string[]; deciders: string[] } {
  if (!state.done) throw new VetoError("veto is not finished")
  return {
    picks: state.history.filter((h) => h.action === "pick").map((h) => h.mapId),
    bans: state.history.filter((h) => h.action === "ban").map((h) => h.mapId),
    deciders: [...state.available],
  }
}
