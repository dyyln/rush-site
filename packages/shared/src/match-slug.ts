import { z } from "zod"

// Human match room ids such as brave-amber-falcon. Lists hold plain neutral words only.
// Tier names are left out so a room id never reads like a rank.

export const SLUG_ADJECTIVES = [
  "agile", "alert", "ample", "arctic", "atomic", "blazing", "bold", "bouncy", "brave", "breezy",
  "bright", "brisk", "calm", "candid", "cheery", "civic", "clear", "clever", "cosmic", "cozy",
  "crafty", "crisp", "curious", "daring", "dapper", "dashing", "dusky", "eager", "early", "elegant",
  "epic", "fabled", "fair", "fancy", "fearless", "festive", "fiery", "fleet", "frosty", "gallant",
  "gentle", "glad", "gleaming", "glowing", "graceful", "grand", "happy", "hardy", "hazy", "hearty",
  "honest", "humble", "icy", "jaunty", "jolly", "keen", "kind", "lively", "loyal", "lucky",
  "lunar", "mellow", "merry", "mighty", "misty", "modest", "mystic", "neat", "nifty", "nimble",
  "noble", "patient", "peppy", "placid", "plucky", "polar", "polite", "prime", "proud", "quaint",
  "quick", "quiet", "radiant", "rapid", "rugged", "rustic", "serene", "sharp", "shiny", "silent",
  "silky", "sleek", "smart", "snappy", "solar", "spry", "steady", "stellar", "stoic", "sturdy",
  "sunlit", "sunny", "swift", "tidy", "tranquil", "trusty", "upbeat", "valiant", "vast", "vibrant",
  "vivid", "wise", "witty", "zesty", "zippy",
] as const

export const SLUG_COLOURS = [
  "amber", "azure", "cedar", "cerulean", "cinder", "cobalt", "copper", "coral", "crimson", "cyan",
  "ember", "emerald", "frost", "garnet", "indigo", "jade", "lilac", "lime", "maroon", "mint",
  "navy", "ochre", "olive", "onyx", "opal", "pearl", "plum", "quartz", "rose", "ruby",
  "rust", "saffron", "sage", "sand", "sapphire", "scarlet", "sienna", "slate", "teal", "topaz",
  "umber", "violet",
] as const

export const SLUG_NOUNS = [
  "anchor", "antelope", "arrow", "aurora", "badger", "beacon", "beaver", "bison", "breeze", "canyon",
  "cheetah", "comet", "compass", "condor", "cougar", "crane", "delta", "dolphin", "dragon", "eagle",
  "eclipse", "elk", "falcon", "ferret", "finch", "forest", "fox", "galaxy", "gazelle", "gecko",
  "geyser", "glacier", "griffin", "harbor", "hawk", "heron", "horizon", "iguana", "island", "jaguar",
  "kestrel", "lagoon", "lantern", "leopard", "lion", "lynx", "marlin", "marten", "meadow", "mesa",
  "meteor", "moose", "nebula", "octopus", "orbit", "orca", "osprey", "otter", "owl", "panther",
  "pelican", "penguin", "phoenix", "pike", "planet", "prairie", "puffin", "puma", "pulsar", "quasar",
  "raven", "reef", "ridge", "river", "robin", "rocket", "salmon", "seal", "shield", "sparrow",
  "stag", "storm", "summit", "swan", "thunder", "tiger", "tortoise", "trout", "tundra", "turtle",
  "valley", "viper", "volcano", "walrus", "whale", "wolf", "zebra",
] as const

// Three or four lowercase words joined by dashes. A uuid never matches because it has five parts and digits
export const MATCH_SLUG_PATTERN = /^[a-z]+(?:-[a-z]+){2,3}$/
export const MatchSlugSchema = z.string().max(64).regex(MATCH_SLUG_PATTERN)

export function isMatchSlug(value: string): boolean {
  return value.length <= 64 && MATCH_SLUG_PATTERN.test(value)
}

type Rng = () => number

function pick<T>(list: readonly T[], rng: Rng): T {
  const i = Math.min(list.length - 1, Math.max(0, Math.floor(rng() * list.length)))
  return list[i]!
}

// Three words is adjective colour noun. Four adds a second, different adjective in front
export function generateMatchSlug(words: 3 | 4 = 3, rng: Rng = Math.random): string {
  const adjective = pick(SLUG_ADJECTIVES, rng)
  const tail = [pick(SLUG_COLOURS, rng), pick(SLUG_NOUNS, rng)]
  if (words === 3) return [adjective, ...tail].join("-")
  const rest = SLUG_ADJECTIVES.filter((a) => a !== adjective)
  return [pick(rest, rng), adjective, ...tail].join("-")
}

// How many attempts use three words before the generator moves to four
export const SLUG_THREE_WORD_TRIES = 4
export const SLUG_MAX_TRIES = 8

// Draws ids until taken says no. Throws when every try collides
export async function findFreeMatchSlug(taken: (slug: string) => Promise<boolean>, rng: Rng = Math.random): Promise<string> {
  for (let i = 0; i < SLUG_MAX_TRIES; i++) {
    const slug = generateMatchSlug(i < SLUG_THREE_WORD_TRIES ? 3 : 4, rng)
    if (!(await taken(slug))) return slug
  }
  throw new Error("no free match slug")
}
