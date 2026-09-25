import type { Redis } from "ioredis"

// Last socket heartbeat per player on any instance, so each player counts once however many tabs they have
const ONLINE = "ws:online"
// Two ping rounds. A player whose sockets all went quiet drops out after this
export const ONLINE_WINDOW_MS = 60_000

export async function touchOnline(redis: Redis, steamId: string, now: number): Promise<void> {
  await redis.zadd(ONLINE, now, steamId)
}

// Called when the player's last socket on this instance closes. Another instance re-adds them on its next pong
export async function dropOnline(redis: Redis, steamId: string): Promise<void> {
  await redis.zrem(ONLINE, steamId)
}

// Unique signed in players with a live socket. Also trims entries past the window
export async function countOnline(redis: Redis, now: number): Promise<number> {
  const cutoff = now - ONLINE_WINDOW_MS
  const [, count] = (await redis.multi().zremrangebyscore(ONLINE, 0, `(${cutoff}`).zcard(ONLINE).exec()) ?? []
  return Number(count?.[1] ?? 0)
}
