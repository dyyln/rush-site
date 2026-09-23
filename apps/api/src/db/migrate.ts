import { loadEnv } from "../env.js"
import { runMigrations } from "./client.js"

const env = loadEnv()
await runMigrations(env.DATABASE_URL)
console.log("migrations applied")
