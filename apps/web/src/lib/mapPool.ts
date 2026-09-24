import { useEffect, useSyncExternalStore } from "react";
import { configPool, RUSH_MAP, type PublicMap } from "@rushsite/shared";
import { api } from "./api";
import { isMock } from "./env";
import { knownMaps, setKnownMaps, subscribeKnownMaps } from "./mapPoolStore";

let loading: Promise<void> | null = null;

function fallback(): PublicMap[] {
  return [
    ...configPool().map((m) => ({ id: m.id, displayName: m.displayName, modes: m.modes, previewUrl: null, workshopId: m.workshopId })),
    { id: RUSH_MAP.id, displayName: RUSH_MAP.displayName, modes: ["rush3v3"], previewUrl: null, workshopId: null },
  ];
}

// Loads once per page. force reloads after an admin edit
export function loadMapPool(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (isMock ? Promise.resolve(fallback()) : api.get<{ maps: PublicMap[] }>("/maps").then((r) => r.maps))
    .then(setKnownMaps)
    .catch(() => {
      // Names fall back to the shared config. A later call tries again
      loading = null;
    });
  return loading;
}

// Re-renders when the pool arrives
export function useMapPool(): ReadonlyMap<string, PublicMap> {
  useEffect(() => {
    void loadMapPool();
  }, []);
  return useSyncExternalStore(subscribeKnownMaps, knownMaps, knownMaps);
}
