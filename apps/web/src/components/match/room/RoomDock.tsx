"use client";

import { connectDeadlineOf, type RoomStage, type RoomState } from "@rushsite/shared";
import { DockButton, DockCountdown, DockLink, DockTimer } from "@/components/layout/Dock";
import { useDockAction, type DockAction } from "@/components/layout/dockStore";
import { vetoTurn } from "@/components/ui/VetoTurn";
import { signed } from "@/lib/format";
import type { MatchDetail } from "@/lib/types";
import { steamConnectUrl } from "./StagePanels";
import { roomOutcome } from "./RoomResult";

const TURN_TEXT = {
  mine: "Your turn",
  voted: "Waiting on your team",
  theirs: "Opponents' turn",
  watching: "Teams are picking",
  done: "Veto done",
} as const;

const OUTCOME_TEXT = { won: "You won", lost: "You lost", draw: "Draw", abandoned: "Abandoned", finished: "Finished" } as const;

// The match room's own dock: what is happening now and the one thing to do next. Players only, spectators keep the normal dock
export function RoomDock({ m, room, stage, viewer, participant }: { m: MatchDetail; room: RoomState; stage: RoomStage; viewer: string | null; participant: boolean }) {
  useDockAction(participant && viewer ? dockFor(m, room, stage, viewer) : null);
  return null;
}

function dockFor(m: MatchDetail, room: RoomState, stage: RoomStage, viewer: string): DockAction | null {
  const [a, b] = m.teams;
  const score = a && b ? `${a.score} : ${b.score}` : null;
  switch (stage) {
    case "accept": {
      const acc = room.accept;
      // The accept dialog is modal and owns the Accept button
      return acc
        ? {
            label: "Match found",
            value: `${acc.accepted} of ${acc.required} accepted`,
            action: <DockTimer until={acc.deadline} label="to accept" />,
          }
        : null;
    }
    case "veto": {
      const veto = room.veto;
      if (!veto) return { label: "Map veto", value: "Teams are picking", action: null };
      const myTeam = veto.state.teams.findIndex((t) => t.steamIds.includes(viewer));
      const turn = vetoTurn(veto.state, myTeam < 0 ? null : (myTeam as 0 | 1), viewer);
      return {
        label: veto.kind === "maps" || !veto.kind ? "Map veto" : "Room pick",
        value: TURN_TEXT[turn],
        action: veto.stepDeadline ? <DockTimer until={veto.stepDeadline} label="this step" /> : null,
      };
    }
    case "allocating":
      return {
        label: room.status === "starting" ? "Starting server" : "Finding a server",
        value: "Connect opens in a moment",
        action: (
          <DockButton tone="quiet" disabled>
            Connect
          </DockButton>
        ),
      };
    case "connect": {
      const server = room.server;
      const deadline = connectDeadlineOf(room);
      const w = room.warmup;
      return server
        ? {
            label: "Server ready",
            value: (
              <>
                {deadline !== null && (
                  <>
                    Join within <DockCountdown until={deadline} />
                  </>
                )}
                {w ? ` · ${w.connected} of ${w.expected} on server` : ""}
              </>
            ),
            action: (
              <DockLink href={steamConnectUrl(server)} tone="win" external>
                Connect
              </DockLink>
            ),
          }
        : null;
    }
    case "live":
      return {
        label: room.liveMap ? `Live · Map ${room.liveMap}` : "Live",
        value: score ?? "In progress",
        action: room.server ? (
          <DockLink href={steamConnectUrl(room.server)} tone="quiet" external>
            Rejoin
          </DockLink>
        ) : null,
      };
    case "result": {
      const outcome = roomOutcome(m, room.result, viewer);
      const change = room.result?.ratingChanges.find((c) => c.steamId === viewer);
      const delta = change ? change.after - change.before : m.ratingDeltas?.[viewer];
      return {
        label: "Match over",
        value: (
          <>
            {OUTCOME_TEXT[outcome]}
            {score ? ` · ${score}` : ""}
            {delta !== undefined && !m.unrated ? ` · ${signed(delta)}` : ""}
          </>
        ),
        action: m.tournament ? (
          <DockLink href={`/tournaments/${m.tournament.id}`}>Back to cup</DockLink>
        ) : (
          <DockLink href={`/play?modes=${m.mode}&start=1`}>Queue again</DockLink>
        ),
      };
    }
    case "cancelled":
      // Back to the normal queue controls
      return null;
  }
}
