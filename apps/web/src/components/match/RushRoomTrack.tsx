"use client";

import { useEffect, useId, useRef } from "react";
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

function visitText(v: Visit): string {
  if (!v.team) return `Round ${v.round}, draw`;
  const toward = v.toward === "ct" ? RUSH_ROOMS.castles.ct.displayName : RUSH_ROOMS.castles.t.displayName;
  return `Round ${v.round} won by ${v.team.label}, play moved toward ${toward}`;
}

export function RushRoomTrack({ rooms, rounds, teams, live, building, title = "Room track" }: Props) {
  const headingId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const track = buildRushTrack(rooms, rounds, teams);
  const playing = live && !track.over;
  const current = playing ? track.current : null;
  const tTeam = playOf(teams, 0) === "t" ? teams[0] : teams[1];
  const ctTeam = tTeam === teams[0] ? teams[1] : teams[0];
  const defender = (i: number) => (i === 0 ? tTeam : i === LAST_SLOT ? ctTeam : null);

  // Keeps the current room in view where the track scrolls
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>("[aria-current]");
    if (!el || !listRef.current || listRef.current.scrollWidth <= listRef.current.clientWidth) return;
    const list = listRef.current;
    list.scrollLeft = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2;
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
      <ol className={styles.track} ref={listRef}>
        {track.slots.map((slot) => {
          const isCurrent = current === slot.index;
          const isLast = !playing && track.last === slot.index;
          const def = defender(slot.index);
          const reached = slot.visits.length > 0 || isCurrent;
          return (
            <li
              key={slot.index}
              className={cx(styles.slot, !building && !reached && styles.unreached)}
              data-kind={slot.kind}
              data-side={def?.side}
              data-current={isCurrent || undefined}
              data-last={isLast || undefined}
              data-empty={(building && !slot.room) || undefined}
              data-latest={(building && building.latestSlot === slot.index) || undefined}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className={styles.kind}>
                {slot.kind === "castle" ? (slot.index === 0 ? "T castle" : "CT castle") : SLOT_LABEL[slot.kind]}
                <span className="visually-hidden">, slot {slot.index}</span>
              </span>
              {slot.room ? (
                <span className={styles.thumb}>
                  <RoomImage room={String(slot.room.id)} />
                </span>
              ) : (
                building && <span className={cx(styles.thumb, styles.thumbEmpty)} aria-hidden="true" />
              )}
              <span className={styles.name}>
                {slot.room?.displayName ?? (
                  <span className={styles.unknown}>{building ? `Slot ${slot.index} · ${slot.kind === "start" ? "start" : "mid"}` : playing ? "Not drawn yet" : "Not played"}</span>
                )}
              </span>
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
              {slot.visits.length > 0 && (
                <ul className={styles.marks} aria-label={`Rounds in ${slot.room?.displayName ?? `slot ${slot.index}`}`}>
                  {slot.visits.map((v) => (
                    <Mark key={v.round} v={v} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {(track.decider.length > 0 || current === "decider") && (
        <div className={styles.decider} data-current={current === "decider" || undefined} aria-current={current === "decider" ? "step" : undefined}>
          <span className={styles.kind}>Decider at 7-7</span>
          <span className={styles.thumb}>
            <RoomImage room={String(RUSH_ROOMS.decider.id)} />
          </span>
          <span className={styles.name}>{RUSH_ROOMS.decider.displayName}</span>
          {current === "decider" && (
            <span className={styles.now}>
              <span className={styles.pulse} aria-hidden="true" />
              Current room
            </span>
          )}
          {track.decider.length > 0 && (
            <ul className={styles.marks} aria-label={`Rounds in ${RUSH_ROOMS.decider.displayName}`}>
              {track.decider.map((v) => (
                <Mark key={v.round} v={v} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

// One round in a room. Shape, arrow and text carry the result as well as colour
function Mark({ v }: { v: Visit }) {
  const text = visitText(v);
  return (
    <li className={styles.mark} data-side={v.team?.side} title={text}>
      {v.team ? <TeamMarker side={v.team.side} /> : null}
      <span className="mono" aria-hidden="true">
        {v.round}
      </span>
      {v.toward && (
        <svg className={styles.arrow} data-toward={v.toward} viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
          <path d="M2 5h6M5.5 2.5L8 5 5.5 7.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <span className="visually-hidden">{text}</span>
    </li>
  );
}

// Match page wrapper. mapNumber picks one map of a series, where each map is its own Rush match
export function MatchRushTrack({ m, rounds, mapNumber, sideOf }: { m: MatchDetail; rounds: MatchRound[]; mapNumber?: number; sideOf: (i: number) => TeamSide }) {
  const [a, b] = m.teams;
  if (!a || !b) return null;
  const map = mapNumber === undefined ? undefined : m.maps?.find((x) => x.mapNumber === mapNumber);
  const rooms = map ? map.rushRooms : m.rushRooms;
  const live = m.status === "live" && (!map || map.status === "live");
  // Before the first round only a known room draw is worth showing
  if (rounds.length === 0 && !(live && rooms)) return null;
  return (
    <RushRoomTrack
      rooms={rooms}
      rounds={rounds}
      live={live}
      teams={[
        { name: a.name, label: a.displayName ?? a.name, side: sideOf(0), play: a.side },
        { name: b.name, label: b.displayName ?? b.name, side: sideOf(1), play: b.side },
      ]}
    />
  );
}
