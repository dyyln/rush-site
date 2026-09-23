import type { DathostServerStore } from "./types.js"

export function createMemoryServerStore(): DathostServerStore & { entries(): [string, string][] } {
  const map = new Map<string, string>()
  return {
    async get(matchId) {
      return map.get(matchId)
    },
    async set(matchId, serverId) {
      map.set(matchId, serverId)
    },
    async delete(matchId) {
      map.delete(matchId)
    },
    async count() {
      return map.size
    },
    entries() {
      return [...map.entries()]
    },
  }
}
