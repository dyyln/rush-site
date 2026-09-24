# RushsiteMatch

CounterStrikeSharp plugin that runs one rushsite match per CS2 server process. It reads `match.json`, enforces the whitelist and password, records the demo, tracks rounds and player stats, and posts match events to the API. Contracts are in `../docs/CONTRACTS.md`.

## What it does in each mode

The split is decided once, from `winCondition` in `match.json`. See `MatchController` in `src/RushsiteMatch.Core/Match/MatchController.cs`.

| | Aim (`first_to_N`, aim1v1 and aim2v2) | Rush (`valve_rush`, rush1v1 and rush3v3) |
|---|---|---|
| Whitelist kick, `sv_password` check | yes | yes |
| `bot_quota 0` and `bot_kick`, re-checked every second | yes | yes |
| Warmup hold and start | held until everyone is in and on their side, then a countdown starts the match | held until everyone is in and on their side and the rooms are settled, then the same countdown ends warmup with `mp_warmup_end` |
| Map loadout, no buying, spawn immunity | yes | no |
| Side validation on `jointeam` | yes, first team on a side claims it | yes, fixed from `match.json`. Wrong joins are redirected, repeated ones kicked |
| Sets `mp_maxrounds`, clinch, overtime and halftime | yes, overtime on | no. Never touches any `mp_` round convar |
| Series (Bo3) on one server | yes | yes |
| Pause on disconnect | yes | no |
| Late Steam authorization counted | yes | yes |
| State restored after a plugin hot reload | yes | yes |
| `tv_record` start | at match start | when all players are in, or when the match goes live |
| round_end, match_end, stats, demo upload | yes | yes |
| match_abandoned | yes | yes |

### Aim modes

- Warmup is held with `mp_warmup_pausetimer 1`.
- Players pick a side with the normal team menu. The plugin blocks joins to the wrong side and never moves anyone. The rules are:
  - A teammate already on a side decides the side.
  - Otherwise an opponent already on a side decides it.
  - Otherwise `teams[0]` goes CT and `teams[1]` goes T, matching `mp_teamname_1` and `mp_teamname_2`.
- There is no ready-up. Once every match player is connected and the teams sit on opposite sides, a countdown of `rushsite_start_countdown` seconds starts. If a player leaves or changes side during it, the countdown stops and the plugin waits again. The connect and disconnect graces still abandon the match as before.
- `!ready` only replies that the match starts on its own.
- The mode cfg is exec'd again at match start because Valve's `gamemode_competitive.cfg` runs on map load after the agent's command line `+exec`. Without it aim plays with $800, buy zones and C4. It runs before `mp_warmup_pausetimer 0` (the cfg sets it to 1) and before `mp_warmup_end`, whose restart applies `mp_startmoney 16000`. Rush never runs it.
- On start the plugin runs these commands in order: `exec rushsite/matches/<matchId>/mode.cfg` (written by both drivers), the loadout convars below, `mp_respawn_immunitytime`, `mp_maxrounds 2N-1`, `mp_match_can_clinch 1`, `mp_overtime_enable 1`, `mp_overtime_maxrounds`, `mp_overtime_startmoney`, `mp_halftime 0|1`, `mp_warmup_pausetimer 0`, `tv_record`, `mp_warmup_end`.
- First to 13 is 25 max rounds with clinch. A draw round (time runs out with no winner) still counts toward the 25. If regulation ends level, overtime runs in periods of `rushsite_overtime_maxrounds` rounds. A period is won by taking half of it plus one, and a tied period starts another. So an aim map always has a winner. Set `rushsite_overtime_maxrounds 0` to turn overtime off, and the map can then end `draw`.

#### Loadout

- Each aim map has a fixed loadout of primary and secondary per side, plus armor. It comes from the map's `loadout` in `match.json` when set, otherwise from the table in `src/RushsiteMatch.Core/Match/Loadout.cs`, looked up by map id, then map name, then the map the server reports. An unknown map gets rifles.

| Map | CT | T | Armor |
|---|---|---|---|
| aim_map, aim_redline, aim_ag_texture2 | M4A4 + USP-S | AK-47 + Glock | kevlar and helmet |
| aim_usp | USP-S | USP-S | kevlar and helmet |
| aim_deagle7k (plays aim_deagle) | Deagle | Deagle | kevlar and helmet |
| awp_india | AWP | AWP | kevlar and helmet |

- The plugin sets `mp_ct_default_primary`, `mp_t_default_primary`, `mp_ct_default_secondary`, `mp_t_default_secondary`, empty default grenades, `mp_free_armor`, `mp_buytime 0`, `mp_buy_anywhere 0` and `mp_weapons_allow_map_placed 0`. It sets them in warmup and again after mode.cfg at match start, because mode.cfg turns buying back on.
- 0.2 s after each spawn, the plugin gives the loadout primary only if the player has no primary, the loadout secondary only if they have no secondary, and `item_assaultsuit`. It never removes a weapon: removing and giving in the same tick crashed clients with `CopyExistingEntity: missing client entity`. Turn this off with `rushsite_aim_loadout 0`.
- `mp_respawn_immunitytime` is set from `rushsite_aim_spawn_immunity`. Whether CS2 honours it at round start in competitive, and not only on respawn, is unverified.
- The score is kept per config team, so a halftime swap is handled.

### Rush

- Valve's `rush_001.js` owns round time, max rounds and the match end. The plugin never sets an `mp_` round convar.
- Teams are fixed from `match.json`. See "Rush teams" below.
- Warmup is held with `mp_warmup_pausetimer 1`. Once every player is connected and on their side, the aim start countdown runs (`rushsite_start_countdown`, same chat and center text). When it runs out the plugin sends `mp_warmup_pausetimer 0`, `tv_record` (a no-op when already recording) and `mp_warmup_end`. Leaving or switching side during the countdown stops it, as in aim.
- Why the plugin ends warmup itself: in a live rush1v1 test Valve's warmup never ended. The likely cause is `mp_endwarmup_player_count`, which defaults to 0 and means "require maximum players for mode". `gamemodes.txt` gives Rush `maxplayers 6` and `gamemode_rush.cfg` does not change it. `rush_001.js` has no warmup or player count logic of its own. Ending warmup explicitly works whatever the engine waits for. Ending warmup when everyone is present is not a rule change. Round rules, rooms, economy and timers stay Valve's.
- With `rushRooms` the countdown does not end warmup until the script has answered the room set (`rushsite_rooms_applied`) or `rush_rooms_failed` has gone out. The countdown waits at zero and chat says the rooms are loading. That wait is at most about 10 s, the reply timeout twice. So the rooms are always applied in warmup, before the first live round.
- `rushsite_rush_hold_warmup 0` stops holding Valve's warmup timer. The countdown still ends warmup once everyone is in.
- No loadout, spawn immunity or overtime. Rush is Valve's rules as shipped.
- A Rush map cannot normally end tied. Every round has a tower owner who wins it, so 15 rounds always give someone 8. A tie needs a round that `rush_001.js` ends with the `DRAW` reason, which the documented rules never do. If it happens, the plugin reports `winnerTeam: "draw"` in `match_end`, or in `map_end` for a series. No tiebreak is invented.
- The match counts as live on the first of these:
  - `round_announce_match_start`
  - `begin_new_match`
  - a `round_freeze_end` outside warmup
- The winner comes from `cs_win_panel_match` if it fires. Otherwise the plugin's own tracking decides, using the rules from `rush_001.js`:
  - The front starts in slot 3.
  - A T win moves the front +1 and a CT win moves it -1.
  - A round won in the enemy castle wins the match. So does an 8th round win.
  - There are at most 15 rounds.
- When the score decides the match, the plugin waits `rushsite_match_end_wait` seconds for the win panel, then ends the match itself. It does not rely on anything after the restart that `mp_match_end_restart 1` triggers.
- `round_end` carries an extra `arena` field in Rush.
  - It holds the rush_001 room id, for example `"101"` or `"convoy"`.
  - It is found at `round_freeze_end` by matching living T pawns, or `tspawn*` entities, to the nearest `t1room.<id>` target.
  - This field is not in CONTRACTS.md yet.

## Chat

- Every line starts with the brand prefix in purple. Scores are gold and team names follow the site colours, purple for the first team and amber for the second.
- Start countdown, every mode: announced when it starts, every 10 seconds above 10, then each of the last 5 seconds. The center of the screen shows every second. When it stops, chat names who left the server or switched side.
- Disconnect: `<name> disconnected. 3:00 to return or they forfeit.` The time is `rushsite_disconnect_grace`. Aim adds that the match pauses at the next freeze time. The time left is repeated every minute and at 30 and 10 seconds, and `<name> is back.` is printed on return. This runs in warmup, live and between series maps, in every mode.
- Match end: the final score, the match link when `brand.siteUrl` is set, and the time until the kick. Players are kicked after `rushsite_match_end_kick_delay` with the score in the kick reason. Anyone who reconnects after that is kicked again.
- Series: each map end prints the map score, the series score and the next map. The series end prints the series score, every map score and the match link.

### Rush rooms from the veto

Needs our modified `rush_001` script from `rush-script/`, installed as described in `rush-script/README.md`. Without it the chat line does nothing and Valve's random draw stands. The script side was proven on a local dedicated server (see `docs/RUSH-ROOM-VETO.md`). The plugin side has unit tests but has not run on a server yet.

- `rushRooms` in `match.json` is an ordered list of 5 room ids for slots 1 to 5. A series map entry may carry its own `rushRooms`, which wins over the top level one. Absent means Valve's draw.
- Slot 3 must be a start room (101 to 104) and slots 1, 2, 4 and 5 mid rooms (201 to 212), with no duplicates. Ids may be numbers or numeric strings. A bad list is logged and ignored, and the match still loads.
- In warmup, each time a Rush map comes up, the plugin runs `say rushsite_rooms 203,207,102,211,205` from the server console. The script only accepts that line when no player sent it. `ent_fire` is not used: it does nothing from the console of a dedicated server. Players see the line in chat during warmup.
- Rooms are never sent once the map is live, because applying resets the script's game state. After a hot reload mid match the plugin keeps the plan for the check below but sends nothing.
- Our script answers each set by running `rushsite_rooms_applied <7 ids in play>` or `rushsite_rooms_rejected <reason> <ids>` on the server console. The plugin registers both commands and ignores them from players. With no answer after `RushRoomsReplyTimeout` (5 s) the rooms are sent once more. With no answer again, or a rejection, or other rooms in play, the plugin sends `rush_rooms_failed { reason: no_reply | rejected | different, rushRooms, detail?, mapNumber? }` once per map. That normally happens while still in warmup, so the API can act before the match is live. `no_reply` means `rushsite_rooms.vpk` is not installed.
- `match_started` carries `rushRooms`, the 7 ids castle to castle as sent, and `rushRoomsConfirmed`.
- `rushsite_status` shows the rooms as `confirmed`, `unconfirmed` or `FAILED`.
- At each `round_freeze_end` the detected arena is compared with the planned room for the current front slot. The 7 to 7 Convoy decider is skipped. The first difference on a map sends `rush_rooms_mismatch { round, expected, detected, rushRooms, mapNumber? }` and shows `MISMATCH` in `rushsite_status`. An arena that cannot be read is not a mismatch.
- `rushsite_rush_rooms 0` turns all of this off. The console command `rushsite_rush_rooms_send` sends the rooms again during warmup.

## Series (Bo3)

When `match.json` has a `series`, the whole series is played on this server:

- The server launches on map `series.startMapNumber`, normally 1. `series.wins` holds maps already won before it, which is non-zero only when a series resumes after a crash.
- When a map ends, the plugin sends `map_end` and keeps everyone on the server. That includes the last map. It stops the demo after `tv_delay` + `rushsite_demo_stop_extra`, and waits at least `rushsite_series_map_break` seconds. In Rush that is about 110 s because of `tv_delay 105`. Then it loads the next map with `host_workshop_map <workshopId>` or `changelevel <mapName>`.
- On the new map it runs mode.cfg again and starts a fresh warmup. It uses the same whitelist, password and teams, with scores and rounds reset. Both count down again once everyone is in. Rush holds warmup again and waits for the new map's rooms. Sides are not swapped between maps.
- Players reload with the map. The plugin sends `player_disconnected` for each of them when it changes the map. It sends `player_connected` again as each one is fully in on the new map.
- Once a team has a majority of maps, or the last map is played, the plugin sends `match_end` with the series result and then kicks everyone. A drawn Rush map credits nobody. If the maps run out level, `match_end` is `draw`.
- `match_abandoned` ends the whole series. That can be a no-show, a disconnect past the grace, or a next map that has not loaded within 5 minutes (`map_load_failed`).
- Each map records `rushsite_<matchId>_m<mapNumber>.dem` and uploads it to `series.demoUploads[mapNumber-1]`. If that entry is missing, the start map falls back to the top level `demoUpload`.
- Without `series`, a match behaves exactly as before. No `mapNumber` is sent and no `map_end`.

## Rush teams

The side each config team plays is fixed for the whole match:

- `teams[0]` plays CT and `teams[1]` plays T.
- A team may set `"side": "ct"` or `"side": "t"` in `match.json` to override this. Setting one side is enough, the other team gets the opposite. Two teams on the same side is a config error. This field is optional and not in CONTRACTS.md yet.
- The mapping never changes from where players stand. `gamemode_rush.cfg` sets `mp_halftime 0`, so Rush never swaps sides. Round and match winners are credited from this mapping only.

Enforcement, all through the `jointeam` listener and without `ChangeTeam`:

- A match player may only join their team's side. Any other `jointeam`, spectator included, is blocked. The plugin tells the player their side and makes them run `jointeam <side>` on the next frame.
- `jointeam 0` (auto select) is redirected the same way and never counts against the player.
- After `rushsite_team_refusals` (default 3) wrong joins the player is kicked with "Your team plays CT in this match. Reconnect and join CT." They can reconnect. The disconnect grace applies.
- If the game puts a player on the wrong side without a `jointeam`, for example auto assign, the plugin sends them back, at most 5 times per player. After that it logs that something else is assigning teams.
- A side holds only its own team's players, so it never holds more than the team size. A join is refused when the side already has that many players who are not from the other team.
- A player who is not connected, or connected but not on their side, counts as not ready. `rushsite_status` shows the lineup, the players on the wrong side and whether warmup is held. Wrong-side players are reminded every 15 seconds.
- If Rush goes live anyway with players missing or off their side, the plugin logs it and scores by the config mapping.

## Steam authorization

A player counts as connected only once Steam has authorized their SteamID64. Both orders work:

- Authorized before `player_connect_full`: counted at `player_connect_full`.
- Authorized after `player_connect_full`: counted when `OnClientAuthorized` fires. A whitelisted player is counted and anyone else is kicked.
- Every second the plugin also counts any authorized, fully connected player it has not counted yet, in case an event was missed.

Abandon checks never list a match player who is on the server, authorized or not. A player waiting on Steam is logged once and left out of `missingSteamIds`. If they leave before authorizing, they count as missing again.

## Plugin reload and match state

The plugin writes `match_state.json` next to `match.json` on load, on every phase change and after every round. It holds the match id, phase, round, score per team, the Rush front slot and wins, whether the demo is recording, the last arena and player stats.

When CounterStrikeSharp hot-reloads the plugin and `match_state.json` has the same `matchId` as `match.json`, the plugin restores that state instead of starting again:

- No second `server_ready` or `match_started`. Warmup is not restarted.
- Round numbers, scores and stats continue.
- A match that was already decided ends on the score timer. A match that had ended stops and uploads its demo.
- In a series the map number, map wins, finished map results and series player totals are restored. A reload between maps goes on to the next map.

On a normal server start the file is ignored and overwritten, because CS2 itself restarted and the old state no longer matches the game. Webhook events still queued in memory at the moment of the reload are lost.

### Turn off hot reload on game hosts

Restoring is a safety net. The real fix is to never reload the plugin during a match. CounterStrikeSharp reloads a plugin whenever its DLL changes on disk, and the install is shared by every server on the box. Turn that off in `game/csgo/addons/counterstrikesharp/configs/core.json`:

```json
{
  "PluginHotReloadEnabled": false
}
```

Keep the other keys in that file as they are. The plugin logs a warning at load when hot reload is on. With it off, plugin updates take effect when a server restarts, so ship them through the agent drain like CS2 updates.

## Team assignment and the current CounterStrikeSharp breakage

On CS2 1.41.8.2 (build 2000913 and 2000914) the Linux vtable offsets moved:

- `ChangeTeam` silently does nothing.
- `Teleport` crashes the server.
- Entity listeners are unreliable.

No CounterStrikeSharp release has the fix yet. PRs #1432 and #1433 are open. The plugin is built to live with this:

- It never calls `Teleport` and uses no entity listeners.
- It never depends on `ChangeTeam`. Players join with the vanilla team menu, and the plugin validates the join through a `jointeam` command listener. In Rush it also makes players run `jointeam` with `ExecuteClientCommandFromServer`, which is unverified on the current build.
- `rushsite_try_changeteam 1` also calls `ChangeTeam` as a best effort once a fixed build ships. It is off by default.
- Kicks use the `kickid` console command, not `Disconnect`.

The plugin cannot be tested end to end until a fixed CounterStrikeSharp build is installed. That can be a release, or a build from the PR branch.

## Build

Requires the .NET 8 SDK for the default build.

```sh
cd plugin
dotnet build -c Release
dotnet test
```

The default build references `CounterStrikeSharp.API` 1.0.368, the last NuGet build that targets net8.0. Starting with 1.0.370, CounterStrikeSharp targets net10.0 and ships a .NET 10 runtime. Whether a net8.0 plugin loads and binds in that host has not been checked on a real server.

### net10 and the latest CounterStrikeSharp

The target lives in one place, `Directory.Build.props`:

```xml
<RushsiteRuntime Condition="'$(RushsiteRuntime)' == ''">net8</RushsiteRuntime>
```

Change `net8` to `net10` there, or pass it for one build:

```sh
dotnet build -c Release -p:RushsiteRuntime=net10
dotnet test -p:RushsiteRuntime=net10
```

`net10` sets `TargetFramework` to `net10.0` for all three projects and references the newest `CounterStrikeSharp.API` 1.0.x on NuGet. It needs the .NET 10 SDK. To pin the build that is deployed, which is what production should do, add `-p:CounterStrikeSharpVersion=1.0.374` or set that property in `Directory.Build.props`. The output then lands in `bin/Release/net10.0/`.

Switch once a CounterStrikeSharp release ships the CS2 1.41.8.2 fixes from PR #1432 and #1433, then:

1. Rerun the tests on net10.
2. Load the plugin on a test server and run `rushsite_status`.
3. Consider turning on `rushsite_try_changeteam`.

Layout:

- `src/RushsiteMatch.Core`: all logic. It has no CounterStrikeSharp dependency. It covers config, webhooks, stats, the start countdown, loadouts, series, score tracking, the controller and demo upload.
- `src/RushsiteMatch`: the CounterStrikeSharp adapter. It covers `RushsiteMatchPlugin` and `CssGameServer`, which implements `IGameServer`.
- `tests/RushsiteMatch.Tests`: xunit tests against Core, using fake game, clock, sink and uploader.

## Install

This needs Metamod:Source and CounterStrikeSharp, the with-runtime package, already installed on the server.

```sh
DEST=<cs2>/game/csgo/addons/counterstrikesharp/plugins/RushsiteMatch
mkdir -p "$DEST"
cp src/RushsiteMatch/bin/Release/net8.0/RushsiteMatch.dll \
   src/RushsiteMatch/bin/Release/net8.0/RushsiteMatch.Core.dll "$DEST"/
```

## Match config

The plugin looks for `match.json` in this order:

1. `RUSHSITE_MATCH_JSON` env var. The host agent sets it on each CS2 process.
2. `rushsite_match_config` convar.
3. `+rushsite_match_config <path>` on the command line, read from `/proc/self/cmdline` because the fake convar does not exist yet when the command line runs.
4. `match.json` in the `RUSHSITE_MATCH_DIR` directory.
5. `game/csgo/cfg/match.json`.

Relative paths resolve against `game/csgo`. If `RUSHSITE_MATCH_ID` is set and differs from `matchId`, the plugin refuses to start. The file is validated before use:

- The mode must be known.
- There must be exactly two teams.
- Every team member must be in `allowedSteamIds`, and every allowed id must be on a team.
- The ids must be SteamID64.
- `winCondition` must fit the mode.
- A team `side`, when set, must be `ct` or `t`, and the two teams must differ.
- `map` is optional. It is the launch map, and each `series.maps` entry has the same shape: `{ id, displayName?, workshopId?, mapName?, loadout? }`. Each needs a `workshopId` of digits or a `mapName` of letters, digits and `_`.
- `loadout` is optional: `{ primary?: { ct?, t? }, secondary?: { ct?, t? }, armor?: "none" | "kevlar" | "kevlar_helmet" }`. Weapons are `weapon_` engine names. A missing side leaves that slot empty, and armor defaults to kevlar and helmet.
- `series` is optional: `{ bestOf, maps, startMapNumber, wins, demoUploads }`. `bestOf` is odd, `maps` and `demoUploads` have `bestOf` entries, `startMapNumber` is in range, and `wins` uses team names and does not already decide the series.
- `brand` is optional: `{ name?, siteUrl? }`. `name` is the chat prefix, `[rushsite]` when missing. `siteUrl` is the web root for the match link printed at match end. A `siteUrl` that is not an absolute http(s) URL is ignored and no link is printed. Neither field fails the load.
- `slug` is optional. The match link is `<siteUrl>/matches/<slug>`, or `<siteUrl>/matches/<matchId>` without it.
- A team `displayName`, when set, is used in chat. Otherwise chat says `Team <name>`.

The plugin retries the load every second until it succeeds, and `rushsite_reload` retries it on demand.

## Server requirements

Launch the server with:

- `+tv_enable 1`, so `tv_record` works.
- `sv_hibernate_when_empty 0`, so timers run with no one on the server.
- `tv_autorecord 0`.

## Cvars

| Cvar | Default | Meaning |
|---|---|---|
| `rushsite_match_config` | empty | Path to match.json. Used when `RUSHSITE_MATCH_JSON` is not set |
| `rushsite_connect_grace` | 300 | Seconds for every player to connect once. Then match_abandoned `no_show` |
| `rushsite_disconnect_grace` | 180 | Seconds a player may stay away after leaving. Then match_abandoned `disconnected` |
| `rushsite_start_countdown` | 10 | Every mode. Countdown once every player is in and on their side, then warmup ends |
| `rushsite_aim_loadout` | 1 | Aim only. Hand out the map loadout, stop buying and fill empty weapon slots on spawn |
| `rushsite_aim_spawn_immunity` | 2 | Aim only. Seconds for `mp_respawn_immunitytime` |
| `rushsite_overtime_maxrounds` | 6 | Aim only. Rounds per overtime period for a tied map. 0 turns overtime off |
| `rushsite_overtime_startmoney` | 16000 | Aim only. `mp_overtime_startmoney` |
| `rushsite_series_map_break` | 30 | Series only. Minimum seconds between a map ending and the next loading |
| `rushsite_aim_halftime` | 0 | Aim only. Swap sides at halftime |
| `rushsite_pause_on_disconnect` | 1 | Aim only. `mp_pause_match` when a player drops, and unpause when all are back |
| `rushsite_match_end_wait` | 10 | Seconds to wait for `cs_win_panel_match` after the score decides the match |
| `rushsite_match_end_kick_delay` | 10 | Seconds the final score and match link stay on screen before everyone is kicked |
| `rushsite_demo_stop_extra` | 5 | Seconds added to `tv_delay` before `tv_stoprecord` |
| `rushsite_kick_bots` | 1 | Hold `bot_quota` at 0. `gamemode_rush.cfg` sets 2 |
| `rushsite_try_changeteam` | 0 | Also try `ChangeTeam` when a player must move. Broken on the current CS2 build |
| `rushsite_team_refusals` | 3 | Rush only. Wrong side joins before the player is kicked |
| `rushsite_rush_hold_warmup` | 1 | Rush only. Hold Valve's warmup timer until the start countdown ends warmup |
| `rushsite_webhook_max_attempts` | 10 | Attempts per webhook event before it is dropped |

The plugin sets these fake convars when it loads. To change them, use rcon or a cfg that is exec'd after the plugin loads. Durations are read when the match config loads.

## Commands

- `!ready` (`css_ready`): replies that the match starts on its own. There is no ready-up.
- Server console only:
  - `rushsite_status`: print the match status.
  - `rushsite_force_start`: start an aim match now.
  - `rushsite_reload`: load match.json again if no match is loaded.

## Events emitted

Each event is a POST to `webhookUrl`, used exactly as given, with body `{"event": MatchEvent}` and header `X-Rushsite-Signature: sha256=<hex HMAC-SHA256 of the body with webhookSecret>`.

Delivery:

- One worker sends events in order.
- A failed event is retried with exponential backoff: 1 s, doubling, capped at 30 s.
- A 5xx, 408, 429 or network error is retried. Any other 4xx is dropped at once.
- After `rushsite_webhook_max_attempts` attempts the event is dropped.

| Event | When |
|---|---|
| `server_ready` | match.json loaded and the server is set up |
| `player_connected` | a whitelisted player finishes connecting |
| `player_disconnected` | a whitelisted player leaves before the match ends, and in a series for everyone when the next map loads |
| `match_started` | aim: the start countdown ran out. Rush: the match goes live after the countdown ends warmup. Sent on every map of a series with `mapNumber` |
| `round_end` | every live round. `winnerTeam` is a team name, or `draw`. Rush adds `arena`. A series adds `mapNumber` and rounds restart at 1 on each map |
| `kill` | every frag between two match players in a live round, sent as it happens. See below |
| `map_end` | series only, after every map, the last one included. `{ mapNumber, mapId, winnerTeam, score, players, demoUploaded }`. `score` is rounds, `players` are this map's stats, `demoUploaded` is `false` |
| `match_end` | as soon as the match ends. `demoUploaded` is always `false` here. The upload is reported by `demo_uploaded`. In a series it is sent once, after the last `map_end`, with the series winner, `score` as maps won per team, `players` as totals across maps, and `maps: [{ mapNumber, mapId, winnerTeam, score }]` |
| `match_abandoned` | `reason` is `no_show`, `disconnected` or `map_load_failed`. `missingSteamIds` lists everyone not connected. Ends a whole series |
| `demo_uploaded` | `{ ok, bytes?, error?, mapNumber? }`, once a demo upload finishes. That is after `match_end`, `map_end` or `match_abandoned`. Not sent if recording never started |

`kill` is `{ round, tick, attacker, victim, weapon, headshot, wallbang, assister?, mapNumber? }`:

- `round` counts from 1. A kill after `round_end` and before the next `round_start` or `round_freeze_end` belongs to the round that just ended, so it arrives after that round's `round_end`.
- `tick` is `Server.TickCount`. `weapon` is the `player_death` weapon name, such as `ak47`, or `unknown`.
- `wallbang` is true when `penetrated` is above 0. `assister` is left out unless it is another match player.
- Suicides, world deaths and frags involving anyone off the whitelist are not sent. Team kills are sent, and do not count in the stats.

Stats cover live rounds only:

- Kills leave out team kills and suicides.
- Damage is the `dmg_health` from `player_hurt`, leaving out self damage and team damage.

## Demo

- The plugin runs `tv_record "rushsite_<matchId>"`, which writes `game/csgo/rushsite_<matchId>.dem`. In a series each map writes `rushsite_<matchId>_m<mapNumber>.dem`.
- `tv_record` writes the delayed GOTV stream, so `tv_stoprecord` waits for `tv_delay` + `rushsite_demo_stop_extra` seconds.
- The plugin waits until the file size stops changing, then PUTs it to `demoUpload.presignedPutUrl` with `Content-Type: application/octet-stream`. It makes 3 attempts.
- `match_end` goes out at once. Recording continues for `tv_delay` + `rushsite_demo_stop_extra` seconds, about 110 s in Rush because `gamemode_rush.cfg` sets `tv_delay 105`. The plugin does not change `tv_delay`.
- When the upload finishes, the plugin sends `demo_uploaded` with `ok`, the file size in `bytes`, and `error` on failure.
- After an abandon, the partial demo is recorded through the same delay, uploaded for review and reported by `demo_uploaded`.

## Game events used

| Event | Use | Rush notes |
|---|---|---|
| `player_connect_full` | presence and whitelist backup | standard |
| `player_disconnect` | presence and abandon timer | standard |
| `player_team` | side tracking | standard |
| `player_spawn` | aim loadout | not used |
| `round_freeze_end` | Rush live detection and arena detection | expected to fire. Unverified |
| `round_end` | score, round_end webhook | expected to fire through `map_params` `FireWinCondition`. The `reason` values in Rush are unverified |
| `round_start` | opens the next round for `kill` numbering | standard |
| `player_death`, `player_hurt` | stats and `kill` events | standard |
| `cs_win_panel_match` | preferred match end signal | unverified in Rush. It may not fire before `mp_match_end_restart`, so score tracking is the fallback |
| `round_announce_match_start`, `begin_new_match` | Rush live detection | unverified in Rush |

Also used:

- The `OnClientAuthorized` listener, for the whitelist kick and for players authorized after they connect.
- A `jointeam` command listener, for side validation in every mode.

Valve added no game events for Rush. A tower capture fires no event, so the plugin does not report captures.
