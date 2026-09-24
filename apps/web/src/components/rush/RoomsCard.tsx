import { RUSH_ROOM_VETO, RUSH_START_SLOT, roomSlots, type RoomSlot, type TeamIndex, type VetoState } from "@rushsite/shared";
import { Card } from "@/components/ui/Card";
import type { TeamSide } from "@/components/ui/TeamMarker";
import { ComplexLayout } from "./ComplexLayout";

// Slots from the stored room ids. Who picked what is only known while the veto state is at hand
function slotsFromIds(ids: number[]): RoomSlot[] {
  return ids.map((id, slot) => ({
    slot,
    room: String(id),
    source: slot === 0 || slot === ids.length - 1 ? "castle" : slot === RUSH_START_SLOT ? "leftover" : "pick",
  }));
}

// The rooms a Rush match plays, from the room veto
export function RoomsCard({ rushRooms, veto, sideOf }: { rushRooms?: number[]; veto?: VetoState | null; sideOf: (team: TeamIndex) => TeamSide }) {
  const slots = veto?.done ? roomSlots(veto, RUSH_ROOM_VETO.format) : rushRooms?.length ? slotsFromIds(rushRooms) : null;
  if (!slots) return null;
  return (
    <Card eyebrow="Rush" title="Rooms">
      <ComplexLayout slots={slots} sideOf={sideOf} />
    </Card>
  );
}
