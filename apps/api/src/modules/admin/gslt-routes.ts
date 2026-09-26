import { UuidSchema } from "@rushsite/shared"
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { gsltTokens } from "../../db/schema.js"
import { iso, type AdminStore } from "./store.js"
import { AdminError } from "./routes.js"
import type { AdminPluginOptions, GsltStatus, GsltView } from "./types.js"

export interface GsltDeps {
  store: AdminStore
  opts: Pick<AdminPluginOptions, "db" | "emitAdmin">
}

const MEMO_MAX = 64
const TOKEN_RE = /\b[0-9A-Fa-f]{32}\b/g
// Anything that looks like a token but has the wrong length
const HEXISH_RE = /\b[0-9A-Fa-f]{20,}\b/

const MemoSchema = z.string().trim().max(MEMO_MAX)
const AddBody = z.object({
  text: z.string().max(20_000),
  // Used for tokens whose line carries no memo of its own
  memo: MemoSchema.optional(),
})
const PatchBody = z.object({ memo: MemoSchema.nullable() })

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value)
  if (!r.success) {
    throw new AdminError(400, "invalid_request", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "))
  }
  return r.data
}

export type ParsedGslt = { token: string; memo: string | null; line: number }
export type GsltPaste = { tokens: ParsedGslt[]; invalidLines: number[] }

const cleanMemo = (s: string): string | null => {
  const m = s.trim().slice(0, MEMO_MAX).trim()
  return m.length > 0 ? m : null
}

// The memo from what follows the token on one line.
// Steam's manage page gives app id, token, last logon and memo. A bare token may be followed by a memo.
function memoOf(before: string, after: string): string | null {
  const rest = after.trim()
  if (!rest) return null
  const steamRow = /^\s*\d+\s*$/.test(before)
  if (!steamRow) return cleanMemo(rest)
  // Steam rows put the last logon first. Tabs or wide gaps split the columns
  const cols = rest.split(/\t+| {2,}/).map((c) => c.trim()).filter(Boolean)
  if (cols.length >= 2) return cleanMemo(cols.slice(1).join(" "))
  // Single spaced paste. Only Never can be told apart from a memo
  const never = rest.match(/^never\b\s*(.*)$/i)
  if (never) return cleanMemo(never[1] ?? "")
  return null
}

// Pulls tokens and memos out of pasted text. One token per line
export function parseGsltPaste(text: string): GsltPaste {
  const tokens: ParsedGslt[] = []
  const invalidLines: number[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return
    const found = [...line.matchAll(TOKEN_RE)]
    if (found.length !== 1) {
      // Header rows from Steam's table carry no token and are ignored quietly
      if (found.length > 1 || HEXISH_RE.test(line)) invalidLines.push(i + 1)
      else if (!/login\s*token/i.test(line)) invalidLines.push(i + 1)
      return
    }
    const m = found[0]!
    const start = m.index ?? 0
    tokens.push({
      token: m[0].toUpperCase(),
      memo: memoOf(line.slice(0, start), line.slice(start + m[0].length)),
      line: i + 1,
    })
  })
  return { tokens, invalidLines }
}

// Never show a full token. Short test tokens are hidden completely
export function maskGslt(token: string): string {
  if (token.length < 16) return "*".repeat(Math.min(token.length, 8))
  return `${token.slice(0, 4)}…${token.slice(-4)}`
}

type Row = typeof gsltTokens.$inferSelect

function view(r: Row): GsltView {
  return {
    id: r.id,
    token: maskGslt(r.token),
    memo: r.memo,
    status: r.status as GsltStatus,
    matchId: r.matchId,
    lastUsedAt: iso(r.lastUsedAt),
    createdAt: iso(r.createdAt)!,
  }
}

export function registerGsltRoutes(app: FastifyInstance, deps: GsltDeps, adminOf: (req: FastifyRequest) => string) {
  const { store, opts } = deps
  const db = opts.db

  const audit = (req: FastifyRequest, action: "gslt.add" | "gslt.update" | "gslt.remove", target: string, payload: unknown) =>
    store.writeAudit({ adminSteamId: adminOf(req), action, target, payload })

  const list = async () => {
    const rows = await db.select().from(gsltTokens).orderBy(asc(gsltTokens.createdAt), asc(gsltTokens.id))
    const tokens = rows.map(view)
    const count = (s: GsltStatus) => tokens.filter((t) => t.status === s).length
    return { tokens, counts: { total: tokens.length, free: count("free"), inUse: count("in_use"), invalid: count("invalid") } }
  }

  const findRow = async (id: string): Promise<Row> => {
    if (!UuidSchema.safeParse(id).success) throw new AdminError(404, "not_found", "Token not found")
    const [row] = await db.select().from(gsltTokens).where(eq(gsltTokens.id, id))
    if (!row) throw new AdminError(404, "not_found", "Token not found")
    return row
  }

  app.get("/admin/gslt", list)

  app.post("/admin/gslt", async (req, reply) => {
    const body = parse(AddBody, req.body)
    const pasted = parseGsltPaste(body.text)
    if (pasted.tokens.length === 0) {
      throw new AdminError(400, "invalid_request", "No token found. Paste 32 character hex tokens, one per line", {
        invalidLines: pasted.invalidLines,
      })
    }
    const fallbackMemo = body.memo ? cleanMemo(body.memo) : null

    // Duplicates inside the paste count as skipped
    const unique = new Map<string, ParsedGslt>()
    for (const t of pasted.tokens) if (!unique.has(t.token)) unique.set(t.token, t)
    // Older rows may be stored in another case
    const existing = await db
      .select({ token: sql<string>`upper(${gsltTokens.token})` })
      .from(gsltTokens)
      .where(inArray(sql`upper(${gsltTokens.token})`, [...unique.keys()]))
    for (const e of existing) unique.delete(e.token)

    const fresh = [...unique.values()]
    const inserted = fresh.length
      ? await db
          .insert(gsltTokens)
          .values(fresh.map((t) => ({ token: t.token, memo: t.memo ?? fallbackMemo })))
          .onConflictDoNothing()
          .returning()
      : []
    const added = inserted.map(view)
    const skipped = pasted.tokens.length - added.length
    const entry = await audit(req, "gslt.add", "gslt_pool", {
      added: added.map((t) => ({ id: t.id, token: t.token, memo: t.memo })),
      skipped,
      invalidLines: pasted.invalidLines,
    })
    if (added.length > 0) opts.emitAdmin("host", { action: "gslt_added", count: added.length, by: entry.adminSteamId })
    return reply.code(added.length > 0 ? 201 : 200).send({
      added: added.length,
      skipped,
      invalidLines: pasted.invalidLines,
      tokens: added,
      audit: entry,
    })
  })

  app.patch<{ Params: { id: string } }>("/admin/gslt/:id", async (req) => {
    const before = await findRow(req.params.id)
    const body = parse(PatchBody, req.body ?? {})
    const memo = body.memo === null ? null : cleanMemo(body.memo)
    const [row] = await db.update(gsltTokens).set({ memo }).where(eq(gsltTokens.id, before.id)).returning()
    if (!row) throw new AdminError(404, "not_found", "Token not found")
    const entry = await audit(req, "gslt.update", row.id, { token: maskGslt(row.token), memo, before: before.memo })
    opts.emitAdmin("host", { action: "gslt_updated", id: row.id, by: entry.adminSteamId })
    return { token: view(row), audit: entry }
  })

  app.delete<{ Params: { id: string } }>("/admin/gslt/:id", async (req) => {
    const before = await findRow(req.params.id)
    if (before.status === "in_use") {
      throw new AdminError(409, "gslt_in_use", "This token is held by a running match. Remove it once the match ends", {
        matchId: before.matchId,
      })
    }
    // The status check repeats in the delete so a token reserved meanwhile stays
    const [removed] = await db
      .delete(gsltTokens)
      .where(and(eq(gsltTokens.id, before.id), ne(gsltTokens.status, "in_use")))
      .returning()
    if (!removed) throw new AdminError(409, "gslt_in_use", "This token was just reserved by a match")
    const entry = await audit(req, "gslt.remove", removed.id, { token: maskGslt(removed.token), memo: removed.memo, status: removed.status })
    opts.emitAdmin("host", { action: "gslt_removed", id: removed.id, by: entry.adminSteamId })
    return { ok: true, audit: entry }
  })
}
