// Fake map pool for NEXT_PUBLIC_MOCK=1
import { POOL_MODES, configPool, minPoolSize, parseWorkshopRef, slugMapId, type MapLoadout, type PoolMap, type PoolMode, type PoolView } from "@rushsite/shared";
import { ApiError } from "@/lib/api";
import { MOCK_ME } from "@/lib/mock";
import type { AuditAction, AuditEntry, WorkshopPreview } from "./types";

let pool: PoolMap[] | null = null;
let seq = 0;
const maps = () => (pool ??= configPool());

function audit(action: AuditAction, target: string, payload: unknown): AuditEntry {
  return { id: `00000000-0000-4000-9000-${String(++seq).padStart(12, "0")}`, adminSteamId: MOCK_ME.steamId, action, target, payload, createdAt: new Date().toISOString() };
}

function preview(ref: string): WorkshopPreview {
  const workshopId = parseWorkshopRef(ref);
  if (!workshopId) throw new ApiError(400, "invalid_request", "Enter a Workshop id or a steamcommunity.com filedetails URL");
  const title = `aim_mock_${workshopId.slice(-4)}`;
  const existing = maps().find((m) => m.workshopId === workshopId);
  return {
    item: {
      workshopId,
      title,
      url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`,
      previewUrl: null,
      creatorSteamId: "76561198000000001",
      creatorName: "Mock author",
      fileSize: 24_000_000,
      tags: ["Map", "Cs2"],
      createdAt: new Date(Date.now() - 90 * 86_400_000).toISOString(),
      updatedAt: new Date(Date.now() - 9 * 86_400_000).toISOString(),
      subscriptions: 12_345,
      cs2: true,
    },
    suggestedId: slugMapId(title),
    existingId: existing?.id ?? null,
  };
}

function guardMin(next: PoolMap[]) {
  for (const mode of POOL_MODES) {
    const was = maps().filter((m) => m.modes.includes(mode)).length;
    const now = next.filter((m) => m.modes.includes(mode)).length;
    if (now < minPoolSize(mode) && now < was) {
      throw new ApiError(409, "pool_too_small", `${mode} needs at least ${minPoolSize(mode)} enabled maps for the veto`);
    }
  }
}

export const mockMaps = {
  view(): PoolView {
    return { maps: maps(), stored: pool !== null && maps().some((m) => m.updatedAt), minPool: { aim1v1: minPoolSize("aim1v1"), aim2v2: minPoolSize("aim2v2") } };
  },
  preview,
  add(input: { workshop: string; id?: string; displayName?: string; modes: PoolMode[]; loadout?: MapLoadout }) {
    const p = preview(input.workshop);
    const id = input.id ?? p.suggestedId;
    if (p.existingId || maps().some((m) => m.id === id)) throw new ApiError(409, "map_exists", "Already in the pool");
    const map: PoolMap = {
      id,
      displayName: input.displayName ?? p.item.title,
      workshopId: p.item.workshopId,
      mapName: null,
      loadout: input.loadout ?? null,
      modes: input.modes,
      position: maps().length,
      previewUrl: null,
      source: "admin",
      workshop: p.item,
      updatedBy: MOCK_ME.steamId,
      updatedAt: new Date().toISOString(),
    };
    pool = [...maps(), map];
    return { map, audit: audit("map.add", id, input) };
  },
  update(id: string, patch: { displayName?: string; modes?: PoolMode[]; loadout?: MapLoadout | null }) {
    const before = maps().find((m) => m.id === id);
    if (!before) throw new ApiError(404, "not_found", "Map not found");
    const after: PoolMap = {
      ...before,
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.modes !== undefined ? { modes: patch.modes } : {}),
      ...(patch.loadout !== undefined ? { loadout: patch.loadout } : {}),
      updatedBy: MOCK_ME.steamId,
      updatedAt: new Date().toISOString(),
    };
    const next = maps().map((m) => (m.id === id ? after : m));
    guardMin(next);
    pool = next;
    return { map: after, audit: audit("map.update", id, patch) };
  },
  reorder(ids: string[]) {
    pool = ids.map((id, position) => ({ ...maps().find((m) => m.id === id)!, position }));
    return { maps: pool, audit: audit("map.reorder", "map_pool", { ids }) };
  },
  remove(id: string) {
    const row = maps().find((m) => m.id === id);
    if (!row) throw new ApiError(404, "not_found", "Map not found");
    if (row.source !== "admin") throw new ApiError(409, "config_map", "Maps from the shared config can be disabled but not removed");
    if (row.modes.length) throw new ApiError(409, "map_enabled", "Disable the map in every mode first");
    pool = maps().filter((m) => m.id !== id);
    return { ok: true as const, audit: audit("map.remove", id, {}) };
  },
};
