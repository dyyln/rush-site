import type { TeamIndex, VetoState, VetoStep, VetoTeam } from "../schemas/veto.js"
import { RUSH_RULES, RUSH_ROOMS } from "../config/modes.js"
import { RUSH_CASTLE_SLOTS, roomKey, type RoomVetoFormat } from "../config/rush-veto.js"
import { VetoError, createVeto } from "./bo3.js"

const other = (t: TeamIndex): TeamIndex => (t === 0 ? 1 : 0)

// Steps from the format. Teams alternate on every action, and banToOne adds bans until one room is left
export function roomVetoSteps(format: RoomVetoFormat, firstTeam: TeamIndex = 0): VetoStep[] {
  const actions = [...format.sequence]
  const picks = actions.filter((a) => a === "pick").length
  const bans = actions.length - picks
  if (format.banToOne) {
    const extra = format.pool.length - 1 - picks - bans
    if (extra < 0) throw new VetoError(`pool of ${format.pool.length} is too small for the sequence`)
    for (let i = 0; i < extra; i++) actions.push("ban")
  }
  const steps = actions.map((action, i) => ({ action, team: i % 2 === 0 ? firstTeam : other(firstTeam) }))
  for (const t of [0, 1] as const) {
    const n = steps.filter((s) => s.action === "pick" && s.team === t).length
    if (n > format.pickSlots[t].length) throw new VetoError(`team ${t} has ${n} picks but ${format.pickSlots[t].length} slots`)
  }
  return steps
}

export function createRoomVeto(teams: [VetoTeam, VetoTeam], format: RoomVetoFormat, firstTeam: TeamIndex = 0): VetoState {
  return createVeto({ pool: [...format.pool], teams, steps: roomVetoSteps(format, firstTeam) })
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

// The seven slots from T castle to CT castle, filled from the veto so far
export function roomSlots(state: VetoState, format: RoomVetoFormat): RoomSlot[] {
  const slots: RoomSlot[] = Array.from({ length: RUSH_RULES.roomSlots }, (_, slot) => ({ slot, room: null, source: "open" }))
  slots[RUSH_CASTLE_SLOTS.t] = { slot: RUSH_CASTLE_SLOTS.t, room: roomKey(RUSH_ROOMS.castles.t.id), source: "castle" }
  slots[RUSH_CASTLE_SLOTS.ct] = { slot: RUSH_CASTLE_SLOTS.ct, room: roomKey(RUSH_ROOMS.castles.ct.id), source: "castle" }
  const used: [number, number] = [0, 0]
  for (const h of state.history) {
    if (h.action !== "pick") continue
    const slot = format.pickSlots[h.team][used[h.team]++]
    if (slot !== undefined) slots[slot] = { slot, room: h.mapId, source: "pick", team: h.team }
  }
  if (state.done) {
    const open = [...format.leftoverSlots, ...slots.filter((s) => s.source === "open").map((s) => s.slot)]
    const seen = new Set<number>()
    const order = open.filter((s) => slots[s]!.source === "open" && !seen.has(s) && seen.add(s))
    state.available.forEach((room, i) => {
      const slot = order[i]
      if (slot !== undefined) slots[slot] = { slot, room, source: "leftover" }
    })
  }
  return slots
}

// Slot the current pick will land in. null when the current step is not a pick
export function nextPickSlot(state: VetoState, format: RoomVetoFormat): number | null {
  const step = state.done ? null : state.steps[state.stepIndex]
  if (!step || step.action !== "pick") return null
  const used = state.history.filter((h) => h.action === "pick" && h.team === step.team).length
  return format.pickSlots[step.team][used] ?? null
}

// Room ids in slot order for match.json. Throws until every slot is filled
export function rushRoomsFromVeto(state: VetoState, format: RoomVetoFormat): number[] {
  const slots = roomSlots(state, format)
  if (!state.done || slots.some((s) => s.room === null)) throw new VetoError("room veto is not finished")
  return slots.map((s) => Number(s.room))
}
