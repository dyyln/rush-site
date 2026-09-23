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

`GET /matches/:id` is public and returns `{ match: { id, mode, mapId, status, driver, startedAt, endedAt, teams: [{ name, score, players: [{ steamId, displayName, avatarUrl, tier, rating, kills, deaths, headshots, damage }] }], rounds: [{ round, winnerTeam, score: Record<team, number>, arena?, endedAt }], tournament?: { id, name, bracketMatchId, bestOf, gameNumber } } }`. Connect info is only included for participants, as `connect: { ip, port, password, connect }`. /ws needs a signed in session (401 otherwise). Signed-out viewers of match and tournament pages poll `GET /matches/:id` and `GET /tournaments/:id/bracket` every 5 s while the tab is visible.
Rounds come from `round_end` webhooks stored in `match_rounds`.
Live: client sends `subscribe_match { matchId }` / `unsubscribe_match { matchId }`; server sends `match_update { matchId, status, teams: [{ name, score }], lastRound?: Round }` on every round_end, match_started, match_end and cancel to subscribers. Any signed in player may subscribe.

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

## Trust-gated matchmaking

`queue_join` payload gains `minTrust?: "new" | "verified" | "trusted"` (default "new"). Stored on the ticket. Two tickets can only match when every player on each side meets the other side's `minTrust`. queue_status echoes `minTrust`. The preference is remembered per user in `user_settings.min_trust` and applied when omitted. Wait-time widening never relaxes it. The ETA shown reflects the filtered pool.

## Security (see docs/SECURITY.md)

- POST, PUT, PATCH and DELETE from a browser must carry an `Origin` of PUBLIC_URL or API_PUBLIC_URL. Anything else gets 403 `bad_origin`. Webhooks are exempt and requests without `Origin` (tools, server side) pass.
- `/ws` upgrades with a foreign `Origin` get 403 and upgrades without a valid session get 401. At most 8 sockets per user per instance, 429 `too_many_connections` above that. The web opens the socket only after `GET /me` succeeds.
- Bans: a player with an active ban gets no session. The Steam callback redirects to `${PUBLIC_URL}/banned?until=<ISO or empty for permanent>&reason=<text>`. A session that belongs to a banned player answers 401 `banned` on every route and on `/ws`, and `GET /me` answers 403 `{ error: "banned", details: { reason, until } }` so the web can show `/banned`. The check reads a Redis marker `ban:<steamId>` written by `BanService.ban`, cleared by unban, and refreshed from Postgres at every sign in.
- Session end: logout and ban close every open socket of that player on every instance with close code 4001 (reason `logged_out` or `banned`), sent through the `rs:ws` channel as audience `{ kind: "disconnect", steamIds, reason }`. The web does not reconnect blindly after 4001. It re-checks `GET /me` and reopens only when the session is still valid.
- HTTP rate limits live in `apps/api/src/lib/security.ts` (`RATE_RULES`), Redis backed, keyed per session or per IP. Over the limit answers 429 `rate_limited` with `Retry-After`. Socket messages are limited to a burst of 30 then 3 per second, over that the client gets an `error` with code `rate_limited`, and 100 strikes close the socket with 1008.

## Feature batch 3 (owners: ux, icons, cups-admin, review, admin-ops)

Same rules as batch 2: own folders, additive edits to shared files, schemas in packages/shared/src/schemas/<feature>.ts.

### Cups admin (owner: cups-admin) — team names, manual cups, schedules, admin cup tools
`tournament_entries.team_name` (nullable, 3 to 24 chars, profanity-filtered later). Enter body gains `teamName?`. Cup schedules move to a `cup_schedules` table (id, mode, cadence daily|weekly, weekday, start_time UTC, max_entrants, min_trust, best_of_final, enabled) seeded from the current config on first migration; the scheduler reads the table. Admin REST under /admin/tournaments: `GET /admin/tournaments/schedules`, `POST`, `PATCH /:id`, `DELETE /:id`; `POST /admin/tournaments` (one-off cup: mode, name, startsAt, maxEntrants, minTrust); `POST /admin/tournaments/:id/cancel`, `/reschedule { startsAt }`, `/entries/:entryId/disqualify { reason }`, `/matches/:bracketMatchId/force-result { winnerEntryId, reason }`. Every action writes admin_audit. Web: /admin/tournaments (schedules table with enable toggle, create cup form, running cups with the tools).

### Review queue (owner: review) — reviewer page, report outcomes
`flags` table gains status open|reviewing|cleared|confirmed, reviewer_steam_id, decided_at, note. A flag is created automatically when a match gets 2+ reports on the same player or any report from a Trusted player. `reports.outcome` received|reviewed|actioned|dismissed, updated when the flag is decided. REST: `GET /admin/review?status=` (flags with match summary, reports, player trust and stats), `POST /admin/review/:flagId/claim`, `/decide { outcome: cleared|confirmed, note, ban?: { reason, until? } }` (confirmed applies the ban through BanService and rolls back rating per the brief, and marks every report on that player in that match actioned). Reporters see outcomes on the match page and a "Your reports" list on their profile (`GET /me/reports`). Web: /admin/review with the round timeline and kill feed reused, report notes, decide form.

### Admin ops (owner: admin-ops) — dashboard, feature flags, announcements, queue open/close, manual ban
`feature_flags` (key pk, enabled, value jsonb, updated_by, updated_at) with `GET /flags` public (enabled keys only) and admin CRUD. Queue open/close per mode is the flag `queue.<mode>.open` (default true); the queue service refuses joins (503 mode_closed) and GET /status reports reason `closed`. `announcements` (id, text, level info|warn, starts_at, ends_at, dismissible) with `GET /announcements` public and admin CRUD, shown as a site-wide banner. Manual ban: admin users page gets a ban form by SteamID64 or profile URL with reason and optional end date (existing ban route). Dashboard: `GET /admin/metrics?range=1h|24h|7d` returning series for queue depth per mode, matches started per hour, median wait, active sockets, sampled every minute into a `metric_samples` table by the API loop (retain 7 days). Web: /admin overview gets the charts (inline SVG, dataviz palette), /admin/flags, /admin/announcements, queue toggles on the overview.
