"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";
import { ALL_RUSH_ROOMS, RUSH_ROOMS, RUSH_RULES, findRushRoom, type RushRoom } from "@rushsite/shared";
import { Card } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { TeamMarker, type TeamSide } from "@/components/ui/TeamMarker";
import { RoomImage } from "@/components/rush/RoomImage";
import type { MatchDetail, MatchRound } from "@/lib/types";
import styles from "./RushRoomTrack.module.css";

// Side a team plays. Rush never swaps sides
export type RushSide = "t" | "ct";

export type RushTrackTeam = {
  name: string;
  label: string;
  // Own or enemy colour for this viewer
  side: TeamSide;
  // From the api when sent. Otherwise teams[0] is CT and teams[1] is T, as in match.json
  play?: RushSide;
};

type Props = {
  // Room ids for slots 0 to 6, T castle first. Left out until the server reports them. null is a slot not filled yet
  rooms?: readonly (number | null)[];
  rounds: MatchRound[];
  teams: readonly [RushTrackTeam, RushTrackTeam];
  // Play is still going on this map
  live: boolean;
  // Veto preview: empty slots show a placeholder and latestSlot, the slot the last step filled, animates in
  building?: { latestSlot: number | null };
  title?: string;
};

type Visit = { round: number; team: RushTrackTeam | null; toward: RushSide | null };
type Slot = { index: number; room: RushRoom | null; kind: "castle" | "start" | "mid"; visits: Visit[] };
type Where = number | "decider";

export type RushTrack = {
  slots: Slot[];
  decider: Visit[];
  // Where the next round is played. Null once the map is over
  current: Where | null;
  // Where the last round was played
  last: Where | null;
  // Castle slot taken by the winning round, when the match ended that way
  captured: number | null;
  over: boolean;
};

const START_SLOT = 3;
const LAST_SLOT = RUSH_RULES.roomSlots - 1;

// round.arena is a room id or display name. Unknown strings give null
function resolveRoom(arena: string | undefined): RushRoom | null {
  if (!arena) return null;
  const s = arena.trim();
  if (/^\d+$/.test(s)) return findRushRoom(Number(s)) ?? null;
  const low = s.toLowerCase();
  return ALL_RUSH_ROOMS.find((r) => String(r.id) === low || r.displayName.toLowerCase() === low) ?? null;
}

// teams[0] plays CT and teams[1] plays T unless the api says otherwise
function playOf(teams: readonly [RushTrackTeam, RushTrackTeam], i: 0 | 1): RushSide {
  const own = teams[i].play;
  const other = teams[i === 0 ? 1 : 0].play;
  return own ?? (other ? (other === "ct" ? "t" : "ct") : i === 0 ? "ct" : "t");
}

const kindOf = (i: number): Slot["kind"] => (i === 0 || i === LAST_SLOT ? "castle" : i === START_SLOT ? "start" : "mid");

// Replays the rounds with the rules from the rush_001 script. A T win moves play one room toward the CT
// castle, a CT win one room toward the T castle. A win in the enemy castle, 8 wins or the 7-7 decider ends it
export function buildRushTrack(rooms: readonly (number | null)[] | undefined, rounds: MatchRound[], teams: readonly [RushTrackTeam, RushTrackTeam]): RushTrack {
  const teamOn = (s: RushSide) => (playOf(teams, 0) === s ? teams[0] : teams[1]);
  const sideOfTeam = (name: string): RushSide | null => (name === teams[0].name ? playOf(teams, 0) : name === teams[1].name ? playOf(teams, 1) : null);

  const slots: Slot[] = Array.from({ length: RUSH_RULES.roomSlots }, (_, i) => ({
    index: i,
    room: i === 0 ? RUSH_ROOMS.castles.t : i === LAST_SLOT ? RUSH_ROOMS.castles.ct : rooms?.[i] != null ? findRushRoom(rooms[i]!) ?? null : null,
    kind: kindOf(i),
    visits: [],
  }));
  const decider: Visit[] = [];
  let pos = START_SLOT;
  let deciderNext = false;
  let last: Where | null = null;
  let captured: number | null = null;
  let over = false;
  const wins = { t: 0, ct: 0 };

  for (const r of [...rounds].sort((x, y) => x.round - y.round)) {
    if (over) break;
    const played = resolveRoom(r.arena);
    const at: Where = deciderNext || played?.id === RUSH_ROOMS.decider.id ? "decider" : pos;
    const side = sideOfTeam(r.winnerTeam);
    const visit: Visit = { round: r.round, team: side ? teamOn(side) : null, toward: side === "t" ? "ct" : side === "ct" ? "t" : null };
    last = at;
    if (at === "decider") {
      decider.push(visit);
      over = side !== null;
      continue;
    }
    const slot = slots[at]!;
    // Rooms the api did not send are filled in from the rounds as they come
    if (!slot.room && played && played.id !== RUSH_ROOMS.decider.id) slot.room = played;
    slot.visits.push(visit);
    if (!side) continue;
    wins[side]++;
    pos += side === "t" ? 1 : -1;
    if (pos < 0 || pos > LAST_SLOT) {
      captured = at;
      over = true;
    } else if (wins[side] >= RUSH_RULES.roundsToWin) {
      over = true;
    } else if (wins.t === RUSH_RULES.roundsToWin - 1 && wins.ct === RUSH_RULES.roundsToWin - 1) {
      deciderNext = true;
    }
  }
  pos = Math.max(0, Math.min(LAST_SLOT, pos));
  return { slots, decider, current: over ? null : deciderNext ? "decider" : pos, last, captured, over };
}

const SLOT_LABEL: Record<Slot["kind"], string> = { castle: "Castle", start: "Start room", mid: "Mid room" };


export function RushRoomTrack({ rooms, rounds, teams, live, building, title = "Room track" }: Props) {
  const headingId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const track = buildRushTrack(rooms, rounds, teams);
  const playing = live && !track.over;
  const current = playing ? track.current : null;
  const tTeam = playOf(teams, 0) === "t" ? teams[0] : teams[1];
  const ctTeam = tTeam === teams[0] ? teams[1] : teams[0];
  const defender = (i: number) => (i === 0 ? tTeam : i === LAST_SLOT ? ctTeam : null);
  // While live, every room between play and a castle is held by that castle's team. The room in play is contested
  // Every room between play and a castle is held by that castle's team. The room in play, and once
  // over the room play ended in, is split between the two. A finished Convoy takes its winner's colour
  const ended = !building && !playing && track.over ? endedIn(track) : null;
  // During a live Convoy decider the rooms either side of the room it replaced keep their holders
  const front = typeof current === "number" ? current : current === "decider" ? replacedByDecider(track) : ended;
  const finalWinner = ended === null ? null : ([...track.slots.flatMap((sl) => sl.visits), ...track.decider].sort((x, y) => y.round - x.round)[0]?.team ?? null);
  // The room in play, or the room play ended in, stays split between the two
  const holder = (i: number) => (front === null || i === front ? null : i < front ? tTeam : ctTeam);
  // The left team's castle goes on the left (on top on phones), so it attacks left to right
  const flip = tTeam !== teams[0];
  const shownSlots = flip ? [...track.slots].reverse() : track.slots;
  const [leftTeam, rightTeam] = flip ? [ctTeam, tTeam] : [tTeam, ctTeam];
  const splitStyle = front !== null ? ({ "--split-a": `var(--team-${leftTeam.side})`, "--split-b": `var(--team-${rightTeam.side})` } as CSSProperties) : undefined;

  // Keeps the current room in view where the track scrolls
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>("[aria-current]");
    const box = scrollRef.current;
    if (!el || !box || box.scrollWidth <= box.clientWidth) return;
    box.scrollLeft = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2;
  }, [current, rounds.length]);

  const nameOf = (w: Where | null) => (w === null ? "" : w === "decider" ? RUSH_ROOMS.decider.displayName : track.slots[w]!.room?.displayName ?? `slot ${w}`);
  const lastVisit = [...track.slots.flatMap((s) => s.visits), ...track.decider].sort((a, b) => b.round - a.round)[0];
  const status = building
    ? ""
    : playing
    ? `Play is in ${nameOf(current)} for round ${rounds.length + 1}`
    : track.over && lastVisit?.team
      ? track.captured !== null
        ? `${lastVisit.team.label} took ${nameOf(track.captured)} in round ${lastVisit.round}`
        : `${lastVisit.team.label} won the match in ${nameOf(track.last)}, round ${lastVisit.round}`
      : rounds.length > 0
        ? `Last round played in ${nameOf(track.last)}`
        : "";

  return (
    <Card as="section" className={styles.card} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          {title}
        </h2>
        {status && (
          <p className={styles.status} aria-live={playing ? "polite" : undefined}>
            {status}
          </p>
        )}
      </div>
      <div className={styles.scroll} ref={scrollRef}>
      <ol
        className={styles.track}
        ref={listRef}
        style={splitStyle}
      >
        {shownSlots.map((slot) => {
          const isCurrent = current === slot.index;
          const isLast = !playing && track.last === slot.index;
          const def = defender(slot.index);
          const reached = slot.visits.length > 0 || isCurrent;
          const held = holder(slot.index);
          return (
            <li
              key={slot.index}
              className={cx(styles.slot, !building && !reached && styles.unreached)}
              data-kind={slot.kind}
              data-side={def?.side}
              data-current={isCurrent || undefined}
              data-control={held?.side}
              data-contested={slot.index === front || undefined}
              data-last={isLast || undefined}
              data-empty={(building && !slot.room) || undefined}
              data-latest={(building && building.latestSlot === slot.index) || undefined}
              aria-current={isCurrent ? "step" : undefined}
            >
              {/* The kind shows in the border (castle colour, dashed start room), so it is only spoken */}
              <span className="visually-hidden">
                {slot.kind === "castle" ? (slot.index === 0 ? "T castle" : "CT castle") : SLOT_LABEL[slot.kind]}, slot {slot.index}
                {held ? `, held by ${held.label}` : ""}:{" "}
              </span>
              <span className={styles.frame}>
                {slot.room ? <RoomImage room={String(slot.room.id)} /> : <span className={styles.blank} aria-hidden="true" />}
                {/* An empty slot in the veto preview is just an empty frame. The spoken label says which slot */}
                {slot.room ? (
                  <span className={styles.name}>{slot.room.displayName}</span>
                ) : building ? (
                  <span className="visually-hidden">not picked yet</span>
                ) : (
                  <span className={styles.name}>
                    <span className={styles.unknown}>{playing ? "Not drawn yet" : "Not played"}</span>
                  </span>
                )}
              </span>
              <span className={styles.meta}>
                {def && (
                  <span className={styles.defender} data-side={def.side}>
                    <TeamMarker side={def.side} />
                    <span>Defended by {def.label}</span>
                  </span>
                )}
                {isCurrent && (
                  <span key={`now-${rounds.length}`} className={styles.now}>
                    <span className={styles.pulse} aria-hidden="true" />
                    Current room
                  </span>
                )}
                {isLast && track.over && (
                  <span className={styles.final}>{track.captured === slot.index ? "Castle taken" : "Final round"}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      </div>
      {(track.decider.length > 0 || current === "decider") && (
        <div
          className={styles.decider}
          data-current={current === "decider" || undefined}
          data-control={(track.last === "decider" && ended !== null && finalWinner?.side) || undefined}
          data-contested={current === "decider" || undefined}
          style={splitStyle}
          aria-current={current === "decider" ? "step" : undefined}
        >
          <span className="visually-hidden">Decider at 7-7: </span>
          <span className={styles.frame}>
            <RoomImage room={String(RUSH_ROOMS.decider.id)} />
            <span className={styles.name}>
              {RUSH_ROOMS.decider.displayName}
              <span className={styles.nameNote}>Decider at 7-7</span>
            </span>
          </span>
          <span className={styles.meta}>
            {current === "decider" && (
              <span className={styles.now}>
                <span className={styles.pulse} aria-hidden="true" />
                Current room
              </span>
            )}
          </span>
        </div>
      )}
    </Card>
  );
}


// Match page wrapper. mapNumber picks one map of a series, where each map is its own Rush match
// The room play ended in. A match decided in Convoy ended in the room Convoy replaced at 7-7,
// one step on from the last regular round in the direction that round moved play
function endedIn(track: RushTrack): number | null {
  if (typeof track.last === "number") return track.last;
  return track.last === "decider" ? replacedByDecider(track) : null;
}

// The room Convoy took the place of at 7-7
function replacedByDecider(track: RushTrack): number | null {
  const regular = track.slots.flatMap((sl) => sl.visits.map((v) => ({ v, slot: sl.index }))).sort((x, y) => y.v.round - x.v.round)[0];
  if (!regular) return null;
  const step = regular.v.toward === "ct" ? 1 : regular.v.toward === "t" ? -1 : 0;
  return Math.max(0, Math.min(LAST_SLOT, regular.slot + step));
}

// Rooms, live state and teams for one map of a Rush match, as the track and the round graph need them
function rushInputs(m: MatchDetail, mapNumber: number | undefined, sideOf: (i: number) => TeamSide) {
  const [a, b] = m.teams;
  if (!a || !b) return null;
  const map = mapNumber === undefined ? undefined : m.maps?.find((x) => x.mapNumber === mapNumber);
  const teams: readonly [RushTrackTeam, RushTrackTeam] = [
    { name: a.name, label: a.displayName ?? a.name, side: sideOf(0), play: a.side },
    { name: b.name, label: b.displayName ?? b.name, side: sideOf(1), play: b.side },
  ];
  return { rooms: map ? map.rushRooms : m.rushRooms, live: m.status === "live" && (!map || map.status === "live"), teams };
}

export function MatchRushTrack({ m, rounds, mapNumber, sideOf }: { m: MatchDetail; rounds: MatchRound[]; mapNumber?: number; sideOf: (i: number) => TeamSide }) {
  const inputs = rushInputs(m, mapNumber, sideOf);
  if (!inputs) return null;
  // Before the first round only a known room draw is worth showing
  if (rounds.length === 0 && !(inputs.live && inputs.rooms)) return null;
  return <RushRoomTrack rooms={inputs.rooms} rounds={rounds} live={inputs.live} teams={inputs.teams} />;
}

// True when the left team (teams[0]) defends the CT castle, so every room row draws CT castle first
export function rushFlip(m: MatchDetail): boolean {
  const [a, b] = m.teams;
  if (!a || !b) return false;
  const stub = (play: RushSide | undefined): RushTrackTeam => ({ name: "", label: "", side: "own", play });
  return playOf([stub(a.side), stub(b.side)], 0) === "ct";
}

// Where play was in each round, as a slot from 0 (T castle) to 6 (CT castle), for the round graph.
// The graph puts the left team's castle on top
// pending is the slot of the round being played, which has no result yet
// flip puts the CT castle on top, when the left team defends it, so that team's push reads downward
export type RushRoundPath = { slotOf: ReadonlyMap<number, number>; pending: number | null; slots: number; flip: boolean };

export function rushRoundPath(m: MatchDetail, rounds: MatchRound[], mapNumber: number | undefined, sideOf: (i: number) => TeamSide): RushRoundPath | null {
  const inputs = rushInputs(m, mapNumber, sideOf);
  if (!inputs) return null;
  const track = buildRushTrack(inputs.rooms, rounds, inputs.teams);
  const slotOf = new Map<number, number>();
  for (const s of track.slots) for (const v of s.visits) slotOf.set(v.round, s.index);
  // Convoy at 7-7 replaces the room in play, drawn in the middle
  for (const v of track.decider) slotOf.set(v.round, START_SLOT);
  const now = inputs.live && !track.over ? track.current : null;
  const flip = playOf(inputs.teams, 0) === "ct";
  return { slotOf, pending: now === null ? null : now === "decider" ? START_SLOT : now, slots: RUSH_RULES.roomSlots, flip };
}
