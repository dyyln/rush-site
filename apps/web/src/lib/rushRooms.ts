import { ALL_RUSH_ROOMS, RUSH_START_SLOT } from "@rushsite/shared";

// Rooms with a cropped image in public/rush-rooms. The rest show a placeholder
const WITH_IMAGE = new Set(["101", "102", "103", "104", "201", "202", "204", "212", "301", "401"]);

export function rushRoomName(key: string): string {
  return ALL_RUSH_ROOMS.find((r) => String(r.id) === key)?.displayName ?? `Room ${key}`;
}

export function rushRoomImage(key: string): string | null {
  return WITH_IMAGE.has(key) ? `/rush-rooms/${key}.webp` : null;
}

// Slot 0 is the T castle and slot 6 the CT castle
export function rushSlotLabel(slot: number): string {
  if (slot === 0) return "T castle";
  if (slot === 6) return "CT castle";
  if (slot === RUSH_START_SLOT) return "Start";
  // Numbered from each team's own castle
  return slot < RUSH_START_SLOT ? `T room ${slot}` : `CT room ${6 - slot}`;
}
