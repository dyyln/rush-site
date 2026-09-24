import { describe, expect, it } from "vitest"
import { ChatPostSchema } from "./chat.js"

describe("ChatPostSchema", () => {
  it("turns line breaks and tabs into one space", () => {
    expect(ChatPostSchema.parse({ body: "gg\nwp\r\n\n\tnext" }).body).toBe("gg wp next")
    expect(ChatPostSchema.parse({ body: "a b c" }).body).toBe("a b c")
  })

  it("drops other control characters and trims", () => {
    expect(ChatPostSchema.parse({ body: "  hi\u0007 there\u007f \n" }).body).toBe("hi there")
  })

  it("refuses a message that is only line breaks", () => {
    expect(ChatPostSchema.safeParse({ body: "\n\r\n\t" }).success).toBe(false)
  })

  it("takes letters, digits, spaces and keyboard punctuation only", () => {
    expect(ChatPostSchema.safeParse({ body: "gg, wp! 2:1 (close) @kestrel #1 50% ~ok" }).success).toBe(true)
    expect(ChatPostSchema.safeParse({ body: "nice \u{1F525}" }).success).toBe(false)
    expect(ChatPostSchema.safeParse({ body: "sch\u00f6n" }).success).toBe(false)
  })
})
