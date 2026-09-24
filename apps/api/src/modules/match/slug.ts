import { randomInt } from "node:crypto"
import { findFreeMatchSlug, isMatchSlug } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { matches } from "../../db/schema.js"

const SPAN = 2 ** 32

// Crypto backed so room ids cannot be guessed from earlier ones
export const cryptoRng = (): number => randomInt(SPAN) / SPAN

// Picks a room id no match uses yet. The unique index catches the rare race between two inserts
export function newMatchSlug(db: Db, rng: () => number = cryptoRng): Promise<string> {
  return findFreeMatchSlug(async (slug) => {
    const [hit] = await db.select({ id: matches.id }).from(matches).where(eq(matches.slug, slug)).limit(1)
    return !!hit
  }, rng)
}

// Match id for a room id. null when no match has it
export async function matchIdForSlug(db: Db, slug: string): Promise<string | null> {
  if (!isMatchSlug(slug)) return null
  const [row] = await db.select({ id: matches.id }).from(matches).where(eq(matches.slug, slug)).limit(1)
  return row?.id ?? null
}
