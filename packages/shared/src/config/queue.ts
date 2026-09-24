import type { Mode } from "../schemas/mode.js"

export const ACCEPT_WINDOW_SEC = 20

// Seconds each veto step stays open before it resolves with the votes cast so far
export const VETO_STEP_SEC = 20

// Seconds a player has to join the server once it is ready. The plugin's no-show grace must match
export const CONNECT_GRACE_SEC = 300

export type RatingWidenStep = {
  // Applies once a ticket has waited at least this long
  afterSec: number
  // Max rating gap allowed between the two sides. null means any gap
  maxRatingDiff: number | null
}

// Ordered by afterSec ascending
export const RATING_WIDEN_SCHEDULE: readonly RatingWidenStep[] = [
  { afterSec: 0, maxRatingDiff: 100 },
  { afterSec: 30, maxRatingDiff: 200 },
  { afterSec: 60, maxRatingDiff: 350 },
  { afterSec: 120, maxRatingDiff: 500 },
  { afterSec: 180, maxRatingDiff: 800 },
  { afterSec: 300, maxRatingDiff: null },
]

export function maxRatingDiffAfter(waitSec: number): number | null {
  let current: RatingWidenStep = RATING_WIDEN_SCHEDULE[0]!
  for (const step of RATING_WIDEN_SCHEDULE) {
    if (waitSec >= step.afterSec) current = step
  }
  return current.maxRatingDiff
}

export type PartyBucketRule = {
  mode: Mode
  // Party sizes that can queue for this mode
  allowedPartySizes: readonly number[]
  // Parties face parties and solos face solos until a ticket waits this long.
  // After that a team may be built from mixed party sizes.
  mixAfterSec: number
}

export const PARTY_BUCKET_RULES: Record<Mode, PartyBucketRule> = {
  aim1v1: { mode: "aim1v1", allowedPartySizes: [1], mixAfterSec: 0 },
  aim2v2: { mode: "aim2v2", allowedPartySizes: [1, 2], mixAfterSec: 60 },
  rush3v3: { mode: "rush3v3", allowedPartySizes: [1, 2, 3], mixAfterSec: 90 },
  rush1v1: { mode: "rush1v1", allowedPartySizes: [1], mixAfterSec: 0 },
}

// A ticket's bucket is solo for party size 1, party otherwise
export type PartyBucket = "solo" | "party"
export function partyBucket(partySize: number): PartyBucket {
  return partySize <= 1 ? "solo" : "party"
}

export function canMixBuckets(mode: Mode, waitSec: number): boolean {
  return waitSec >= PARTY_BUCKET_RULES[mode].mixAfterSec
}

export type CooldownReason = "decline" | "accept_timeout" | "no_connect" | "abandon"

export type CooldownLadder = {
  // Cooldown in seconds for the 1st, 2nd, 3rd offence and so on. The last entry repeats
  ladderSec: readonly number[]
  // Offences older than this no longer count toward the ladder
  decaySec: number
}

const MIN = 60
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// Short cooldown for declining or letting the accept window lapse
export const DECLINE_COOLDOWN: CooldownLadder = {
  ladderSec: [1 * MIN, 2 * MIN, 5 * MIN, 10 * MIN],
  decaySec: 6 * HOUR,
}

// Escalating cooldown for never connecting or leaving mid match. The player also forfeits
export const ABANDON_COOLDOWN: CooldownLadder = {
  ladderSec: [15 * MIN, 1 * HOUR, 4 * HOUR, 24 * HOUR, 7 * DAY],
  decaySec: 7 * DAY,
}

export const COOLDOWN_LADDERS: Record<CooldownReason, CooldownLadder> = {
  decline: DECLINE_COOLDOWN,
  accept_timeout: DECLINE_COOLDOWN,
  no_connect: ABANDON_COOLDOWN,
  abandon: ABANDON_COOLDOWN,
}

// offenceCount is 1 based and counts offences within the decay window including this one
export function cooldownSeconds(reason: CooldownReason, offenceCount: number): number {
  const ladder = COOLDOWN_LADDERS[reason].ladderSec
  const idx = Math.min(Math.max(offenceCount, 1), ladder.length) - 1
  return ladder[idx]!
}
