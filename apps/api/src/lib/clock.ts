export type Clock = { now(): number }
export const systemClock: Clock = { now: () => Date.now() }

export type Rng = () => number
