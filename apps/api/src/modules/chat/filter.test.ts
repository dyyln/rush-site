import { describe, expect, it } from "vitest"
import { collapseRepeats, filterMessage, fingerprint, findLinks, linkVerdict, normaliseWord, similarity } from "./filter.js"

const verdict = (text: string) => {
  const r = filterMessage(text)
  return r.ok ? (r.masked ? `mask:${r.body}` : "ok") : r.code
}

describe("normalisation", () => {
  it("reads case, leetspeak, accents and lookalike letters", () => {
    expect(normaliseWord("FUCK")).toBe("fuck")
    expect(normaliseWord("sh1t")).toBe("shit")
    expect(normaliseWord("$h!t")).toBe("shit")
    expect(normaliseWord("b1tch3s")).toBe("bitches")
    expect(normaliseWord("f.u.c.k")).toBe("fuck")
    expect(normaliseWord("ſhít")).toBe("shit")
    // Cyrillic е and с
    expect(normaliseWord("fuсkеd")).toBe("fucked")
    // Sentence punctuation at the ends is not read as leetspeak
    expect(normaliseWord("fuck!")).toBe("fuck")
    expect(collapseRepeats("fuuuuuck")).toBe("fuck")
  })

  it("catches spaced, repeated and leetspeak profanity", () => {
    expect(verdict("fuuuuck this")).toBe("mask:f****** this")
    expect(verdict("f u c k this")).toBe("mask:f * * * this")
    expect(verdict("that was sh1t")).toBe("mask:that was s***")
    expect(verdict("f-u-c-k")).toBe("mask:f******")
    expect(verdict("FUCKING hell")).toBe("mask:F****** hell")
  })
})

describe("word boundaries", () => {
  it("leaves ordinary words alone", () => {
    for (const text of [
      "Scunthorpe United won",
      "nice assassin skin",
      "a classic pass",
      "cocktail after the cup",
      "reading Dickens",
      "shitake mushrooms",
      "flame retardant",
      "Niger and Nigeria",
      "that was a con",
      "spicy peek",
      "cocky play",
      "hancock",
      "grape juice",
    ]) {
      expect(verdict(text), text).toBe("ok")
    }
  })

  it("still catches the term with a known suffix", () => {
    expect(verdict("you bitches")).toBe("mask:you b******")
    expect(verdict("what a dickhead")).toBe("mask:what a d*******")
  })
})

describe("severity", () => {
  it("masks profanity and refuses slurs and hate terms", () => {
    expect(verdict("well shit")).toBe("mask:well s***")
    expect(verdict("you are a r3tard")).toBe("chat_blocked_language")
    expect(verdict("r e t a r d")).toBe("chat_blocked_language")
    expect(verdict("just kys")).toBe("chat_blocked_language")
    expect(verdict("kill   yourself")).toBe("chat_blocked_language")
    // A refused term wins over a masked one
    expect(verdict("fuck you retard")).toBe("chat_blocked_language")
  })
})

describe("links", () => {
  it("finds scheme and bare links", () => {
    expect(findLinks("see https://example.com/a and www.foo.org").map((l) => l.host)).toEqual(["example.com", "www.foo.org"])
    expect(findLinks("gg wp e.g. nice")).toEqual([])
  })

  it("allows one http or https link", () => {
    expect(verdict("vod at https://youtube.com/watch?v=1")).toBe("ok")
    expect(verdict("https://a.com and https://b.com")).toBe("chat_too_many_links")
    expect(verdict("steam://connect/1.2.3.4")).toBe("chat_link_not_allowed")
    expect(verdict("javascript:alert(1)")).toBe("chat_link_not_allowed")
    expect(verdict("ftp://files.example.com")).toBe("chat_link_not_allowed")
  })

  it("blocks steam lookalikes and skin scam hosts", () => {
    expect(verdict("https://steamcommunity.com/id/me")).toBe("ok")
    expect(verdict("https://store.steampowered.com/app/730")).toBe("ok")
    expect(verdict("https://steamdb.info/app/730")).toBe("ok")
    for (const url of [
      "https://steamcommunlty.com/tradeoffer",
      "https://stearncommunity.ru/login",
      "https://steam-gift.xyz",
      "http://st3amcommunity.com",
      "https://steamcommunity.com.verify-login.ru",
      "https://steamcommunity.com@evil.ru/login",
      "free-skins.gg",
      "https://cs2-case-drop.com",
      "https://xn--stamcommunity-ncb.com",
    ]) {
      expect(verdict(url), url).toBe("chat_scam_link")
    }
  })

  it("blocks invite spam", () => {
    expect(verdict("join discord.gg/abc")).toBe("chat_invite_link")
    expect(verdict("https://discord.com/invite/abc")).toBe("chat_invite_link")
    expect(verdict("t.me/somegroup")).toBe("chat_invite_link")
    expect(verdict("https://steamcommunity.com/groups/spam")).toBe("chat_invite_link")
    expect(linkVerdict({ scheme: "https", host: "discord.com", path: "/channels/1" })).toBe("ok")
  })
})

describe("mentions and caps", () => {
  it("limits mentions and shouting", () => {
    expect(verdict("@a1 @b2 @c3 gg")).toBe("ok")
    expect(verdict("@a1 @b2 @c3 @d4 gg")).toBe("chat_too_many_mentions")
    expect(verdict("GG WP")).toBe("ok")
    expect(verdict("WHY IS NOBODY QUEUEING RUSH")).toBe("chat_shouting")
    expect(verdict("Rush is LIVE on EU tonight folks")).toBe("ok")
  })
})

describe("duplicate fingerprint", () => {
  it("treats near copies as the same", () => {
    expect(fingerprint("Anyone for RUSH???")).toBe(fingerprint("anyone for rush"))
    expect(similarity(fingerprint("anyone for rush"), fingerprint("anyone for rush pls"))).toBeGreaterThan(0.75)
    expect(similarity(fingerprint("anyone for rush"), fingerprint("gg that was close"))).toBeLessThan(0.5)
  })
})
