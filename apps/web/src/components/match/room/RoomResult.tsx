"use client";

import { TIERS, type MatchResultPayload } from "@rushsite/shared";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TierChip } from "@/components/ui/TierChip";
import { signed } from "@/lib/format";
import type { MatchDetail } from "@/lib/types";
import styles from "./Room.module.css";

type Outcome = "won" | "lost" | "draw" | "abandoned" | "finished";

const TIER_NAME = Object.fromEntries(TIERS.map((t) => [t.id, t.displayName])) as Record<string, string>;
const TIER_ORDER = TIERS.map((t) => t.id as string);

// Winner from the live result when this tab saw it, otherwise from the final score
function winnerOf(m: MatchDetail, result: MatchResultPayload | null): string | null {
  if (result) return result.winnerTeam && result.winnerTeam !== "draw" ? result.winnerTeam : null;
  const [a, b] = m.teams;
  if (!a || !b || a.score === b.score) return null;
  return a.score > b.score ? a.name : b.name;
}

export function roomOutcome(m: MatchDetail, result: MatchResultPayload | null, viewer: string | null): Outcome {
  const mine = m.teams.find((t) => t.players.some((p) => p.steamId === viewer))?.name;
  const winner = winnerOf(m, result);
  if (m.status === "abandoned" || result?.status === "abandoned") {
    if (!mine || !winner) return "abandoned";
    return mine === winner ? "won" : "lost";
  }
  if (!winner) return m.teams.length === 2 ? "draw" : "finished";
  if (!mine) return "finished";
  return mine === winner ? "won" : "lost";
}

const HEADLINE: Record<Outcome, string> = {
  won: "You won",
  lost: "You lost",
  draw: "Draw",
  abandoned: "Match abandoned",
  finished: "Match finished",
};

export function RoomResult({ m, result, viewer }: { m: MatchDetail; result: MatchResultPayload | null; viewer: string | null }) {
  const participant = !!viewer && m.teams.some((t) => t.players.some((p) => p.steamId === viewer));
  const outcome = roomOutcome(m, result, participant ? viewer : null);
  const change = result?.ratingChanges.find((c) => c.steamId === viewer);
  const delta = change ? change.after - change.before : viewer ? m.ratingDeltas?.[viewer] : undefined;
  const tierMove = change && change.tierBefore !== change.tierAfter ? tierChange(change.tierBefore, change.tierAfter) : null;
  const winner = winnerOf(m, result);
  const winnerLabel = m.teams.find((t) => t.name === winner);

  return (
    <Card tone="raised" as="div">
      <section className={styles.result} data-outcome={outcome} aria-labelledby="result-heading" role="status">
        <h2 id="result-heading" className={styles.headline}>
          {participant ? HEADLINE[outcome] : winnerLabel ? `${winnerLabel.displayName ?? winnerLabel.name} won` : HEADLINE[outcome]}
        </h2>
        {outcome === "abandoned" && <p className="muted">Someone left or never joined. The player list shows who forfeited.</p>}
        {participant && delta !== undefined && delta !== 0 && (
          <p className={styles.ratingLine}>
            <span className="muted">Rating</span>
            {change && (
              <>
                <span className="mono">{Math.round(change.before)}</span>
                <span aria-hidden="true">to</span>
                <TierChip tier={change.tierAfter} rating={Math.round(change.after)} size="sm" link={false} />
              </>
            )}
            <span className={`mono ${delta >= 0 ? styles.up : styles.down}`}>{signed(delta)}</span>
            {tierMove && <span>{tierMove}</span>}
          </p>
        )}
        {participant && m.unrated && <p className="muted">Unrated match. Your rating did not change.</p>}
        {participant && !m.tournament && (
          <p>
            <ButtonLink href={`/play?modes=${m.mode}&start=1`}>Queue again</ButtonLink>
          </p>
        )}
      </section>
    </Card>
  );
}

function tierChange(before: string, after: string): string {
  const up = TIER_ORDER.indexOf(after) > TIER_ORDER.indexOf(before);
  return up ? `Promoted to ${TIER_NAME[after] ?? after}` : `Dropped to ${TIER_NAME[after] ?? after}`;
}
