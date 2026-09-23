# Component contracts

Every component builds against these. Change them here first, then in code.

## Directory ownership

| Dir | Owner | Language |
|---|---|---|
| `packages/shared` | shared | TypeScript. Zod schemas and config that every TS app imports |
| `apps/api` | api | Fastify. Auth, parties, queue, matchmaker, rating, veto, allocator, WebSocket, trust |
| `apps/api/src/modules/tournaments` | tournaments | Fastify plugin registered by api |
| `apps/api/src/modules/admin` | admin | Fastify plugin registered by api, all routes under /admin, gated on ADMIN_STEAM_IDS |
| `apps/web/src/app/admin` | admin | Next.js admin pages |
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
  cs2: { gameType: number; gameMode: number; execCfg: string; extraArgs?: string[] }   // from MODE_CONFIGS, the agent prefers this over its own table
}
type StartServerResponse = { matchId: string; ip: string; port: number; connect: string }
```

If a CS2 process crashes, the agent POSTs `{ event: { type: "match_abandoned", reason: "server_crashed", missingSteamIds: [] } }` to the match's webhookUrl, signed with webhookSecret like the plugin does.

The plugin reads its config path from the env var `RUSHSITE_MATCH_JSON` set by the agent.

Agent env: `RUSHSITE_AGENT_TOKEN`, `RUSHSITE_CS2_DIR`, `RUSHSITE_PORT_RANGE` (e.g. `27015-27030`), `RUSHSITE_PUBLIC_IP`.

## Plugin -> API webhooks (HTTP POST, header `X-Rushsite-Signature: sha256=<hmac of body with webhookSecret>`)

Endpoint `POST /webhooks/match/:matchId`. Body `{ event: MatchEvent }`. `webhookUrl` in match.json is that full URL. The presigned demo PUT must not sign a Content-Type, the plugin sends application/octet-stream.

```ts
type MatchEvent =
  | { type: "server_ready" }
  | { type: "player_connected"; steamId: string }
  | { type: "player_disconnected"; steamId: string }
  | { type: "match_started" }
  | { type: "round_end"; round: number; winnerTeam: string; score: Record<string, number>; arena?: string }   // winnerTeam may be "draw". arena only in rush
  | { type: "match_end"; winnerTeam: string; score: Record<string, number>; players: PlayerStats[]; demoUploaded: boolean }   // sent immediately at match end, demoUploaded is false when the upload is still running
  | { type: "demo_uploaded"; ok: boolean; bytes?: number; error?: string }   // after match_end or match_abandoned once the upload finishes
  | { type: "match_abandoned"; reason: string; missingSteamIds: string[] }
type PlayerStats = { steamId: string; kills: number; deaths: number; headshots: number; damage: number }
```

The plugin reads its match config from `match.json` written by the agent next to the server cfg:
`{ matchId, mode, allowedSteamIds, teams, password, webhookUrl, webhookSecret, demoUpload, winCondition }`.

## API -> Web (WebSocket at `/ws`, JSON messages, auth via session cookie)

Server -> client events:
`queue_status`, `match_found` (accept window), `veto_state`, `server_ready` (ip, port, password, connect string), `match_result`, `party_update`, `tournament_update`, `mode_stats` (broadcast to all: per mode playersInQueue and matchesInProgress), `match_cancelled` (matchId, reason), `error` (code, message, sent to the client whose message was rejected), `admin_event` (admins only).
Client -> server: `subscribe_match`, `unsubscribe_match`, `accept_match`, `veto_vote`, `queue_join` (payload `{ modes: Mode[] }`, every mode must have teamSize >= party size), `queue_leave` (payload `{ modes?: Mode[] }`, omit to leave all).

One queue ticket per party holds a set of modes. Matching in any mode consumes the ticket and removes the party from every other mode. `queue_status` reports per-mode wait state.

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

## Admin (apps/api/src/modules/admin, apps/web/src/app/admin)

Access: session steamId must be in `ADMIN_STEAM_IDS` (comma separated env). Non-admins get 404, not 403.
REST under `/admin`: `GET /admin/overview`, `GET /admin/queue`, `GET /admin/matches?status=`, `GET /admin/matches/:id`, `GET /admin/hosts`, `GET /admin/users/:steamId`, `GET /admin/events?limit=` (recent webhooks and errors), `POST /admin/queue/:ticketId/remove`, `POST /admin/matches/:id/cancel`, `POST /admin/users/:steamId/ban`, `POST /admin/users/:steamId/unban`, `POST /admin/users/:steamId/trust`.
WS: admins additionally receive `admin_event` messages `{ kind: queue|match|host|webhook|error|user, payload }` for live refresh. Unban does not restore rolled-back ratings.

## Server drivers (packages/shared/src/drivers.ts, implementations in apps/api and packages/dathost)

```ts
interface ServerDriver {
  name: "hetzner" | "dathost"
  capacity(): Promise<{ free: number; total: number }>
  start(req: StartServerRequest): Promise<StartServerResponse>
  stop(matchId: string): Promise<void>
  fetchDemo?(matchId: string): Promise<ReadableStream | Buffer | null>   // dathost only, after match_end
}
```
Allocator order: every Hetzner host first. If none has a free slot, wait `SURGE_WAIT_SEC` (default 20) polling, then use DatHost. Matches record `driver` and `driverRef` on the matches table so stop and demo fetch route correctly. Env: `DATHOST_EMAIL` and `DATHOST_PASSWORD` (DatHost uses HTTP Basic, use a dedicated account), `DATHOST_TEMPLATE_SERVER_ID` (a prepared server with our plugin installed, cloned per match), `DATHOST_LOCATION` (default `dusseldorf`, their Frankfurt site), `SURGE_WAIT_SEC`. The API must call fetchDemo before stop, deleting the clone deletes its files.

## Match pages

`GET /matches/:id` is public and returns `{ match: { id, mode, mapId, status, driver, startedAt, endedAt, teams: [{ name, score, players: [{ steamId, displayName, avatarUrl, tier, rating, kills, deaths, headshots, damage }] }], rounds: [{ round, winnerTeam, score: Record<team, number>, arena?, endedAt }], tournament?: { id, name, bracketMatchId, bestOf, gameNumber } } }`. Connect info is only included for participants, as `connect: { ip, port, password, connect }`. Signed-out spectators may open /ws and only subscribe.
Rounds come from `round_end` webhooks stored in `match_rounds`.
Live: client sends `subscribe_match { matchId }` / `unsubscribe_match { matchId }`; server sends `match_update { matchId, status, teams: [{ name, score }], lastRound?: Round }` on every round_end, match_started, match_end and cancel to subscribers. Anyone may subscribe.
