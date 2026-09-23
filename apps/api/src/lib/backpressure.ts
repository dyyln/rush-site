// Per process counters shown on GET /health
export const realtimeMetrics = {
  droppedSlow: 0,
  closedSlow: 0,
  snapshotHits: 0,
  snapshotMisses: 0,
  snapshotWriteErrors: 0,
}

export const SOFT_BUFFER_LIMIT = 256 * 1024
export const HARD_BUFFER_LIMIT = 1024 * 1024
export const CLOSE_TRY_AGAIN_LATER = 1013

// Periodic sends carry state the next one repeats, so a slow client can skip them.
// Queue status only counts when it is flagged as a refresh
function droppable(type: string, payload: unknown): boolean {
  if (type === "mode_stats") return true
  return type === "queue_status" && (payload as { refresh?: boolean } | null)?.refresh === true
}

export interface BufferedSocket {
  readonly readyState: number
  readonly bufferedAmount?: number
  send(data: string): void
  close?(code?: number, reason?: string): void
}

const OPEN = 1

// Sends unless the socket is too far behind. Returns true when the frame was queued
export function sendChecked(socket: BufferedSocket, msg: { type: string; payload: unknown }, data: string): boolean {
  if (socket.readyState !== OPEN) return false
  const buffered = socket.bufferedAmount ?? 0
  if (buffered > HARD_BUFFER_LIMIT) {
    realtimeMetrics.closedSlow++
    socket.close?.(CLOSE_TRY_AGAIN_LATER, "slow consumer")
    return false
  }
  if (buffered > SOFT_BUFFER_LIMIT && droppable(msg.type, msg.payload)) {
    realtimeMetrics.droppedSlow++
    return false
  }
  socket.send(data)
  return true
}
