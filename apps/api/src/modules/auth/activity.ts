import type { Redis } from "ioredis"
import type { Db } from "../../db/client.js"
import { userActivityDays } from "../../db/schema.js"

const DAY_SEC = 86_400

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

// Marks a user active for the UTC day. Redis keeps it to one insert per user per day
export class ActivityRecorder {
  constructor(
    private readonly db: Db,
    private readonly redis: Redis,
    private readonly now: () => number,
  ) {}

  async touch(steamId: string): Promise<void> {
    const day = utcDay(this.now())
    const first = await this.redis.set(`act:${day}:${steamId}`, "1", "EX", 2 * DAY_SEC, "NX")
    if (first !== "OK") return
    await this.db.insert(userActivityDays).values({ steamId, day }).onConflictDoNothing()
  }
}
