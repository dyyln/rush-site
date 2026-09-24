import { ACCEPT_WINDOW_SEC, type MatchAcceptView, type MatchVetoView, type VetoState } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { matchPlayers, matches, vetoes } from "../../db/schema.js"
import { vetoKindOf } from "./room-veto.js"

type MatchRow = typeof matches.$inferSelect
type PlayerRow = typeof matchPlayers.$inferSelect

export type RoomView = { accept?: MatchAcceptView; veto?: MatchVetoView; warmup?: { connected: number; expected: number } }

// Votes of the other team stay hidden while it acts, the same as the veto_state message
export function vetoViewFor(state: VetoState, teamIdx: number): VetoState {
  const acting = state.done ? null : (state.steps[state.stepIndex]?.team ?? null)
  return acting === null || acting === teamIdx ? state : { ...state, votes: {} }
}

// Step state a participant needs to rebuild the match room after a reload
export async function buildRoomView(db: Db, m: MatchRow, players: PlayerRow[], viewer: string): Promise<RoomView> {
  const me = players.find((p) => p.steamId === viewer)
  if (!me) return {}
  if (m.status === "accepting") {
    return {
      accept: {
        deadline: m.acceptDeadline?.getTime() ?? Date.now(),
        windowSec: ACCEPT_WINDOW_SEC,
        accepted: players.filter((p) => p.accepted).length,
        required: players.length,
        responded: me.accepted || me.declined,
      },
    }
  }
  if (m.status === "veto") {
    const [row] = await db.select().from(vetoes).where(eq(vetoes.matchId, m.id))
    if (!row) return {}
    const state = row.state as VetoState
    const kind = vetoKindOf(row.format)
    return {
      veto: {
        state: vetoViewFor(state, me.team),
        stepDeadline: state.done ? null : (row.stepDeadline?.getTime() ?? null),
        ...(kind === "rooms" ? { kind } : {}),
      },
    }
  }
  if (m.status === "ready" || m.status === "starting") {
    return { warmup: { connected: players.filter((p) => p.connected).length, expected: players.length } }
  }
  return {}
}
