import type { PublicMap } from "@rushsite/shared";

// Every known map by id. Filled from GET /maps by loadMapPool
let maps: ReadonlyMap<string, PublicMap> = new Map();
const listeners = new Set<() => void>();

export function setKnownMaps(list: PublicMap[]): void {
  maps = new Map(list.map((m) => [m.id, m]));
  for (const l of listeners) l();
}

export function knownMaps(): ReadonlyMap<string, PublicMap> {
  return maps;
}

// Sync lookup for helpers such as mapName. Empty until the pool has loaded
export function knownMap(id: string): PublicMap | undefined {
  return maps.get(id);
}

export function subscribeKnownMaps(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
