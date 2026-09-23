// Glicko-2 as described in Glickman, "Example of the Glicko-2 system" (2012).
// Each match is treated as its own rating period.

export type Glicko2Rating = {
  rating: number
  rd: number
  volatility: number
}

export type Glicko2Options = {
  tau?: number
  maxRd?: number
  minRd?: number
  epsilon?: number
}

export type GameResult = {
  opponent: Pick<Glicko2Rating, "rating" | "rd">
  // 1 win, 0.5 draw, 0 loss
  score: number
}

export const GLICKO2_SCALE = 173.7178
export const DEFAULT_RATING = 1500
export const DEFAULT_RD = 350
export const DEFAULT_VOLATILITY = 0.06
export const DEFAULT_TAU = 0.5

export function defaultRating(): Glicko2Rating {
  return { rating: DEFAULT_RATING, rd: DEFAULT_RD, volatility: DEFAULT_VOLATILITY }
}

const toMu = (r: number) => (r - DEFAULT_RATING) / GLICKO2_SCALE
const toPhi = (rd: number) => rd / GLICKO2_SCALE
const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI))
const e = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)))

function clampRd(rd: number, opts: Glicko2Options): number {
  const max = opts.maxRd ?? DEFAULT_RD
  const min = opts.minRd ?? 0
  return Math.min(max, Math.max(min, rd))
}

// Probability that a beats b
export function expectedScore(
  a: Pick<Glicko2Rating, "rating" | "rd">,
  b: Pick<Glicko2Rating, "rating" | "rd">,
): number {
  const phi = Math.sqrt(toPhi(a.rd) ** 2 + toPhi(b.rd) ** 2)
  return 1 / (1 + Math.exp(-g(phi) * (toMu(a.rating) - toMu(b.rating))))
}

function newVolatility(sigma: number, phi: number, v: number, delta: number, tau: number, eps: number): number {
  const a = Math.log(sigma * sigma)
  const f = (x: number) => {
    const ex = Math.exp(x)
    const num = ex * (delta * delta - phi * phi - v - ex)
    const den = 2 * (phi * phi + v + ex) ** 2
    return num / den - (x - a) / (tau * tau)
  }
  let A = a
  let B: number
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v)
  } else {
    let k = 1
    while (f(a - k * tau) < 0) k++
    B = a - k * tau
  }
  let fA = f(A)
  let fB = f(B)
  let iter = 0
  while (Math.abs(B - A) > eps && iter++ < 1000) {
    const C = A + ((A - B) * fA) / (fB - fA)
    const fC = f(C)
    if (fC * fB <= 0) {
      A = B
      fA = fB
    } else {
      fA = fA / 2
    }
    B = C
    fB = fC
  }
  return Math.exp(A / 2)
}

export function updateRating(
  player: Glicko2Rating,
  results: GameResult[],
  opts: Glicko2Options = {},
): Glicko2Rating {
  const tau = opts.tau ?? DEFAULT_TAU
  const eps = opts.epsilon ?? 1e-6
  const mu = toMu(player.rating)
  const phi = toPhi(player.rd)
  const sigma = player.volatility

  if (results.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma)
    return { rating: player.rating, rd: clampRd(phiStar * GLICKO2_SCALE, opts), volatility: sigma }
  }

  let vInv = 0
  let sum = 0
  for (const r of results) {
    const muJ = toMu(r.opponent.rating)
    const phiJ = toPhi(r.opponent.rd)
    const gJ = g(phiJ)
    const eJ = e(mu, muJ, phiJ)
    vInv += gJ * gJ * eJ * (1 - eJ)
    sum += gJ * (r.score - eJ)
  }
  const v = 1 / vInv
  const delta = v * sum
  const sigmaPrime = newVolatility(sigma, phi, v, delta, tau, eps)
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime)
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v)
  const muPrime = mu + phiPrime * phiPrime * sum

  return {
    rating: muPrime * GLICKO2_SCALE + DEFAULT_RATING,
    rd: clampRd(phiPrime * GLICKO2_SCALE, opts),
    volatility: sigmaPrime,
  }
}

// Team rating and RD are the plain mean of the members
export function teamComposite(team: Glicko2Rating[]): Glicko2Rating {
  if (team.length === 0) throw new Error("team is empty")
  const n = team.length
  return {
    rating: team.reduce((s, p) => s + p.rating, 0) / n,
    rd: team.reduce((s, p) => s + p.rd, 0) / n,
    volatility: team.reduce((s, p) => s + p.volatility, 0) / n,
  }
}

// Updates every player against the mean of the opposing team.
// scoreA is team A's result: 1 win, 0.5 draw, 0 loss.
export function updateTeamMatch(
  teamA: Glicko2Rating[],
  teamB: Glicko2Rating[],
  scoreA: number,
  opts: Glicko2Options = {},
): [Glicko2Rating[], Glicko2Rating[]] {
  if (scoreA < 0 || scoreA > 1) throw new Error("scoreA must be between 0 and 1")
  const compA = teamComposite(teamA)
  const compB = teamComposite(teamB)
  const scoreB = 1 - scoreA
  return [
    teamA.map((p) => updateRating(p, [{ opponent: compB, score: scoreA }], opts)),
    teamB.map((p) => updateRating(p, [{ opponent: compA, score: scoreB }], opts)),
  ]
}
