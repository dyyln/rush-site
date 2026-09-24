import { ALL_RUSH_ROOMS, RUSH_START_SLOT } from "@rushsite/shared";


export function rushRoomName(key: string): string {
  return ALL_RUSH_ROOMS.find((r) => String(r.id) === key)?.displayName ?? `Room ${key}`;
}

// Screenshot tile in public/rush-rooms, one per room id. Unknown keys show a placeholder
export function rushRoomImage(key: string): string | null {
  return ALL_RUSH_ROOMS.some((r) => String(r.id) === key) ? `/rush-rooms/${key}.webp` : null;
}

// Slot 0 is the T castle and slot 6 the CT castle
export function rushSlotLabel(slot: number): string {
  if (slot === 0) return "T castle";
  if (slot === 6) return "CT castle";
  if (slot === RUSH_START_SLOT) return "Start";
  // Numbered from each team's own castle
  return slot < RUSH_START_SLOT ? `T room ${slot}` : `CT room ${6 - slot}`;
}
