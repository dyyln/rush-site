import type { VetoKind } from "@rushsite/shared"

// vetoes.format for the Rush room ban and pick. Map vetoes store their VetoFormat
export const ROOM_VETO_FORMAT = "rush-rooms"

export const vetoKindOf = (format: string): VetoKind => (format === ROOM_VETO_FORMAT ? "rooms" : "maps")
