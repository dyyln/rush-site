# Adversarial technical review

Status: review of commit `28a75b7` (HEAD) plus the working tree as of 2026-09-23. Other agents were editing during the review, so where the tree was mid-edit the committed file was read with `git show HEAD:<path>`. Line numbers are HEAD line numbers unless marked "tree".

Scope: `apps/api`, `apps/web`, `packages/*`, `agent/`, `plugin/`, `infra/`, the deploy in `~/dev/dyylndev/services/rushsite`, and the docs. The goal assumed here is a real launch with a few thousand players.

How claims were checked:

- **Reproduced**: run against the API test harness (PGlite and ioredis-mock) on a copy of HEAD in the session scratchpad, or against the local Postgres 16 on 5433 inside a rolled-back transaction. No repo files were changed.
- **Read**: follows directly from the code cited.
- **Inferred**: depends on CS2 or CounterStrikeSharp behaviour that nobody on this project has observed.
- Production was only read: `GET /health`, `GET /status` and response headers.

Nothing in this stack has ever run against a real CS2 server. Every number and behaviour below that involves CS2 is a prediction.

---

## Top ten

| # | Severity | Finding | Section |
|---|---|---|---|
| 1 | Critical | There is no working path from the queue to a running server. The agent rejects every Rush start (`execCfg` mismatch), the aim modes are blocked on `TODO` workshop ids, and when they are filled in, Valve's competitive cfg will likely override the aim settings | 1.1, 1.2, 1.3 |
| 2 | Critical | In Rush nobody puts players on the right team. The plugin never validates or moves them, so round and match winners, and so ratings, go to whoever happened to stand on that side | 2.1 |
| 3 | Critical | A match that never gets `match_end` stays `live` forever. Every player in it is locked out of the queue and their party is locked. Reproduced | 3.1 |
| 4 | High | DatHost surge is broken. The plugin's `server_ready` arrives before `start()` returns, so connect info is never saved, no player gets `server_ready`, and 10 minutes later all players get a `no_connect` cooldown. Reproduced. Tournament surge can also create two clones per match | 4.1, 4.2 |
| 5 | High | A player whose Steam authorization lands after `player_connect_full` is never counted as connected. After 5 minutes the plugin abandons the match and that player takes a forfeit loss while standing on the server | 2.2 |
| 6 | High | Infrastructure failures are punished as player no-shows. When everyone is missing, every player still gets an escalating cooldown. That covers every CS2 patch day. Forfeit wins also give full rating to the other side, which is farmable | 3.3, 3.4 |
| 7 | High | The demo pipeline cannot work in production. Presigned URLs point at `http://rushsite-minio:9000`, a Docker-internal name that game servers and browsers cannot resolve. Demos are never deleted, not on game hosts and not in storage | 5.1, 5.2 |
| 8 | High | CS2 updates are fatal to the plugin and nothing notices. The agent auto-updates CS2 and reopens without checking that Metamod and CounterStrikeSharp still load. Replacing the plugin DLL hot-reloads it inside every running match and wipes its state. The plugin compiles against CSS 1.0.368 on net8 and runs against a net10 PR build it was never loaded in | 6.1, 6.2, 6.3 |
| 9 | High | Operations. There is no CI. Migrations run at boot, and a migration in the tree right now fails on Postgres 16 and would crash-loop the API. No backups are scheduled, and the backup script targets the wrong compose file. Redis is capped at 128 MB with no `maxmemory`. The live site is not running HEAD | 7.1 to 7.6 |
| 10 | High | Most tests check the code against its own fakes. The fake agent accepts any request, every harness sets `ALLOW_UNRESOLVED_MODES`, PGlite has one connection, and the tournament and admin suites run on in-memory stores. Mode config is written three times (TS, Go, DatHost) and the copies already disagree, which is how #1 passed 300 tests | 8.1, 8.2, 9.1 |

## Do not launch until

1. One Rush match and one aim match have been played end to end on a real box: queue, accept, veto, allocate, connect, play to the end, `match_end`, rating change, demo in storage, server torn down. Keep the server log and the webhook log as the reference fixture.
2. The `rush3v3` `cs2.execCfg` sent by the API is accepted by the agent (1.1). Aim workshop ids are filled in, and the aim cfg is shown to survive the map load (1.2, 1.3).
3. Rush sides are enforced: each config team on one side, three a side, checked before the match goes live (2.1).
4. Presence counts players authorized after `connect_full` (2.2).
5. A `live` and a `ready` match can end without the plugin: a stale-match sweep with a hard cap, plus a reconcile against the agent's `GET /servers` (3.1, 3.2).
6. An abandon where every player is missing is cancelled with no cooldown. Forfeit wins are unrated or capped (3.3, 3.4).
7. Either DatHost is disabled in production, or `server_ready` before `start()` returns is handled and the per-match allocation lock outlives a DatHost boot (4.1, 4.2).
8. `S3_PUBLIC_ENDPOINT` is a URL the game box and browsers can reach, and a demo upload has been seen to land (5.1).
9. A CI job runs `pnpm -r typecheck`, `pnpm -r test`, the web build, `go test` and `dotnet test`, plus a migration against real Postgres, on every push. The deploy refuses a SHA that has not passed (7.1).
10. Nightly `pg_dump` runs on the VPS, is copied off the box, and one restore has been tested (7.3).
11. The agent refuses to reopen after a CS2 update until a canary server loads the plugin and reports `server_ready`. CounterStrikeSharp hot reload is turned off (6.1, 6.2).
12. HEAD, with the security fixes, is what is deployed (7.6).

---

## 1. The match pipeline has never had a working path

### 1.1 Critical: the agent rejects every Rush start (Read)

- `packages/shared/src/config/modes.ts:104` sets `rush3v3.cs2.execCfg` to `"gamemode_rush.cfg"`.
- `apps/api/src/modules/match/allocator.ts:232` sends that block to the agent: `cs2: { ...getModeConfig(p.mode).cs2 }`.
- `agent/internal/match/validate.go:49-54` (`applyCS2`) lets the request override the agent's own `rushsite_rush3v3.cfg`.
- `agent/internal/match/render.go:103-123` (`ModeCfg`) looks for `gamemode_rush.cfg` in `RUSHSITE_MODE_CFG_DIR`, then in the embedded `cfgs/`. Neither has it, so it returns `invalid("no mode cfg named gamemode_rush.cfg on this agent")`.
- `agent/internal/api/api.go` maps a validation error to 400. `allocator.ts:249-254` treats anything other than 503 as fatal for this attempt. The match retries every tick for 120 s and is then cancelled as `server_start_failed`.

Why it matters: every Rush match on Hetzner fails. Rush is the headline mode and the first planned end-to-end match. The DatHost driver renders `exec gamemode_rush.cfg` (`packages/dathost/src/cfg.ts`), so the two drivers already disagree on the same contract field.

Why the tests missed it: `FakeAgent` (`apps/api/test/helpers.ts`) accepts any request. The Go tests use `rushsite_rush3v3.cfg`. `schemas.test.ts:267` asserts the wrong value.

Smallest fix: set `rush3v3.cs2.execCfg` to `"rushsite_rush3v3.cfg"`. Add a Go test that every `execCfg` in `MODE_CONFIGS` exists in the embedded cfgs, either as a JSON fixture exported from shared or checked in the Makefile.

### 1.2 Critical: aim modes cannot queue in production (Read, live)

- `modes.ts:7-12` gives every aim map `workshopId: TODO`, and `modes.ts:88,96` set `workshopCollection: TODO`.
- `unresolvedConfig` blocks the mode unless `ALLOW_UNRESOLVED_MODES` is set. It is false in production and true in every test harness.
- Live `GET /status` answers `aim1v1` and `aim2v2` `not_configured`, and `rush3v3` `no_servers`.

Fix: fill in the ids, and add a check that fails the build when `unresolvedConfig` is non-empty for a mode that is meant to be live.

### 1.3 High: Valve's competitive cfg will likely override the aim settings (Inferred)

- Aim launches as `+game_type 0 +game_mode 1 ... +host_workshop_map <id> ... +exec rushsite/matches/<id>/server.cfg` (`render.go:41-72`).
- `+host_workshop_map` downloads the map first, so the map loads after the command-line `+exec` has run. On load, CS2 runs `gamemode_competitive.cfg`. That is the long-standing Source behaviour, and `agent/RUSH.md` already notes the same ordering risk for Rush.
- The result would be $800 start money, normal freeze time, buy zones and **C4 given** on aim maps. The plugin sets only `mp_maxrounds`, clinch, overtime and halftime at match start (`MatchController.cs:285-299`), and on map start it re-applies only bots, team balance and password (`:120-133`).

Fix: on map start, the plugin re-execs the match's mode cfg, or the agent writes the overrides to `gamemode_competitive_server.cfg`, which Valve runs after the mode cfg. Verify with `mp_startmoney` on the first real aim match.

### 1.4 Assumptions a first real match will test, ranked by how likely they are to be wrong

| # | Assumption | Where | Likelihood wrong | What happens if wrong |
|---|---|---|---|---|
| 1 | The API's `cs2.execCfg` matches a cfg the agent has | 1.1 | Certain | No Rush server starts |
| 2 | Rush players end up on their config team's side by themselves | `MatchController.cs:221-223`, `OnPlayerConnected` only moves players when `ManagesMatch` | Very high. CS2 auto-assigns on join and `ChangeTeam` is broken | Wrong winner, wrong ratings (2.1) |
| 3 | Our aim cfg survives the map load | 1.3 | High | Aim plays as competitive with C4 |
| 4 | Presigned upload URL is reachable from the game host | 5.1 | Certain with the current `.env` | No demos |
| 5 | A net8 plugin built against CSS 1.0.368 binds against the net10 PR build: schema props (`GameRules.WarmupPeriod`, `AbsOrigin`, `PlayerPawn`), `Utilities.GetAllEntities`, `AuthorizedSteamID` | `CssGameServer.cs` | High that at least one call fails | `IsWarmup()` silently false, arena detection null, or the plugin does not load |
| 6 | Steam authorization is done by `player_connect_full` | 2.2 | Medium, and certain on a slow Steam day | False no-show forfeits |
| 7 | Rush go-live fires one of `round_announce_match_start`, `begin_new_match`, or `round_freeze_end` outside warmup (plugin README marks all "unverified in Rush") | `RushsiteMatchPlugin.cs:258-268`, `MatchController.cs:333-341` | Medium | Match stays `ready`. At 600 s `expireConnect` sees everyone connected and **cancels the match mid-game** as `never_started` (`flow.ts:955-960`) |
| 8 | `cs_win_panel_match` fires before `mp_match_end_restart 1` restarts the game, or the score mirror agrees with the script | `ScoreTracker.cs:124-161` | Medium | If both miss, rounds of the restarted game keep counting until round 15, and the result mixes two games |
| 9 | Valve's 120 s Rush warmup waits for all six players | the plugin never holds Rush warmup | High that it does not wait | Rush goes live 3v2. The late player joins mid-match, or is a no-show at 300 s and forfeits |
| 10 | `-maxplayers 7` is honoured for a mode Valve lists as 6, and GOTV does not take a player slot | `render.go:38` | Medium | Sixth player cannot join |
| 11 | `tv_record` under `tv_delay 105` writes a complete demo, and stop plus upload finish inside `DEMO_WAIT_SEC=180` | `MatchController.cs:483-489`, `env.ts:90` | Medium | Server killed during the upload, demo lost |
| 12 | Several CS2 processes share one install with only `-port` and `+tv_port` distinct. Concurrent `host_workshop_map` downloads into one shared workshop dir are safe | `manager.go:327-373` | Medium | Port clash or a corrupt workshop download |
| 13 | Room target names are `t1room.<id>` and T pawns sit nearest their room | `RushArena.cs` | Medium | `arena` null. Cosmetic |
| 14 | `bot_quota 2 fill` bots are gone within 1 s | `MatchController.cs:137-145` | Low | A bot plays a round during warmup |
| 15 | The agent's Steam-API update check reads the installed build correctly | `update/install.go` | Low to medium | Updates missed, or false drains |
| 16 | The plugin can reach `https://api.rushsite.dyyln.dev` from the game box, and the webhook rate limit of 1200 per minute per match holds | `lib/security.ts` | Low | Events dropped |

---

## 2. Plugin correctness

### 2.1 Critical: Rush teams are not enforced (Read)

- `OnJoinTeamRequest` returns true for Rush without checking anything (`MatchController.cs:223`).
- `TryMovePlayer` is only called when `ManagesMatch && Phase == Warmup` (`:184-189`), so even a fixed `ChangeTeam` would never move a Rush player.
- `rushsite_rush3v3.cfg` sets `mp_limitteams 0` and `mp_autoteambalance 0`, so nothing stops 4v2 or 6v0.
- `SideMap.SetPlayerSide` is last-writer-wins per team (`SideMap.cs:21-26`). One player of team A on CT flips team A to CT.
- `OnRoundEnd` maps the side that won to a team through that map (`MatchController.cs:350`). The ratings in `finishMatch` follow the team name the plugin sends.

Why it matters: parties get split, round wins get credited to the wrong team, and ratings move the wrong way. This is a correctness failure in the headline mode.

Smallest fix: the `jointeam` listener already works without `ChangeTeam`. Use it for Rush too, with the same `SideMap.IsJoinAllowed` rule as aim. Block `match_started` until `TeamsAreValid` holds, and hold Rush warmup with `mp_warmup_pausetimer 1` until then. Holding warmup is server fill, not a rule change.

### 2.2 High: late Steam authorization makes a present player a no-show (Read)

- `OnPlayerConnectFull` only counts players whose `AuthorizedSteamID` is set (`RushsiteMatchPlugin.cs:177-185`). The comment says the others are "handled by OnClientAuthorized".
- `OnClientAuthorized` calls `MatchController.OnClientAuthorized` (`:169-175`), which only checks the whitelist and kicks. It never calls `OnPlayerConnected` (`MatchController.cs:157-163`).
- So that player stays in `_presence.Missing`. After `rushsite_connect_grace` (300 s) the plugin sends `match_abandoned no_show` with them listed, and the API gives them a forfeit loss and a cooldown (`flow.ts` `abandonMatch`).

Smallest fix: in the `OnClientAuthorized` handler, if the player is already fully connected, call `_match.OnPlayerConnected`. Add a Core test for the auth-after-connect order.

### 2.3 High: webhook delivery gives up and never recovers (Read)

- One FIFO worker, 10 attempts, with backoff 1, 2, 4, 8, 16, then 30 s capped (`WebhookDispatcher.cs:56-60`). With connection refused that is about 150 s, and up to about 250 s with 10 s timeouts. After that the event is dropped and the next one is tried.
- Any 4xx except 408 and 429 is dropped at once (`:62-63`), for example a 400 `invalid_event` from schema drift or a 401 after a secret mix-up.
- Events live only in memory. A plugin reload or a CS2 crash loses the queue.

Why it matters: a deploy that takes the API down for more than about 2.5 minutes drops `match_end` for every match that ends in that window. Combined with 3.1, those players are stuck.

Fix: add a stale-match sweep on the API side (3.1). Also persist unsent events to a file in the match dir and replay them on load, and raise the retry window to at least 15 minutes for `match_end` and `match_abandoned`.

### 2.4 High: plugin state is lost on reload (Read plus Inferred)

- All match state (round counter, score, presence, sides) is in memory.
- CounterStrikeSharp hot-reloads a plugin when its DLL changes on disk (`PluginHotReloadEnabled`, on by default in `core.json`). The install is shared by every server on the box.
- After a reload, `EnsureMatch` builds a fresh controller from `match.json`: round 0, score 0, phase Warmup. For Rush the next freeze end sends `match_started` again. Rounds restart at 1 and are dropped by `onConflictDoNothing` on `match_rounds (match_id, round)`. The final `match_end` carries only the rounds seen since the reload.

Fix: turn hot reload off on game hosts. Deploy plugin updates only through the agent drain, the same way as CS2 updates.

### 2.5 Medium: the two drivers render different servers (Read)

The Hetzner `server.cfg` (`render.go:75-101`) sets `rcon_password ""`, `sv_hibernate_when_empty 0`, `tv_password`, `tv_autorecord 0` and `bot_kick`. The DatHost `server.cfg` (`packages/dathost/src/cfg.ts` `buildServerCfg`) sets none of these and relies on an operator `rushsite_base.cfg` that is not in the repo.

- Without `sv_hibernate_when_empty 0`, the plugin's 1 s timer stops on an empty server, so no-show detection never runs.
- Without `tv_password`, GOTV is open. In aim, with no `tv_delay`, that is a live ghosting feed.

Fix: generate one `server.cfg` from shared code for both drivers.

---

## 3. Match flow and data model

### 3.1 Critical: `live` has no deadline (Reproduced)

`timersTick` (`flow.ts:840-874`) handles `accepting`, `veto`, `ready` and `starting`. Nothing ever handles `live`. A match only leaves `live` through a plugin `match_end` or `match_abandoned`, an agent crash webhook, or an admin cancel.

Ways to get stuck:

- A dropped `match_end` (2.3).
- A DatHost server that crashes. No agent is watching it, so there is no crash webhook.
- A box reboot. On restart `Manager.Recover` skips dead pids silently (`manager.go:165-169`), so no crash webhook is sent.
- A CS2 hang.

`ACTIVE_MATCH_STATUSES` includes `live`, so `queue.join` answers `in_match` and the party is `party_locked` for good.

Reproduced on the harness: after `server_ready` and `match_started`, advancing the clock 48 h and running `tick()` leaves the match `live`, and `queue.join` fails with `in_match`.

Smallest fix:

- A sweep that ends any `live` match older than the mode's maximum length plus a margin (for example 45 min for rush, 30 for aim). It asks the driver whether the server is alive, then cancels unrated.
- A 60 s reconcile of `GET /servers?include=exited` against active matches, which catches crashed and unknown servers.
- The agent sends the crash webhook for saved servers that `Recover` finds dead.

### 3.2 High: failed stops leak servers and share GSLTs (Read)

`Allocator.release` (`allocator.ts:275-293`) logs a failed `driver.stop` and then marks the slot free and the GSLT free anyway. The CS2 process keeps running with that GSLT and port.

- The next match to take that token logs a second server in with it, and Steam drops the first server's login.
- The agent still counts the port as used, so its capacity drifts from `server_slots`. The API marks a host `updating` on the 503 that follows (`allocator.ts:251-252`).
- `syncHosts` never compares the agent's `free` with the table (`allocator.ts:133-165`).

Fix: keep the slot and token `releasing` until a stop succeeds or the agent's server list no longer shows the match. Reconcile slots from `GET /servers` in `syncHosts`.

### 3.3 High: infrastructure failures cost players cooldowns (Reproduced, Read)

- `resolveAbandon` returns `void` with `forfeiters: [...a, ...b]` when both teams have someone missing (`accept.ts` HEAD line 64).
- `abandonMatch` issues a cooldown to every forfeiter (`flow.ts:814-816`). `expireConnect` (`flow.ts:955-960`) calls it with everyone who never connected.
- When all players are missing, the cause is almost always ours: a wrong `RUSHSITE_PUBLIC_IP`, the firewall, a server on an old CS2 build after a Valve patch, or the DatHost race in 4.1. Yet all of them get `no_connect` cooldowns, which escalate.
- **Patch day:** after Valve ships an update, the agent keeps accepting servers until its next check (default 5 minutes, `config.go:239`), and the API keeps allocating until the next health sync (30 s). Updated clients cannot join old servers. Every match started in that window ends with everyone penalised.

Fix: when every player is missing, cancel as `server_unreachable` with no cooldown. Do the same when every missing player is on both teams. Also stop allocating to a host whose `cs2Version` is behind the Steam API's current version.

### 3.4 Medium: forfeit wins are rated in full (Read)

`abandonMatch` rates the winners at the full value of a win when the loser never connected (`flow.ts` HEAD around 775-786). A duo with an alt account can queue 1v1 against each other and feed wins through no-shows. That costs only the alt's cooldown, and cooldowns are per account. There is no win-trade detection yet.

Fix: when a forfeiter never connected, leave the winners unrated, or rate them at the reduced "match" weight only after N rounds were played.

### 3.5 Medium: a second rollback undoes the first (Reproduced)

- `rollbackCheater` (`rating/service.ts:146-259`) replays each victim from `first.ratingBefore` of the earliest event it voids. It reads only history from that seq onward and skips earlier `rollback` rows.
- When a later rollback's first voided event comes after an earlier rollback's voided event, `ratingBefore` of that later event still contains the effect the earlier rollback removed. The replay puts it back.

Reproduced on the harness. Player V lost to cheater X1 (m1), lost to an honest player (m2), lost to cheater X2 (m3), then beat the honest player (m4). After both rollbacks V sits at 1447.3. A clean replay of m2 and m4 alone gives about 1553.8.

Also:

- The rollback holds one transaction for the whole window and locks victims in map order (`SCALABILITY.md` 3). That risks a deadlock with a concurrent `applyMatch`.
- Teammates of the cheater keep what they gained in 2v2 and 3v3. The brief only asks for opponents, but that should be a stated decision.
- After a rollback, the `before` and `after` values of every later `rating_events` row are stale. The profile rating chart jumps.

Fix: replay each victim from their first non-voided event in the mode, or from the default rating, instead of from the earliest newly voided event. Run one transaction per victim, ordered by `steam_id`.

### 3.6 Medium: the ledger-free design has no invariant check (Read)

`ratings` is a mutable balance (rating, rd, vol, matchesPlayed, wins, losses) updated beside `rating_events`. Nothing checks that a player's `ratings` row equals the replay of their non-voided events. After the bug in 3.5 there is no way to detect or repair drift except by hand.

Fix: a nightly job that replays every player and mode and reports differences. Later, make `ratings` a cache rebuilt from events.

### 3.7 Race conditions not covered by the QA passes

- **Queue accept:** `respond` and `expireAccept` both lock the match row. They are sound. A player who leaves the queue while a claim commits still gets `match_found` and a cooldown if they decline (SCALABILITY 1).
- **Veto:** `vote` and `expireVetoStep` lock the match and veto rows. A vote cast in the last moment of a step can land on the next step. `castVetoVote` rejects it if the other team is acting, so the effect is only a confusing error.
- **Party change while queued:** the party hook cancels the ticket after the party transaction commits (`queue/service.ts` `cancelParty`). A matchmaker pass in between can claim a ticket whose `steamIds` no longer match the party. The window is small.
- **Duplicate webhooks:** `round_end` is keyed on `(match_id, round)`, kills on `(match, round, tick, victim)`, and `finishMatch` is guarded by status and `ratingApplied`. These are sound, except after a plugin reload (2.4).
- **Out-of-order webhooks:** the plugin sends in order. The agent's crash webhook is a second sender. A crash just after the match ends, with `match_end` still queued in the dead process, turns a finished match into `cancelled server_crashed`, unrated. A dropped `match_started` followed by rounds leaves the match `ready`, so it is cancelled mid-game at 600 s (1.4 row 7).
- **Server crash during veto:** no server exists during a veto. A tournament match reserves the slot and GSLT before the veto (`flow.ts` `createTournamentMatch`), and they are held for the whole veto. That is not a bug, but it takes capacity away from the ladder at cup start.
- **Webhook handler does slow work inline:** `finishMatch` → `emitResult` → the tournament listener can provision the next bracket match → `tryAllocate`. That can be a 15 s agent call, or a DatHost boot of up to 240 s, inside the plugin's 10 s webhook timeout. The retry is idempotent, but it holds the plugin's queue.

---

## 4. DatHost surge

### 4.1 High: `server_ready` wins the race with `start()` (Reproduced)

- `DatHost start()` clones, uploads `match.json`, starts, polls every 3 s until `on && !booting`, and for Rush then sends three console lines (`packages/dathost/src/driver.ts:144-223`). The plugin loads during that boot and posts `server_ready` about 1 s after the first map start.
- `handleEvent` `server_ready` (`flow.ts:572-583`) moves an `allocating` match to `ready`. `sendServerReady` sends nothing, because `serverIp` and `connect` are still null.
- When `start()` returns, the `update ... where status = 'allocating'` (`flow.ts:505`) matches no row. The connect info is never stored. The row count is not checked.
- At 600 s `expireConnect` finds every player missing, and 3.3 gives all of them a `no_connect` cooldown.

Reproduced with a surge driver that delivers `server_ready` inside `start()`: the status is `ready`, ip, port and connect are null, zero `server_ready` messages are sent, and after 601 s all six players have `no_connect` cooldowns.

Fix: in `server_ready`, only change `starting` to `ready`. Accept `allocating` by recording `readyAt` without the status change. Check the row count of the `starting` update and re-read.

### 4.2 High: two clones for one tournament match, and a stalled allocation loop (Read)

- Tournament matches pass `waitedMs = Infinity` (`flow.ts:482`), so they go to DatHost at once when Hetzner is full.
- `tryAllocate` holds `lock:alloc:<id>` for 60 s (`flow.ts:468`). A DatHost boot can take 240 s plus the clone. The tournament scheduler calls `tryAllocate` inline. After 60 s the allocation loop (`flow.ts` `allocationTick`) takes the expired lock, still sees `allocating`, and calls `surge.start` again. That makes a second clone. `store.set` overwrites `driverRef`, so teardown deletes the second clone and the first one, where the players are, keeps running until autostop and is never deleted.
- The allocation loop awaits every job in a pass (`eachLimit`), and the `running` flag (`app.ts` `loop`) skips passes while one runs. One slow DatHost boot stops new Hetzner allocations and teardowns for minutes. When they finally run, many matches have passed `ALLOCATION_TIMEOUT_SEC=120` and are cancelled `no_server`.
- `SURGE_WAIT_SEC=20` plus a boot of 60 to 240 s puts players on a spinner for 1.5 to 4.5 minutes after accept. The brief's premise that "DatHost is the pressure valve" has not been timed.
- DatHost auto-updates CS2 on its own schedule, so the plugin on the template breaks the same way as in 6.1, with no drain.

Fix: make the per-match lock outlive `bootTimeoutMs` plus a margin, or record a `surge_starting` status in Postgres before calling DatHost. Run DatHost starts outside the pass, as fire and forget with their own concurrency cap. Measure clone-to-ready time on the account before relying on it.

---

## 5. Demos

### 5.1 High: presigned URLs point at a Docker-internal host (Read)

- The deploy's `.env.example` sets `S3_PUBLIC_ENDPOINT=http://rushsite-minio:9000` (`services/rushsite/.env.example`). `S3DemoStorage` signs with that endpoint (`storage.ts:464-471`).
- The game servers are meant for a separate box and DatHost, and cannot resolve `rushsite-minio`. MinIO publishes no port and has no Caddy route. Every plugin PUT fails.
- The download URLs in `GET /matches/:id` `demo.url` point at the same host, which is unreachable from browsers.

Fix: expose MinIO through Caddy on a public hostname, or use Hetzner Object Storage as the brief says, and set `S3_PUBLIC_ENDPOINT` to that.

### 5.2 Medium: demos are never deleted (Read)

- The plugin writes `game/csgo/rushsite_<matchId>.dem` and never removes it after upload. The agent removes only the match cfg dir (`manager.go:444-448`). A 20-minute Rush demo is tens of MB, and the box also holds the 60 GB install and, per the brief, Postgres.
- `demos.delete_after` is set to 30 days (`flow.ts` `demo_uploaded`), but no job reads it. MinIO lives on the VPS disk.
- Agent per-match logs in `/var/lib/rushsite-agent/logs` and `steamcmd.log` are never rotated.

Fix: the plugin deletes the file after a successful upload. The agent sweeps `*.dem` older than a day. Add an API job that deletes objects past `delete_after` unless flagged.

---

## 6. CounterStrikeSharp and CS2 updates

### 6.1 High: the agent reopens after a CS2 update without checking the plugin (Read)

`Updater.drain` (`update/update.go:458-482`) runs SteamCMD, re-patches `gameinfo.gi`, and then calls `SetAccepting(true)`. The 1.41.8.2 update is the proof that a CS2 update can break CounterStrikeSharp: `ChangeTeam` silently did nothing and `Teleport` crashed.

After such an update:

- Servers start and the plugin either fails to load or runs on broken offsets.
- Without the plugin there is no `server_ready`, so the match waits in `starting` for 720 s (`ALLOCATION_TIMEOUT_SEC + CONNECT_TIMEOUT_SEC`) and is then cancelled.
- If the plugin loads with bad offsets, results can be wrong.

Fix: after an update, start one canary server with a synthetic `match.json`. Reopen only after it posts `server_ready` to a local endpoint and reports its CSS version. Otherwise stay closed and alert. The same gate is needed for DatHost template servers.

### 6.2 High: CounterStrikeSharp hot reload runs inside live matches (Inferred)

See 2.4. Set `PluginHotReloadEnabled: false` in `addons/counterstrikesharp/configs/core.json` from `bootstrap.sh`.

### 6.3 High: the compile target and the runtime do not match (Read, Inferred)

- The plugin targets net8.0 and `CounterStrikeSharp.API` 1.0.368 (`RushsiteMatch.csproj`). The only builds with the 1.41.8.2 fixes are PR #1432 and #1433, which ship net10 and a newer API.
- `plugin/README.md` asserts "A net8.0 plugin loads in that host". Nobody has checked. Schema property accessors and generated classes change between CSS builds.
- A `MissingMethodException` shows up only when the method is JIT-compiled. For example `IsWarmup` swallows it and returns false, which feeds Rush go-live detection (`CssGameServer.cs:422-433`).
- .NET 8 LTS support ends in November 2026, weeks after launch.

Fix: build against the exact CSS build that is deployed (retarget to net10 now, pinned to the PR artifact). Add a smoke command, `rushsite_selftest`, that exercises every CSS call the adapter uses and prints the results. Run it as part of the canary in 6.1.

### 6.4 Medium: the plan for the breakage is "wait" (Read)

- `bootstrap.sh` requires a pinned `CSS_ZIP`, which is good, but Metamod defaults to "latest 2.0 dev build" (`bootstrap.sh:125-133`), which is unpinned.
- There is no documented owner or process for the next CS2 update. One is likely within weeks of a new mode shipping.

Fix: pin Metamod. Write a one-page runbook: who watches CSS, how to pin a build, and how to close queues per mode (the `queue.<mode>.open` flag exists).

---

## 7. Operations

### 7.1 High: there is no CI, and a broken migration is in the tree now (Reproduced)

- There is no `.github`, `.forgejo` or `.gitea` directory. `make test` exists but nothing runs it. `deploy.sh` ships any committed HEAD without a test gate.
- The working tree has an uncommitted `apps/api/drizzle/0013_review_reopen.sql` with `CREATE UNIQUE INDEX ... WHERE "flags"."status"::text in ('open','reviewing')`. An enum-to-text cast is not immutable. Postgres 16 refuses it: `ERROR: functions in index predicate must be marked IMMUTABLE`. This was checked in a rolled-back transaction on the local Postgres.
- The API test harness fails on the same statement, so the whole API suite fails on the working tree right now. If it is committed and deployed, `DB_MIGRATE_ON_START=true` makes the API crash-loop. `restart: unless-stopped` keeps it down, and `deploy.sh` has already replaced the running container.

Fix: compare against the enum directly (`"status" in ('open','reviewing')`). Add CI. Make `deploy.sh` run `drizzle migrate` in a one-off container before `compose up`, so a failed migration leaves the old API running.

### 7.2 Medium: migrations at boot on a live box (Read)

- The drizzle migrator runs pending files at every API start (`server.ts:7`), inside the one API container, with no advisory lock. That is fine for one instance, but two instances would race.
- `CREATE INDEX` without `CONCURRENTLY` locks writes on the table for its duration. The migrations use plain `CREATE INDEX` (for example `0012_leaderboard_search.sql` on `users`, tree). That is harmless on small tables and a stall later.
- There are no down migrations, and the README says so.

### 7.3 High: no backups are scheduled, and the script does not fit the live deploy (Read)

- `infra/scripts/db-backup.sh` runs `docker compose -f docker-compose.yml exec postgres` from the repo dir. The live stack is `/opt/services/rushsite/docker-compose.yml` with the service `rushsite-postgres`, so the script cannot find the service.
- `services/rushsite/README.md` gives a manual `pg_dump` command and no cron.
- MinIO data (demos under review) and Redis (sessions, queue) have no backup either.

Whether a cron exists on the VPS was not checked, since only HTTP probing was in scope.

Fix: a systemd timer or cron on the VPS running `docker exec rushsite-postgres pg_dump`, copied to a different provider. Do one restore drill.

### 7.4 Medium: single VPS, memory caps and log rotation (Read)

- Postgres runs at `mem_limit: 512m`, the API at 512m and Redis at 128m, on a VPS shared with the other `dyylndev` services.
- Redis has AOF on and **no `maxmemory`** (`command: redis-server --appendonly yes`). At the cgroup cap it is OOM-killed, not evicted. An AOF rewrite forks and can double resident memory. Losing Redis logs everyone out and empties the queues.
- The API's `fetchDemo` for DatHost buffers whole demos in memory (`packages/dathost/src/driver.ts:233-249`, `storage.ts:492-497`) inside the 512 MB API.
- Log rotation is set only for `rushsite-api` and `rushsite-web`. Postgres, Redis and MinIO use the daemon default. On the game box nothing rotates the agent logs, the CS2 console logs or `steamcmd.log`.
- The brief puts Postgres, Redis, API, web and CS2 on one AX box. The deploy puts the site on a shared VPS with game servers "on a separate box". Both are single points of failure. The second is safer, but it is not what the capacity estimates in `SCALABILITY.md` assume.

Fix: set `--maxmemory 96mb --maxmemory-policy volatile-lru` and raise the cap. Stream DatHost demos to S3 instead of buffering them. Set logging options on every container. Add logrotate for the agent data dir.

### 7.5 Medium: secrets handling (Read)

- Every secret sits in one hand-written `.env` (chmod 600) that is also the API `env_file`. There is no secret store and no rotation.
- `DATHOST_PASSWORD` is the account login (Basic auth), not a scoped API key.
- `RUSHSITE_AGENT_TOKEN` is shared by every host and sent over plain HTTP (`SECURITY.md` 7).
- GSLTs and per-match `webhook_secret` and `password` are stored in plaintext in Postgres, so every backup carries them.
- `apps/web/.env.local` is tracked in git. It holds only public values today, but `.dockerignore` excludes `.env.*` only at the root, so it is copied into the web build context.

Fix: DatHost API token if one is available, per-host agent tokens, encrypted backups, and `**/.env*` in `.dockerignore`.

### 7.6 High: production is not running HEAD (live probe)

`https://rushsite.dyyln.dev/play` still sends `x-powered-by: Next.js` and no CSP. `https://api.rushsite.dyyln.dev/health` sends no helmet headers and still exposes socket and loop metrics. The security commit (`28a75b7`) is therefore not deployed. Everything `SECURITY.md` marks "fixed" is fixed in the repo only.

Fix: deploy, and add `/version` returning the deployed SHA so this can be checked.

---

## 8. Test quality

### 8.1 High: the tests prove the code agrees with its fakes (Read)

`apps/api` has about 300 `it()` blocks. They run on PGlite (real SQL, one connection) and `ioredis-mock`.

- `FakeAgent` (`test/helpers.ts`) accepts any `StartServerRequest`, returns in 0 ms and never validates. The execCfg bug (1.1), the agent's 409 and 400 paths, and timeouts are never exercised.
- Every harness sets `ALLOW_UNRESOLVED_MODES: "true"`, so the production gating path is not what the tests run.
- PGlite has one connection. `FOR UPDATE SKIP LOCKED`, row-lock contention and the rollback deadlock (3.5) cannot happen, so the "race" tests only check sequential interleavings.
- `ioredis-mock` stands in for `SET NX PX` locks, pub/sub fan-out and the rate limiter store.
- The tournament plugin tests (17) and admin tests (13) run on `MemoryTournamentStore` with a fake `startMatch` returning `{ matchId }`. The Postgres `TournamentStore` (`store.ts`, 459 lines, the provisioning claims and row locks) has no test. The admin plugin tests (17) use the admin memory store.
- Nothing tests match flow and tournaments together, from `onResult` to bracket advance to the next `createTournamentMatch`.
- No test covers a `live` match that never ends, `server_ready` before allocation, a crash webhook after a box reboot, or `expireConnect` on a match that is actually live.
- The plugin tests (81) exercise Core with a fake game server. They encode what the authors believe CS2 does (event order, winner sides, auth order) and cannot check it.
- The Go tests use a fake process runner. No test checks the rendered launch line against a real `cs2`, which is unavoidable, but also none checks it against the TS mode table, which is avoidable.
- There is no web test of any kind. The `SIMPLIFY.md` check was byte-identical output of the **mock** build.

Smallest fixes, in order of value:

1. A golden-fixture contract test. Shared JSON files with a `StartServerRequest` per mode and one webhook body per event type. The Go agent must accept and render each request, the plugin must serialize to each body, and the API must accept each body.
2. Run the API suite once against real Postgres in CI, with `ALLOW_UNRESOLVED_MODES` off in one job.
3. A test for the SQL tournament store.
4. One scripted end-to-end run on a real box (the "do not launch until" list, item 1).

### 8.2 Medium: web mock versus live drift (Read)

- REST responses are not validated. `request<T>` returns `data as T` (`apps/web/src/lib/api.ts:55-70`). Several calls hedge on the shape, for example `"user" in res ? res.user : res` and `"settings" in res ? res.settings : res`, which shows the author was not sure of the contract.
- `Profile`, `ModeStats`, `MatchSummary`, `Leaderboard` and `User` are hand-written in `apps/web/src/lib/types.ts:34-117`, not taken from shared. `app/admin/_lib/types.ts` (177 lines) hand-mirrors the API admin types (`SIMPLIFY.md` proposal 6, not applied).
- WS messages that fail `ServerMessageSchema` are dropped silently in production (`apps/web/src/lib/ws.ts:110-117`, the warning is dev only). A schema drift on `match_found` or `server_ready` would leave players staring at a queue that already matched.
- The mock (`lib/mock.ts` 705 lines, `ws-mock.ts` 438 lines, three more admin mocks) is the only environment in which the pages have been exercised end to end.

Fix: move the REST response types into shared zod schemas. Parse them in `request` in development builds and log in production. Add a Playwright smoke run against the local stack.

---

## 9. Authorship consistency and contract drift

### 9.1 High: duplicated sources of truth that already disagree (Read)

| Concept | Copies | Disagreement found |
|---|---|---|
| Mode launch table | `packages/shared/src/config/modes.ts`, `agent/internal/match/modes.go`, `packages/dathost/src/cfg.ts` (`PRESETS`) | Rush `execCfg` (1.1) |
| `server.cfg` | `agent/internal/match/render.go`, `packages/dathost/src/cfg.ts` | hibernate, GOTV password, rcon, bots (2.5) |
| `match.json` | `render.go` `PluginJSON`, `dathost/cfg.ts` `buildMatchJson` | none yet |
| Webhook sender | plugin `WebhookDispatcher` (10 attempts), agent `webhook.Sender` (5 attempts, 2 s) | different retry policies for the same endpoint |
| Timeouts for "player never came" | plugin `rushsite_connect_grace` 300 s, API `CONNECT_TIMEOUT_SEC` 600 s, DatHost `autostop_minutes` 30 | whichever fires first decides forfeit versus cancel |
| Background loops | `app.ts` `loop()` with Redis locks, and hand-rolled intervals in `friends/`, `challenges/`, `tournaments/` without locks (`SIMPLIFY.md` 12) | different locking and backoff |
| Error classes | `lib/errors.ts`, `AdminError`, `TournamentError` (`SIMPLIFY.md` 1) | different 4xx bodies |
| In-memory stores | admin and tournaments ship memory stores in `src/` used only by tests | the SQL paths are untested (8.1) |

Fix: one generated `modes.json` from shared that the Go agent embeds, and one cfg renderer. The rest can wait.

### 9.2 Contract statements that contradict the code or the research

- `CONTRACTS.md` ModeConfig comment: "ban-to-7: alternate bans over 15 arenas to 7 (rush ladder)". The code uses `vetoFormat: "none"` for Rush. The research says the draw cannot be controlled, and the script has 16 rooms, not 15.
- `CONTRACTS.md` Veto: "`vetoResult(state).deciders` is ... the 7 arenas in play order (rush)". There is no Rush veto.
- `CONTRACTS.md` Agent API: "cs2 ... from MODE_CONFIGS, the agent prefers this over its own table". This is the mechanism that produces 1.1. The contract lets the API override something the agent has to have on disk, without a rule for which names are valid.
- `CLAUDE.md`: "Demo capture ... delete clean ones after a set time". `delete_after` is written and never read (5.2).
- `CLAUDE.md`: "one dedicated AX box running everything". The deploy runs the site on a shared VPS with no game servers.
- `CLAUDE.md` storage: "Hetzner Object Storage for demos". The deploy uses MinIO on the VPS, with an unreachable public endpoint (5.1).
- `CLAUDE.md`: "A player who never connects ... forfeits". The code also penalises every player when nobody connects (3.3).
- `CONTRACTS.md` "If a CS2 process crashes, the agent POSTs match_abandoned". The agent does not do this for servers that died while it was down (3.1).
- `plugin/README.md`: "A net8.0 plugin loads in that host". Nobody has checked (6.3).
- `SECURITY.md` "fixed" items are not live (7.6).

---

## 10. Dependency and version risk

| Dependency | Locked | Risk |
|---|---|---|
| CounterStrikeSharp | compile 1.0.368 (net8), runtime an unreleased PR build (net10) | See 6.3. The biggest single dependency risk |
| Metamod:Source | "latest 2.0 dev" by default | Unpinned (6.4) |
| .NET 8 SDK | net8.0 | Support ends November 2026 |
| Next.js | 16.3.6, React 19.3 | Current major. The standalone output and CSP headers were checked only with `next start`, not in a browser (`SECURITY.md`) |
| zod | 4.6.5 | Used on both sides of the wire. `z.uuid()` in v4 enforces RFC variant bits. The web and the API share the package, so they stay in step. Fine as long as the lockfile is frozen, which the Dockerfiles do |
| drizzle-orm / drizzle-kit | 0.45.3 / 0.31 | Pre-1.0. Minors break. Generated SQL is not reviewed (see 7.1) |
| vitest / vite | 5.0.1 / 8.3 | Very new majors, test only |
| PGlite | 0.5 | Differs from Postgres where it matters (one connection). It did catch 7.1 |
| Go | `go 1.22` in `go.mod`, stdlib only | Low. No toolchain on the dev machine, so builds come from a scratch toolchain |

---

## Appendix: reproductions

The files are in the session scratchpad (`repro/`), not in the repo. They were run against `git archive HEAD` of `apps/api` and `packages`, with the repo's `node_modules` symlinked in.

- `race.test.ts`: a surge driver that delivers `server_ready` inside `start()` on a Rush tournament match. Result: status `ready`, ip, port and connect null, 0 `server_ready` messages, and after 601 s six `no_connect` cooldowns.
- `live.test.ts`: `startDuel`, allocate, `server_ready`, `match_started`, clock +48 h, `tick()`. Result: status `live`, and `queue.join` throws `in_match`.
- `rollback.test.ts`: m1 X1 beats V, m2 O beats V, m3 X2 beats V, m4 V beats O, then `rollbackCheater(X1)` and `rollbackCheater(X2)`. Result: V at 1447.3 after both rollbacks, against 1553.8 for a clean replay of m2 and m4.
- Postgres 16 on 5433, rolled back: `CREATE UNIQUE INDEX ... WHERE s::text in (...)` on an enum column gives `functions in index predicate must be marked IMMUTABLE`.
