import type { TeamIndex, VetoAction, VetoState, VetoStep, VetoTeam } from "../schemas/veto.js"
import { RUSH_RULES, RUSH_ROOMS } from "../config/modes.js"
import {
  RUSH_CASTLE_SLOTS,
  RUSH_MID_POOL,
  RUSH_START_POOL,
  RUSH_START_SLOT,
  roomKey,
  sideKey,
  sideOfKey,
  type SeriesRoomRole,
  type SeriesRoomStepKind,
  type SeriesRoomVetoFormat,
} from "../config/rush-veto.js"
import { VetoError, createVeto, type Rng } from "./bo3.js"
import { isValidRushPath, roomPhaseDone, type RoomSlot } from "./rooms.js"

// Room pick for a whole Rush series. Rules are in RUSH_SERIES_ROOM_VETO (config/rush-veto.ts)

const other = (t: TeamIndex): TeamIndex => (t === 0 ? 1 : 0)

// A team's mid picks start beside its own castle
const OWN_SLOTS = { t: [1, 2], ct: [5, 4] } as const
const MID_PER_MAP = 4

export type SeriesRoomPhase = { id: string; pool: string[]; mapNumber: number; kind: SeriesRoomStepKind }

function roleTeam(role: SeriesRoomRole, firstTeam: TeamIndex, flipWinner: TeamIndex): TeamIndex {
  switch (role) {
    case "first":
      return firstTeam
    case "second":
      return other(firstTeam)
    case "flipWinner":
      return flipWinner
    case "flipLoser":
      return other(flipWinner)
  }
}

function phasePool(map: number, kind: SeriesRoomStepKind): string[] {
  if (kind === "side") return [sideKey(map, "ct"), sideKey(map, "t")]
  return [...(kind === "mid" ? RUSH_MID_POOL : RUSH_START_POOL)]
}

// Checks what does not depend on which team holds which role
export function validateSeriesRoomFormat(format: SeriesRoomVetoFormat): void {
  const { maps, steps } = format
  if (!Number.isInteger(maps) || maps < 2) throw new VetoError("a series room veto needs at least 2 maps")
  if (maps * MID_PER_MAP > RUSH_MID_POOL.length) throw new VetoError(`${maps} maps need more mid rooms than the ${RUSH_MID_POOL.length} there are`)
  if (maps > RUSH_START_POOL.length) throw new VetoError(`${maps} maps need more start rooms than the ${RUSH_START_POOL.length} there are`)
  let last = 0
  for (let map = 1; map <= maps; map++) {
    const own = steps.filter((s) => s.map === map)
    const count = (k: SeriesRoomStepKind) => own.filter((s) => s.kind === k).length
    if (count("side") > 1) throw new VetoError(`map ${map} has more than one side step`)
    if (map === 1 && count("side") === 0) throw new VetoError("map 1 needs a side step")
    if (count("start") !== 1) throw new VetoError(`map ${map} needs one start pick`)
    if (count("mid") > MID_PER_MAP) throw new VetoError(`map ${map} has more mid picks than mid slots`)
    if (map < maps && count("mid") !== MID_PER_MAP) throw new VetoError(`map ${map} must pick all its mid rooms, only the last map takes leftovers`)
    // The side comes first so every pick knows which castle it sits beside
    const side = own.findIndex((s) => s.kind === "side")
    if (side > 0) throw new VetoError(`map ${map} must choose sides before it picks rooms`)
  }
  for (const s of steps) {
    if (s.map < 1 || s.map > maps) throw new VetoError(`step for map ${s.map} is outside the series`)
    if (s.map < last) throw new VetoError("steps must run map by map")
    last = s.map
  }
}

export function createSeriesRoomVeto(
  teams: [VetoTeam, VetoTeam],
  format: SeriesRoomVetoFormat,
  firstTeam: TeamIndex = 0,
  rng: Rng = Math.random,
): VetoState {
  validateSeriesRoomFormat(format)
  const flipWinner: TeamIndex = rng() < 0.5 ? 0 : 1
  const phases: SeriesRoomPhase[] = []
  const steps: VetoStep[] = format.steps.map((s) => {
    const id = `m${s.map}-${s.kind}`
    let phase = phases.findIndex((p) => p.id === id)
    if (phase < 0) phase = phases.push({ id, pool: phasePool(s.map, s.kind), mapNumber: s.map, kind: s.kind }) - 1
    const action: VetoAction = s.kind === "side" ? "side" : "pick"
    return { action, team: roleTeam(s.team, firstTeam, flipWinner), phase }
  })
  for (let map = 1; map <= format.maps; map++) {
    for (const t of [0, 1] as const) {
      const picks = steps.filter((s) => s.team === t && phases[s.phase!]!.mapNumber === map && phases[s.phase!]!.kind === "mid").length
      if (picks > OWN_SLOTS.t.length) throw new VetoError(`team ${t} has ${picks} mid picks on map ${map} but 2 slots`)
    }
  }
  const pool = [...new Set(phases.flatMap((p) => p.pool))]
  const state = createVeto({ pool, teams, steps })
  return { ...state, phases, flipWinner }
}

function phaseOf(state: VetoState, step: number) {
  const idx = state.steps[step]?.phase
  return idx === undefined ? undefined : state.phases?.[idx]
}

export type SeriesRoomMap = {
  mapNumber: number
  // Team playing CT, null until the map's sides are chosen
  ctTeam: TeamIndex | null
  // The seven slots from T castle to CT castle
  slots: RoomSlot[]
}

// Every map of the series with its sides and slots, filled from the veto so far
export function seriesRoomMaps(state: VetoState, format: SeriesRoomVetoFormat): SeriesRoomMap[] {
  const phases = state.phases ?? []
  const out: SeriesRoomMap[] = []
  let prevCt: TeamIndex | null = null
  for (let map = 1; map <= format.maps; map++) {
    const slots: RoomSlot[] = Array.from({ length: RUSH_RULES.roomSlots }, (_, slot) => ({ slot, room: null, source: "open" }))
    slots[RUSH_CASTLE_SLOTS.t] = { slot: RUSH_CASTLE_SLOTS.t, room: roomKey(RUSH_ROOMS.castles.t.id), source: "castle" }
    slots[RUSH_CASTLE_SLOTS.ct] = { slot: RUSH_CASTLE_SLOTS.ct, room: roomKey(RUSH_ROOMS.castles.ct.id), source: "castle" }

    const hasSideStep = phases.some((p) => p.mapNumber === map && p.kind === "side")
    const chosen = state.history.find((h) => h.action === "side" && phaseOf(state, h.step)?.mapNumber === map)
    const ct: TeamIndex | null = chosen
      ? sideOfKey(chosen.mapId) === "ct"
        ? chosen.team
        : other(chosen.team)
      : !hasSideStep && prevCt !== null
        ? other(prevCt)
        : null
    prevCt = ct

    const used: [number, number] = [0, 0]
    for (const h of state.history) {
      const phase = phaseOf(state, h.step)
      if (h.action !== "pick" || phase?.mapNumber !== map) continue
      if (phase.kind === "start") {
        slots[RUSH_START_SLOT] = { slot: RUSH_START_SLOT, room: h.mapId, source: "pick", team: h.team }
      } else if (phase.kind === "mid" && ct !== null) {
        const slot = OWN_SLOTS[h.team === ct ? "ct" : "t"][used[h.team]++]
        if (slot !== undefined) slots[slot] = { slot, room: h.mapId, source: "pick", team: h.team }
      }
    }

    // Mid rooms no map used fill what is still open, beside each castle first
    const mid = phases.findIndex((p) => p.mapNumber === map && p.kind === "mid")
    if (ct !== null && (mid < 0 || roomPhaseDone(state, mid))) {
      const left = state.available.filter((r) => RUSH_MID_POOL.includes(r))
      const open = [...OWN_SLOTS.t, ...OWN_SLOTS.ct].filter((s) => slots[s]!.source === "open")
      open.forEach((slot, i) => {
        const room = left[i]
        if (room !== undefined) slots[slot] = { slot, room, source: "leftover", team: slot < RUSH_START_SLOT ? other(ct) : ct }
      })
    }
    out.push({ mapNumber: map, ctTeam: ct, slots })
  }
  return out
}

export type SeriesRoomStepInfo = { mapNumber: number; kind: SeriesRoomStepKind; team: TeamIndex; action: VetoAction }

// What the current step decides, or null once the veto is done
export function currentSeriesRoomStep(state: VetoState): SeriesRoomStepInfo | null {
  const step = state.done ? null : state.steps[state.stepIndex]
  const phase = step ? phaseOf(state, state.stepIndex) : undefined
  if (!step || !phase?.mapNumber || !phase.kind) return null
  return { mapNumber: phase.mapNumber, kind: phase.kind, team: step.team, action: step.action }
}

// Slot the current pick will land in. null for a side step or once done
export function seriesNextPickSlot(state: VetoState, format: SeriesRoomVetoFormat): number | null {
  const cur = currentSeriesRoomStep(state)
  if (!cur || cur.kind === "side") return null
  if (cur.kind === "start") return RUSH_START_SLOT
  const map = seriesRoomMaps(state, format)[cur.mapNumber - 1]
  if (!map || map.ctTeam === null) return null
  const own = OWN_SLOTS[cur.team === map.ctTeam ? "ct" : "t"]
  return own.find((s) => map.slots[s]!.source === "open") ?? null
}

export type SeriesRushMap = { mapNumber: number; rushRooms: number[]; ctTeam: TeamIndex }

// Room ids and sides per map for match.json. Throws until every map has a path the server accepts and no room repeats
export function seriesRushRoomsFromVeto(state: VetoState, format: SeriesRoomVetoFormat): SeriesRushMap[] {
  if (!state.done) throw new VetoError("room veto is not finished")
  const maps = seriesRoomMaps(state, format)
  const seen = new Set<string>()
  return maps.map((m) => {
    if (m.ctTeam === null || m.slots.some((s) => s.room === null)) throw new VetoError(`map ${m.mapNumber} is not filled`)
    const ids = m.slots.map((s) => Number(s.room))
    if (!isValidRushPath(ids)) throw new VetoError(`map ${m.mapNumber} path ${ids.join(",")} breaks the server's pool rule`)
    for (const s of m.slots) {
      if (s.source === "castle") continue
      if (seen.has(s.room!)) throw new VetoError(`room ${s.room} is on more than one map`)
      seen.add(s.room!)
    }
    return { mapNumber: m.mapNumber, rushRooms: ids, ctTeam: m.ctTeam }
  })
}
