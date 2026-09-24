// Seed lists for the chat filter. Add new entries here, one per line, in lower case plain spelling.
// The filter normalises case, leetspeak, repeated letters and spacing, so variants need no entries.
// A term matches whole words only, plus the suffixes in TERM_SUFFIXES. A phrase is several words.

// Slurs, hate terms and self-harm abuse. A message containing one is refused
export const REFUSE_TERMS: readonly string[] = [
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "tranny",
  "chink",
  "gook",
  "kike",
  "spic",
  "wetback",
  "coon",
  "paki",
  "kys",
  "kill yourself",
  "heil hitler",
  "sieg heil",
]

// General profanity. Masked to its first letter, for example f***
export const MASK_TERMS: readonly string[] = [
  "fuck",
  "motherfuck",
  "shit",
  "bullshit",
  "bitch",
  "cunt",
  "asshole",
  "arsehole",
  "bastard",
  "dick",
  "cock",
  "pussy",
  "whore",
  "slut",
  "wanker",
  "twat",
  "prick",
]

// Endings that still count as the term, such as fucking or bitches
export const TERM_SUFFIXES: readonly string[] = ["s", "es", "ed", "er", "ers", "ing", "y", "ies", "head", "heads"]

// Ordinary words that normalise onto a term. Compared after normalisation
export const ALLOW_WORDS: readonly string[] = [
  "niger",
  "nigeria",
  "cocky",
  "dicky",
  "pricky",
  "coony",
  "spicy",
  "scunthorpe",
  "shitake",
  "dickens",
]

// Official Steam hosts and well known Steam tools. Any other host that reads as steam is treated as a phishing lookalike
export const STEAM_OFFICIAL_HOSTS: readonly string[] = [
  "steampowered.com",
  "steamcommunity.com",
  "steamstatic.com",
  "steamgames.com",
  "steamdeck.com",
  "s.team",
  "steamdb.info",
  "steamcharts.com",
]

// Host fragments of fake skin, trade and giveaway sites, matched after normalisation
export const SCAM_HOST_PATTERNS: readonly RegExp[] = [
  /(skin|knife|case|item|trade|csgo|cs2).*(free|gift|drop|giveaway|bonus|claim|reward)/,
  /(free|gift|drop|giveaway|bonus|claim|reward).*(skin|knife|case|item|csgo|cs2)/,
  /(csgo|cs2)(trade|skins?|drop|case|market)/,
  /st[e3]a?m.?(com+un|gift|trade|login|verify|auth)/,
]

// Invite links for other communities. Refused as spam
export const INVITE_HOST_PATTERNS: readonly RegExp[] = [
  /^(www\.)?discord\.(gg|io|me|li)$/,
  /^(www\.)?(t|telegram)\.me$/,
  /^chat\.whatsapp\.com$/,
]

// Paths on otherwise normal hosts that are invites
export const INVITE_PATH_PATTERNS: readonly RegExp[] = [/^discord(app)?\.com\/invite\//, /^steamcommunity\.com\/groups\//]
