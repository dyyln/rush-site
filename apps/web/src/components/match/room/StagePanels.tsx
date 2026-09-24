"use client";

import Link from "next/link";
import { CONNECT_GRACE_SEC, type MatchAcceptView, type MatchVetoView, type Mode, type RoomServer, type RoomWarmup } from "@rushsite/shared";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { Timer } from "@/components/ui/Timer";
import { VetoBoard } from "@/components/ui/VetoBoard";
import { VetoSummary } from "@/components/play/VetoSummary";
import { AcceptOverlay } from "./AcceptOverlay";
import { ConnectSteps, type ConnectStep } from "@/components/match/ConnectSteps";
import { RoomVetoBoard } from "@/components/rush/RoomVetoBoard";
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
    <Card tone="accent" eyebrow="Match found" title={modeLabel(mode)}>
      <div className={styles.accept}>
        <Timer until={accept.deadline} totalSec={accept.windowSec} size="lg" label="Time to accept" />
        <div className={styles.acceptBody}>
          <p className="muted" aria-live="polite">
            {accept.accepted} of {accept.required} accepted
          </p>
          <ol className={styles.pips} aria-hidden="true">
            {Array.from({ length: accept.required }, (_, i) => (
              <li key={i} className={i < accept.accepted ? styles.pipOn : undefined} />
            ))}
          </ol>
          <p className="muted">Players are accepting the match.</p>
        </div>
      </div>
    </Card>
  );
}

export function VetoPanel({
  mode,
  veto,
  viewer,
  names,
  onVote,
}: {
  mode: Mode;
  veto: MatchVetoView | null;
  viewer: string | null;
  names: Record<string, string>;
  onVote: (mapId: string) => void;
}) {
  if (!veto || !viewer) {
    return (
      <Card tone="accent" eyebrow="Map veto" title={modeLabel(mode)}>
        <p className="muted">The teams are banning maps.</p>
      </Card>
    );
  }
  return (
    <Card tone="accent">
      {veto.kind === "rooms" ? (
        <RoomVetoBoard state={veto.state} mySteamId={viewer} stepDeadline={veto.stepDeadline} onVote={onVote} names={names} />
      ) : (
        <VetoBoard mode={mode} state={veto.state} mySteamId={viewer} stepDeadline={veto.stepDeadline} onVote={onVote} names={names} />
      )}
    </Card>
  );
}

export function AllocatingPanel({
  mode,
  step,
  veto,
  viewer,
}: {
  mode: Mode;
  step: ConnectStep;
  veto: MatchVetoView | null;
  viewer: string | null;
}) {
  return (
    <Card tone="accent" eyebrow={step === "starting" ? "Starting server" : "Allocating server"} title={modeLabel(mode)}>
      <div className="stack">
        {veto?.state.done && viewer && veto.kind !== "rooms" && <VetoSummary mode={mode} state={veto.state} mySteamId={viewer} />}
        <ConnectSteps step={step} />
      </div>
    </Card>
  );
}

// steam://connect needs the password in the path to skip the console
export function steamConnectUrl(s: Pick<RoomServer, "ip" | "port" | "password">): string {
  return `steam://connect/${s.ip}:${s.port}${s.password ? `/${encodeURIComponent(s.password)}` : ""}`;
}

export function ConnectPanel({
  mode,
  server,
  live,
  warmup,
  mapId,
  deadline = null,
  names = {},
  viewer = null,
}: {
  mode: Mode;
  server: RoomServer;
  live: boolean;
  warmup: RoomWarmup | null;
  // Epoch ms by which every player must be on the server
  deadline?: number | null;
  names?: Record<string, string>;
  viewer?: string | null;
  // Map on the server now. In a series it changes while the server stays the same
  mapId: string | null;
}) {
  const map = mapId || server.mapId;
  return (
    <Card tone={live ? "raised" : "accent"} eyebrow={live ? "Server" : "Connect now"} title={live ? "Rejoin the server" : `Server ready on ${mapName(mode, map)}`}>
      <div className="stack">
        {live ? (
          <p className="muted">Dropped out? Join the same server again. It stays the same for every map.</p>
        ) : (
          <>
            <div className={styles.accept}>
              {deadline !== null && <Timer until={deadline} totalSec={CONNECT_GRACE_SEC} size="lg" label="Time to join" />}
              <p className="muted">Join the server now. If you do not connect in time you forfeit the match and lose rating.</p>
            </div>
            <ConnectSteps step="waiting" connected={warmup?.connected} expected={warmup?.expected} />
            {warmup?.missingSteamIds && warmup.missingSteamIds.length > 0 && (
              <p className="muted" aria-live="polite">
                Not on the server yet:{" "}
                {warmup.missingSteamIds.map((id) => (id === viewer ? "you" : (names[id] ?? "a player"))).join(", ")}
              </p>
            )}
          </>
        )}
        <label htmlFor="connect-string" className="visually-hidden">
          Console connect command
        </label>
        <input id="connect-string" className={`${styles.connectInput} mono`} value={server.connect} readOnly onFocus={(e) => e.currentTarget.select()} />
        <div className="row">
          <a className={styles.launch} href={steamConnectUrl(server)}>
            Launch CS2 and connect
          </a>
          <CopyButton variant={live ? "secondary" : "primary"} text={server.connect}>
            Copy connect
          </CopyButton>
        </div>
      </div>
    </Card>
  );
}

export function CancelledPanel({ reason, participant }: { reason: string | null; participant: boolean }) {
  const copy = cancelCopy(reason);
  return (
    <Card eyebrow="Match cancelled" title={copy.title}>
      <div className="stack">
        {copy.body && <p className="muted">{copy.body}</p>}
        {participant && (
          <p>
            <ButtonLink href="/play" variant="secondary">
              Back to Play
            </ButtonLink>
          </p>
        )}
        {!participant && (
          <p>
            <Link href="/leaderboard">See the leaderboard</Link>
          </p>
        )}
      </div>
    </Card>
  );
}
