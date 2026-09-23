import { buildApp } from "./app.js"
import { createDb, runMigrations } from "./db/client.js"
import { loadEnv } from "./env.js"
import { createRedis } from "./lib/redis.js"
import { RedisNotifier, subscribeFanout, LocalHub } from "./modules/ws/hub.js"

const env = loadEnv()
if (env.DB_MIGRATE_ON_START) await runMigrations(env.DATABASE_URL)

const { db, close: closeDb } = createDb(env.DATABASE_URL)
const redis = createRedis(env.REDIS_URL)
const pub = createRedis(env.REDIS_URL)
const sub = createRedis(env.REDIS_URL)
const hub = new LocalHub()
await subscribeFanout(sub, hub)

const { app } = await buildApp({ env, db, redis, notifier: new RedisNotifier(pub), hub })

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down")
  await app.close()
  await Promise.allSettled([closeDb(), redis.quit(), pub.quit(), sub.quit()])
  process.exit(0)
}
process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))

await app.listen({ host: env.HOST, port: env.PORT })
