"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TIERS, type MatchResultPayload, type VetoStatePayload } from "@rushsite/shared";
import { RematchButton } from "@/components/challenges/RematchButton";
import { Button } from "@/components/ui/Button";
import { TierChip } from "@/components/ui/TierChip";
import { api } from "@/lib/api";
import { signed } from "@/lib/format";
import { mapName, modeLabel } from "@/lib/modes";
import type { MatchDetail } from "@/lib/types";
import styles from "./ResultCard.module.css";

type ResultCardProps = {
  result: MatchResultPayload;
  mapId?: string;
  veto?: VetoStatePayload | null;
  mySteamId: string;
  // Leader only. Omitted for other party members
  onQueueAgain?: () => void;
  onDismiss: () => void;
};

type Outcome = "won" | "lost" | "draw" | "abandoned" | "unknown";

const TIER_NAME = Object.fromEntries(TIERS.map((t) => [t.id, t.displayName])) as Record<string, string>;
const TIER_ORDER = TIERS.map((t) => t.id as string);

// Stays on /play after match_result until the player dismisses it or queues again
export function ResultCard({ result, mapId, veto, mySteamId, onQueueAgain, onDismiss }: ResultCardProps) {
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  useEffect(() => {
    let live = true;
    api.match(result.matchId).then(
      (m) => live && setDetail(m),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [result.matchId]);

  const change = result.ratingChanges.find((c) => c.steamId === mySteamId);
  const teamNames = Object.keys(result.score);
  const myTeam = findMyTeam(result, detail, veto, mySteamId, teamNames);
  const outcome = decide(result, myTeam, change);
  const other = myTeam ? teamNames.find((t) => t !== myTeam) : undefined;
  const own = myTeam ? result.score[myTeam] : undefined;
  const opp = other ? result.score[other] : undefined;
  const map = mapId ?? detail?.mapId;

  const headline =
    outcome === "won" ? "You won" : outcome === "lost" ? "You lost" : outcome === "draw" ? "Draw" : outcome === "abandoned" ? "Match abandoned" : "Match finished";
  const tierMove = change ? tierChange(change.tierBefore, change.tierAfter) : null;

  return (
    <section className={`${styles.card} ${styles[outcome]}`} aria-labelledby="result-heading" role="status">
      <header className={styles.head}>
        <div>
          <p className="eyebrow">
            {modeLabel(result.mode)}
            {map ? ` on ${mapName(result.mode, map)}` : ""}
          </p>
          <h2 id="result-heading" className={styles.headline}>
            {headline}
            {own !== undefined && opp !== undefined && (
              <span className={`${styles.score} mono`}>
                {own} : {opp}
              </span>
            )}
          </h2>
          {own === undefined && teamNames.length === 2 && (
            <p className={`${styles.score} mono`}>
              {teamNames.map((t) => result.score[t]).join(" : ")}
            </p>
          )}
          {outcome === "abandoned" && <p className="muted">Someone left or never joined. Check the match page for who forfeited.</p>}
        </div>
        <button type="button" className={styles.close} onClick={onDismiss}>
          <span className="visually-hidden">Dismiss result</span>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {change ? (
        <div className={styles.rating}>
          <span className={styles.ratingLine}>
            <span className="muted">Rating</span>
            <span className="mono">{Math.round(change.before)}</span>
            <span aria-hidden="true">to</span>
            <TierChip tier={change.tierAfter} rating={Math.round(change.after)} size="sm" link={false} />
            <span className={`mono ${change.after >= change.before ? styles.up : styles.down}`}>
              {signed(Math.round(change.after - change.before))}
            </span>
          </span>
          {tierMove && <span className={styles.tierMove}>{tierMove}</span>}
        </div>
      ) : (
        result.status === "completed" && <p className="muted">Unrated match. Your rating did not change.</p>
      )}

      <div className={styles.actions}>
        {onQueueAgain && <Button onClick={onQueueAgain}>Queue again</Button>}
        {result.status === "completed" && <RematchButton matchId={result.matchId} mode={result.mode} />}
        <Link href={`/matches/${result.matchId}`} className={styles.link}>
          View match
        </Link>
      </div>
    </section>
  );
}

function findMyTeam(
  result: MatchResultPayload,
  detail: MatchDetail | null,
  veto: VetoStatePayload | null | undefined,
  me: string,
  names: string[],
): string | undefined {
  const fromDetail = detail?.teams.find((t) => t.players.some((p) => p.steamId === me))?.name;
  if (fromDetail && names.includes(fromDetail)) return fromDetail;
  const fromVeto = veto?.state.teams.find((t) => t.steamIds.includes(me))?.id;
  if (fromVeto && names.includes(fromVeto)) return fromVeto;
  // A rated result tells us which side we were on through the rating move
  const change = result.ratingChanges.find((c) => c.steamId === me);
  if (change && result.winnerTeam && change.after !== change.before && names.length === 2) {
    const won = change.after > change.before;
    return won ? result.winnerTeam : names.find((n) => n !== result.winnerTeam);
  }
  return undefined;
}

function decide(result: MatchResultPayload, myTeam: string | undefined, change: MatchResultPayload["ratingChanges"][number] | undefined): Outcome {
  if (result.status === "abandoned") {
    if (change && change.after > change.before) return "won";
    if (change && change.after < change.before) return "lost";
    return "abandoned";
  }
  if (!result.winnerTeam || result.winnerTeam === "draw") return "draw";
  if (!myTeam) return "unknown";
  return myTeam === result.winnerTeam ? "won" : "lost";
}

function tierChange(before: string, after: string): string | null {
  if (before === after) return null;
  const up = TIER_ORDER.indexOf(after) > TIER_ORDER.indexOf(before);
  return up ? `Promoted to ${TIER_NAME[after] ?? after}` : `Dropped to ${TIER_NAME[after] ?? after}`;
}
