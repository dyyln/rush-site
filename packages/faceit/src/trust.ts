import type { FaceitSignal } from "./types.js"

export type TrustDeltaOptions = {
  bannedDelta?: number
  pastBanDelta?: number
  // Match count thresholds, highest first. The first one met wins.
  experienceSteps?: { minMatches: number; delta: number }[]
}

export const DEFAULT_TRUST_DELTA_OPTIONS = {
  bannedDelta: -100,
  pastBanDelta: -25,
  experienceSteps: [
    { minMatches: 500, delta: 10 },
    { minMatches: 100, delta: 5 },
  ],
} as const satisfies Required<TrustDeltaOptions>

// Maps a FACEIT signal to a trust score contribution.
// No account or unknown data is neutral. An active ban is strongly negative.
// Any expired ban is a smaller negative and cancels the history bonus.
// Long play history with no ban is mildly positive.
export function signalToTrustDelta(signal: FaceitSignal | null | undefined, opts: TrustDeltaOptions = {}): number {
  if (!signal) return 0
  const bannedDelta = opts.bannedDelta ?? DEFAULT_TRUST_DELTA_OPTIONS.bannedDelta
  if (signal.banned) return bannedDelta
  if (signal.pastBans > 0) return opts.pastBanDelta ?? DEFAULT_TRUST_DELTA_OPTIONS.pastBanDelta
  const matches = signal.matchesPlayed
  if (matches === undefined || !Number.isFinite(matches)) return 0
  const steps = [...(opts.experienceSteps ?? DEFAULT_TRUST_DELTA_OPTIONS.experienceSteps)].sort(
    (a, b) => b.minMatches - a.minMatches,
  )
  for (const step of steps) {
    if (matches >= step.minMatches) return step.delta
  }
  return 0
}
