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
  // Rooms not chosen yet are drawn at random by the map
  pendingLabel?: string;
};

// The seven rooms of the Complex from T castle to CT castle
export function ComplexLayout({ slots, sideOf, nextSlot = null, pendingLabel = "Open" }: Props) {
  return (
    <ol className={styles.layout} aria-label="Rooms from T castle to CT castle">
      {slots.map((s) => {
        const side = s.team !== undefined ? sideOf(s.team) : undefined;
        const how = s.source === "castle" ? "Fixed" : s.source === "leftover" ? "Last room left" : s.source === "pick" ? (side === undefined ? "Picked" : side === "own" ? "Your pick" : "Their pick") : pendingLabel;
        return (
          <li
            key={s.slot}
            className={cx(styles.slot, s.slot === nextSlot && styles.slotNext)}
            data-side={side}
            data-source={s.source}
            aria-current={s.slot === nextSlot ? "step" : undefined}
          >
            <span className={styles.slotLabel}>{rushSlotLabel(s.slot)}</span>
            {s.room ? <RoomImage room={s.room} /> : <span className={styles.slotEmpty} aria-hidden="true" />}
            <span className={styles.slotName}>{s.room ? rushRoomName(s.room) : s.slot === nextSlot ? "Next pick" : "Open"}</span>
            {s.source !== "open" && <span className={styles.slotHow}>{how}</span>}
          </li>
        );
      })}
    </ol>
  );
}
