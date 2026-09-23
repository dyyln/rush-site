import { fileURLToPath } from "node:url"
import type { PgDatabase } from "drizzle-orm/pg-core"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import * as schema from "./schema.js"

export type Schema = typeof schema
// Any drizzle Postgres driver. Production uses postgres-js, tests use PGlite
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, Schema>

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url))

export function createDb(url: string): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, { max: 10 })
  const db = drizzle(client, { schema })
  return { db, close: () => client.end({ timeout: 5 }) }
}

export async function runMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1 })
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR })
  } finally {
    await client.end({ timeout: 5 })
  }
}
