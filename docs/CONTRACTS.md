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
  winCondition: string         // "first_to_13" or "valve_rush"
  cs2: { gameType: number; gameMode: number; execCfg: string; extraArgs?: string[] }
  // execCfg is our cfg, shipped by the agent in agent/internal/match/cfgs. Never a Valve gamemode cfg, the game runs those itself
}
type MapEntry = { id: string; displayName: string; workshopId?: string; mapName?: string; loadout?: MapLoadout }
type MapLoadout = { primary?: { ct?: string; t?: string }; secondary?: { ct?: string; t?: string }; armor?: "none" | "kevlar" | "kevlar_helmet" }
// loadout overrides the plugin's default aim loadout for that map. Weapons are weapon_<name>, the agent refuses anything else. Admins set it per map in /admin/maps (the map_pool table). Shared config sets none
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
  teams: { name: string; steamIds: string[]; displayName?: string; side?: "ct" | "t" }[]   // side is optional, teams[0] defaults to CT and teams[1] to T, the plugin refuses two teams on one side
  webhookUrl: string           // api endpoint the plugin posts to
  webhookSecret: string
  demoUpload: { bucket: string; key: string; presignedPutUrl: string }
  cs2: { gameType: number; gameMode: number; execCfg: string; extraArgs?: string[]; workshopId?: string; mapName?: string }
  // Required. Built by resolveLaunch(mode, map) from MODE_CONFIGS, with exactly one of workshopId or mapName matching map.
  // This is the only launch table. The agent refuses (400) an execCfg it does not ship, and DatHost maps from the same block
  series?: SeriesConfig        // best-of series on this one server. map, cs2 and demoUpload then describe map startMapNumber
  brand?: { name: string; siteUrl: string }   // chat prefix and web root. The API sends BRAND_NAME and PUBLIC_URL
  slug?: string                // match room word id. The plugin links to <siteUrl>/matches/<slug or matchId>
}
type SeriesConfig = {
  bestOf: number               // 2 to 7, 3 for cup finals
  maps: MapEntry[]             // full ordered list, length bestOf, each with workshopId or mapName
  startMapNumber: number       // counting from 1. Above 1 only when a series resumes after a crash
  wins: Record<string, number> // maps each team name already won before startMapNumber, normally zeros
  demoUploads: DemoUpload[]    // one per map, index mapNumber - 1
}
type StartServerResponse = { matchId: string; ip: string; port: number; connect: string }
```

If a CS2 process crashes, the agent POSTs `{ event: { type: "match_abandoned", reason: "server_crashed", missingSteamIds: [] } }` to the match's webhookUrl, signed with webhookSecret like the plugin does.

The plugin reads its config path from the env var `RUSHSITE_MATCH_JSON` set by the agent.

Both drivers write the mode settings to `cfg/rushsite/matches/<matchId>/mode.cfg`. The agent's launch line ends with `+exec rushsite/matches/<matchId>/server.cfg +exec rushsite/matches/<matchId>/mode.cfg`. Valve's gamemode cfg runs on map load after that, so the plugin runs `exec rushsite/matches/<matchId>/mode.cfg` again at aim match start.

`agent/testdata/modes.json` is generated from shared config (`pnpm -C packages/shared export:modes`). A shared test fails when it is stale and the Go tests render every launch in it.

Agent env: `RUSHSITE_AGENT_TOKEN`, `RUSHSITE_CS2_DIR`, `RUSHSITE_PORT_RANGE` (e.g. `27015-27030`), `RUSHSITE_PUBLIC_IP`.

## Plugin -> API webhooks (HTTP POST, header `X-Rushsite-Signature: sha256=<hmac of body with webhookSecret>`)

Endpoint `POST /webhooks/match/:matchId`. Body `{ event: MatchEvent }`. `webhookUrl` in match.json is that full URL. The presigned demo PUT must not sign a Content-Type, the plugin sends application/octet-stream.

```ts
type MatchEvent =
  | { type: "server_ready" }
  | { type: "player_connected"; steamId: string }
  | { type: "player_disconnected"; steamId: string }
  | { type: "match_started"; mapNumber?: number; rushRooms?: number[]; rushRoomsConfirmed?: boolean }   // a series sends it when each map goes live. rushRooms: Rush only, the 7 room ids castle to castle when the veto picked them. rushRoomsConfirmed: our rush_001 script confirmed it applied them
  | { type: "rush_rooms_failed"; reason: "no_reply" | "rejected" | "different"; rushRooms: number[]; detail?: string; mapNumber?: number }   // Rush only, once per map, normally in warmup. no_reply: the modified script is not installed. rejected: it refused the set (detail is its reason). different: other rooms are in play (detail lists them)
  | { type: "rush_rooms_mismatch"; round: number; expected: string; detected: string; rushRooms: number[]; mapNumber?: number }   // Rush only, once per map. The room played is not the one the veto picked, so the modified script did not take
  | { type: "round_end"; round: number; winnerTeam: string; score: Record<string, number>; arena?: string; mapNumber?: number }   // winnerTeam may be "draw". arena only in rush
  | { type: "map_end"; mapNumber: number; mapId: string; winnerTeam: string; score: Record<string, number>; players: PlayerStats[]; demoUploaded: boolean }   // series only, every map including the last. winnerTeam is a team name, or "draw" if a Rush map ever ends level
  | { type: "match_end"; winnerTeam: string; score: Record<string, number>; players: PlayerStats[]; demoUploaded: boolean; maps?: SeriesMapResult[] }   // sent immediately at match end, demoUploaded is false when the upload is still running. In a series: once at series end, score is maps won, players are totals, maps lists every map played
  | { type: "demo_uploaded"; ok: boolean; bytes?: number; error?: string; mapNumber?: number }   // after match_end or match_abandoned once the upload finishes. A series reports each map
  | { type: "match_abandoned"; reason: string; missingSteamIds: string[] }   // reason "server_crashed" (agent) or "map_load_failed" (the next series map did not load within 5 minutes) cancels with no penalty
type PlayerStats = { steamId: string; kills: number; deaths: number; headshots: number; damage: number }
type SeriesMapResult = { mapNumber: number; mapId: string; winnerTeam: string; score: Record<string, number> }
```
`mapNumber` counts from 1 and is left out on single map matches. `kill` also takes an optional `mapNumber`. Scores have no upper bound. A tied aim map, and every series map, goes to overtime so a map can end 16-14. Rush follows Valve's rules.

The plugin reads its match config from `match.json` written by the agent next to the server cfg:
`{ matchId, mode, map, allowedSteamIds, teams, password, webhookUrl, webhookSecret, demoUpload, winCondition, series?, rushRooms?, brand?, slug? }`. `map` is the MapEntry the server starts on (the plugin reads its loadout). `series`, `rushRooms`, `brand` and `slug` are the StartServerRequest fields, copied as is. Both the Go agent and the DatHost driver write these.
`brand.name` is the chat prefix (`[DuelRush]` when absent). At match end, and at series end, the plugin prints the final score and `<brand.siteUrl>/matches/<slug or matchId>`, waits `rushsite_match_end_kick_delay` seconds (default 10) and then kicks everyone with the score in the kick reason. An invalid or missing `siteUrl` only drops the link. Team `displayName` is used in chat, otherwise `Team <name>`.
`rushRooms` is written by the API after the room veto as 7 ids castle to castle (401 first, 301 last). The plugin also accepts the 5 ids for slots 1 to 5, and a `series.maps[n].rushRooms` wins over the top level one. `series.maps[n].ctTeam` is the team name that plays CT on that map, and the other team plays T. It wins over `teams[].side`, and a value that names no team is ignored with a warning. Slot 3 must be a start room (101 to 104) and slots 1, 2, 4 and 5 mid rooms (201 to 212). See `docs/RUSH-ROOM-VETO.md` and the plugin README.
In Rush the plugin holds warmup until every player is on their team's side, redirects wrong joins, and kicks after 3 refusals. It writes `match_state.json` beside match.json so a hot reload with the same matchId resumes without a second `server_ready`.

## API -> Web (WebSocket at `/ws`, JSON messages, auth via session cookie)

Server -> client events:
`queue_status`, `match_found` (accept window), `veto_state`, `server_ready` (ip, port, password, connect string), `match_result`, `party_update`, `tournament_update`, `mode_stats` (broadcast to all: per mode playersInQueue and matchesInProgress), `match_cancelled` (matchId, reason), `error` (code, message, sent to the client whose message was rejected), `admin_event` (admins only).
Client -> server: `subscribe_match`, `unsubscribe_match`, `accept_match`, `veto_vote`, `queue_join` (payload `{ modes: Mode[] }`, every mode must have teamSize >= party size), `queue_leave` (payload `{ modes?: Mode[] }`, omit to leave all).

One queue ticket per party holds a set of modes. Matching in any mode consumes the ticket and removes the party from every other mode. `queue_status` reports per-mode wait state.

Message shape: `{ type: string; payload: unknown; ts: number }`. Schemas in `packages/shared/src/ws.ts`.

## Veto

Ladder matches are one map. The API randomises firstTeam and builds the veto with `createVeto({ format: getModeConfig(mode).vetoFormat, ... })`. `vetoResult(state).deciders` is the map to play (bo1) or the 7 arenas in play order (rush).

## Best-of series (one server per series)

A match with `bestOf > 1` is a series. Today that is a cup bracket match whose bestOf is above 1 (the final, Bo3 by default). The whole series is one `matches` row, one veto, one allocation and one webhook URL.

- Veto: `bo3-pickban` runs once. `matches.maps` holds one map per map number. A short list repeats its last map, so a Bo5 plays the decider again.
- Allocation: one Hetzner slot and GSLT, or one DatHost clone, reserved for the whole series. StartServerRequest carries `series` with every map and one presigned demo upload per map (keys `demos/<date>/<matchId>_m<N>.dem`). The plugin plays the maps in order on that server with the same whitelist, password and teams, loading each map with `host_workshop_map <workshopId>` or `changelevel <mapName>`, and kicks only after `match_end`. Demo files on the server are `rushsite_<matchId>_m<N>.dem`.
- Per map: `match_started { mapNumber }` opens the map, `round_end` carries `mapNumber` and rounds restart at 1, `map_end` closes it. Rows live in `match_maps` (match_id, map_number, map_id, status live|done, winner_team, score, players, played_in). `match_rounds`, `match_kills` and `demos` are keyed by map number too. `demo_uploaded { mapNumber }` marks that map's demo.
- Series end: the API ends the series itself on the `map_end` that gives a team `floor(bestOf / 2) + 1` map wins. The plugin's `match_end` then arrives as a replay and is ignored. If map_end webhooks were lost, `match_end.maps` fills them in, and the plugin's winnerTeam counts only when the map rows cannot decide. `matches.score` is maps won. `match_players` stats are totals over the maps. Ratings change once, on the series result.
- Release: the server is stopped and the slot and GSLT freed only when the series ends. After a finish, teardown waits for `demo_uploaded` of the last played map, or `DEMO_WAIT_SEC`. DatHost demos are pulled per map before the clone is deleted. Demo rows for maps the series never reached are dropped. Cancel, forfeit (`match_abandoned`), watchdog and admin paths end the whole series and release as for a single map. `match_abandoned` with `map_load_failed` ends it like `server_crashed`: cancelled, no rating, no cooldown, server released at once, and the bracket resumes it at the next map on a new server.
- Between maps: the plugin pauses about 30 s on aim and about 110 s on Rush (tv_delay), sends `player_disconnected` for everyone and `player_connected` as they load in. The match stays `live` and nothing in the API penalises that. The API connect timeout only covers the first map (`ready` status), the plugin runs the connect grace for every later map. The watchdog cap is the mode cap per remaining map plus 5 minutes per level change, and the Hetzner process and DatHost clone keep running through the change so liveness stays alive.
- Draws: a drawn map (`winnerTeam: "draw"`) is stored with no winner and counts for nobody, the series goes on. A series `match_end` with `"draw"` (maps ran out level) ends the match finished, unrated, winner null, like a Bo1 draw. The result listeners get `completed` with winnerTeam `draw` and the maps. The bracket replays that series from map 1 on a new server, as it replays a drawn single game.
- Results: `MatchResultEvent` completed gains `maps: [{ mapNumber, winnerTeam, matchId }]`. `flow.onMapResult` reports each decided map `{ matchId, mapNumber, winnerTeam }`. The tournaments module records maps as bracket games (`GameRecord.map`) while the series is live and resolves the bracket match from the series result.
- Crash resume: when the series server dies (`server_crashed` cancels the match) the bracket match goes back to ready with its decided maps kept. The next match gets `gameNumber` = next map and `priorMaps`, plays the same maps from there, and its `series.wins` counts the earlier maps. Those maps appear in `match_maps` with `played_in` set to the earlier match.
- Match page and `match_update` for a series carry `bestOf`, `maps[]` (per map status, score, winner, stat lines, demo link) and the live `mapNumber`. Rounds and kills carry `mapNumber`.

## Rating

Glicko-2 per mode. `rating_events` stores before and after for every player per match so rollback is a replay. Team rating is the mean.
A cheater rollback records each voided match in `rating_rollbacks` and skips matches already there, so it is idempotent. Each victim is replayed over their whole history in the mode, skipping every voided event, so an earlier rollback stays applied.

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
REST under `/admin`: `GET /admin/overview`, `GET /admin/queue`, `GET /admin/matches?status=`, `GET /admin/matches/:id`, `GET /admin/hosts`, `GET /admin/users/:steamId`, `GET /admin/events?limit=` (recent webhooks and errors), `POST /admin/queue/:ticketId/remove`, `POST /admin/matches/:id/cancel`, `POST /admin/users/:steamId/ban`, `POST /admin/users/:steamId/unban`, `POST /admin/users/:steamId/trust`, `POST /admin/users/:steamId/cooldown/clear` (ends running cooldowns, 409 `no_cooldown` when none). `GET /admin/users?q=` is a name search (2 to 64 characters, contains match from 3, digits also match SteamID64 prefixes, max 20 rows, 30 per minute). `GET /admin/users/:steamId` also returns `state: { queue, match }` and `adminName` on audit rows.

Match history: `GET /users/:steamId/matches?limit=&mode=&cursor=` returns `{ matches, nextCursor }`, newest first by (created_at, id). The cursor is opaque. The profile returns the first 20 as `recentMatches` with `recentMatchesCursor`. Rows carry `slug`, and a series has `bestOf`, the played `maps` and scores in maps won.
WS: admins additionally receive `admin_event` messages `{ kind: queue|match|host|webhook|error|user, payload }` for live refresh. Unban does not restore rolled-back ratings.

## Server drivers (packages/shared/src/drivers.ts, implementations in apps/api and packages/dathost)

```ts
interface ServerDriver {
  name: "hetzner" | "dathost"
  capacity(): Promise<{ free: number; total: number }>
  start(req: StartServerRequest): Promise<StartServerResponse>
  stop(matchId: string): Promise<void>
  fetchDemo?(matchId: string, mapNumber?: number): Promise<ReadableStream | Buffer | null>   // dathost only, after match_end. mapNumber picks one map of a series
  status?(matchId: string): Promise<"alive" | "gone" | "unknown">          // dathost. Hetzner liveness comes from the agent's GET /servers
}
```
Allocator order: every Hetzner host first. If none has a free slot, wait `SURGE_WAIT_SEC` (default 20) polling, then use DatHost. Matches record `driver` and `driverRef` on the matches table so stop and demo fetch route correctly. Env: `DATHOST_EMAIL` and `DATHOST_PASSWORD` (DatHost uses HTTP Basic, use a dedicated account), `DATHOST_TEMPLATE_SERVER_ID` (a prepared server with our plugin installed, cloned per match), `DATHOST_LOCATION` (default `dusseldorf`, their Frankfurt site), `SURGE_WAIT_SEC`. The API must call fetchDemo before stop, deleting the clone deletes its files.

Match watchdog (apps/api/src/modules/match/watchdog.ts): every `WATCHDOG_INTERVAL_SEC` (default 30) inside the allocation loop, and once at API boot, every `starting`, `ready` or `live` match is checked. A Hetzner match whose id is missing from its agent's `GET /servers`, or a DatHost match whose `status()` is `gone`, ends `abandoned` with `cancelReason` `server_lost`. A match past `MATCH_MAX_MIN_AIM` (60, room for overtime) or `MATCH_MAX_MIN_RUSH` (40) minutes from its start ends `abandoned` with `timeout`. A series gets the cap once per map it can still play. A `live` match whose server state is unknown and that sent no webhook for `MATCH_SILENCE_SEC` (900) ends as `server_lost`. None of these change ratings or issue cooldowns. Slot and GSLT are released and the result listeners get `abandoned` with no missing players.
`server_ready` that arrives while the match is still `allocating` (a DatHost boot) is held: the API records it and sends `server_ready` to players when `start()` returns connect info. The per-match allocation lock is a lease renewed while the start call runs.
No-show penalties: a missing player gets a cooldown only when someone on the other team connected. A forfeit is rated only when the winning team connected, and winners who never connected stay unrated. When nobody connected the match ends with `cancelReason` `server_unreachable` and nobody is penalised.

## Match pages

`GET /matches/:id` is public and returns `{ match: { id, mode, mapId, status, driver, startedAt, endedAt, teams: [{ name, score, players: [{ steamId, displayName, avatarUrl, tier, rating, kills, deaths, headshots, damage }] }], rounds: [{ round, winnerTeam, score: Record<team, number>, arena?, endedAt }], tournament?: { id, name, bracketMatchId, bestOf, gameNumber } } }`. Connect info is only included for participants, as `connect: { ip, port, password, connect }`. /ws needs a signed in session (401 otherwise). Signed-out viewers of match and tournament pages poll `GET /matches/:id` and `GET /tournaments/:id/bracket` every 5 s while the tab is visible.

Match rooms: every match gets a `slug` of three or four random words (`brave-amber-falcon`, generator in `packages/shared/src/match-slug.ts`, unique index on `matches.slug`, null on older matches). `GET /matches/:id` takes the uuid or the slug. The web room lives at `/matches/<slug>`, and uuid links load and then replace the address with the slug. `match_found`, `veto_state` and `server_ready` carry `slug?`. For participants only, the detail also carries the current step, so a reload rebuilds the room: `accept?: { deadline, windowSec, accepted, required, responded }` while accepting, `veto?: { state, stepDeadline }` while in veto (the other team's votes are hidden while it acts), and `warmup?: { connected, expected }` while starting or ready. Series fields: `bestOf?`, `maps?: [{ mapNumber, mapId, status: upcoming|live|done, winnerTeam, score, demo?, playedIn?, players? }]`, `rounds[].mapNumber?` and `kills[].mapNumber?`. In a series `teams[].score` is maps won. `match_update` adds `mapNumber?` and `maps?` (without players). The room state mapping is `packages/shared/src/room.ts` (`roomFromDetail`, `applyRoomEvent`, `mergeRoomDetail`, `roomStage`). The Play page keeps only mode picking, party and queue. It sends the player to the room when a match starts.

Rush room veto: behind `RUSH_ROOM_VETO.enabled` in `packages/shared/src/config/rush-veto.ts` (off by default, the API env `RUSH_ROOM_VETO` overrides it). It runs for every single map Rush match (`isRushMode`, so rush1v1 and rush2v2 too). A Rush Bo3 runs the series room veto instead, see below. Two phases, both config data: mid rooms (the 12 mid rooms, ban ban pick pick ban ban pick pick, picks go next to the picking team's castle: team 0 fills slots 1 then 2, team 1 fills 5 then 4, and the other mid rooms stay unused), then the start room (the 4 start rooms, alternating bans until one is left, which becomes slot 3). Teams alternate across both phases. It uses the map veto engine: each step carries `phase`, the state carries `phases` with their pools, and a vote outside the running phase's pool is rejected. `vetoes.format = "rush-rooms"`, and `veto_state` and the participant `veto` view carry `kind: "rooms"`. When the veto finishes, `matches.rush_rooms` stores seven room ids from T castle to CT castle, checked against the game server's rule (`isValidRushPath`: start room in slot 3, mid rooms in 1, 2, 4 and 5, no repeats). They appear on `GET /matches/:id` as `rushRooms` and go into match.json as `rushRooms`.

Rush series room veto: same flag. A Rush series whose bestOf matches `RUSH_SERIES_ROOM_VETO.format.maps` (3) picks rooms and sides for every map once, before map 1. No bans and no repeats, so the three maps use all 12 mid rooms and three of the four start rooms. The config is `RUSH_SERIES_ROOM_VETO` in `packages/shared/src/config/rush-veto.ts` and the engine `packages/shared/src/veto/series-rooms.ts`. `first` is the higher seed, passed by the bracket as `source.higherSeed` (random when unknown). A coin flip at creation (`state.flipWinner`) makes team A of map 3.
- Map 1: second chooses its side, mid picks first, second, first, second, then second picks the start room.
- Map 2: sides swap. Mid picks second, first, second, first, then first picks the start room.
- Map 3: the flip winner chooses its side, the flip loser picks 2 of the 4 mid rooms left, the flip winner gets the other 2 in pool order and picks the start room. The last start room is unused.
- A mid pick goes beside the picking team's own castle, first pick next to it (T fills 1 then 2, CT 5 then 4).
- Side steps have `action: "side"` and vote on `side:<map>:ct` or `side:<map>:t`. Each phase carries `mapNumber` and `kind` (side, mid, start).
- `vetoes.format = "rush-series-rooms"`, `veto_state` and the participant `veto` view carry `kind: "series-rooms"`. When it finishes, `matches.series_rooms` stores `[{ mapNumber, rushRooms, ctTeam }]` with ctTeam a team name, and `maps` is `rush_001` per map. match.json gets them as `series.maps[n].rushRooms` and `series.maps[n].ctTeam`, and the top level `rushRooms` is left out. `GET /matches/:id` shows them on `maps[]`. A series resumed after a crash reuses the rooms of its first match. A resume whose first match had no room veto, and a Rush series of another length, keep Valve's random draw.
Rounds come from `round_end` webhooks stored in `match_rounds`.
Player `kills`, `deaths` and `headshots` are live: until a match is `finished`, the API adds counts from stored `kill` events for maps without final stats, using ended rounds only while the match runs (team kills give no kill, every death counts). `damage` and deaths with no kill event, such as suicides, only arrive with `match_end` or `map_end`, whose totals then replace the counted lines. The live map of a series gets counted `players` the same way.
Client sends `resync {}` to get the party, queue and match phase replayed on a socket that is already open (a page mounting after the connect replay). Live: client sends `subscribe_match { matchId }` / `unsubscribe_match { matchId }`; server sends `match_update { matchId, status, teams: [{ name, score }], lastRound?: Round }` on every round_end, match_started, match_end and cancel to subscribers. Any signed in player may subscribe.

## Feature batch 2 (owners: challenges, match-api, match-web, stats, notify)

Rules for this batch: each owner adds new files under its own folders. Edits to shared web files (SiteHeader, tokens.css, api.ts, ws.ts, types.ts, mock.ts, ws-mock.ts) and to apps/api/src/app.ts and env.ts must be small and additive, never restructuring. New schemas go in packages/shared/src/schemas/<feature>.ts with one export line added to the barrel, and a ws.ts message added only by the owner named below.

### Challenges (owner: challenges) — features 2 rematch, 3 direct challenge links
Tables: `challenges` (id, mode, created_by, target_steam_id nullable, rematch_of_match_id nullable, map_id nullable, code unique, status open|accepted|declined|expired|cancelled, expires_at, match_id nullable).
REST: `POST /challenges { mode, targetSteamId?, rematchOfMatchId?, mapId? }` -> `{ challenge, url }` (no target makes an open link anyone may accept, `mapId` from the mode's live pool skips the veto, asking again with the same target or open link, mode and map returns the open one); `GET /challenges/:code`; `GET /challenges/:code/preview` (public, for link previews, no steam or match ids); `POST /challenges/:code/accept` (creates a match that skips queue and accept, runs veto for aim, allocates); `POST /challenges/:code/decline`; `GET /challenges/mine`.
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
- Bracket scores: each bracket match in `GET /tournaments/:id/bracket` and the detail carries `score: { a, b } | null` (round score of a single game, maps won for a series), `maps?: [{ mapNumber, mapId, status: live|done, score: { a, b }, winner: a|b|null }]` for series, and `room: string | null` (slug or match id of the live or last game, for `/matches/<room>`). Read in one query over `matches` left join `match_maps`. Round scores move without a bracket version bump, so signed-in viewers follow live games with `subscribe_match` and apply `match_update`, and signed-out viewers refetch the bracket without If-None-Match while a match is live. Forfeits, walkovers and byes have no score.
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
- Bans: a player with an active ban gets no session. The Steam callback redirects to `${PUBLIC_URL}/banned?until=<ISO or empty for permanent>&reason=<text>`, plus `&permanent=1` when the ban has no end. The page says "permanent" only when that flag is set. A session that belongs to a banned player answers 401 `banned` on every route and on `/ws`, and `GET /me` answers 403 `{ error: "banned", details: { reason, until } }` so the web can show `/banned`. The check reads a Redis marker `ban:<steamId>` written by `BanService.ban`, cleared by unban, and refreshed from Postgres at every sign in.
- Session end: logout and ban close every open socket of that player on every instance with close code 4001 (reason `logged_out` or `banned`), sent through the `rs:ws` channel as audience `{ kind: "disconnect", steamIds, reason }`. The web does not reconnect blindly after 4001. It re-checks `GET /me` and reopens only when the session is still valid.
- HTTP rate limits live in `apps/api/src/lib/security.ts` (`RATE_RULES`), Redis backed, keyed per session or per IP. Over the limit answers 429 `rate_limited` with `Retry-After`. Socket messages are limited to a burst of 30 then 3 per second, over that the client gets an `error` with code `rate_limited`, and 100 strikes close the socket with 1008.

## Feature batch 3 (owners: ux, icons, cups-admin, review, admin-ops)

Same rules as batch 2: own folders, additive edits to shared files, schemas in packages/shared/src/schemas/<feature>.ts.

### Cups admin (owner: cups-admin) — team names, manual cups, schedules, admin cup tools
`tournament_entries.team_name` (nullable, 3 to 24 chars, profanity-filtered later). Enter body gains `teamName?`. Cup schedules move to a `cup_schedules` table (id, mode, cadence daily|weekly, weekday, start_time UTC, max_entrants, min_trust, best_of_final, enabled) seeded from the current config on first migration; the scheduler reads the table. Admin REST under /admin/tournaments: `GET /admin/tournaments/schedules`, `POST`, `PATCH /:id`, `DELETE /:id`; `POST /admin/tournaments` (one-off cup: mode, name, startsAt, maxEntrants, minTrust); `POST /admin/tournaments/:id/cancel`, `/reschedule { startsAt }`, `/entries/:entryId/disqualify { reason }`, `/matches/:bracketMatchId/force-result { winnerEntryId, reason }`. Every action writes admin_audit. Web: /admin/tournaments (schedules table with enable toggle, create cup form, running cups with the tools).
Details (cups-admin): schemas in packages/shared/src/schemas/cups.ts. Team names are trimmed, inner spaces collapsed, letters, digits, spaces and `. _ ' ! ? & # -`, unique per cup ignoring case (409 `team_name_taken`), 400 `invalid_team_name` or `team_name_not_allowed` (1v1). Entries gain `teamName` and `disqualified`, `name` is the team name when set. Schedules also carry `cupKey` (seeded rows keep the old `daily-<mode>` keys), `name`, `nextStartsAt`. The scheduler creates a cup for an enabled schedule only when that schedule has no open cup. Editing a schedule updates its open cup and a new time moves it to the next slot, a mode change is refused with 409 `schedule_has_entries` when the open cup has entries. Disabling or deleting a schedule cancels its open cup when it has no entries (cancelReason `schedule_disabled` or `schedule_removed`) and otherwise keeps it; PATCH and DELETE return `openCup: { tournamentId, name, action: cancelled|kept, entrantCount } | null`. `POST /admin/tournaments/:id/entries/:entryId/strip-badges { reason }` removes that entry's badges from a completed cup (409 `not_completed`, `no_badges`), audited as `tournament.strip_badges`. Team rosters (StartServerRequest, match.json, MatchDetail teams) gain optional `displayName`, the cup team name. `name` stays the result id A or B, the agent writes `mp_teamname` from displayName when set and the match page shows it. One-off cups have cadence `special`, cupKey `special-<uuid>`, sign-ups open at creation, optional `bestOfFinal` (1, 3, 5, default 3). Cancel takes `{ reason }`, sets `cancelReason` `admin_cancelled` and stops live games. Reschedule is open cups only and emits `tournament_update` kind `rescheduled`. Disqualify on an open cup blocks the players from entering again (403 `disqualified`), on a running cup the current series resolves with `disqualified` and later series resolve when they become ready. Force-result works on ready, provisioning or live series and resolves them as `admin_decision`. Disqualified losers get no placement badge. Audit actions are `tournament.schedule_create|schedule_update|schedule_delete|create|cancel|reschedule|disqualify|force_result|strip_badges` with the schedule or tournament id as target.

### Review queue (owner: review) — reviewer page, report outcomes
`flags` table gains status open|reviewing|cleared|confirmed, reviewer_steam_id, decided_at, note. A flag is created automatically when a match gets 2+ reports on the same player or any report from a Trusted player. `reports.outcome` received|reviewed|actioned|dismissed, updated when the flag is decided. REST: `GET /admin/review?status=` (flags with match summary, reports, player trust and stats), `POST /admin/review/:flagId/claim`, `/decide { outcome: cleared|confirmed, note, ban?: { reason, until? } }` (confirmed applies the ban through BanService and rolls back rating per the brief, and marks every report on that player in that match actioned). Reporters see outcomes on the match page and a "Your reports" list on their profile (`GET /me/reports`). Web: /admin/review with the round timeline and kill feed reused, report notes, decide form.

### Admin ops (owner: admin-ops) — dashboard, feature flags, announcements, queue open/close, manual ban
`feature_flags` (key pk, enabled, value jsonb, updated_by, updated_at) with `GET /flags` public (enabled keys only) and admin CRUD. Queue open/close per mode is the flag `queue.<mode>.open` (default true); the queue service refuses joins (503 mode_closed) and GET /status reports reason `closed`. `announcements` (id, text, level info|warn, starts_at, ends_at, dismissible) with `GET /announcements` public and admin CRUD, shown as a site-wide banner. Manual ban: admin users page gets a ban form by SteamID64 or profile URL with reason and optional end date (existing ban route). Dashboard: `GET /admin/metrics?range=1h|24h|7d` returning series for queue depth per mode, matches started per hour, median wait, active sockets, sampled every minute into a `metric_samples` table by the API loop (retain 7 days). Web: /admin overview gets the charts (inline SVG, dataviz palette), /admin/flags, /admin/announcements, queue toggles on the overview.
Details (admin-ops): `GET /flags` -> `{ flags: Record<key, value> }` where a flag with no value reads `true`. Admin flag routes are `GET /admin/flags`, `PUT /admin/flags/:key { enabled, value? }` and `DELETE /admin/flags/:key`. A missing queue flag means open. Closing a mode takes that mode out of every waiting ticket (tickets with no other mode are cancelled), refuses challenge accepts with 409 `mode_closed`, and the cup scheduler neither creates nor starts cups in that mode until it reopens. Announcement routes are `GET|POST /admin/announcements` and `PATCH|DELETE /admin/announcements/:id`. `GET /announcements` returns only announcements inside their window. Manual ban: `GET /admin/users/resolve?q=` takes a SteamID64 or profile URL (`/id/` custom URLs need STEAM_API_KEY). Banning a SteamID64 that never signed in creates a bare user row named after the id, so the ban applies at their first sign in. `metric_samples` (metric, mode, sampled_at, value) rows are keyed by minute. Metrics are `queue_depth` per mode, `median_wait_sec` per mode, `matches_found` (matches created by the matchmaker, all modes) and `active_sockets`. `active_sockets` counts only the sockets on the instance that takes the sampler lock, which is exact for one instance. `GET /admin/metrics` returns `{ range, from, to, stepSec, queueDepth, medianWaitSec, activeSockets, matchesFound, matchesStepSec }` with steps of 1 min, 10 min and 1 h for the line series and 5 min or 1 h for matches found.

### Cups UX (owner: cups-ux) — features 62, 64, 66 to 70
`TournamentSummary` gains optional `entrantPreview: [{ steamId, displayName, avatarUrl }]` (first 5 entries by sign up order, one per entry: the captain's steamId and avatar with the entry display name) and `winner: { entryId, name, avatarUrl } | null` (completed cups). Schemas in packages/shared/src/schemas/cups-ux.ts. The API should fill both on `GET /tournaments` rows. The web falls back to a count and no champion row when they are missing.
Web: components under apps/web/src/components/tournaments (AvatarStack, LocalTime, LiveBadge, WithdrawDialog, bracketPath). Cup times render in the viewer's zone with UTC in a tooltip. BracketView highlights the viewer's route from `myEntryId`.
