import type { StartServerRequest, StartServerResponse } from "./schemas/agent.js"

export type ServerDriverName = "hetzner" | "dathost"

export interface ServerDriver {
  name: ServerDriverName
  capacity(): Promise<{ free: number; total: number }>
  start(req: StartServerRequest): Promise<StartServerResponse>
  stop(matchId: string): Promise<void>
  // DatHost only. Call after match_end
  fetchDemo?(matchId: string): Promise<ReadableStream | Buffer | null>
}
