import { afterEach, describe, expect, it } from "vitest"
import { createHarness, makeUsers, type Harness } from "../../../test/helpers.js"
import { matchmakeAll, modeOrder } from "./loop.js"

let h: Harness
afterEach(async () => {
  await h?.close()
})

describe("mode order", () => {
  it("puts every mode first once every three ticks", () => {
    expect(modeOrder(0)).toEqual(["aim1v1", "aim2v2", "rush3v3"])
    expect(modeOrder(1)).toEqual(["aim2v2", "rush3v3", "aim1v1"])
    expect(modeOrder(2)).toEqual(["rush3v3", "aim1v1", "aim2v2"])
    expect(modeOrder(3)).toEqual(modeOrder(0))
  })

  // Six rush solos where one of them also waits in 1v1 next to a 1v1 only solo
  async function setup(): Promise<{ multi: string; duelOnly: string }> {
    const ids = await makeUsers(h.db, 7)
    const [multi, duelOnly, ...rush] = ids as [string, string, ...string[]]
    await h.ctx.queue.join(multi, ["aim1v1", "rush3v3"])
    await h.ctx.queue.join(duelOnly, ["aim1v1"])
    for (const id of rush.slice(0, 5)) await h.ctx.queue.join(id, ["rush3v3"])
    return { multi, duelOnly }
  }

  it("lets rush take a multi mode solo on its turn", async () => {
    h = await createHarness()
    const { multi, duelOnly } = await setup()
    const created = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.ctx.now(), undefined, 2)
    expect(created).toHaveLength(1)
    expect((await h.ctx.queue.status(multi)).state).not.toBe("queued")
    expect((await h.ctx.queue.status(duelOnly)).state).toBe("queued")
    expect(await h.ctx.queue.playersInQueue("rush3v3")).toBe(0)
  })

  it("gives the same solo to 1v1 when 1v1 goes first", async () => {
    h = await createHarness()
    const { duelOnly } = await setup()
    const created = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.ctx.now(), undefined, 0)
    expect(created).toHaveLength(1)
    expect((await h.ctx.queue.status(duelOnly)).state).not.toBe("queued")
    expect(await h.ctx.queue.playersInQueue("rush3v3")).toBe(5)
  })
})
