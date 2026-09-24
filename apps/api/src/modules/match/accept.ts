export type AcceptPlayer = {
  steamId: string
  ticketId: string | null
  accepted: boolean
  declined: boolean
}

export type AcceptOutcome =
  | { kind: "pending"; accepted: number; required: number; acceptedSteamIds: string[] }
  | { kind: "all_accepted" }
  | {
      kind: "failed"
      reason: "declined" | "timeout"
      // Players who declined or never answered
      penalize: string[]
      // Tickets with no offender go back into the queue
      requeueTickets: string[]
      // Tickets with an offender are dropped
      dropTickets: string[]
    }

// Decides what happens to an accept window. A decline ends it at once. A timeout ends it when anyone is missing
export function resolveAccept(players: AcceptPlayer[], timedOut: boolean): AcceptOutcome {
  const declined = players.filter((p) => p.declined)
  const accepted = players.filter((p) => p.accepted && !p.declined)
  if (declined.length === 0 && accepted.length === players.length) return { kind: "all_accepted" }
  if (declined.length === 0 && !timedOut) return { kind: "pending", accepted: accepted.length, required: players.length, acceptedSteamIds: accepted.map((p) => p.steamId) }

  // On a decline only the decliners are at fault. On a timeout everyone who did not accept is
  const offenders = new Set(
    (declined.length > 0 ? declined : players.filter((p) => !p.accepted)).map((p) => p.steamId),
  )
  const tickets = new Map<string, string[]>()
  for (const p of players) {
    if (!p.ticketId) continue
    tickets.set(p.ticketId, [...(tickets.get(p.ticketId) ?? []), p.steamId])
  }
  const requeueTickets: string[] = []
  const dropTickets: string[] = []
  for (const [ticketId, members] of tickets) {
    if (members.some((m) => offenders.has(m))) dropTickets.push(ticketId)
    else requeueTickets.push(ticketId)
  }
  return {
    kind: "failed",
    reason: declined.length > 0 ? "declined" : "timeout",
    penalize: [...offenders],
    requeueTickets,
    dropTickets,
  }
}

export type AbandonOutcome =
  | { kind: "forfeit"; loserTeam: 0 | 1; forfeiters: string[] }
  | { kind: "void"; forfeiters: string[] }

// A team with missing players forfeits. When both teams are missing someone nobody gets rated
export function resolveAbandon(teams: [string[], string[]], missing: string[]): AbandonOutcome {
  const miss = new Set(missing)
  const a = teams[0].filter((s) => miss.has(s))
  const b = teams[1].filter((s) => miss.has(s))
  if (a.length > 0 && b.length === 0) return { kind: "forfeit", loserTeam: 0, forfeiters: a }
  if (b.length > 0 && a.length === 0) return { kind: "forfeit", loserTeam: 1, forfeiters: b }
  return { kind: "void", forfeiters: [...a, ...b] }
}
