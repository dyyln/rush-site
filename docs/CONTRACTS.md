# Component contracts

Every component builds against these. Change them here first, then in code.

## Directory ownership

| Dir | Owner | Language |
|---|---|---|
| `packages/shared` | shared | TypeScript. Zod schemas and config that every TS app imports |
| `apps/api` | api | Fastify. Auth, parties, queue, matchmaker, rating, veto, allocator, WebSocket, trust |
| `apps/api/src/modules/tournaments` | tournaments | Fastify plugin registered by api |
| `apps/web` | web | Next.js |
| `agent/` | agent | Go host agent |
| `plugin/` | plugin | C# CounterStrikeSharp plugin |
| `worker/` | worker | Python, demo analysis. Not started yet |
| `infra/` | infra | Docker Compose, Dockerfiles, server bootstrap scripts |

## Ids

- Users are identified by `steamId64` (string).
- Matches, parties, tickets, tournaments use UUID v4 strings.
- Modes are `"aim1v1" | "aim2v2" | "rush3v3"`.

## Mode config (packages/shared/src/config/modes.ts)

```ts
type ModeConfig = {
  mode: Mode
  teamSize: 1 | 2 | 3
  maps: MapEntry[]            // aim maps or rush arenas
  vetoFormat: "none" | "bo1-ban" | "ban-to-7" | "bo3-pickban"
  // none: no veto, single map (rush ladder for now). bo1-ban: alternate bans to one map (aim ladder). ban-to-7: alternate bans over 15 arenas to 7 (rush ladder). bo3-pickban: tournament finals only
  winCondition: string         // "first_to_16" or "valve_rush"
  cs2: { gameType: number; gameMode: number; workshopCollection?: string; execCfg: string }
}
type MapEntry = { id: string; displayName: string; workshopId?: string; mapName?: string }
```

Tier bands live in `packages/shared/src/config/tiers.ts`. Brand name lives in `packages/shared/src/config/brand.ts`.

## Agent API (api -> agent, HTTP on the host, bearer token from env)

- `GET /health` -> `{ ok, cs2Version, slots: { total, free }, updating: boolean }`
- `POST /servers` body `StartServerRequest` -> `StartServerResponse`
- `DELETE /servers/:matchId` -> 204
- `GET /servers` -> running servers

```ts
type StartServerRequest = {
  matchId: string
  mode: Mode
  map: MapEntry
  gslt: string
  password: string
  allowedSteamIds: string[]
  teams: { name: string; steamIds: string[] }[]
  webhookUrl: string           // api endpoint the plugin posts to
  webhookSecret: string
  demoUpload: { bucket: string; key: string; presignedPutUrl: string }
}
type StartServerResponse = { matchId: string; ip: string; port: number; connect: string }
```

Agent env: `RUSHSITE_AGENT_TOKEN`, `RUSHSITE_CS2_DIR`, `RUSHSITE_PORT_RANGE` (e.g. `27015-27030`), `RUSHSITE_PUBLIC_IP`.

## Plugin -> API webhooks (HTTP POST, header `X-Rushsite-Signature: sha256=<hmac of body with webhookSecret>`)

Endpoint `POST /webhooks/match/:matchId`. Body `{ event: MatchEvent }`.

```ts
type MatchEvent =
  | { type: "server_ready" }
  | { type: "player_connected"; steamId: string }
  | { type: "player_disconnected"; steamId: string }
  | { type: "match_started" }
  | { type: "round_end"; round: number; winnerTeam: string; score: Record<string, number> }
  | { type: "match_end"; winnerTeam: string; score: Record<string, number>; players: PlayerStats[]; demoUploaded: boolean }
  | { type: "match_abandoned"; reason: string; missingSteamIds: string[] }
type PlayerStats = { steamId: string; kills: number; deaths: number; headshots: number; damage: number }
```

The plugin reads its match config from `match.json` written by the agent next to the server cfg:
`{ matchId, mode, allowedSteamIds, teams, password, webhookUrl, webhookSecret, demoUpload, winCondition }`.

## API -> Web (WebSocket at `/ws`, JSON messages, auth via session cookie)

Server -> client events:
`queue_status`, `match_found` (accept window), `veto_state`, `server_ready` (connect string), `match_result`, `party_update`, `tournament_update`.
Client -> server: `accept_match`, `veto_vote`, `queue_join`, `queue_leave`.

Message shape: `{ type: string; payload: unknown; ts: number }`. Schemas in `packages/shared/src/ws.ts`.

## Veto

Ladder matches are one map. The API randomises firstTeam and builds the veto with `createVeto({ format: getModeConfig(mode).vetoFormat, ... })`. `vetoResult(state).deciders` is the map to play (bo1) or the 7 arenas in play order (rush).

## Rating

Glicko-2 per mode. `rating_events` stores before and after for every player per match so rollback is a replay. Team rating is the mean.

## Git

Nobody commits. Leave the working tree for the coordinator.

## FACEIT signal (packages/faceit)

`createFaceitClient({ apiKey }).lookupBySteamId(steamId64)` returns `FaceitSignal | null`. Null is no account and is neutral. `FaceitUnavailableError` means unknown, never negative.

```ts
type FaceitSignal = {
  faceitId: string; nickname: string
  banned: boolean; banReason?: string; banEndsAt?: string   // active ban
  pastBans: number; lastBanEndedAt?: string                  // expired bans, still count against Trusted
  skillLevel?: number; elo?: number; matchesPlayed?: number
  fetchedAt: string
}
```

The api trust module owns the numeric trust scale and passes weights via `signalToTrustDelta(signal, opts)`. `trust_signals` stores the signal JSON as-is. The api logs loudly on `reason === "auth"`.
