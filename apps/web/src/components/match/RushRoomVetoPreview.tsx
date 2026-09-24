"use client";

import { useEffect, useState } from "react";
import { RUSH_ROOMS, RUSH_RULES, type RushRoom } from "@rushsite/shared";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MapCard, type MapCardState } from "@/components/ui/MapCard";
import { TeamMarker, type TeamSide } from "@/components/ui/TeamMarker";
import { RushRoomTrack, type RushTrackTeam } from "./RushRoomTrack";
import { rushRoomImage } from "@/lib/rushRooms";
import styles from "./RushRoomVetoPreview.module.css";

// Prototype format. The real one is still open, see docs/RUSH-ROOM-VETO.md
type VetoTeam = "A" | "B";
type VetoPool = "start" | "mid";
type VetoStep = { action: "ban" | "pick"; team: VetoTeam; pool: VetoPool };

const STEPS: readonly VetoStep[] = [
  // Start room: three bans, the one left is played in slot 3
  { action: "ban", team: "A", pool: "start" },
  { action: "ban", team: "B", pool: "start" },
  { action: "ban", team: "A", pool: "start" },
  // Mid rooms
  { action: "ban", team: "A", pool: "mid" },
  { action: "ban", team: "B", pool: "mid" },
  { action: "pick", team: "A", pool: "mid" },
  { action: "pick", team: "B", pool: "mid" },
  { action: "ban", team: "A", pool: "mid" },
  { action: "ban", team: "B", pool: "mid" },
  { action: "pick", team: "A", pool: "mid" },
  { action: "pick", team: "B", pool: "mid" },
];
// A team's mid picks go on its attacking side, next to the start room first, then the outer room.
// Team A plays CT and attacks toward the T castle (slot 0), Team B plays T and attacks toward the CT castle
const ATTACK_SLOTS: Record<VetoTeam, readonly number[]> = { A: [2, 1], B: [4, 5] };
const START_SLOT = 3;
const AUTO_MS = 1200;
const SEED = 7;

const POOLS: Record<VetoPool, readonly RushRoom[]> = { start: RUSH_ROOMS.startRooms, mid: RUSH_ROOMS.midRooms };
const POOL_NAME: Record<VetoPool, string> = { start: "start room", mid: "mid room" };
const TEAMS: Record<VetoTeam, { label: string; side: TeamSide }> = {
  A: { label: "Team A", side: "own" },
  B: { label: "Team B", side: "enemy" },
};
const TRACK_TEAMS: readonly [RushTrackTeam, RushTrackTeam] = [
  { name: "A", label: TEAMS.A.label, side: TEAMS.A.side, play: "ct" },
  { name: "B", label: TEAMS.B.label, side: TEAMS.B.side, play: "t" },
];

type RoomMark = { state: "banned" | "picked" | "left"; team?: VetoTeam; slot?: number };
type Veto = {
  rooms: (number | null)[];
  marks: Map<RushRoom["id"], RoomMark>;
  latestSlot: number | null;
  // What the last step did, for the live region
  result: string;
};

// Replays the chosen rooms against the step list
function replay(choices: readonly number[]): Veto {
  const rooms: (number | null)[] = Array.from({ length: RUSH_RULES.roomSlots }, () => null);
  rooms[0] = RUSH_ROOMS.castles.t.id;
  rooms[RUSH_RULES.roomSlots - 1] = RUSH_ROOMS.castles.ct.id;
  const marks = new Map<RushRoom["id"], RoomMark>();
  let latestSlot: number | null = null;
  let result = "";
  const picks: Record<VetoTeam, number> = { A: 0, B: 0 };
  choices.forEach((id, i) => {
    const step = STEPS[i]!;
    const room = POOLS[step.pool].find((r) => r.id === id);
    if (!room) return;
    const team = TEAMS[step.team].label;
    latestSlot = null;
    if (step.action === "ban") {
      marks.set(id, { state: "banned", team: step.team });
      result = `${team} banned ${room.displayName}.`;
    } else {
      const slot = ATTACK_SLOTS[step.team][picks[step.team]++] ?? null;
      marks.set(id, { state: "picked", team: step.team, ...(slot !== null ? { slot } : {}) });
      if (slot !== null) rooms[slot] = room.id as number;
      latestSlot = slot;
      result = `${team} picked ${room.displayName} for slot ${slot}.`;
    }
    // Once a pool has no steps left, a single room left over is played in its slot
    const poolDone = !STEPS.slice(i + 1).some((s) => s.pool === step.pool);
    const left = POOLS[step.pool].filter((r) => !marks.has(r.id));
    if (poolDone && step.pool === "start" && left.length === 1) {
      const last = left[0]!;
      marks.set(last.id, { state: "left", slot: START_SLOT });
      rooms[START_SLOT] = last.id as number;
      latestSlot = START_SLOT;
      result += ` ${last.displayName} is left and is played in slot ${START_SLOT}.`;
    }
  });
  return { rooms, marks, latestSlot, result };
}

// Seeded per step, so Reset replays the same veto
function randomChoice(choices: readonly number[]): number | null {
  const step = STEPS[choices.length];
  if (!step) return null;
  const { marks } = replay(choices);
  const open = POOLS[step.pool].filter((r) => !marks.has(r.id));
  if (open.length === 0) return null;
  let s = (SEED * 2654435761 + choices.length * 40503 + choices.reduce((a, b) => a + b, 0)) >>> 0;
  s = (s * 1664525 + 1013904223) >>> 0;
  return open[s % open.length]!.id as number;
}

export function RushRoomVetoPreview() {
  const [choices, setChoices] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const veto = replay(choices);
  const done = choices.length >= STEPS.length;
  const step = STEPS[choices.length];

  const next = () =>
    setChoices((c) => {
      const id = randomChoice(c);
      return id === null ? c : [...c, id];
    });

  useEffect(() => {
    if (!playing) return;
    if (done) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(next, AUTO_MS);
    return () => clearTimeout(t);
  }, [playing, choices.length, done]);

  const choose = (id: number) => {
    setPlaying(false);
    setChoices((c) => (c.length < STEPS.length ? [...c, id] : c));
  };

  const stepText = step
    ? `${TEAMS[step.team].label} ${step.action === "ban" ? "bans" : "picks"} a ${POOL_NAME[step.pool]}`
    : "Veto done. The track is set";

  return (
    <div className={styles.wrap}>
      <p className={styles.note}>
        <span className={styles.proto}>Prototype</span>
        Format not decided yet. Start room: 3 bans, the room left is played in slot 3. Mid rooms: ban, ban, pick, pick, ban, ban, pick, pick.
        Each pick goes on the picking team's attacking side, next to the start room first: Team A (CT) fills slots 2 then 1, Team B (T) fills 4 then 5. Castles are fixed.
      </p>

      <RushRoomTrack title="Rooms this match" rooms={veto.rooms} rounds={[]} teams={TRACK_TEAMS} live={false} building={{ latestSlot: veto.latestSlot }} />

      <Card as="div" className={styles.panel}>
        <div className={styles.stepRow}>
          <p className={styles.counter}>
            <span className="mono">
              Step {Math.min(choices.length + 1, STEPS.length)} of {STEPS.length}
            </span>
          </p>
          <p className={styles.step} data-side={step ? TEAMS[step.team].side : undefined}>
            {step && <TeamMarker side={TEAMS[step.team].side} />}
            {stepText}
          </p>
        </div>
        <p className={styles.live} aria-live="polite" role="status">
          {veto.result}
        </p>

        <div className={styles.controls}>
          <Button variant="secondary" onClick={() => { setPlaying(false); setChoices((c) => c.slice(0, -1)); }} disabled={choices.length === 0}>
            Previous step
          </Button>
          <Button variant="secondary" onClick={() => { setPlaying(false); next(); }} disabled={done}>
            Next step
          </Button>
          <Button variant="primary" onClick={() => setPlaying((p) => !p)} disabled={done} aria-pressed={playing}>
            {playing ? "Pause" : "Play"}
          </Button>
          <Button variant="ghost" onClick={() => { setPlaying(false); setChoices([]); }} disabled={choices.length === 0}>
            Reset
          </Button>
        </div>

        {(["start", "mid"] as const).map((pool) => (
          <section key={pool} className={styles.pool} aria-labelledby={`veto-pool-${pool}`}>
            <h3 id={`veto-pool-${pool}`} className={styles.poolTitle}>
              {pool === "start" ? "Start rooms" : "Mid rooms"}
              {step?.pool === pool && <span className={styles.active}>Choose one</span>}
            </h3>
            <ul className={styles.rooms}>
              {POOLS[pool].map((room) => (
                <li key={room.id}>
                  <RoomCard room={room} mark={veto.marks.get(room.id)} step={step?.pool === pool ? step : undefined} onChoose={choose} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Card>
    </div>
  );
}

const STAMP: Record<RoomMark["state"], string> = { banned: "Banned", picked: "Picked", left: "Left over" };
const CARD_STATE: Record<RoomMark["state"], MapCardState> = { banned: "banned", picked: "picked", left: "decider" };

// Same card as the map veto, with the room screenshot as its art
function RoomCard({ room, mark, step, onChoose }: { room: RushRoom; mark?: RoomMark; step?: VetoStep; onChoose: (id: number) => void }) {
  const team = mark?.team ? TEAMS[mark.team] : null;
  const choosable = !!step && !mark;
  return (
    <MapCard
      mapId={String(room.id)}
      name={room.displayName}
      imageSrc={rushRoomImage(String(room.id))}
      state={mark ? CARD_STATE[mark.state] : "available"}
      stampLabel={mark ? STAMP[mark.state] : undefined}
      by={team ? { label: team.label, side: team.side } : undefined}
      note={mark?.slot !== undefined ? `Slot ${mark.slot}` : undefined}
      onSelect={choosable ? () => onChoose(room.id as number) : undefined}
      actionLabel={step?.action === "ban" ? "Ban" : "Pick"}
    />
  );
}
