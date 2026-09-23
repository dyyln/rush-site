import type { QueueStatusPayload, WsEnvelope } from "@rushsite/shared"
import type { Redis } from "ioredis"
import type { Audience, Notifier, Outgoing } from "../modules/ws/hub.js"
import { realtimeMetrics } from "./backpressure.js"

// Latest state a client needs to re-render after a reconnect, kept per user in Redis
export type SnapshotPatch = {
  party?: WsEnvelope
  queue?: WsEnvelope
  // null clears the match phase once the match is over
  match?: WsEnvelope | null
}

export type Snapshot = {
  party: WsEnvelope
  queue: WsEnvelope
  match: WsEnvelope | null
}

const TTL_MS = 12 * 60 * 60 * 1000
// A result is replayed only this soon after it was sent
const RESULT_REPLAY_MS = 2 * 60 * 1000

const MATCH_PHASE = new Set(["match_found", "veto_state", "server_ready"])
const TRACKED = new Set(["party_update", "queue_status", "match_result", "match_cancelled", ...MATCH_PHASE])

export const snapshotKey = (steamId: string) => `snapshot:${steamId}`

export class SnapshotStore {
  constructor(
    private readonly redis: Redis,
    private readonly now: () => number = Date.now,
  ) {}

  // Overwrites the given fields. With onlyMissing it keeps fields a live message already wrote
  async update(steamId: string, patch: SnapshotPatch, opts: { onlyMissing?: boolean } = {}): Promise<void> {
    const fields: [string, string][] = []
    if (patch.party) fields.push(["party", JSON.stringify(patch.party)])
    if (patch.queue) fields.push(["queue", JSON.stringify(patch.queue)])
    if (patch.match !== undefined) {
      fields.push(["match", JSON.stringify(patch.match)])
      // Start of a match phase. A queued status sent before it is stale because claiming a ticket sends none
      if (patch.match && MATCH_PHASE.has(patch.match.type)) fields.push(["matchTs", String(patch.match.ts)])
    }
    if (fields.length === 0) return
    const key = snapshotKey(steamId)
    const multi = this.redis.multi()
    for (const [f, v] of fields) {
      if (opts.onlyMissing) multi.hsetnx(key, f, v)
      else multi.hset(key, f, v)
    }
    multi.pexpire(key, TTL_MS)
    await multi.exec()
  }

  // Returns null unless party, queue and match are all known
  async read(steamId: string): Promise<Snapshot | null> {
    const raw = await this.redis.hgetall(snapshotKey(steamId))
    if (raw.party === undefined || raw.queue === undefined || raw.match === undefined) return null
    const party = JSON.parse(raw.party) as WsEnvelope
    let queue = JSON.parse(raw.queue) as WsEnvelope
    let match = JSON.parse(raw.match) as WsEnvelope | null
    const matchTs = raw.matchTs ? Number(raw.matchTs) : 0
    const q = queue.payload as QueueStatusPayload
    const now = this.now()
    const idle = (): WsEnvelope => ({
      ...queue,
      payload: { state: "idle", partyId: q.partyId, modes: [], cooldownUntil: null } satisfies QueueStatusPayload,
    })
    if (q.state === "queued" && queue.ts < matchTs) queue = idle()
    else if (q.state === "cooldown" && (q.cooldownUntil ?? 0) <= now) queue = idle()
    if (match?.type === "match_result" && now - match.ts > RESULT_REPLAY_MS) match = null
    return { party, queue, match }
  }

  // Stores outgoing messages that describe a user's state
  record(audience: Audience, msg: Outgoing): Promise<unknown> | null {
    if (audience.kind !== "users" || !TRACKED.has(msg.type)) return null
    const env: WsEnvelope = { type: msg.type, payload: msg.payload, ts: msg.ts }
    let patch: SnapshotPatch
    if (msg.type === "party_update") patch = { party: env }
    else if (msg.type === "queue_status") patch = { queue: env }
    else if (msg.type === "match_cancelled") patch = { match: null }
    else patch = { match: env }
    return Promise.all(audience.steamIds.map((id) => this.update(id, patch)))
  }
}

// Wraps a notifier so user state messages also land in the snapshot
export function withSnapshots(inner: Notifier, store: SnapshotStore, onError?: (err: unknown) => void): Notifier {
  return {
    send(audience, msg) {
      inner.send(audience, msg)
      const p = store.record(audience, msg)
      if (p)
        p.catch((err: unknown) => {
          realtimeMetrics.snapshotWriteErrors++
          onError?.(err)
        })
    },
  }
}
