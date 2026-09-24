import { CHAT_LIMITS, type ChatErrorCode } from "@rushsite/shared"
import {
  ALLOW_WORDS,
  INVITE_HOST_PATTERNS,
  INVITE_PATH_PATTERNS,
  MASK_TERMS,
  REFUSE_TERMS,
  SCAM_HOST_PATTERNS,
  STEAM_OFFICIAL_HOSTS,
  TERM_SUFFIXES,
} from "./wordlist.js"

export type FilterResult =
  | { ok: true; body: string; masked: boolean }
  | { ok: false; code: ChatErrorCode; message: string; rule: string }

const LEET: Record<string, string> = {
  "4": "a",
  "@": "a",
  "3": "e",
  "0": "o",
  "1": "i",
  "!": "i",
  "|": "i",
  $: "s",
  "5": "s",
  "7": "t",
  "+": "t",
  "9": "g",
}

// Cyrillic and Greek letters that look like Latin ones
const HOMOGLYPHS: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ѕ: "s", ј: "j", к: "k", м: "m", т: "t", н: "h", в: "b",
  α: "a", ο: "o", ε: "e", ι: "i", κ: "k", ν: "v", ρ: "p", τ: "t", υ: "u",
}

// Sentence punctuation stripped from the ends of a word before leetspeak is read
const EDGE_PUNCT = /^[!?.,;:'"`()[\]{}<>\-_~*]+|[!?.,;:'"`()[\]{}<>\-_~*]+$/g

// Lower case, accents dropped and lookalike letters mapped
function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/./gu, (c) => HOMOGLYPHS[c] ?? c)
}

// One word to plain letters. Returns the letters before repeats are collapsed
export function normaliseWord(raw: string): string {
  return [...fold(raw).replace(EDGE_PUNCT, "")]
    .map((c) => LEET[c] ?? c)
    .filter((c) => /\p{L}/u.test(c))
    .join("")
}

export function collapseRepeats(s: string): string {
  return s.replace(/(.)\1+/gu, "$1")
}

type Word = { start: number; end: number; letters: string }

// Splits text into words with their spans. Single letters in a row are joined so f u c k reads as one word
export function words(text: string): Word[] {
  const raw: Word[] = []
  for (const m of text.matchAll(/\S+/g)) {
    const letters = normaliseWord(m[0])
    if (letters) raw.push({ start: m.index, end: m.index + m[0].length, letters })
  }
  const out: Word[] = []
  let i = 0
  while (i < raw.length) {
    let j = i
    while (j < raw.length && raw[j]!.letters.length === 1) j++
    if (j - i >= 2) {
      out.push({ start: raw[i]!.start, end: raw[j - 1]!.end, letters: raw.slice(i, j).map((w) => w.letters).join("") })
      i = j
    } else {
      out.push(raw[i]!)
      i++
    }
  }
  return out
}

type Term = { words: string[]; severity: "refuse" | "mask" }

const allow = new Set(ALLOW_WORDS.map((w) => collapseRepeats(normaliseWord(w))))
const TERMS: Term[] = [
  ...REFUSE_TERMS.map((t) => ({ words: t.split(/\s+/), severity: "refuse" as const })),
  ...MASK_TERMS.map((t) => ({ words: t.split(/\s+/), severity: "mask" as const })),
]

// Whole word match. The word may add a known suffix. It must be at least as long as the term
// so a shorter real word that collapses onto it, like con and coon, is left alone
function wordMatches(letters: string, term: string, allowSuffix: boolean): boolean {
  const c = collapseRepeats(letters)
  if (allow.has(c)) return false
  const forms = allowSuffix ? [term, ...TERM_SUFFIXES.map((s) => term + s)] : [term]
  return forms.some((f) => letters.length >= f.length && c === collapseRepeats(f))
}

// Finds listed terms. Returns the worst severity and the spans to mask
export function scanTerms(text: string): { severity: "refuse" | "mask" | null; spans: [number, number][] } {
  const ws = words(text)
  const spans: [number, number][] = []
  let severity: "refuse" | "mask" | null = null
  for (let i = 0; i < ws.length; i++) {
    for (const term of TERMS) {
      const n = term.words.length
      if (i + n > ws.length) continue
      let hit = true
      for (let k = 0; k < n && hit; k++) hit = wordMatches(ws[i + k]!.letters, term.words[k]!, k === n - 1)
      if (!hit) continue
      if (term.severity === "refuse") severity = "refuse"
      else if (!severity) severity = "mask"
      spans.push([ws[i]!.start, ws[i + n - 1]!.end])
    }
  }
  return { severity, spans }
}

// Keeps the first character of each span and stars the rest. Spaces stay
export function mask(text: string, spans: [number, number][]): string {
  // Spans are UTF-16 offsets, so work on code units
  const out = text.split("")
  for (const [start, end] of spans) {
    let first = true
    for (let i = start; i < end; i++) {
      if (/\s/.test(out[i]!)) continue
      if (first) {
        first = false
        continue
      }
      out[i] = "*"
    }
  }
  return out.join("")
}

// Links

const TLDS =
  "com|net|org|gg|io|co|uk|de|fr|eu|ru|su|ua|pl|nl|be|es|it|se|no|dk|fi|cz|tr|br|cn|jp|kr|in|us|ca|au|me|tv|cc|ly|to|xyz|info|biz|link|site|online|shop|store|top|click|club|live|pro|app|dev|fun|win|bet|vip|icu|cyou|pw|ws|gift|trade|market|team|games?"
const SCHEME_URL = /\b([a-z][a-z0-9+.-]{1,20}):\/\/([^\s/?#]+)([^\s]*)/gi
const BARE_URL = new RegExp(`(?<![@\\w.-])((?:[a-z0-9-]+\\.)+(?:${TLDS}))(?![\\w-])(\\/[^\\s]*)?`, "gi")
const PSEUDO_SCHEME = /\b(javascript|data|vbscript|file):/i

// userinfo is set for user@host links, which hide the real host behind a familiar name
type Link = { scheme: string | null; host: string; path: string; userinfo?: boolean }

export function findLinks(text: string): Link[] {
  const links: Link[] = []
  const covered: [number, number][] = []
  for (const m of text.matchAll(SCHEME_URL)) {
    // user@host sends the browser to host
    const authority = m[2]!
    const host = authority.split("@").pop()!.split(":")[0]!.toLowerCase()
    links.push({ scheme: m[1]!.toLowerCase(), host, path: m[3] ?? "", userinfo: authority.includes("@") })
    covered.push([m.index, m.index + m[0].length])
  }
  for (const m of text.matchAll(BARE_URL)) {
    if (covered.some(([s, e]) => m.index >= s && m.index < e)) continue
    links.push({ scheme: null, host: m[1]!.toLowerCase(), path: m[2] ?? "" })
  }
  return links
}

// Host letters with leetspeak and lookalikes read as plain letters, dots and dashes removed
function hostSkeleton(host: string): string {
  return [...fold(host)]
    .map((c) => LEET[c] ?? c)
    .join("")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/[^a-z0-9]/g, "")
}

const isOfficialSteam = (host: string) => STEAM_OFFICIAL_HOSTS.some((o) => host === o || host.endsWith(`.${o}`))

export function linkVerdict(link: Link): "ok" | "chat_invite_link" | "chat_scam_link" | "chat_link_not_allowed" {
  if (link.scheme && link.scheme !== "http" && link.scheme !== "https") return "chat_link_not_allowed"
  const host = link.host.replace(/^www\./, "")
  const hostPath = `${host}${link.path}`.toLowerCase()
  if (INVITE_HOST_PATTERNS.some((p) => p.test(host)) || INVITE_PATH_PATTERNS.some((p) => p.test(hostPath))) return "chat_invite_link"
  if (link.userinfo) return "chat_scam_link"
  if (isOfficialSteam(host)) return "ok"
  // Punycode hosts are where lookalike letters hide
  if (host.includes("xn--")) return "chat_scam_link"
  const skeleton = hostSkeleton(host)
  if (skeleton.includes("steam")) return "chat_scam_link"
  if (SCAM_HOST_PATTERNS.some((p) => p.test(skeleton))) return "chat_scam_link"
  return "ok"
}

const MESSAGES: Record<string, string> = {
  chat_link_not_allowed: "Only http and https links are allowed.",
  chat_invite_link: "Invite links to other communities are not allowed.",
  chat_scam_link: "That link looks like a scam site and was blocked.",
  chat_too_many_links: `At most ${CHAT_LIMITS.maxLinks} link per message.`,
  chat_too_many_mentions: `At most ${CHAT_LIMITS.maxMentions} mentions per message.`,
  chat_shouting: "Please do not post in all caps.",
  chat_blocked_language: "That message breaks the chat rules.",
}

const refuse = (code: ChatErrorCode, rule: string): FilterResult => ({ ok: false, code, message: MESSAGES[code] ?? code, rule })

// Runs every content rule on one message. Refusals come before masking
export function filterMessage(text: string): FilterResult {
  if (PSEUDO_SCHEME.test(text)) return refuse("chat_link_not_allowed", "pseudo_scheme")
  const links = findLinks(text)
  for (const link of links) {
    const verdict = linkVerdict(link)
    if (verdict !== "ok") return refuse(verdict, link.host)
  }
  if (links.length > CHAT_LIMITS.maxLinks) return refuse("chat_too_many_links", String(links.length))

  const mentions = text.match(/(?:^|\s)@[\p{L}\p{N}_.-]{2,}/gu)?.length ?? 0
  if (mentions > CHAT_LIMITS.maxMentions) return refuse("chat_too_many_mentions", String(mentions))

  const prose = text.replace(SCHEME_URL, " ").replace(BARE_URL, " ")
  const letters = prose.match(/\p{L}/gu)?.length ?? 0
  const upper = prose.match(/\p{Lu}/gu)?.length ?? 0
  if (letters >= CHAT_LIMITS.caps.minLetters && upper / letters >= CHAT_LIMITS.caps.maxUpperShare) return refuse("chat_shouting", "caps")

  const { severity, spans } = scanTerms(text)
  if (severity === "refuse") return refuse("chat_blocked_language", "refuse_term")
  if (severity === "mask") return { ok: true, body: mask(text, spans), masked: true }
  return { ok: true, body: text, masked: false }
}

// Comparable form for the duplicate guard
export function fingerprint(text: string): string {
  return collapseRepeats(fold(text).replace(/[^\p{L}\p{N}]+/gu, ""))
}

// 0 to 1, where 1 is identical
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  const longest = Math.max(a.length, b.length)
  if (longest === 0) return 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return 1 - prev[b.length]! / longest
}
