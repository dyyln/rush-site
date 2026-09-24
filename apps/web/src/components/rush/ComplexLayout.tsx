import type { RoomSlot } from "@rushsite/shared";
import type { TeamSide } from "@/components/ui/TeamMarker";
import { cx } from "@/components/ui/cx";
import { rushRoomName, rushSlotLabel } from "@/lib/rushRooms";
import { RoomImage } from "./RoomImage";
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
  // Always one row of seven with no how line, for the series room pick where three maps stack
  compact?: boolean;
};

// The seven rooms of the Complex from T castle to CT castle
export function ComplexLayout({ slots, sideOf, nextSlot = null, previewRoom = null, pendingLabel = "Open", flip = false, compact = false }: Props) {
  return (
    <ol className={cx(styles.layout, compact && styles.layoutCompact)} aria-label={flip ? "Rooms from CT castle to T castle" : "Rooms from T castle to CT castle"}>
      {(flip ? [...slots].reverse() : slots).map((s) => {
        const side = s.team !== undefined ? sideOf(s.team) : undefined;
        const preview = s.slot === nextSlot && !s.room ? previewRoom : null;
        const how = s.source === "castle" ? "Fixed" : s.source === "leftover" ? "Last room left" : s.source === "pick" ? (side === undefined ? "Picked" : side === "own" ? "Your pick" : "Their pick") : pendingLabel;
        return (
          <li
            key={s.slot}
            className={cx(styles.slot, s.slot === nextSlot && styles.slotNext)}
            data-side={side}
            data-source={s.source}
            aria-current={s.slot === nextSlot ? "step" : undefined}
          >
            {/* Which slot is only spoken. The image and the room name carry the rest */}
            <span className="visually-hidden">{rushSlotLabel(s.slot)}: </span>
            <span className={styles.slotFrame} data-preview={preview ? true : undefined}>
              {s.room || preview ? <RoomImage room={(s.room ?? preview)!} /> : <span className={styles.slotEmpty} aria-hidden="true" />}
              {(s.room || preview) && (
                <span className={styles.slotName} aria-hidden={preview ? true : undefined}>
                  {rushRoomName((s.room ?? preview)!)}
                </span>
              )}
            </span>
            {!s.room && <span className="visually-hidden">{s.slot === nextSlot ? "next pick" : pendingLabel}</span>}
            {!compact && s.room && s.source !== "open" && s.source !== "castle" && <span className={styles.slotHow}>{how}</span>}
          </li>
        );
      })}
    </ol>
  );
}
