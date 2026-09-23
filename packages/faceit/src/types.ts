export type FaceitSignal = {
  faceitId: string
  nickname: string
  banned: boolean
  banReason?: string
  banEndsAt?: string
  pastBans: number
  lastBanEndedAt?: string
  skillLevel?: number
  elo?: number
  matchesPlayed?: number
  fetchedAt: string
}

export type FetchResponseLike = {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<FetchResponseLike>
