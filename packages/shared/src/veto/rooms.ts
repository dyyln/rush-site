import type { TeamIndex, VetoState, VetoStep, VetoTeam } from "../schemas/veto.js"
import { RUSH_RULES, RUSH_ROOMS } from "../config/modes.js"
import { RUSH_CASTLE_SLOTS, RUSH_MID_POOL, RUSH_START_POOL, RUSH_START_SLOT, roomKey, type RoomVetoFormat, type RoomVetoPhase } from "../config/rush-veto.js"
import { VetoError, createVeto } from "./bo3.js"

const other = (t: TeamIndex): TeamIndex => (t === 0 ? 1 : 0)

function phaseActions(phase: RoomVetoPhase): RoomVetoPhase["sequence"][number][] {
  const actions = [...phase.sequence]
  if (actions.length >= phase.pool.length) throw new VetoError(`phase ${phase.id} has more steps than rooms`)
  if (phase.banToOne) {
    const extra = phase.pool.length - 1 - actions.length
    for (let i = 0; i < extra; i++) actions.push("ban")
  }
  return actions
}

// Steps from the format. Teams alternate on every action across all phases
export function roomVetoSteps(format: RoomVetoFormat, firstTeam: TeamIndex = 0): VetoStep[] {
  const steps: VetoStep[] = []
  format.phases.forEach((phase, idx) => {
    for (const action of phaseActions(phase)) {
      steps.push({ action, team: steps.length % 2 === 0 ? firstTeam : other(firstTeam), phase: idx })
    }
    for (const t of [0, 1] as const) {
      const n = steps.filter((s) => s.phase === idx && s.action === "pick" && s.team === t).length
      if (n > phase.pickSlots[t].length) throw new VetoError(`team ${t} has ${n} picks in ${phase.id} but ${phase.pickSlots[t].length} slots`)
    }
  })
  return steps
}

export function createRoomVeto(teams: [VetoTeam, VetoTeam], format: RoomVetoFormat, firstTeam: TeamIndex = 0): VetoState {
  const pool = format.phases.flatMap((p) => [...p.pool])
  if (new Set(pool).size !== pool.length) throw new VetoError("a room is in more than one phase")
  const state = createVeto({ pool, teams, steps: roomVetoSteps(format, firstTeam) })
  return { ...state, phases: format.phases.map((p) => ({ id: p.id, pool: [...p.pool] })) }
}

export type RoomSlotSource = "castle" | "pick" | "leftover" | "open"

export type RoomSlot = {
  slot: number
  // Room key, null while the slot is open
  room: string | null
  source: RoomSlotSource
  // The team that picked the room
  team?: TeamIndex
}

// A phase is over once the veto is past its last step
function phaseDone(state: VetoState, phase: number): boolean {
  if (state.done) return true
  const last = state.steps.reduce((n, s, i) => (s.phase === phase ? i : n), -1)
  return last >= 0 && state.stepIndex > last
}

// The seven slots from T castle to CT castle, filled from the veto so far
export function roomSlots(state: VetoState, format: RoomVetoFormat): RoomSlot[] {
  const slots: RoomSlot[] = Array.from({ length: RUSH_RULES.roomSlots }, (_, slot) => ({ slot, room: null, source: "open" }))
  slots[RUSH_CASTLE_SLOTS.t] = { slot: RUSH_CASTLE_SLOTS.t, room: roomKey(RUSH_ROOMS.castles.t.id), source: "castle" }
  slots[RUSH_CASTLE_SLOTS.ct] = { slot: RUSH_CASTLE_SLOTS.ct, room: roomKey(RUSH_ROOMS.castles.ct.id), source: "castle" }
  const used = format.phases.map(() => [0, 0] as [number, number])
  for (const h of state.history) {
    if (h.action !== "pick") continue
    const phase = state.steps[h.step]?.phase ?? 0
    const slot = format.phases[phase]?.pickSlots[h.team][used[phase]![h.team]++]
    if (slot !== undefined) slots[slot] = { slot, room: h.mapId, source: "pick", team: h.team }
  }
  format.phases.forEach((phase, idx) => {
    if (phase.leftoverSlots.length === 0 || !phaseDone(state, idx)) return
    const left = state.available.filter((r) => phase.pool.includes(r))
    phase.leftoverSlots.forEach((slot, i) => {
      const room = left[i]
      if (room !== undefined && slots[slot]?.source === "open") slots[slot] = { slot, room, source: "leftover" }
    })
  })
  return slots
}

// Phase of the current step, or null once the veto is done
export function currentRoomPhase(state: VetoState, format: RoomVetoFormat): { index: number; phase: RoomVetoPhase } | null {
  const step = state.done ? null : state.steps[state.stepIndex]
  if (!step) return null
  const index = step.phase ?? 0
  const phase = format.phases[index]
  return phase ? { index, phase } : null
}

// Slot the current pick will land in. null when the current step is not a pick
export function nextPickSlot(state: VetoState, format: RoomVetoFormat): number | null {
  const step = state.done ? null : state.steps[state.stepIndex]
  if (!step || step.action !== "pick") return null
  const phase = step.phase ?? 0
  const used = state.history.filter((h) => h.action === "pick" && h.team === step.team && (state.steps[h.step]?.phase ?? 0) === phase).length
  return format.phases[phase]?.pickSlots[step.team][used] ?? null
}

// The rule the game server applies. Castles at the ends, a start room in slot 3, mid rooms elsewhere, no repeats
export function isValidRushPath(ids: readonly number[]): boolean {
  if (ids.length !== RUSH_RULES.roomSlots) return false
  if (new Set(ids).size !== ids.length) return false
  return ids.every((id, slot) => {
    const key = String(id)
    if (slot === RUSH_CASTLE_SLOTS.t) return id === RUSH_ROOMS.castles.t.id
    if (slot === RUSH_CASTLE_SLOTS.ct) return id === RUSH_ROOMS.castles.ct.id
    if (slot === RUSH_START_SLOT) return RUSH_START_POOL.includes(key)
    return RUSH_MID_POOL.includes(key)
  })
}

// Room ids in slot order for match.json. Throws until every slot is filled with a path the server accepts
export function rushRoomsFromVeto(state: VetoState, format: RoomVetoFormat): number[] {
  const slots = roomSlots(state, format)
  if (!state.done || slots.some((s) => s.room === null)) throw new VetoError("room veto is not finished")
  const ids = slots.map((s) => Number(s.room))
  if (!isValidRushPath(ids)) throw new VetoError(`room path ${ids.join(",")} breaks the server's pool rule`)
  return ids
}
