import type { MapEntry, Mode, VetoFormat } from "../schemas/mode.js"
import { POOL_MODES, type PoolMap, type PoolMode } from "../schemas/map-pool.js"
import { BO3_MIN_POOL } from "../veto/bo3.js"
import { AIM_MAPS, MODE_CONFIGS } from "./modes.js"

// Smallest pool a veto format can run on
export function vetoMinPool(format: VetoFormat): number {
  switch (format) {
    case "none":
      return 1
    case "bo1-ban":
      return 2
    case "ban-to-7":
      return 8
    case "bo3-pickban":
      return BO3_MIN_POOL
  }
}

// Smallest live pool a mode may have. Cup finals run a Bo3 pick-ban in any mode with a veto
export function minPoolSize(mode: Mode): number {
  const format = MODE_CONFIGS[mode].vetoFormat
  if (format === "none") return 1
  return Math.max(vetoMinPool(format), BO3_MIN_POOL)
}

export function isPoolMode(mode: string): mode is PoolMode {
  return (POOL_MODES as readonly string[]).includes(mode)
}

// Weapons the plugin knows by item index. Admin loadouts pick from these
export const LOADOUT_PRIMARIES = [
  "weapon_ak47",
  "weapon_m4a1",
  "weapon_m4a1_silencer",
  "weapon_awp",
  "weapon_ssg08",
  "weapon_aug",
  "weapon_sg556",
  "weapon_famas",
  "weapon_galilar",
] as const
export const LOADOUT_SECONDARIES = [
  "weapon_usp_silencer",
  "weapon_hkp2000",
  "weapon_glock",
  "weapon_deagle",
  "weapon_p250",
  "weapon_fiveseven",
  "weapon_tec9",
  "weapon_cz75a",
  "weapon_elite",
  "weapon_revolver",
] as const

// The pool as the shared config defines it. Used until an admin edits the pool
export function configPool(): PoolMap[] {
  return AIM_MAPS.map((m, i) => ({
    id: m.id,
    displayName: m.displayName,
    workshopId: m.workshopId ?? null,
    mapName: m.mapName ?? null,
    loadout: m.loadout ?? null,
    modes: POOL_MODES.filter((mode) => MODE_CONFIGS[mode].maps.some((x) => x.id === m.id)),
    position: i,
    previewUrl: null,
    source: "config" as const,
    workshop: null,
    updatedBy: null,
    updatedAt: null,
  }))
}

// The MapEntry sent to servers. Extra pool fields stay out of match.json
export function poolMapEntry(m: Pick<PoolMap, "id" | "displayName" | "workshopId" | "mapName" | "loadout">): MapEntry {
  return {
    id: m.id,
    displayName: m.displayName,
    ...(m.workshopId ? { workshopId: m.workshopId } : {}),
    ...(m.mapName ? { mapName: m.mapName } : {}),
    ...(m.loadout ? { loadout: m.loadout } : {}),
  }
}

// Pulls a Workshop id out of a bare id or a steamcommunity.com filedetails URL
export function parseWorkshopRef(input: string): string | null {
  const s = input.trim()
  if (/^\d{1,20}$/.test(s)) return s
  let url: URL
  try {
    url = new URL(s)
  } catch {
    return null
  }
  if (!/(^|\.)steamcommunity\.com$/i.test(url.hostname)) return null
  if (!/\/(sharedfiles|workshop)\/filedetails\/?$/i.test(url.pathname)) return null
  const id = url.searchParams.get("id")
  return id && /^\d{1,20}$/.test(id) ? id : null
}

// A pool map id from a Workshop title such as "AIM Map (CS2)"
export function slugMapId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
    .replace(/_+$/, "")
  return slug.length >= 2 ? slug : ""
}
