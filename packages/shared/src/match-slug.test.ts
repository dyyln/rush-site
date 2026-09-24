import { describe, expect, it } from "vitest"
import {
  MATCH_SLUG_PATTERN,
  SLUG_ADJECTIVES,
  SLUG_COLOURS,
  SLUG_MAX_TRIES,
  SLUG_NOUNS,
  SLUG_THREE_WORD_TRIES,
  findFreeMatchSlug,
  generateMatchSlug,
  isMatchSlug,
} from "./match-slug.js"
import { TIERS } from "./config/tiers.js"

// Deterministic rng that walks a fixed list of values
function seq(...values: number[]) {
  let i = 0
  return () => values[i++ % values.length]!
}

const BLOCKED = ["ass", "damn", "hell", "kill", "dead", "nazi", "slave", "sex", "drug", "hate", "gay", "fat", "ugly", "stupid", "dumb", "ape", "monkey", "black", "white", "yellow", "brown", "red"]

describe("word lists", () => {
  const all = [...SLUG_ADJECTIVES, ...SLUG_COLOURS, ...SLUG_NOUNS]

  it("are plain lowercase words", () => {
    for (const w of all) expect(w).toMatch(/^[a-z]{3,9}$/)
  })

  it("have no word twice, within or across lists", () => {
    expect(new Set(all).size).toBe(all.length)
  })

  it("leave out blocked words and tier names", () => {
    const tiers = TIERS.map((t) => t.id.toLowerCase())
    for (const w of all) {
      expect(BLOCKED).not.toContain(w)
      expect(tiers).not.toContain(w)
    }
  })

  it("give a large enough space for three words", () => {
    expect(SLUG_ADJECTIVES.length * SLUG_COLOURS.length * SLUG_NOUNS.length).toBeGreaterThan(400_000)
  })
})

describe("generateMatchSlug", () => {
  it("builds adjective colour noun", () => {
    expect(generateMatchSlug(3, () => 0)).toBe(`${SLUG_ADJECTIVES[0]}-${SLUG_COLOURS[0]}-${SLUG_NOUNS[0]}`)
    const last = generateMatchSlug(3, () => 0.999999)
    expect(last).toBe(`${SLUG_ADJECTIVES.at(-1)}-${SLUG_COLOURS.at(-1)}-${SLUG_NOUNS.at(-1)}`)
  })

  it("adds a second different adjective for four words", () => {
    const slug = generateMatchSlug(4, () => 0)
    const parts = slug.split("-")
    expect(parts).toHaveLength(4)
    expect(parts[0]).not.toBe(parts[1])
    expect(SLUG_ADJECTIVES).toContain(parts[0])
  })

  it("always matches the room id pattern", () => {
    for (let i = 0; i < 500; i++) {
      expect(isMatchSlug(generateMatchSlug(3))).toBe(true)
      expect(isMatchSlug(generateMatchSlug(4))).toBe(true)
    }
  })

  it("rarely repeats", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateMatchSlug(3)))
    expect(seen.size).toBeGreaterThan(1980)
  })
})

describe("isMatchSlug", () => {
  it("tells room ids from uuids", () => {
    expect(isMatchSlug("brave-amber-falcon")).toBe(true)
    expect(isMatchSlug("brave-calm-amber-falcon")).toBe(true)
    expect(isMatchSlug("9d4f1c2a-7b3e-4a5d-8c6f-1e2d3c4b5a69")).toBe(false)
    expect(isMatchSlug("abcdefab-abcd-abcd-abcd-abcdefabcdef")).toBe(false)
    expect(isMatchSlug("brave-falcon")).toBe(false)
    expect(isMatchSlug("Brave-Amber-Falcon")).toBe(false)
    expect(MATCH_SLUG_PATTERN.test("a-b-c-d-e")).toBe(false)
  })
})

describe("findFreeMatchSlug", () => {
  it("returns the first free id", async () => {
    const slug = await findFreeMatchSlug(async () => false, () => 0)
    expect(slug.split("-")).toHaveLength(3)
  })

  it("retries on collision and moves to four words after the three word tries", async () => {
    const tried: string[] = []
    const slug = await findFreeMatchSlug(async (s) => {
      tried.push(s)
      return tried.length <= SLUG_THREE_WORD_TRIES
    }, seq(0.1, 0.5, 0.9, 0.3))
    expect(tried).toHaveLength(SLUG_THREE_WORD_TRIES + 1)
    expect(tried.slice(0, -1).every((s) => s.split("-").length === 3)).toBe(true)
    expect(slug.split("-")).toHaveLength(4)
  })

  it("gives up after the max tries", async () => {
    let calls = 0
    await expect(
      findFreeMatchSlug(async () => {
        calls++
        return true
      }),
    ).rejects.toThrow("no free match slug")
    expect(calls).toBe(SLUG_MAX_TRIES)
  })
})
