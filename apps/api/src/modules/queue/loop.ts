import { MODES, getModeConfig, type Mode } from "@rushsite/shared"
import type { FastifyBaseLogger } from "fastify"
import type { MatchFlow } from "../match/flow.js"
import { findMatches } from "./matchmaker.js"
import { toMmTicket, type LiveTicket, type QueueService } from "./service.js"

const MAX_PASSES = 5

// One matchmaking pass for one mode. A ticket lost to another mode is excluded and the pass re-runs
export async function matchmakeMode(
  mode: Mode,
  queue: QueueService,
  flow: MatchFlow,
  now: number,
  log?: FastifyBaseLogger,
): Promise<string[]> {
  const created: string[] = []
  const excluded = new Set<string>()
  const teamSize = getModeConfig(mode).teamSize
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const all = await queue.waiting(mode)
    const tickets = all.filter((t) => !excluded.has(t.id))
    const byId = new Map<string, LiveTicket>(tickets.map((t) => [t.id, t]))
    const proposals = findMatches(
      tickets.map((t) => toMmTicket(t, mode)),
      { mode, teamSize, now },
    )
    let rerun = false
    for (const p of proposals) {
      const teams: [LiveTicket[], LiveTicket[]] = [
        p.teams[0].map((t) => byId.get(t.id)!),
        p.teams[1].map((t) => byId.get(t.id)!),
      ]
      const res = await flow.createFromQueue(mode, teams)
      if (res.ok) {
        created.push(res.matchId)
      } else {
        for (const id of res.lost) excluded.add(id)
        log?.info({ mode, lost: res.lost }, "ticket taken by another mode, re-running")
        rerun = true
        break
      }
    }
    if (!rerun) break
  }
  return created
}

// The first mode rotates each tick so a player queued for several modes is not always taken by the same one
export function modeOrder(tick: number): Mode[] {
  const start = ((tick % MODES.length) + MODES.length) % MODES.length
  return [...MODES.slice(start), ...MODES.slice(0, start)]
}

export async function matchmakeAll(
  queue: QueueService,
  flow: MatchFlow,
  now: number,
  log?: FastifyBaseLogger,
  tick = 0,
): Promise<string[]> {
  const out: string[] = []
  for (const mode of modeOrder(tick)) out.push(...(await matchmakeMode(mode, queue, flow, now, log)))
  return out
}
