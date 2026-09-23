// Maps our matchId to the DatHost server id of its clone.
// The api can back this with the matches.driverRef column.
export interface DathostServerStore {
  get(matchId: string): Promise<string | undefined>
  set(matchId: string, serverId: string): Promise<void>
  delete(matchId: string): Promise<void>
  // Optional. Used by capacity() to count clones we own.
  count?(): Promise<number>
}

export type FetchResponseLike = {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

export type FetchInit = {
  method?: string
  headers?: Record<string, string>
  body?: FormData
  signal?: AbortSignal
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponseLike>

// Subset of the DatHost GameServerOutput we rely on
export type DathostServer = {
  id: string
  name?: string
  ip?: string
  raw_ip?: string
  on?: boolean
  booting?: boolean
  server_error?: string | null
  ports?: { game?: number; gotv?: number }
  location?: string
  user_data?: string
}

export type DathostFileEntry = { path: string; size?: number | string }
