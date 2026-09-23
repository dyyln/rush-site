import Link from "next/link";
import type { Presence, PresenceDetail } from "@rushsite/shared";
import { mapName, modeLabel, MODE_COPY } from "@/lib/modes";
import styles from "./friends.module.css";

export const PRESENCE_LABEL: Record<Presence, string> = {
  online: "Online",
  queue: "In queue",
  match: "In match",
  offline: "Offline",
};

export const PRESENCE_ORDER: Record<Presence, number> = { online: 0, queue: 1, match: 2, offline: 3 };

// Friends on the site now (online, queue or match) first, then offline friends. Names sort within each group
export function sortByPresence<T extends { presence: Presence; displayName: string }>(list: readonly T[]): T[] {
  const group = (p: Presence) => (p === "offline" ? 1 : 0);
  return [...list].sort(
    (a, b) => group(a.presence) - group(b.presence) || a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
  );
}

// Case-insensitive name match. A pasted SteamID64 matches too
export function matchesQuery(p: { displayName: string; steamId: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || p.displayName.toLowerCase().includes(q) || p.steamId.includes(q);
}

// Rush always plays on Complex, so it reads well before the map is set
function mapLabel(d: PresenceDetail): string | null {
  if (!d.mode) return null;
  if (d.mode === "rush3v3") return mapName("rush3v3", d.mapId ?? "rush_001");
  return d.mapId ? mapName(d.mode, d.mapId) : null;
}

// One line under a friend's name. A live match gets its score and a Watch link
export function PresenceLine({ presence, detail }: { presence: Presence; detail?: PresenceDetail }) {
  if (presence === "match" && detail?.mode) {
    const map = mapLabel(detail);
    const parts = [modeLabel(detail.mode), map].filter(Boolean).join(" · ");
    return (
      <span className={styles.presenceLine}>
        <span className={styles.presenceText}>
          {parts}
          {detail.score && (
            <>
              {" · "}
              <span className="mono">
                {detail.score[0]}–{detail.score[1]}
              </span>
            </>
          )}
        </span>
        {detail.matchId && (
          <Link href={`/matches/${detail.matchId}`} className={styles.watch}>
            Watch<span className="visually-hidden"> match</span>
          </Link>
        )}
      </span>
    );
  }
  if (presence === "queue" && detail?.modes?.length) {
    return (
      <span className={styles.presenceLine}>
        <span className={styles.presenceText}>Queue: {detail.modes.map((m) => MODE_COPY[m].label).join(", ")}</span>
      </span>
    );
  }
  return (
    <span className={styles.presenceLine}>
      <span className={styles.presenceText}>{PRESENCE_LABEL[presence]}</span>
    </span>
  );
}

// Avatar initials or image with a presence dot. Colour is backed by the text line and a hidden label
export function PresenceAvatar({ name, src, presence }: { name: string; src: string | null; presence: Presence }) {
  const initials = name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
  return (
    <span className={styles.avatar}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className={styles.avatarImg} />
      ) : (
        <span className={styles.initials} aria-hidden="true">
          {initials}
        </span>
      )}
      <span className={`${styles.dot} ${styles[presence]}`}>
        <span className="visually-hidden">{PRESENCE_LABEL[presence]}</span>
      </span>
    </span>
  );
}

export function friendError(e: unknown): string {
  const code = (e as { code?: string }).code;
  const MESSAGES: Record<string, string> = {
    cannot_add_self: "You cannot add yourself.",
    user_not_found: "That player has not signed in here yet.",
    already_friends: "You are already friends.",
    too_many_requests: "You have too many pending requests.",
    request_not_pending: "That request was already answered.",
    not_friends: "Only friends can be invited.",
    party_full: "The party is full.",
    already_in_party: "They are already in your party.",
    invite_expired: "This invite has expired.",
    party_gone: "That party no longer exists.",
    invite_not_pending: "This invite was already answered.",
  };
  if (code && MESSAGES[code]) return MESSAGES[code]!;
  return e instanceof Error ? e.message : "Something went wrong";
}
