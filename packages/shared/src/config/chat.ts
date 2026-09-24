// Chat posting limits. The api enforces them and the web shows the matching messages.
export const CHAT_LIMITS = {
  // Posts per user in a fixed window, across every channel
  rate: { max: 5, windowSec: 10 },
  // Going over the rate starts a cooldown. Each repeat takes the next step, the last step repeats
  cooldownStepsSec: [30, 120, 600],
  // Strikes are forgotten after this long without hitting the limit
  strikeResetSec: 60 * 60,
  // The same or nearly the same text from one user inside this window is refused
  duplicateWindowSec: 30,
  // 0 to 1. Share of characters that must match for two messages to count as the same
  duplicateSimilarity: 0.8,
  // Links per message. Only http and https are allowed
  maxLinks: 1,
  maxMentions: 3,
  // Shouting is refused when a message has at least minLetters letters and this share is upper case
  caps: { minLetters: 12, maxUpperShare: 0.7 },
} as const

// Feature flag that turns on a global slow mode. The value is { seconds } and admins are exempt
export const CHAT_SLOW_MODE_FLAG = "chat.slow_mode"
export const CHAT_SLOW_MODE_DEFAULT_SEC = 10

// Error codes a refused post can carry. Timed ones include details.retryAfterSec
export const CHAT_ERROR_CODES = [
  "chat_muted",
  "chat_rate_limited",
  "chat_slow_mode",
  "chat_duplicate",
  "chat_too_many_links",
  "chat_link_not_allowed",
  "chat_scam_link",
  "chat_invite_link",
  "chat_too_many_mentions",
  "chat_shouting",
  "chat_blocked_language",
] as const
export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number]
