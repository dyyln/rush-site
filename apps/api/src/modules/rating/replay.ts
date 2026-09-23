import { updateRating, type Glicko2Rating } from "@rushsite/shared"

export type ReplayEvent = {
  id: string
  reason: "match" | "forfeit" | "rollback" | "adjust"
  before: Glicko2Rating
  after: Glicko2Rating
  oppRating: number | null
  oppRd: number | null
  score: number | null
}

export type ReplayResult = {
  final: Glicko2Rating
  // Rating after each kept event, in order
  steps: { id: string; after: Glicko2Rating }[]
}

// Replays a player's history from start, skipping voided events.
// Match results are recomputed with the stored opponent composite so later games keep their weight.
// Earlier rollback entries are skipped because this replay supersedes them. Admin adjustments keep their delta.
export function replayRatings(start: Glicko2Rating, events: ReplayEvent[], voided: Set<string>): ReplayResult {
  let current = { ...start }
  const steps: ReplayResult["steps"] = []
  for (const ev of events) {
    if (voided.has(ev.id) || ev.reason === "rollback") continue
    if (ev.reason === "adjust") {
      current = { ...current, rating: current.rating + (ev.after.rating - ev.before.rating) }
    } else if (ev.oppRating !== null && ev.oppRd !== null && ev.score !== null) {
      current = updateRating(current, [{ opponent: { rating: ev.oppRating, rd: ev.oppRd }, score: ev.score }])
    }
    steps.push({ id: ev.id, after: current })
  }
  return { final: current, steps }
}
