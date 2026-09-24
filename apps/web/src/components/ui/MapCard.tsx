import { MapThumb } from "@/components/play/MapThumb";
import { cx } from "./cx";
import styles from "./MapCard.module.css";

// taken is a room already played on an earlier map of a series. Out of the pool, but not banned
export type MapCardState = "available" | "banned" | "picked" | "decider" | "taken";

// One member of the acting team who voted for this map, shown as a dot
export type MapCardVoter = {
  steamId: string;
  name: string;
  me?: boolean;
};

type MapCardProps = {
  mapId: string;
  name: string;
  // Image in place of the map preview, like a Rush room screenshot
  imageSrc?: string | null;
  // Stamp text in place of the state name, like "Left over"
  stampLabel?: string;
  state?: MapCardState;
  // Current viewer voted for this map
  voted?: boolean;
  // Votes from the acting team for the current step. Used when voters is not given
  votes?: number;
  // Who in the acting team voted for this map
  voters?: MapCardVoter[];
  // Size of the acting team, for "2 of 3 teammates voted"
  voterTotal?: number;
  // Whose votes these are. Own team purple, opponents amber
  voterSide?: "own" | "enemy";
  // Team that banned or picked the map, like "Team B"
  by?: { label: string; side: "own" | "enemy" };
  // Short note under the name
  note?: string;
  // Makes the card a button
  onSelect?: () => void;
  disabled?: boolean;
  actionLabel?: string;
  // Small tag after the name, like "auto" for a timed out ban
  tag?: string;
};

const STAMP: Record<Exclude<MapCardState, "available">, string> = {
  banned: "Banned",
  picked: "Picked",
  decider: "Decider",
  taken: "Taken",
};

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

export function MapCard({
  mapId,
  name,
  imageSrc,
  stampLabel,
  state = "available",
  voted,
  votes,
  voters,
  voterTotal,
  voterSide = "own",
  by,
  note,
  onSelect,
  disabled,
  actionLabel = "Ban",
  tag,
}: MapCardProps) {
  const count = voters ? voters.length : (votes ?? 0);
  const who = voterSide === "own" ? "teammates" : "opponents";
  // A team of one needs no count, "Your vote" says it all
  const voteText =
    state !== "available" || count === 0 || voterTotal === 1
      ? null
      : voterTotal
        ? `${count} of ${voterTotal} ${who} voted`
        : `${count} ${count === 1 ? "vote" : "votes"}`;
  const stamp = state === "available" ? null : (stampLabel ?? STAMP[state]);
  // What choosing this card does. Shown on hover and focus, and kept once the viewer has voted
  const intent = onSelect && state === "available" ? (actionLabel.toLowerCase() === "pick" ? "pick" : "ban") : null;

  const body = (
    <>
      <span className={styles.art}>
        <MapThumb mapId={mapId} src={imageSrc} className={styles.thumb} />
        {stamp && (
          <span className={cx(styles.stamp, styles[`stamp_${state}`])} aria-hidden="true">
            {stamp}
          </span>
        )}
        {intent && (
          <span className={cx(styles.intent, intent === "pick" ? styles.intentPick : styles.intentBan)} aria-hidden="true">
            {actionLabel}
          </span>
        )}
      </span>
      <span className={styles.info}>
        <span className={styles.top}>
          <span className={cx(styles.name, "mono")}>{name}</span>
          {tag && <span className={cx(styles.tag, "mono")}>{tag}</span>}
        </span>

        {stamp && (
          <span className={styles.status}>
            <span className={cx(styles.stateLabel, styles[`label_${state}`])}>{stamp}</span>
            {by && <span className={cx(styles.by, by.side === "own" ? styles.sideOwn : styles.sideEnemy)}>by {by.label}</span>}
            {!by && !note && state === "decider" && <span className={styles.note}>Map to play</span>}
          </span>
        )}
        {note && <span className={styles.note}>{note}</span>}

        {state === "available" && (voted || count > 0) && (
          <span className={styles.voteRow}>
            {voters && voters.length > 0 && (
              <span className={styles.dots} aria-hidden="true">
                {voters.map((v) => (
                  <span
                    key={v.steamId}
                    className={cx(styles.dot, voterSide === "own" ? styles.dotOwn : styles.dotEnemy, v.me && styles.dotMe)}
                    title={v.me ? "Your vote" : v.name}
                  >
                    {initial(v.name)}
                  </span>
                ))}
              </span>
            )}
            {!voters && count > 0 && (
              <span className={cx(styles.count, "mono")} aria-hidden="true">
                {count}
              </span>
            )}
            <span className={styles.voteText}>
              {voted && <span className={styles.yourVote}>Your vote</span>}
              {voteText && <span className={styles.note}>{voteText}</span>}
            </span>
          </span>
        )}
      </span>
    </>
  );

  const cls = cx(
    "glass",
    styles.card,
    styles[state],
    voted && styles.voted,
    onSelect && !disabled && styles.interactive,
    intent === "pick" ? styles.actPick : intent === "ban" ? styles.actBan : null,
  );
  if (onSelect) {
    const others = voters?.filter((v) => !v.me).map((v) => v.name) ?? [];
    const label = [`${actionLabel} ${name}`, voted ? "your vote" : null, voteText, others.length ? `voted by ${others.join(", ")}` : null]
      .filter(Boolean)
      .join(", ");
    return (
      <button type="button" className={cls} data-enter="off" onClick={onSelect} disabled={disabled} aria-pressed={!!voted} aria-label={label} data-map={mapId}>
        {body}
      </button>
    );
  }
  return (
    <div className={cls} data-enter="off" data-map={mapId}>
      {body}
    </div>
  );
}
