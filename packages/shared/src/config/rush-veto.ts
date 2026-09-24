import type { TeamIndex, VetoAction } from "../schemas/veto.js"
import { RUSH_RULES, RUSH_ROOMS, type RushRoomId } from "./modes.js"

// Room ban and pick for Rush. The server takes the result only when slot 3 is a start room and slots 1, 2, 4 and 5 are mid rooms

export type RoomVetoPhase = {
  id: string
  label: string
  // Rooms this phase bans and picks from, as string keys
  pool: readonly string[]
  // Actions in order. Teams alternate across all phases, starting with the first team
  sequence: readonly VetoAction[]
  // Adds alternating bans after the sequence until one room of the pool is left
  banToOne: boolean
  // Slots each team fills with its picks, in order from its own castle. Team 0 starts as T
  pickSlots: readonly [readonly number[], readonly number[]]
  // Where the rooms left at the end of the phase go, in order. Others stay unused
  leftoverSlots: readonly number[]
}

export type RoomVetoFormat = { phases: readonly RoomVetoPhase[] }

export type RoomVetoConfig = { enabled: boolean; format: RoomVetoFormat }

export const roomKey = (id: RushRoomId): string => String(id)

export const RUSH_START_POOL: readonly string[] = RUSH_ROOMS.startRooms.map((r) => roomKey(r.id))
export const RUSH_MID_POOL: readonly string[] = RUSH_ROOMS.midRooms.map((r) => roomKey(r.id))
// Every room either phase can use
export const RUSH_ROOM_POOL: readonly string[] = [...RUSH_START_POOL, ...RUSH_MID_POOL]

export const RUSH_CASTLE_SLOTS = { t: 0, ct: RUSH_RULES.roomSlots - 1 } as const
export const RUSH_START_SLOT = 3

export const RUSH_ROOM_VETO: RoomVetoConfig = {
  enabled: false,
  format: {
    phases: [
      {
        id: "mid",
        label: "Mid rooms",
        pool: RUSH_MID_POOL,
        sequence: ["ban", "ban", "pick", "pick", "ban", "ban", "pick", "pick"],
        banToOne: false,
        // Each team's picks go next to its own castle
        pickSlots: [
          [1, 2],
          [5, 4],
        ],
        leftoverSlots: [],
      },
      {
        id: "start",
        label: "Start room",
        pool: RUSH_START_POOL,
        sequence: [],
        banToOne: true,
        pickSlots: [[], []],
        leftoverSlots: [RUSH_START_SLOT],
      },
    ],
  },
}

// First team index for the sequence. The API decides it per match
export const ROOM_VETO_FIRST_TEAM: TeamIndex = 0

// Room pick for a Rush Bo3, run once before map 1. No bans and no repeats: the three maps use all 12 mid rooms
// and three of the four start rooms. Rules the engine applies (veto/series-rooms.ts):
// - first is the higher seed, second the other team. The coin flip before the veto makes flipWinner team A of the last map
// - side: the acting team chooses the side it plays on that map. A map with no side step swaps the previous map's sides
// - mid: the pick goes next to the picking team's own castle, first pick beside the castle (T fills 1 then 2, CT 5 then 4)
// - mid slots still open when a map's mid picks end take the mid rooms no map used, beside the castle first. Only the last map may do this
// - start: the pick becomes slot 3
export type SeriesRoomRole = "first" | "second" | "flipWinner" | "flipLoser"
export type SeriesRoomStepKind = "side" | "mid" | "start"
export type SeriesRoomStep = { map: number; kind: SeriesRoomStepKind; team: SeriesRoomRole }
export type SeriesRoomVetoFormat = { maps: number; steps: readonly SeriesRoomStep[] }

export const RUSH_SERIES_ROOM_VETO: { format: SeriesRoomVetoFormat } = {
  format: {
    maps: 3,
    steps: [
      // Map 1. The higher seed picks mid rooms first, so the other team chooses sides and the start room
      { map: 1, kind: "side", team: "second" },
      { map: 1, kind: "mid", team: "first" },
      { map: 1, kind: "mid", team: "second" },
      { map: 1, kind: "mid", team: "first" },
      { map: 1, kind: "mid", team: "second" },
      { map: 1, kind: "start", team: "second" },
      // Map 2. Sides swap. The other team picks mid rooms first and the higher seed chooses the start room
      { map: 2, kind: "mid", team: "second" },
      { map: 2, kind: "mid", team: "first" },
      { map: 2, kind: "mid", team: "second" },
      { map: 2, kind: "mid", team: "first" },
      { map: 2, kind: "start", team: "first" },
      // Map 3. The flip winner (team A) chooses sides, team B takes 2 of the 4 mid rooms left, A gets the other 2 and chooses the start room
      { map: 3, kind: "side", team: "flipWinner" },
      { map: 3, kind: "mid", team: "flipLoser" },
      { map: 3, kind: "mid", team: "flipLoser" },
      { map: 3, kind: "start", team: "flipWinner" },
    ],
  },
}

// Key voted on for a side step, such as side:1:ct
export const sideKey = (map: number, side: "ct" | "t"): string => `side:${map}:${side}`
export const sideOfKey = (key: string): "ct" | "t" | null => (key.endsWith(":ct") ? "ct" : key.endsWith(":t") ? "t" : null)
