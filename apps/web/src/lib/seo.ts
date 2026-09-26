import {
  AIM_MAPS,
  BRAND_NAME,
  isRushMode,
  LEADERBOARD_MIN_MATCHES,
  MODES,
  RUSH_MAP,
  RUSH_ROOMS,
  RUSH_RULES,
  type Mode,
  type PublicMap,
} from "@rushsite/shared";
import { apiUrl } from "./env";
import { MODE_ART, MODE_COPY } from "./modes";

// Server only helpers for the public mode and map pages

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3107").replace(/\/$/, "");

// Pages are rebuilt at most this often, so a map an admin adds shows up without a deploy
export const GUIDE_REVALIDATE_SEC = 3600;

export type FaqItem = { q: string; a: string };

export type ModePage = {
  slug: string;
  mode: Mode;
  // Page title, kept under 60 characters with the brand suffix
  title: string;
  description: string;
  heading: string;
  lede: string;
  intro: string[];
  rules: { label: string; value: string }[];
  faq: FaqItem[];
};

const ACCEPT_SEC = 20;

export const MODE_PAGES: ModePage[] = [
  {
    slug: "rush",
    mode: "rush3v3",
    title: "CS2 Rush 3v3 Matchmaking",
    description: `Play CS2 Rush 3v3 on dedicated servers. Solo queue or bring a party of up to three, earn a Rush rating and enter free Rush cups on ${BRAND_NAME}.`,
    heading: "3v3 Rush",
    lede: "Valve's Rush mode on the Complex map, with a real ladder behind it.",
    intro: [
      "Rush is a 3v3 mode where both teams fight through a chain of arenas inside one map, Complex. Each round is played in a single room. Win it and the fight moves one room closer to the enemy castle.",
      `${BRAND_NAME} runs Rush on its own dedicated servers with Valve's rules untouched. Queue alone or with up to two friends, and the matchmaker fills your team from the solo queue.`,
    ],
    rules: [
      { label: "Teams", value: "3 vs 3, parties of 1 to 3" },
      { label: "Map", value: `${RUSH_MAP.displayName} (${RUSH_MAP.id})` },
      { label: "Win", value: `${RUSH_RULES.roundsToWin} rounds, or a round won in the enemy castle` },
      { label: "Length", value: `At most ${RUSH_RULES.maxRounds} rounds` },
      { label: "Arenas", value: `${RUSH_RULES.roomSlots} room slots, drawn from ${RUSH_ROOMS.startRooms.length} start and ${RUSH_ROOMS.midRooms.length} mid rooms` },
      { label: "Rating", value: "Its own Rush rating and leaderboard" },
    ],
    faq: [
      {
        q: "How does a Rush round work?",
        a: "Eliminate the enemy team or hold the tower when time runs out to win the round. The next round moves one room toward the losing team's castle.",
      },
      {
        q: "How do you win a Rush match?",
        a: `Win ${RUSH_RULES.roundsToWin} rounds, or win a round inside the enemy castle. A match lasts at most ${RUSH_RULES.maxRounds} rounds, and the Convoy room decides it at 7 to 7.`,
      },
      {
        q: "Can I pick the Rush arenas?",
        a: "No. The Complex map draws its rooms when it loads, the same way Valve's own matchmaking does, so there is no veto in Rush.",
      },
      {
        q: "Do I need a full team?",
        a: "No. Queue alone, as a duo or as a trio. Missing spots are filled from the solo queue.",
      },
    ],
  },
  {
    slug: "1v1-aim",
    mode: "aim1v1",
    title: "CS2 1v1 Aim Duels, Ranked",
    description: `Ranked 1v1 aim duels for CS2 on classic aim maps. Queue, ban maps, play first to 13 on a dedicated server and climb the 1v1 ladder on ${BRAND_NAME}.`,
    heading: "1v1 Aim",
    lede: "Just you, your crosshair and one opponent.",
    intro: [
      "1v1 Aim is the purest test on the site. Two players, one aim map, first to 13 rounds. No utility, no teammates to blame.",
      `The matchmaker pairs you with a player near your rating. Each of you bans maps on the website, a server starts, and the result moves your 1v1 rating the moment the match ends.`,
    ],
    rules: [
      { label: "Players", value: "1 vs 1" },
      { label: "Win", value: "First to 13 rounds" },
      { label: "Maps", value: `${AIM_MAPS.length} aim maps, picked by veto` },
      { label: "Accept", value: `${ACCEPT_SEC} seconds to accept a found match` },
      { label: "Rating", value: "Its own 1v1 rating and leaderboard" },
    ],
    faq: [
      {
        q: "How are maps chosen?",
        a: "Both players ban maps on the website before the server starts. The last map standing is played.",
      },
      {
        q: "How is rating calculated?",
        a: "Every mode has its own Glicko-2 rating. It shows from your first match and moves after every result, more when the result is a surprise.",
      },
      {
        q: "What happens if I do not accept or never join?",
        a: `Missing the ${ACCEPT_SEC} second accept gives a short queue cooldown. Not joining the server forfeits the match and loses rating.`,
      },
    ],
  },
  {
    slug: "2v2-aim",
    mode: "aim2v2",
    title: "CS2 2v2 Aim Matchmaking",
    description: `Ranked 2v2 aim matches for CS2. Queue with a duo or solo with an auto-filled teammate, play first to 13 on aim maps and climb the 2v2 ladder on ${BRAND_NAME}.`,
    heading: "2v2 Aim",
    lede: "Aim duels with a partner, where trades and timing matter.",
    intro: [
      "2v2 Aim takes the aim maps and adds a teammate. Trading kills and peeking together wins rounds that raw aim alone would lose.",
      "Bring a duo or queue alone and the matchmaker finds you a teammate near your rating. Parties prefer parties and solos prefer solos, mixing only when the queue runs long.",
    ],
    rules: [
      { label: "Players", value: "2 vs 2, duo or solo" },
      { label: "Win", value: "First to 13 rounds" },
      { label: "Maps", value: `${AIM_MAPS.length} aim maps, picked by team veto` },
      { label: "Accept", value: `${ACCEPT_SEC} seconds to accept a found match` },
      { label: "Rating", value: "Its own 2v2 rating and leaderboard" },
    ],
    faq: [
      {
        q: "Can I queue 2v2 alone?",
        a: "Yes. A solo player is matched with a teammate from the solo queue.",
      },
      {
        q: "How does the team veto work?",
        a: "Each ban is a vote. Both teammates vote, the majority wins and a tie is settled at random.",
      },
      {
        q: "Does my duo partner share my rating?",
        a: "No. Each player has their own 2v2 rating, and the team's average is used for matching.",
      },
    ],
  },
];

export function modePage(slug: string): ModePage | undefined {
  return MODE_PAGES.find((p) => p.slug === slug);
}

export function modePath(mode: Mode): string | null {
  const p = MODE_PAGES.find((x) => x.mode === mode);
  return p ? `/modes/${p.slug}` : null;
}

export { MODE_ART, MODE_COPY };

// Hand written map notes. Maps an admin adds later get the generic line
const MAP_NOTES: Record<string, string> = {
  aim_map: "The original aim map, rebuilt for CS2. A small symmetric arena where rifle duels come down to crosshair placement.",
  aim_redline: "A modern aim arena in the ranked pool. Short rounds, clean duels and nowhere to hide for long.",
  aim_ag_texture2: "A CS2 take on the old texture aim maps. Simple cover and open ground keep every round a straight duel.",
  aim_usp: "A pistol aim map built around the USP-S, where first bullet accuracy beats spraying.",
  aim_deagle7k: "A Deagle aim map. One clean shot wins the duel, so a steady crosshair beats a fast flick.",
  awp_india: "An AWP duel map. Holds, quick scopes and repeeks against one shot kills.",
  [RUSH_MAP.id]:
    "The Rush map. Complex packs every Rush arena into one map, and the fight moves to a new room each round.",
};

export function mapNote(m: Pick<PublicMap, "id" | "displayName">): string {
  return MAP_NOTES[m.id] ?? `${m.displayName} is in the ${BRAND_NAME} aim map pool for ranked duels.`;
}

const LOCAL_ART = new Set([...AIM_MAPS.map((m) => m.id)]);

export function mapImage(m: Pick<PublicMap, "id" | "previewUrl">): string | null {
  if (m.id === RUSH_MAP.id) return "/backdrops/rush_001_2.webp";
  if (m.previewUrl) return m.previewUrl;
  return LOCAL_ART.has(m.id) ? `/maps/${m.id}.webp` : null;
}

export function workshopUrl(workshopId: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`;
}

function fallbackMaps(): PublicMap[] {
  const aimModes = MODES.filter((m) => !isRushMode(m) && m.startsWith("aim"));
  return [
    ...AIM_MAPS.map((m) => ({ id: m.id, displayName: m.displayName, modes: aimModes, previewUrl: null, workshopId: m.workshopId ?? null })),
    { id: RUSH_MAP.id, displayName: RUSH_MAP.displayName, modes: MODES.filter(isRushMode), previewUrl: null, workshopId: null },
  ];
}

// Maps in play right now. Falls back to the shared config when the api is unreachable, for example during a build
export async function playableMaps(): Promise<PublicMap[]> {
  try {
    const res = await fetch(`${apiUrl}/maps`, { next: { revalidate: GUIDE_REVALIDATE_SEC }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(String(res.status));
    const maps = ((await res.json()) as { maps: PublicMap[] }).maps;
    return maps.filter((m) => m.modes.length > 0);
  } catch {
    return fallbackMaps();
  }
}

// Ranked modes a map is played in, test queues left out
export function rankedModesOf(m: Pick<PublicMap, "modes">): Mode[] {
  return MODES.filter((mode) => m.modes.includes(mode) && modePath(mode) !== null);
}

export type TopPlayer = { rank: number; steamId: string; displayName: string; rating: number; tier: string; matches: number };

// Top of a mode's ladder, empty when the api is unreachable
export async function topPlayers(mode: Mode, limit = 5): Promise<TopPlayer[]> {
  try {
    const res = await fetch(`${apiUrl}/leaderboard/${mode}?limit=${limit}`, { next: { revalidate: 600 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    return ((await res.json()) as { rows: TopPlayer[] }).rows;
  } catch {
    return [];
  }
}

export { LEADERBOARD_MIN_MATCHES };

// Structured data for search results
export function breadcrumbs(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: `${SITE_URL}${it.path}` })),
  };
}

export function faqSchema(faq: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}
