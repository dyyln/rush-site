import { Redis } from "ioredis"

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false })
}

// Best effort mutual exclusion across API instances
export async function withLock<T>(redis: Redis, key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined> {
  const token = Math.random().toString(36).slice(2)
  const ok = await redis.set(key, token, "PX", ttlMs, "NX")
  if (ok !== "OK") return undefined
  try {
    return await fn()
  } finally {
    const current = await redis.get(key)
    if (current === token) await redis.del(key)
  }
}

// Like withLock, but the key is renewed while fn runs so a slow call never lets a second holder in.
// ttlMs only bounds how long the key outlives a crashed holder
export async function withLease<T>(redis: Redis, key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined> {
  const token = Math.random().toString(36).slice(2)
  const ok = await redis.set(key, token, "PX", ttlMs, "NX")
  if (ok !== "OK") return undefined
  const renew = setInterval(() => {
    void (async () => {
      if ((await redis.get(key)) === token) await redis.pexpire(key, ttlMs)
    })().catch(() => undefined)
  }, Math.max(10, Math.floor(ttlMs / 3)))
  renew.unref?.()
  try {
    return await fn()
  } finally {
    clearInterval(renew)
    const current = await redis.get(key)
    if (current === token) await redis.del(key)
  }
}
