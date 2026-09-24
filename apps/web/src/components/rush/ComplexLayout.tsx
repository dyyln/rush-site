import type { RoomSlot } from "@rushsite/shared";
import type { TeamSide } from "@/components/ui/TeamMarker";
import { cx } from "@/components/ui/cx";
import { rushRoomName, rushSlotLabel } from "@/lib/rushRooms";
import { RoomImage } from "./RoomImage";
import { SideEmblem } from "./SideEmblem";
import styles from "./Rush.module.css";

type Props = {
  slots: RoomSlot[];
  // Colour side of each team index
  sideOf: (team: 0 | 1) => TeamSide;
  // Slot the current pick lands in
  nextSlot?: number | null;
  // Room to preview in the next slot, such as the card under the pointer. Drawn grey under the stripes
  previewRoom?: string | null;
  // Rooms not chosen yet are drawn at random by the map
  pendingLabel?: string;
  // Draws CT castle on the left, when the left team defends it, so that team attacks left to right
  flip?: boolean;
  // Castles while the map's sides are open. unset: empty. choosing: empty under the stripes while a team picks sides.
  // preview: grey under the stripes, drawn with the side being hovered or voted. set (the default): the castles
  castles?: "set" | "unset" | "choosing" | "preview";
  // Team playing CT. Puts a CT or T mark in that team's colour on each castle. null or left out: no marks
  ctTeam?: 0 | 1 | null;
  // Always one row of seven with no how line, for the series room pick where three maps stack
  compact?: boolean;
};

// The seven rooms of the Complex from T castle to CT castle
export function ComplexLayout({ slots, sideOf, nextSlot = null, previewRoom = null, pendingLabel = "Open", flip = false, compact = false, castles = "set", ctTeam = null }: Props) {
  return (
    <ol className={cx(styles.layout, compact && styles.layoutCompact)} aria-label={flip ? "Rooms from CT castle to T castle" : "Rooms from T castle to CT castle"}>
      {(flip ? [...slots].reverse() : slots).map((s) => {
        const side = s.team !== undefined ? sideOf(s.team) : undefined;
        const castle = s.source === "castle";
        const hideCastle = castle && (castles === "unset" || castles === "choosing");
        const choosing = castle && (castles === "choosing" || castles === "preview");
        const room = hideCastle ? null : s.room;
        const preview = s.slot === nextSlot && !s.room ? previewRoom : castle && castles === "preview" ? s.room : null;
        const how = s.source === "castle" ? "Fixed" : s.source === "leftover" ? "Last room left" : s.source === "pick" ? (side === undefined ? "Picked" : side === "own" ? "Your pick" : "Their pick") : pendingLabel;
        return (
          <li
            key={s.slot}
            className={cx(styles.slot, (s.slot === nextSlot || choosing) && styles.slotNext)}
            data-side={side}
            data-source={s.source}
            aria-current={s.slot === nextSlot ? "step" : undefined}
          >
            {/* Which slot is only spoken. The image and the room name carry the rest */}
            <span className="visually-hidden">{rushSlotLabel(s.slot)}: </span>
            <span className={styles.slotFrame} data-preview={preview ? true : undefined}>
              {preview || room ? <RoomImage room={(preview ?? room)!} /> : <span className={styles.slotEmpty} aria-hidden="true" />}
              {(preview || room) && (
                <span className={styles.slotName} aria-hidden={preview ? true : undefined}>
                  {rushRoomName((preview ?? room)!)}
                </span>
              )}
              {castle && !hideCastle && ctTeam !== null && (
                <SideEmblem
                  play={s.slot === 0 ? "t" : "ct"}
                  side={sideOf(s.slot === 0 ? (ctTeam === 0 ? 1 : 0) : ctTeam)}
                />
              )}
            </span>
            {hideCastle && <span className="visually-hidden">side not chosen yet</span>}
            {!s.room && <span className="visually-hidden">{s.slot === nextSlot ? "next pick" : pendingLabel}</span>}
            {!compact && s.room && s.source !== "open" && s.source !== "castle" && <span className={styles.slotHow}>{how}</span>}
          </li>
        );
      })}
    </ol>
  );
}
