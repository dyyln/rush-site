import { ACTIVE_MATCH_STATUSES, MODES, REGIONS, unresolvedConfig, type Mode, type ModeUnavailableReason, type ServiceStatus } from "@rushsite/shared"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import type { AppContext } from "../../context.js"
import { matches } from "../../db/schema.js"

export type HostView = {
  region?: string
  status: "online" | "offline" | "updating" | "draining"
  slotsTotal: number
  slotsFree: number
}

export type StatusInput = {
  hosts: HostView[]
  surgeEnabled: boolean
  surgeActive: number
  // Config issues per mode. Empty means the mode is fully configured
  unresolved: Record<Mode, string[]>
  // Modes an admin closed through the queue flags
  closed?: Mode[]
  now: number
}

const DEFAULT_REGION: string = REGIONS[0] ?? "eu"

export function buildStatus(input: StatusInput): ServiceStatus {
  const byRegion = new Map<string, HostView[]>()
  for (const h of input.hosts) {
    const region = h.region ?? DEFAULT_REGION
    byRegion.set(region, [...(byRegion.get(region) ?? []), h])
  }
  if (byRegion.size === 0) byRegion.set(DEFAULT_REGION, [])

  const regions = [...byRegion.entries()].map(([region, hs]) => {
    const live = hs.filter((h) => h.status === "online")
    return {
      region,
      hosts: hs.length,
      hostsOnline: hs.filter((h) => h.status === "online" || h.status === "updating").length,
      slotsTotal: live.reduce((s, h) => s + h.slotsTotal, 0),
      slotsFree: live.reduce((s, h) => s + h.slotsFree, 0),
      updating: hs.some((h) => h.status === "updating"),
    }
  })

  const online = input.hosts.some((h) => h.status === "online" && h.slotsTotal > 0)
  const updating = input.hosts.some((h) => h.status === "updating")
  let capacityReason: ModeUnavailableReason | undefined
  if (!online && !input.surgeEnabled) capacityReason = updating ? "servers_updating" : "no_servers"

  return {
    regions,
    surge: { enabled: input.surgeEnabled, active: input.surgeActive },
    modes: MODES.map((mode) => {
      const reason: ModeUnavailableReason | undefined = input.closed?.includes(mode)
        ? "closed"
        : input.unresolved[mode].length > 0
          ? "not_configured"
          : capacityReason
      return reason ? { mode, available: false, reason } : { mode, available: true }
    }),
    updatedAt: new Date(input.now).toISOString(),
  }
}

export async function serviceStatus(ctx: AppContext): Promise<ServiceStatus> {
  const hosts = await ctx.allocator.hostsWithSlots()
  const [surge] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(matches)
    .where(and(eq(matches.driver, "dathost"), isNull(matches.serverReleasedAt), inArray(matches.status, [...ACTIVE_MATCH_STATUSES])))
  // Placeholder config can queue outside production when the env allows it
  const allowUnresolved = ctx.env.NODE_ENV !== "production" && ctx.env.ALLOW_UNRESOLVED_MODES
  const unresolved = Object.fromEntries(MODES.map((m) => [m, allowUnresolved ? [] : unresolvedConfig(m)])) as Record<Mode, string[]>
  return buildStatus({
    hosts: hosts.map((h) => ({
      region: h.region,
      status: h.status,
      slotsTotal: h.slots.length,
      slotsFree: h.slots.filter((s) => s.status === "free").length,
    })),
    surgeEnabled: ctx.allocator.driver("dathost") !== null,
    surgeActive: surge?.n ?? 0,
    unresolved,
    closed: await ctx.flags.closedModes(),
    now: ctx.now(),
  })
}

// Short cache so queue joins do not rebuild the status every time.
// Capacity reasons only block in production
export function createAvailabilitySource(ctx: AppContext, ttlMs = 5000): (mode: Mode) => Promise<string | null> {
  let cached: { at: number; status: ServiceStatus } | null = null
  return async (mode) => {
    const t = ctx.now()
    if (!cached || t - cached.at >= ttlMs) cached = { at: t, status: await serviceStatus(ctx) }
    const m = cached.status.modes.find((x) => x.mode === mode)
    if (!m || m.available) return null
    // Outside production only missing config blocks, so the flow can be tested without an agent
    // Closed modes are refused by the queue flag gate with their own error code
    if (m.reason === "closed") return null
    if (ctx.env.NODE_ENV !== "production" && m.reason !== "not_configured") return null
    return m.reason ?? "unavailable"
  }
}
