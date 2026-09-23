# RushsiteMatch

CounterStrikeSharp plugin that runs one rushsite match per CS2 server process. It reads `match.json`, enforces the whitelist and password, records the demo, tracks rounds and player stats, and posts match events to the API. Contracts are in `../docs/CONTRACTS.md`.

## What it does in each mode

The split is decided once, from `winCondition` in `match.json`. See `MatchController` in `src/RushsiteMatch.Core/Match/MatchController.cs`.

| | Aim (`first_to_N`, aim1v1 and aim2v2) | Rush (`valve_rush`, rush3v3) |
|---|---|---|
| Whitelist kick, `sv_password` check | yes | yes |
| `bot_quota 0` and `bot_kick`, re-checked every second | yes | yes |
| Warmup hold, `!ready` and `!unready` | yes | warmup held until all six are in and on their side, no `!ready` |
| Side validation on `jointeam` | yes, first team on a side claims it | yes, fixed from `match.json`. Wrong joins are redirected, repeated ones kicked |
| Sets `mp_maxrounds`, clinch, overtime and halftime | yes | no. Never touches any `mp_` round convar |
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
- `!ready` works only when the player is on the right side. Changing side clears ready.
- The match starts when everyone is connected and ready and the teams sit on opposite sides. It also starts `rushsite_ready_timeout` seconds after everyone connects, as long as the sides are valid.
- The mode cfg is exec'd again at match start because Valve's `gamemode_competitive.cfg` runs on map load after the agent's command line `+exec`. Without it aim plays with $800, buy zones and C4. It runs before `mp_warmup_pausetimer 0` (the cfg sets it to 1) and before `mp_warmup_end`, whose restart applies `mp_startmoney 16000`. Rush never runs it.
- On start the plugin runs these commands in order: `exec rushsite/matches/<matchId>/mode.cfg` (written by both drivers), `mp_maxrounds 2N-1`, `mp_match_can_clinch 1`, `mp_overtime_enable 0`, `mp_halftime 0|1`, `mp_warmup_pausetimer 0`, `tv_record`, `mp_warmup_end`. With 31 max rounds and clinch on, first to 16 always finishes without overtime.
- The score is kept per config team, so a halftime swap is handled.

### Rush

- Valve's `rush_001.js` owns round time, max rounds and the match end. The plugin never sets an `mp_` round convar.
- Teams are fixed from `match.json`. See "Rush teams" below.
- Warmup is held with `mp_warmup_pausetimer 1` until every player is connected and on their side. Then the plugin sets it to 0 and Valve's warmup timer runs out as normal. Turn this off with `rushsite_rush_hold_warmup 0`.
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
- In aim warmup, ready state is lost and players type `!ready` again.

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

- `src/RushsiteMatch.Core`: all logic. It has no CounterStrikeSharp dependency. It covers config, webhooks, stats, ready-up, score tracking, the controller and demo upload.
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
| `rushsite_ready_timeout` | 180 | Aim only. Seconds after everyone connects before the match starts without all ready |
| `rushsite_aim_halftime` | 0 | Aim only. Swap sides at halftime |
| `rushsite_pause_on_disconnect` | 1 | Aim only. `mp_pause_match` when a player drops, and unpause when all are back |
| `rushsite_match_end_wait` | 10 | Seconds to wait for `cs_win_panel_match` after the score decides the match |
| `rushsite_demo_stop_extra` | 5 | Seconds added to `tv_delay` before `tv_stoprecord` |
| `rushsite_kick_bots` | 1 | Hold `bot_quota` at 0. `gamemode_rush.cfg` sets 2 |
| `rushsite_try_changeteam` | 0 | Also try `ChangeTeam` when a player must move. Broken on the current CS2 build |
| `rushsite_team_refusals` | 3 | Rush only. Wrong side joins before the player is kicked |
| `rushsite_rush_hold_warmup` | 1 | Rush only. Hold warmup until every player is in and on their side |
| `rushsite_webhook_max_attempts` | 10 | Attempts per webhook event before it is dropped |

The plugin sets these fake convars when it loads. To change them, use rcon or a cfg that is exec'd after the plugin loads. Durations are read when the match config loads.

## Commands

- `!ready` and `!unready` (`css_ready`, `css_unready`): aim modes only.
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
| `player_disconnected` | a whitelisted player leaves before the match ends |
| `match_started` | aim: ready-up done. Rush: the match goes live |
| `round_end` | every live round. `winnerTeam` is a team name, or `draw`. Rush adds `arena` |
| `kill` | every frag between two match players in a live round, sent as it happens. See below |
| `match_end` | as soon as the match ends. `demoUploaded` is always `false` here. The upload is reported by `demo_uploaded` |
| `match_abandoned` | `reason` is `no_show` or `disconnected`. `missingSteamIds` lists everyone not connected |
| `demo_uploaded` | `{ ok, bytes?, error? }`, once the demo upload after `match_end` or `match_abandoned` finishes. Not sent if recording never started |

`kill` is `{ round, tick, attacker, victim, weapon, headshot, wallbang, assister? }`:

- `round` counts from 1. A kill after `round_end` and before the next `round_start` or `round_freeze_end` belongs to the round that just ended, so it arrives after that round's `round_end`.
- `tick` is `Server.TickCount`. `weapon` is the `player_death` weapon name, such as `ak47`, or `unknown`.
- `wallbang` is true when `penetrated` is above 0. `assister` is left out unless it is another match player.
- Suicides, world deaths and frags involving anyone off the whitelist are not sent. Team kills are sent, and do not count in the stats.

Stats cover live rounds only:

- Kills leave out team kills and suicides.
- Damage is the `dmg_health` from `player_hurt`, leaving out self damage and team damage.

## Demo

- The plugin runs `tv_record "rushsite_<matchId>"`, which writes `game/csgo/rushsite_<matchId>.dem`.
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
