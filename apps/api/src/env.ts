import { isTestMode, MODES, type Mode } from "@rushsite/shared"
import { z } from "zod"

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase())))

const csv = z
  .string()
  .default("")
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  )

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined))

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3001),

  // Website origin. Login redirects here and CORS allows it.
  PUBLIC_URL: z.url().default("http://localhost:3000"),
  // Public API origin. Used as the Steam OpenID realm and return_to, and as the match webhook base
  API_PUBLIC_URL: z.url().default("http://localhost:3001"),

  DATABASE_URL: z.string().min(1).default("postgres://rushsite:rushsite@localhost:5432/rushsite"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  // Run pending migrations on boot
  DB_MIGRATE_ON_START: bool.default(true),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Set when web and api live on sibling subdomains, for example .rushsite.gg
  COOKIE_DOMAIN: optionalString,

  STEAM_API_KEY: optionalString,
  FACEIT_API_KEY: optionalString,

  RUSHSITE_AGENT_TOKEN: z.string().min(1).default("change-me-dev-agent-token"),
  // Comma separated agent urls. Prefix one with region= to place it, for example eu=http://10.0.0.2:8080
  AGENT_URLS: csv,
  GSLT_TOKENS: csv,

  // DatHost surge capacity. Disabled without an account email
  DATHOST_EMAIL: optionalString,
  DATHOST_PASSWORD: optionalString,
  DATHOST_TEMPLATE_SERVER_ID: optionalString,
  DATHOST_LOCATION: z.string().default("dusseldorf"),
  // How long a match waits for a Hetzner slot before using DatHost
  SURGE_WAIT_SEC: z.coerce.number().int().nonnegative().default(20),

  S3_ENDPOINT: optionalString,
  S3_PUBLIC_ENDPOINT: optionalString,
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("rushsite-demos"),
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: bool.default(true),

  // Steam ids with admin rights, comma separated
  ADMIN_STEAM_IDS: csv,

  // Completed clean matches needed to move from New to Verified
  TRUST_VERIFIED_MIN_MATCHES: z.coerce.number().int().nonnegative().default(5),
  TRUST_TRUSTED_MIN_MATCHES: z.coerce.number().int().nonnegative().default(150),
  TRUST_TRUSTED_MIN_ACCOUNT_DAYS: z.coerce.number().int().nonnegative().default(365),
  // A Steam ban older than this no longer blocks Verified
  TRUST_BAN_GRACE_DAYS: z.coerce.number().int().nonnegative().default(1825),

  // Days of wins by a banned cheater that get rolled back for their opponents
  ROLLBACK_WINDOW_DAYS: z.coerce.number().int().positive().default(30),

  MATCHMAKER_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  MATCH_TICK_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  // Server starts and teardowns run in their own loop so agent calls never delay the timers
  ALLOCATION_TICK_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  ALLOCATION_CONCURRENCY: z.coerce.number().int().positive().default(4),
  // Give up allocating a server after this long and requeue everyone
  ALLOCATION_TIMEOUT_SEC: z.coerce.number().int().positive().default(120),
  // Backstop for players who never connect when the plugin does not report it
  CONNECT_TIMEOUT_SEC: z.coerce.number().int().positive().default(600),
  // Watchdog caps per mode in minutes. A match past its cap ends with no rating change
  MATCH_MAX_MIN_AIM: z.coerce.number().int().positive().default(60),
  MATCH_MAX_MIN_RUSH: z.coerce.number().int().positive().default(40),
  // A live match with no webhook this long and no answer from its server driver counts as lost
  MATCH_SILENCE_SEC: z.coerce.number().int().positive().default(900),
  // Seconds between watchdog passes in the allocation loop
  WATCHDOG_INTERVAL_SEC: z.coerce.number().int().positive().default(30),
  // Servers stay up after the match until the demo upload is reported or this long passes
  DEMO_WAIT_SEC: z.coerce.number().int().nonnegative().default(180),
  // Lets modes with placeholder map or game ids queue outside production
  ALLOW_UNRESOLVED_MODES: bool.default(false),
  // Rush room ban and pick. Unset follows RUSH_ROOM_VETO.enabled in shared config
  RUSH_ROOM_VETO: bool.optional(),
  // Opens the unrated 1v1 Rush test queue. Off hides it on the site and refuses joins
  RUSH1V1_TEST_QUEUE: bool.default(false),
  // Disable background loops, for tests and one-off scripts
  DISABLE_LOOPS: bool.default(false),
  // Per route HTTP rate limits backed by Redis
  RATE_LIMIT_ENABLED: bool.default(true),
})

export type Env = z.infer<typeof EnvSchema>

// Test modes the server config leaves off. They are hidden on the site and refuse joins
export function disabledModes(env: Pick<Env, "RUSH1V1_TEST_QUEUE">): Mode[] {
  return MODES.filter((m) => isTestMode(m) && !(m === "rush1v1" && env.RUSH1V1_TEST_QUEUE))
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")
    throw new Error(`Invalid environment:\n${issues}`)
  }
  const unsafe = productionProblems(parsed.data)
  if (unsafe.length > 0) throw new Error(`Unsafe production environment:\n${unsafe.map((p) => `  ${p}`).join("\n")}`)
  return parsed.data
}

const PLACEHOLDER = /change-?me|example|placeholder|secret-?here/i

// Refuses to boot production with the dev defaults from .env.example or the schema
export function productionProblems(env: Env): string[] {
  if (env.NODE_ENV !== "production") return []
  const out: string[] = []
  if (PLACEHOLDER.test(env.SESSION_SECRET)) out.push("SESSION_SECRET is a placeholder. Use openssl rand -hex 32")
  if (new Set(env.SESSION_SECRET).size < 10) out.push("SESSION_SECRET is too repetitive")
  if (PLACEHOLDER.test(env.RUSHSITE_AGENT_TOKEN) || env.RUSHSITE_AGENT_TOKEN.length < 16) {
    out.push("RUSHSITE_AGENT_TOKEN is a placeholder or shorter than 16 characters. Use openssl rand -hex 32")
  }
  if (!env.RATE_LIMIT_ENABLED) out.push("RATE_LIMIT_ENABLED must stay on in production")
  return out
}

export function testEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    SESSION_SECRET: "test-session-secret-that-is-long-enough-1234",
    DISABLE_LOOPS: "true",
    DB_MIGRATE_ON_START: "false",
    RATE_LIMIT_ENABLED: "false",
    ...overrides,
  })
}
