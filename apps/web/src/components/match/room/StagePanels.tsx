"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CONNECT_GRACE_SEC, isRushMode, type MatchAcceptView, type MatchVetoView, type Mode, type RoomServer, type RoomWarmup } from "@rushsite/shared";
import { cx } from "@/components/ui/cx";
import { StepClock } from "@/components/ui/VetoHead";
import vh from "@/components/ui/VetoHead.module.css";
import { CopyButton } from "@/components/ui/CopyButton";
import { VetoBoard } from "@/components/ui/VetoBoard";
import { VetoSummary } from "@/components/play/VetoSummary";
import { AcceptOverlay } from "./AcceptOverlay";
import { ConnectSteps, type ConnectStep } from "@/components/match/ConnectSteps";
import { RoomVetoBoard } from "@/components/rush/RoomVetoBoard";
import { SeriesRoomVetoBoard } from "@/components/rush/SeriesRoomVetoBoard";
import { cancelCopy } from "@/lib/errors";
import { mapName, modeLabel } from "@/lib/modes";
import styles from "./Room.module.css";

type Named = { steamId: string; name: string };

export function AcceptPanel({
  accept,
  mode,
  participant,
  onRespond,
  team = [],
  viewer = null,
}: {
  accept: MatchAcceptView;
  mode: Mode;
  participant: boolean;
  onRespond: (accept: boolean) => void;
  // The viewer's team. Their accepts are shown by name
  team?: Named[];
  viewer?: string | null;
}) {
  // Players get the blocking in-game style overlay. Spectators keep an inline panel
  if (participant) return <AcceptOverlay accept={accept} mode={mode} onRespond={onRespond} team={team} viewer={viewer} />;
  return (
    <section className={cx("glass", styles.stagePanel)} aria-labelledby="stage-heading">
      <StageHead
        id="stage-heading"
        eyebrow={`${modeLabel(mode)} · Match found`}
        headline="Players are accepting"
        sub={`${accept.accepted} of ${accept.required} accepted`}
        until={accept.deadline}
        totalSec={accept.windowSec}
      />
      <ol className={styles.pips} aria-hidden="true">
        {Array.from({ length: accept.required }, (_, i) => (
          <li key={i} className={i < accept.accepted ? styles.pipOn : undefined} />
        ))}
      </ol>
    </section>
  );
}

export function VetoPanel({
  mode,
  veto,
  viewer,
  names,
  onVote,
  flip,
}: {
  mode: Mode;
  veto: MatchVetoView | null;
  viewer: string | null;
  names: Record<string, string>;
  onVote: (mapId: string) => void;
  // Rush: left team defends the CT castle. The series room pick works it out per map
  flip?: boolean;
}) {
  if (!veto || !viewer) {
    return (
      <section className={cx("glass", styles.stagePanel)} aria-labelledby="stage-heading">
        <StageHead
          id="stage-heading"
          eyebrow={`${modeLabel(mode)} · Veto`}
          headline={isRushMode(mode) ? "Picking rooms" : "Banning maps"}
          sub="The teams are voting. The match starts when they are done."
        />
      </section>
    );
  }
  // A plain glass panel. The header inside carries the turn colour
  return (
    <section className={`glass ${styles.vetoPanel}`} aria-label="Veto">
      {veto.kind === "series-rooms" ? (
        <SeriesRoomVetoBoard state={veto.state} mySteamId={viewer} stepDeadline={veto.stepDeadline} onVote={onVote} names={names} />
      ) : veto.kind === "rooms" ? (
        <RoomVetoBoard state={veto.state} mySteamId={viewer} stepDeadline={veto.stepDeadline} onVote={onVote} names={names} flip={flip} />
      ) : (
        <VetoBoard mode={mode} state={veto.state} mySteamId={viewer} stepDeadline={veto.stepDeadline} onVote={onVote} names={names} />
      )}
    </section>
  );
}

// Header of every stage band: what is happening in big letters, a line on what to do, and the clock when there is one.
// Same look as the veto header so the room reads as one flow
function StageHead({
  id,
  eyebrow,
  headline,
  sub,
  until = null,
  totalSec,
  tone,
}: {
  id: string;
  eyebrow: string;
  headline: string;
  sub?: ReactNode;
  until?: number | null;
  totalSec?: number;
  tone?: "go" | "bad";
}) {
  return (
    <header className={vh.head}>
      <div className={vh.text}>
        <p className={vh.eyebrow}>{eyebrow}</p>
        <h2 id={id} className={cx(vh.headline, styles.stageHeadline)} data-tone={tone}>
          {headline}
        </h2>
        {sub && (
          <p className={vh.sub} aria-live="polite">
            {sub}
          </p>
        )}
      </div>
      {until !== null && totalSec !== undefined && <StepClock until={until} totalSec={totalSec} mine />}
    </header>
  );
}

export function AllocatingPanel({ mode, step, veto, viewer }: { mode: Mode; step: ConnectStep; veto: MatchVetoView | null; viewer: string | null }) {
  return (
    <section className={cx("glass", styles.stagePanel)} aria-labelledby="stage-heading">
      <StageHead
        id="stage-heading"
        eyebrow={`${modeLabel(mode)} · Server`}
        headline={step === "starting" ? "Starting server" : "Finding a server"}
        sub={step === "starting" ? "Loading the map and match config. Connect appears in the dock when it is up." : "Picking a free server slot near you."}
      />
      <ConnectSteps step={step} hint={false} />
      {veto?.state.done && viewer && (veto.kind ?? "maps") === "maps" && <VetoSummary mode={mode} state={veto.state} mySteamId={viewer} />}
    </section>
  );
}

// steam://connect needs the password in the path to skip the console
export function steamConnectUrl(s: Pick<RoomServer, "ip" | "port" | "password">): string {
  return `steam://connect/${s.ip}:${s.port}${s.password ? `/${encodeURIComponent(s.password)}` : ""}`;
}

export type RosterPlayer = { steamId: string; name: string; side: "own" | "enemy" };

export function ConnectPanel({
  mode,
  server,
  live,
  warmup,
  mapId,
  deadline = null,
  players = [],
  viewer = null,
}: {
  mode: Mode;
  server: RoomServer;
  live: boolean;
  warmup: RoomWarmup | null;
  // Epoch ms by which every player must be on the server
  deadline?: number | null;
  // Everyone in the match, to show who is on the server yet
  players?: RosterPlayer[];
  viewer?: string | null;
  // Map on the server now. In a series it changes while the server stays the same
  mapId: string | null;
}) {
  const map = mapId || server.mapId;
  const missing = new Set(warmup?.missingSteamIds ?? []);
  const known = !!warmup?.missingSteamIds;
  const count = warmup && warmup.expected ? `${warmup.connected} of ${warmup.expected} on the server` : null;
  return (
    <section className={cx("glass", styles.stagePanel)} aria-labelledby="stage-heading">
      {live ? (
        <StageHead
          id="stage-heading"
          eyebrow={`${modeLabel(mode)} · Server`}
          headline="Match live"
          sub="Dropped out? Rejoin from the dock. The server stays the same for every map."
          tone="go"
        />
      ) : (
        <StageHead
          id="stage-heading"
          eyebrow={`${modeLabel(mode)} · Connect`}
          headline={isRushMode(mode) || !map ? "Server ready" : `Server ready · ${mapName(mode, map)}`}
          sub={
            <>
              Connect from the dock. Not joining in time forfeits the match and loses rating.
              {count && <span className="visually-hidden">. {count}</span>}
            </>
          }
          until={deadline}
          totalSec={CONNECT_GRACE_SEC}
          tone="go"
        />
      )}
      {!live && players.length > 0 && (
        <div className={styles.roster}>
          <p className={styles.rosterHead}>
            <span>On the server</span>
            {count && (
              <span className="mono">
                {warmup!.connected}/{warmup!.expected}
              </span>
            )}
          </p>
          <ul className={styles.rosterList}>
            {players.map((p) => {
              const on = known && !missing.has(p.steamId);
              return (
                <li key={p.steamId} className={styles.rosterItem} data-side={p.side} data-on={on || undefined}>
                  <span className={styles.rosterDot} aria-hidden="true" />
                  <span className={styles.rosterName}>{p.steamId === viewer ? "You" : p.name}</span>
                  <span className="visually-hidden">{on ? ", connected" : ", not connected yet"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {/* The big Connect button is in the dock. This keeps the console command for anyone joining by hand */}
      <div className={styles.connectRow}>
        <label htmlFor="connect-string" className="visually-hidden">
          Console connect command
        </label>
        <input id="connect-string" className={`${styles.connectInput} mono`} value={server.connect} readOnly onFocus={(e) => e.currentTarget.select()} />
        <CopyButton variant="secondary" text={server.connect}>
          Copy
        </CopyButton>
        <a className={styles.launchSmall} href={steamConnectUrl(server)}>
          Open in CS2
        </a>
      </div>
    </section>
  );
}

export function CancelledPanel({ mode, reason, participant }: { mode: Mode; reason: string | null; participant: boolean }) {
  const copy = cancelCopy(reason);
  return (
    <section className={cx("glass", styles.stagePanel)} aria-labelledby="stage-heading">
      <StageHead id="stage-heading" eyebrow={modeLabel(mode)} headline={copy.title} sub={copy.body} tone="bad" />
      <p className={styles.stageLinks}>{participant ? <Link href="/play">Back to Play</Link> : <Link href="/leaderboard">See the leaderboard</Link>}</p>
    </section>
  );
}
