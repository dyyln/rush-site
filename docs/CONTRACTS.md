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

## Feature batch 2 (owners: challenges, match-api, match-web, stats, notify)

Rules for this batch: each owner adds new files under its own folders. Edits to shared web files (SiteHeader, tokens.css, api.ts, ws.ts, types.ts, mock.ts, ws-mock.ts) and to apps/api/src/app.ts and env.ts must be small and additive, never restructuring. New schemas go in packages/shared/src/schemas/<feature>.ts with one export line added to the barrel, and a ws.ts message added only by the owner named below.

### Challenges (owner: challenges) — features 2 rematch, 3 direct challenge links
Tables: `challenges` (id, mode, created_by, target_steam_id nullable, rematch_of_match_id nullable, code unique, status open|accepted|declined|expired|cancelled, expires_at, match_id nullable).
REST: `POST /challenges { mode, targetSteamId?, rematchOfMatchId? }` -> `{ challenge, url }`; `GET /challenges/:code`; `POST /challenges/:code/accept` (creates a match that skips queue and accept, runs veto for aim, allocates); `POST /challenges/:code/decline`; `GET /challenges/mine`.
WS (challenges owner adds): `challenge_update { challenge }` to creator and target.
Web: `/challenge/[code]` page, "Rematch" button on the finished match page and result toast, "Challenge" on profiles and party friends list.

### Match extras (owner: match-api for plugin+api, match-web for web) — features 7, 8, 10, 11
Plugin adds `MatchEvent { type: "kill"; round: number; tick: number; attacker: string; victim: string; weapon: string; headshot: boolean; wallbang: boolean; assister?: string }`. API stores in `match_kills`.
`GET /matches/:id` gains `kills: Kill[]` (only when finished or for participants and spectators after round end), `mvp: { steamId, reason }` computed as highest damage then kills, and `demo: { available: boolean, url?: string, expiresAt?: string }` (presigned GET, 10 minutes, only when demo_uploaded ok).
`POST /matches/:id/report { steamId, reason: aimbot|wallhack|griefing|other, note? }` -> 201, once per reporter per target per match. Stored in `reports`.
Details (match-api): schemas are in packages/shared/src/schemas/match-extras.ts. `kills`, `mvp` and `demo` are always present. `mvp` is null until the match is finished, and `reason` is `most_damage` or `most_kills` (kills broke a damage tie). While a match runs, `kills` holds only rounds that have a `round_end`. The plugin skips suicides and world deaths but sends team kills. Report returns 201 `{ report: { id, matchId, steamId, reason, createdAt } }`, 409 `already_reported` on a repeat, 409 `match_not_started`, 403 `not_a_participant` (reporter must have played), 400 `cannot_report_self` or `player_not_in_match`.
Web: kill feed per round (expandable under each timeline segment), MVP banner and summary on finished matches with per-player rating deltas, "Download demo" and "Watch in CS2" (steam://rungame/730 with playdemo is unreliable, so show the console command), report button with reason picker, share button that copies a link to `/matches/[id]/card` which is an OG image route rendering the score card.

### Stats (owner: stats) — features 1 queue ETA, 20 friends leaderboard, 22 tier distribution, 23 status page
`QueueModeStatus.estimatedSec` filled from the median wait of matches made in that mode in the last 30 minutes, null when fewer than 3.
`GET /leaderboard/:mode/friends` -> same shape as the global one, rows limited to Steam friends plus self.
`GET /leaderboard/:mode/distribution` -> `{ tiers: [{ tier, count, pct }], you?: { tier, percentile } }`.
`GET /status` (public) -> `{ regions: [{ region, hosts: n, slotsTotal, slotsFree, updating: boolean }], surge: { enabled, active: n }, modes: [{ mode, available: boolean, reason? }], updatedAt }`.
`GET /matches/live?limit=` (public, default 6, max 24) -> `{ matches: LiveMatch[] }` with `LiveMatch = { id, mode, mapId, status, startedAt, teams: [{ name, score, players: [{ steamId, displayName, avatarUrl }] }], tournament?: { id, name }, topRating? }`. Status ready or live, highest rated first.
Web: ETA next to the wait timer, Friends tab on the leaderboard, tier distribution bar above the table with your percentile, `/status` page linked from the footer and from any "mode unavailable" state.

### Notify and home (owner: notify) — features 5, 17
Web only. Settings stored in localStorage (wrapped in try/catch): sound on match found (on by default), browser notifications (opt in via Notification.requestPermission). Play a short bundled sound file under public/sounds on match_found and server_ready. Home page: next cup per mode with a live countdown and an "Entered" state from `GET /tournaments?status=open` plus `myEntryId`, and a "Watch live" list from `GET /matches/live?limit=6` (stats owner adds this endpoint returning MatchSummary rows).

Challenges details (owner: challenges): challenge matches and rematches are unrated (`match_source` = `challenge`), they count toward match history and stats but not rating. Tables carry created_at and updated_at, mode and status are text, no foreign keys. Decline by the creator means withdraw (`cancelled`). Queue cooldowns block accepting a challenge. Max 5 open challenges per player, 10 minute expiry.

## Friends and presence (owner: friends)

Tables: `friendships` (user_a, user_b ordered so a < b, status accepted, source steam|request, created_at, unique pair), `friend_requests` (id, from_steam_id, to_steam_id, status pending|accepted|declined|cancelled, created_at, responded_at, unique pending pair), `party_invites` (id, party_id, from_steam_id, to_steam_id, invite_code, status pending|accepted|declined|expired, expires_at 10 min).
Auto-link: on login, fetch Steam friends (if public), and for every friend who is a registered user upsert an accepted friendship with source steam. Never remove friendships automatically.
Presence: Redis key per user `presence:<steamId>` with state online|queue|match and ttl 60 s, refreshed by the WS heartbeat and by queue and match transitions. Offline when the key is absent.
REST: `GET /friends` (replaces the old Steam passthrough) -> `{ friends: [{ steamId, displayName, avatarUrl, presence: offline|online|queue|match, source, tiers: Record<mode, tier> }], incoming: FriendRequest[], outgoing: FriendRequest[], steamListAvailable: boolean }`; `POST /friends/requests { steamId }`; `POST /friends/requests/:id/accept|decline`; `DELETE /friends/requests/:id` (cancel); `DELETE /friends/:steamId` (unfriend); `GET /friends/recent` -> players from the viewer's last 20 matches not already friends; `POST /parties/invites { steamId }` -> creates an in-site invite for a friend (creates the party if needed); `POST /parties/invites/:id/accept|decline`.
WS: `friend_update { kind: request|accepted|declined|removed|presence, steamId, request?, presence? }` to both sides; `party_invite { invite: { id, partyId, from: { steamId, displayName, avatarUrl }, inviteCode, expiresAt } }` to the target; presence changes are pushed only to the user's friends.
Web: `/friends` page (friends with presence dots and quick actions Invite / Challenge / Profile, incoming requests, recent players with Add), a friends card on /play backed by the same data, a header badge count for pending requests and invites, Add friend button on profiles, invite toast with Accept and Decline.

## Realtime efficiency (from docs/SCALABILITY.md)

- `tournament_update` no longer carries `bracket`. It carries `{ kind, tournament: TournamentSummary, bracketVersion: number, bracketMatchId? }`. Clients fetch `GET /tournaments/:id/bracket` (ETag = version) when the version changes and they are viewing that cup. Broadcast audience: `started`, `completed`, `cancelled` go to all; `match_live`, `match_updated`, `entries_changed` go only to sockets subscribed via `subscribe_tournament { tournamentId }` / `unsubscribe_tournament`.
- Reconnect snapshot: the API keeps `snapshot:<steamId>` in Redis (party, queue ticket, current match phase) updated on change, and serves it on WS connect without Postgres queries. The web reconnects with jitter (random 0 to 3 s added to the backoff).
- Slow clients: the server checks `bufferedAmount` before each send, drops non-critical messages (mode_stats, queue_status refreshes) when above 256 KB, and closes the socket above 1 MB.
- Match tick is split: a timers loop (accept, veto, connect deadlines, every 1 s, DB only) and an allocation loop (agent and DatHost HTTP, every 2 s, concurrency limited).
Details (friends): schemas in packages/shared/src/schemas/friends.ts. The Redis value of `presence:<steamId>` is JSON `{ state, detail? }`. `detail` is `{ matchId, mode, mapId, score: [own, opp] }` in a match and `{ modes }` in queue. It appears on `GET /friends` rows and on `friend_update` presence pushes, and is refreshed on server ready, match start and every round_end. `GET /friends` also returns `steamOnly: [{ steamId, displayName, avatarUrl, personaState }]` (Steam friends without an account, for Send link) and `tiers` values may be `unranked`. Unfriend sets `friendships.status = removed` so the Steam auto-link does not re-add the pair. A new request re-activates it. Extra routes: `POST /friends/sync` -> `{ steamListAvailable, linked }`, `GET /friends/pending` -> `{ requests: n, invites: PartyInvite[] }` for the header badge. `POST /friends/requests` answers 201 on create and 200 when the request already exists, and sending to someone with a pending request to you accepts it. Cancel sends `friend_update` kind `declined` with request status `cancelled`. Invites: any party member may invite a friend, 403 `not_friends`, 409 `party_full` or `already_in_party`, 410 `invite_expired` or `party_gone`. `party_invite` is re-sent to the target with `status` when an invite is accepted, declined or expires so other tabs drop it. Accept returns `{ invite, party }` and joins through `PartyService.join` with the invite code, falling back to the party's current code if it was rotated.

Parties details (owner: party-qa): all party mutations run in a transaction that locks the party rows. `GET /parties/join/:code` is public and returns `{ inviter, size, full, alreadyMember }` or 404 invite_not_found. Kicking a member rotates the invite code automatically. Invite codes do not expire, "expired" means rotated or the party closed. Join, kick and leave are refused with 409 party_locked while the party's match is in accept, veto or live. CORS allows GET, POST, PUT, PATCH, DELETE with credentials for PUBLIC_URL.
