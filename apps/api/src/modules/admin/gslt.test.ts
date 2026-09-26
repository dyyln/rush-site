import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createAppHarness } from "../../../test/helpers.js"
import { adminAudit, gsltTokens, users } from "../../db/schema.js"
import { maskGslt, parseGsltPaste } from "./gslt-routes.js"

const ROOT = "76561198900000001"
const PLAYER = "76561198900000003"
const MATCH = "00000000-0000-4000-8000-000000000001"

// Fake tokens only
const TOK_A = "AAAA0000000000000000000000001111"
const TOK_B = "BBBB0000000000000000000000002222"
const TOK_C = "CCCC0000000000000000000000003333"

describe("parseGsltPaste", () => {
  it("reads Steam's manage page rows", () => {
    const text = [
      "App ID\tLogin Token\tLast Logon\tMemo",
      `730    ${TOK_A}    Never    Duelrush4`,
      `730\t${TOK_B.toLowerCase()}\t26 Sep, 2026 @ 3:15pm\tEU box two`,
      `730\t${TOK_C}\tNever\t`,
    ].join("\n")
    expect(parseGsltPaste(text)).toEqual({
      tokens: [
        { token: TOK_A, memo: "Duelrush4", line: 2 },
        { token: TOK_B, memo: "EU box two", line: 3 },
        { token: TOK_C, memo: null, line: 4 },
      ],
      invalidLines: [],
    })
  })

  it("reads bare tokens with an optional memo and single spaced rows", () => {
    const text = `${TOK_A}\r\n\n  ${TOK_B} spare one\n730 ${TOK_C} Never Duelrush9`
    expect(parseGsltPaste(text).tokens).toEqual([
      { token: TOK_A, memo: null, line: 1 },
      { token: TOK_B, memo: "spare one", line: 3 },
      { token: TOK_C, memo: "Duelrush9", line: 4 },
    ])
  })

  it("flags lines without exactly one valid token", () => {
    const text = [`${TOK_A}FF`, "not a token", `${TOK_A} ${TOK_B}`, TOK_C].join("\n")
    const r = parseGsltPaste(text)
    expect(r.tokens.map((t) => t.token)).toEqual([TOK_C])
    expect(r.invalidLines).toEqual([1, 2, 3])
  })
})

describe("maskGslt", () => {
  it("keeps only the first and last four characters", () => {
    expect(maskGslt(TOK_A)).toBe("AAAA…1111")
    expect(maskGslt(TOK_A)).not.toContain("0000")
  })
  it("hides short tokens completely", () => {
    expect(maskGslt("GSLTTOKEN0001")).toBe("********")
  })
})

describe("admin gslt routes", () => {
  let h: Awaited<ReturnType<typeof createAppHarness>>
  const cookie: Record<string, string> = {}

  beforeAll(async () => {
    h = await createAppHarness({ plugins: { tournaments: false, admin: true }, env: { ADMIN_STEAM_IDS: ROOT } })
    await h.db.insert(users).values([
      { steamId: ROOT, displayName: "root" },
      { steamId: PLAYER, displayName: "player" },
    ])
    for (const id of [ROOT, PLAYER]) cookie[id] = h.app.signCookie(await h.ctx.sessions.create(id))
  })
  afterAll(async () => {
    await h.close()
  })
  beforeEach(async () => {
    await h.db.delete(gsltTokens)
  })

  const as = (id: string) => {
    const req = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: Record<string, unknown>) =>
      h.app.inject({ method, url, ...(payload ? { payload } : {}), cookies: { rs_sid: cookie[id]! } })
    return {
      get: (url: string) => req("GET", url),
      post: (url: string, p: Record<string, unknown>) => req("POST", url, p),
      patch: (url: string, p: Record<string, unknown>) => req("PATCH", url, p),
      del: (url: string) => req("DELETE", url),
    }
  }

  it("hides the routes from non admins", async () => {
    const [row] = await h.db.insert(gsltTokens).values({ token: TOK_A }).returning()
    // Admin routes answer the stock 404 to everyone else, like the rest of /admin
    expect((await as(PLAYER).get("/admin/gslt")).statusCode).toBe(404)
    expect((await as(PLAYER).post("/admin/gslt", { text: TOK_B })).statusCode).toBe(404)
    expect((await as(PLAYER).patch(`/admin/gslt/${row!.id}`, { memo: "x" })).statusCode).toBe(404)
    expect((await as(PLAYER).del(`/admin/gslt/${row!.id}`)).statusCode).toBe(404)
    expect((await h.app.inject({ method: "GET", url: "/admin/gslt" })).statusCode).toBe(404)
    const rows = await h.db.select().from(gsltTokens)
    expect(rows.map((r) => r.token)).toEqual([TOK_A])
  })

  it("adds pasted tokens, skips duplicates and never returns a full token", async () => {
    // A row seeded from GSLT_TOKENS in another case still counts as a duplicate
    await h.ctx.allocator.seedGslt([TOK_A.toLowerCase()])
    const text = [`730    ${TOK_A}    Never    Duelrush4`, `730    ${TOK_B}    Never    Duelrush5`, TOK_C, TOK_B, "junk"].join("\n")
    const res = await as(ROOT).post("/admin/gslt", { text, memo: "spare" })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body).toMatchObject({ added: 2, skipped: 2, invalidLines: [5] })
    expect(body.tokens.map((t: { token: string; memo: string }) => [t.token, t.memo])).toEqual([
      ["BBBB…2222", "Duelrush5"],
      ["CCCC…3333", "spare"],
    ])
    expect(body.audit).toMatchObject({ action: "gslt.add", adminSteamId: ROOT })
    expect(res.body).not.toContain(TOK_B)
    expect(res.body).not.toContain(TOK_C)

    const list = await as(ROOT).get("/admin/gslt")
    expect(list.statusCode).toBe(200)
    expect(list.json().counts).toEqual({ total: 3, free: 3, inUse: 0, invalid: 0 })
    for (const tok of [TOK_A, TOK_B, TOK_C]) expect(list.body.toUpperCase()).not.toContain(tok)
    expect(list.json().tokens[0]).toMatchObject({ token: "aaaa…1111", memo: null, status: "free", matchId: null, lastUsedAt: null })

    const again = await as(ROOT).post("/admin/gslt", { text: TOK_C })
    expect(again.statusCode).toBe(200)
    expect(again.json()).toMatchObject({ added: 0, skipped: 1 })

    const audits = await h.db.select().from(adminAudit).where(eq(adminAudit.action, "gslt.add"))
    expect(audits.length).toBeGreaterThan(0)
    for (const a of audits) {
      const raw = JSON.stringify(a.payload).toUpperCase()
      for (const tok of [TOK_A, TOK_B, TOK_C]) expect(raw).not.toContain(tok)
    }
  })

  it("rejects a paste with no valid token", async () => {
    const res = await as(ROOT).post("/admin/gslt", { text: "730 ABCDEF Never memo\nhello" })
    expect(res.statusCode).toBe(400)
    expect(res.json().details).toEqual({ invalidLines: [1, 2] })
    expect((await as(ROOT).post("/admin/gslt", {})).statusCode).toBe(400)
    expect(await h.db.select().from(gsltTokens)).toEqual([])
  })

  it("edits the memo", async () => {
    const [row] = await h.db.insert(gsltTokens).values({ token: TOK_A }).returning()
    const res = await as(ROOT).patch(`/admin/gslt/${row!.id}`, { memo: "  Duelrush1 " })
    expect(res.statusCode).toBe(200)
    expect(res.json().token).toMatchObject({ memo: "Duelrush1", token: "AAAA…1111" })
    expect(res.json().audit).toMatchObject({ action: "gslt.update", target: row!.id })
    expect((await as(ROOT).patch(`/admin/gslt/${row!.id}`, { memo: null })).json().token.memo).toBeNull()
    expect((await as(ROOT).patch(`/admin/gslt/${row!.id}`, { memo: "x".repeat(65) })).statusCode).toBe(400)
    expect((await as(ROOT).patch("/admin/gslt/not-a-uuid", { memo: "x" })).statusCode).toBe(404)
  })

  it("refuses to remove a token while a match holds it", async () => {
    const [busy, free] = await h.db
      .insert(gsltTokens)
      .values([
        { token: TOK_A, status: "in_use", matchId: MATCH },
        { token: TOK_B, memo: "Duelrush2" },
      ])
      .returning()
    const refused = await as(ROOT).del(`/admin/gslt/${busy!.id}`)
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toMatchObject({ error: "gslt_in_use", details: { matchId: MATCH } })

    const removed = await as(ROOT).del(`/admin/gslt/${free!.id}`)
    expect(removed.statusCode).toBe(200)
    expect(removed.json().audit).toMatchObject({ action: "gslt.remove", target: free!.id, payload: { token: "BBBB…2222", memo: "Duelrush2" } })
    expect((await h.db.select().from(gsltTokens)).map((r) => r.id)).toEqual([busy!.id])
    expect((await as(ROOT).del(`/admin/gslt/${free!.id}`)).statusCode).toBe(404)
  })
})
