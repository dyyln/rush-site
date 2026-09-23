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
  // Give up allocating a server after this long and requeue everyone
  ALLOCATION_TIMEOUT_SEC: z.coerce.number().int().positive().default(120),
  // Backstop for players who never connect when the plugin does not report it
  CONNECT_TIMEOUT_SEC: z.coerce.number().int().positive().default(600),
  // Servers stay up after the match until the demo upload is reported or this long passes
  DEMO_WAIT_SEC: z.coerce.number().int().nonnegative().default(180),
  // Lets modes with placeholder map or game ids queue outside production
  ALLOW_UNRESOLVED_MODES: bool.default(false),
  // Disable background loops, for tests and one-off scripts
  DISABLE_LOOPS: bool.default(false),
})

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")
    throw new Error(`Invalid environment:\n${issues}`)
  }
  return parsed.data
}

export function testEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    SESSION_SECRET: "test-session-secret-that-is-long-enough-1234",
    DISABLE_LOOPS: "true",
    DB_MIGRATE_ON_START: "false",
    ...overrides,
  })
}
