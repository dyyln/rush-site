import { z } from "zod"
import type { StartServerRequest, StartServerResponse } from "./schemas/agent.js"

export const ServerDriverNameSchema = z.enum(["hetzner", "dathost"])
export type ServerDriverName = z.infer<typeof ServerDriverNameSchema>

export interface ServerDriver {
  name: ServerDriverName
  capacity(): Promise<{ free: number; total: number }>
  start(req: StartServerRequest): Promise<StartServerResponse>
  stop(matchId: string): Promise<void>
  // DatHost only. Call after match_end
  fetchDemo?(matchId: string): Promise<ReadableStream | Buffer | null>
  // Liveness for the match watchdog. gone means the driver is sure no server runs for the match
  status?(matchId: string): Promise<ServerLiveness>
}

export type ServerLiveness = "alive" | "gone" | "unknown"
