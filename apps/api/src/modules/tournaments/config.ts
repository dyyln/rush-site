import type { NewSchedule, ScheduleRecord } from "./store.js"
import type { CupCadence, Mode, TrustLevel } from "./types.js"

const MODE_LABEL: Record<Mode, string> = {
  aim1v1: "1v1 Aim",
  aim2v2: "2v2 Aim",
  rush3v3: "3v3 Rush",
  rush1v1: "1v1 Rush Test",
  rush2v2: "2v2 Rush Test",
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

// Test modes have no default cups
const MAX_ENTRANTS: Record<"daily" | "weekly", Partial<Record<Mode, number>>> = {
  daily: { aim1v1: 32, aim2v2: 16, rush3v3: 16 },
  weekly: { aim1v1: 64, aim2v2: 32, rush3v3: 32 },
}

export function formatFor(bestOfFinal: number): CupFormat {
  return { type: "single_elimination", bestOf: { default: 1, semis: 1, final: bestOfFinal } }
}

export function defaultCupName(mode: Mode, cadence: CupCadence): string {
  const label = cadence === "daily" ? "Daily" : cadence === "weekly" ? "Weekly" : "Special"
  return `${label} ${MODE_LABEL[mode]} Cup`
}

// Hours before the start that sign-ups open, per cadence.
export const REGISTRATION_OPENS_HOURS = { daily: 24, weekly: 7 * 24 } as const

function cup(mode: Mode, cadence: "daily" | "weekly"): CupDefinition {
  const daily = cadence === "daily"
  return {
    key: `${cadence}-${mode}`,
    name: defaultCupName(mode, cadence),
    mode,
    cadence,
    schedule: daily ? { hourUtc: 18, minuteUtc: 0 } : { hourUtc: 17, minuteUtc: 0, weekdayUtc: 0 },
    registrationOpensHours: REGISTRATION_OPENS_HOURS[cadence],
    maxEntrants: MAX_ENTRANTS[cadence][mode] ?? 16,
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

// The cups the first cup_schedules migration seeds. Tests seed the memory store from these.
const pad = (n: number) => String(n).padStart(2, "0")

export function cupToSchedule(c: CupDefinition): NewSchedule {
  return {
    cupKey: c.key,
    name: c.name,
    mode: c.mode,
    cadence: c.cadence === "weekly" ? "weekly" : "daily",
    weekday: c.cadence === "weekly" ? (c.schedule.weekdayUtc ?? 0) : null,
    startTime: `${pad(c.schedule.hourUtc)}:${pad(c.schedule.minuteUtc)}`,
    maxEntrants: c.maxEntrants,
    minTrust: c.minTrust,
    bestOfFinal: c.format.bestOf.final,
    enabled: true,
  }
}

export function scheduleToCup(s: Pick<ScheduleRecord, Exclude<keyof ScheduleRecord, "id" | "updatedAt">>): CupDefinition {
  const [h, m] = s.startTime.split(":").map(Number)
  return {
    key: s.cupKey,
    name: s.name,
    mode: s.mode,
    cadence: s.cadence,
    schedule: { hourUtc: h ?? 0, minuteUtc: m ?? 0, ...(s.cadence === "weekly" ? { weekdayUtc: s.weekday ?? 0 } : {}) },
    registrationOpensHours: REGISTRATION_OPENS_HOURS[s.cadence],
    maxEntrants: s.maxEntrants,
    minTrust: s.minTrust,
    entryFee: 0,
    checkIn: false,
    format: formatFor(s.bestOfFinal),
  }
}

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
