import type { VetoKind } from "@rushsite/shared"

// vetoes.format for the Rush room ban and pick. Map vetoes store their VetoFormat
export const ROOM_VETO_FORMAT = "rush-rooms"
// vetoes.format for the Rush room pick that covers every map of a series
export const SERIES_ROOM_VETO_FORMAT = "rush-series-rooms"

export const vetoKindOf = (format: string): VetoKind =>
  format === ROOM_VETO_FORMAT ? "rooms" : format === SERIES_ROOM_VETO_FORMAT ? "series-rooms" : "maps"
