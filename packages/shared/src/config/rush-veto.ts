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
