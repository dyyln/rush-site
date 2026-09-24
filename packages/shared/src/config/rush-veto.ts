import type { TeamIndex, VetoAction } from "../schemas/veto.js"
import { RUSH_RULES, RUSH_ROOMS, type RushRoomId } from "./modes.js"

// Room ban and pick for Rush. Off until the server can load our picks instead of Valve's random draw

export type RoomVetoFormat = {
  // Rooms that can be banned or picked, as string keys. Castles are never in the pool
  pool: readonly string[]
  // Actions in order. Teams alternate, starting with firstTeam
  sequence: readonly VetoAction[]
  // Adds alternating bans after the sequence until one room is left
  banToOne: boolean
  // Slots each team fills with its picks, in order from its own castle. Team 0 starts as T
  pickSlots: readonly [readonly number[], readonly number[]]
  // Where the rooms left at the end go, in order
  leftoverSlots: readonly number[]
}

export type RoomVetoConfig = { enabled: boolean; format: RoomVetoFormat }

export const roomKey = (id: RushRoomId): string => String(id)

// Start and mid rooms form one pool here. Valve's script keeps them apart, so the override must allow both in any slot
export const RUSH_ROOM_POOL: readonly string[] = [...RUSH_ROOMS.startRooms, ...RUSH_ROOMS.midRooms].map((r) => roomKey(r.id))

export const RUSH_CASTLE_SLOTS = { t: 0, ct: RUSH_RULES.roomSlots - 1 } as const
export const RUSH_START_SLOT = 3

export const RUSH_ROOM_VETO: RoomVetoConfig = {
  enabled: false,
  format: {
    pool: RUSH_ROOM_POOL,
    // Sequence from the user. Pending confirmation, see banToOne
    sequence: ["ban", "ban", "pick", "pick", "ban", "ban", "pick", "pick", "ban", "ban"],
    // The sequence alone leaves more than one room. Extra bans are pending the user's confirmation
    banToOne: true,
    // Each pick goes to the next open slot from the picking team's castle. Pending confirmation
    pickSlots: [
      [1, 2],
      [5, 4],
    ],
    // The last room left is the start room. Pending confirmation
    leftoverSlots: [RUSH_START_SLOT],
  },
}

// First team index for the sequence. The API decides it per match
export const ROOM_VETO_FIRST_TEAM: TeamIndex = 0
