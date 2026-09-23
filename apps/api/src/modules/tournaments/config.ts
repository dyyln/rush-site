import type { CupCadence, Mode, TrustLevel } from "./types.js"

const MODE_LABEL: Record<Mode, string> = {
  aim1v1: "1v1 Aim",
  aim2v2: "2v2 Aim",
  rush3v3: "3v3 Rush",
}

export interface CupFormat {
  type: "single_elimination"
  // Semis and final are set on their own. Every other round uses default.
  bestOf: { default: number; semis: number; final: number }
}

export interface CupDefinition {
  key: string
  name: string
  mode: Mode
  cadence: CupCadence
  // Times are UTC. weekday is 0 for Sunday and only used by weekly cups.
  schedule: { hourUtc: number; minuteUtc: number; weekdayUtc?: number }
  // Sign-ups open this many hours before the start.
  registrationOpensHours: number
  // Counted in entries, which are teams for 2v2 and 3v3.
  maxEntrants: number
  minTrust: TrustLevel
  entryFee: 0
  checkIn: false
  format: CupFormat
}

const FORMAT: CupFormat = { type: "single_elimination", bestOf: { default: 1, semis: 1, final: 3 } }

const MAX_ENTRANTS: Record<CupCadence, Record<Mode, number>> = {
  daily: { aim1v1: 32, aim2v2: 16, rush3v3: 16 },
  weekly: { aim1v1: 64, aim2v2: 32, rush3v3: 32 },
}

function cup(mode: Mode, cadence: CupCadence): CupDefinition {
  const daily = cadence === "daily"
  return {
    key: `${cadence}-${mode}`,
    name: `${daily ? "Daily" : "Weekly"} ${MODE_LABEL[mode]} Cup`,
    mode,
    cadence,
    schedule: daily ? { hourUtc: 18, minuteUtc: 0 } : { hourUtc: 17, minuteUtc: 0, weekdayUtc: 0 },
    registrationOpensHours: daily ? 24 : 7 * 24,
    maxEntrants: MAX_ENTRANTS[cadence][mode],
    minTrust: "verified",
    entryFee: 0,
    checkIn: false,
    format: FORMAT,
  }
}

const MODES: Mode[] = ["aim1v1", "aim2v2", "rush3v3"]

export const DEFAULT_CUPS: CupDefinition[] = [
  ...MODES.map((m) => cup(m, "daily")),
  ...MODES.map((m) => cup(m, "weekly")),
]

// First start time of the cup strictly after `after`.
export function nextStart(def: CupDefinition, after: Date): Date {
  const d = new Date(after.getTime())
  d.setUTCSeconds(0, 0)
  d.setUTCHours(def.schedule.hourUtc, def.schedule.minuteUtc)
  if (def.cadence === "weekly") {
    const wd = def.schedule.weekdayUtc ?? 0
    d.setUTCDate(d.getUTCDate() + ((wd - d.getUTCDay() + 7) % 7))
    if (d.getTime() <= after.getTime()) d.setUTCDate(d.getUTCDate() + 7)
  } else if (d.getTime() <= after.getTime()) {
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return d
}
