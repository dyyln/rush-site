"use client";

import { AvatarStack } from "@/components/tournaments/AvatarStack";
import { bracketPath } from "@/components/tournaments/bracketPath";
import { Avatar } from "@/components/ui/Avatar";
import { entryName, entryPlayers, roundName } from "@/components/ui/BracketView";
import { TeamCard } from "@/components/ui/TeamCard";
import { TierChip } from "@/components/ui/TierChip";
import { cx } from "@/components/ui/cx";
import type { Bracket, EntryView } from "@/lib/types";
import styles from "./EntrantList.module.css";

type Standing = "champion" | "runnerUp" | "playing" | "alive" | "out" | "dq" | "none";
type Row = { entry: EntryView; standing: Standing; label: string; reached: number };

// Open slots drawn in full up to this many, then one tile counts the rest
const OPEN_SLOTS_SHOWN = 8;

const joinedFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

// How far each entry got. Champion first, then by the round reached, still in before knocked out, then seed
function standings(bracket: Bracket, entries: EntryView[]): Row[] {
  const rows = entries.map((entry): Row => {
    if (entry.disqualified) return { entry, standing: "dq", label: "Disqualified", reached: -1 };
    const path = bracketPath(bracket, entry.id);
    if (!path) return { entry, standing: "none", label: "Not in the bracket", reached: -2 };
    const name = (r: number) => roundName(r, bracket.rounds).toLowerCase();
    if (path.outcome === "champion") return { entry, standing: "champion", label: "Champion", reached: bracket.rounds + 1 };
    if (path.outcome === "eliminated") {
      return path.round === bracket.rounds
        ? { entry, standing: "runnerUp", label: "Runner-up", reached: path.round }
        : { entry, standing: "out", label: `Out in ${name(path.round)}`, reached: path.round };
    }
    const next = bracket.matches.find((m) => m.id === path.nextId);
    const round = next?.round ?? path.round;
    return next?.status === "live"
      ? { entry, standing: "playing", label: `Playing ${name(round)}`, reached: round + 0.5 }
      : { entry, standing: "alive", label: `In ${name(round)}`, reached: round + 0.5 };
  });
  return rows.sort((a, b) => b.reached - a.reached || (a.entry.seed ?? 999) - (b.entry.seed ?? 999));
}

type Props = {
  entries: EntryView[];
  bracket: Bracket | null | undefined;
  maxEntrants: number;
  // Sign ups still open: sign up order, join times and the open slots
  signups: boolean;
  myEntryId?: string | null;
  // Hovered or focused entry, whose route the bracket traces
  onTrace?: (entryId: string | null) => void;
};

export function EntrantList({ entries, bracket, maxEntrants, signups, myEntryId, onTrace }: Props) {
  const rows: Row[] = bracket
    ? standings(bracket, entries)
    : [...entries]
        .sort((a, b) => a.registeredAt.localeCompare(b.registeredAt))
        .map((entry) => ({ entry, standing: entry.disqualified ? "dq" : "none", label: entry.disqualified ? "Disqualified" : "", reached: 0 }));
  const open = signups ? Math.max(0, maxEntrants - entries.length) : 0;
  const drawn = open > OPEN_SLOTS_SHOWN ? OPEN_SLOTS_SHOWN - 1 : open;

  return (
    <ol className={styles.list}>
      {rows.map(({ entry: e, standing, label }, i) => {
        const players = entryPlayers(e);
        const name = entryName(e);
        const joined = Date.parse(e.registeredAt);
        const trace = bracket && onTrace ? () => onTrace(e.id) : undefined;
        return (
          <li
            key={e.id}
            className={cx("glass", styles.row, e.id === myEntryId && styles.me)}
            data-standing={standing}
            onMouseEnter={trace}
            onMouseLeave={trace && (() => onTrace!(null))}
            onFocus={trace}
            onBlur={trace && (() => onTrace!(null))}
          >
            <span className={cx("mono", styles.num)}>
              {signups || !bracket ? i + 1 : (e.seed ?? "")}
              <span className="visually-hidden">{signups || !bracket ? ". " : e.seed ? `, seed ${e.seed}. ` : ""}</span>
            </span>
            {players.length > 1 ? (
              <AvatarStack people={players} total={players.length} max={3} noun={["player", "players"]} />
            ) : (
              <Avatar name={name} src={players[0]?.avatarUrl ?? null} size="sm" />
            )}
            <TeamCard title={name} players={players} meanRating={e.rating} className={styles.trigger}>
              <span className={styles.name}>{name}</span>
            </TeamCard>
            <span className={styles.tier}>
              {e.rating !== null ? <TierChip rating={e.rating} size="sm" link={false} /> : <TierChip unranked size="sm" link={false} />}
            </span>
            <span className={styles.status}>
              {signups && !e.disqualified && !Number.isNaN(joined) ? (
                <>
                  <span className="visually-hidden">Joined </span>
                  <span className="mono">{joinedFmt.format(joined)}</span>
                </>
              ) : (
                label
              )}
            </span>
          </li>
        );
      })}
      {Array.from({ length: drawn }, (_, i) => (
        <li key={`open-${i}`} className={cx(styles.row, styles.open)}>
          <span className={cx("mono", styles.num)}>{entries.length + i + 1}</span>
          <span>Open slot</span>
        </li>
      ))}
      {open > drawn && (
        <li className={cx(styles.row, styles.open)}>
          <span className={cx("mono", styles.num)} aria-hidden="true">
            +
          </span>
          <span>
            {open - drawn} more open {open - drawn === 1 ? "slot" : "slots"}
          </span>
        </li>
      )}
    </ol>
  );
}
